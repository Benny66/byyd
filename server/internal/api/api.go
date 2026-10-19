package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"beiyun/server/internal/store"

	_ "time/tzdata"
)

const (
	maxBodyBytes       = 32 << 10
	leaderboardTTL     = 30 * time.Second
	rateLimitPerMinute = 120
	maxSessionsPerDay  = 20
	backfillDays       = 7
)

var shanghai = mustLocation("Asia/Shanghai")

type Server struct {
	store   *store.Store
	web     fs.FS
	limiter *rateLimiter

	mu       sync.Mutex
	cached   *store.Leaderboard
	cachedAt time.Time
}

func New(st *store.Store, web fs.FS) *Server {
	return &Server{store: st, web: web, limiter: newRateLimiter(rateLimitPerMinute)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/devices", s.handleUpsertDevice)
	mux.HandleFunc("PATCH /api/v1/devices/{id}", s.handlePatchDevice)
	mux.HandleFunc("DELETE /api/v1/devices/{id}", s.handleDeleteDevice)
	mux.HandleFunc("POST /api/v1/sessions", s.handleSession)
	mux.HandleFunc("GET /api/v1/leaderboard", s.handleLeaderboard)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("/", s.handleStatic)

	return s.recoverMiddleware(s.logMiddleware(s.rateLimitMiddleware(mux)))
}

/* ------------------------------------------------------------------ 中间件 */

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic", "path", r.URL.Path, "error", rec)
				writeError(w, http.StatusInternalServerError, "internal_error", "服务器开小差了")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		writer := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(writer, r)
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			slog.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", writer.status,
				"ms", time.Since(start).Milliseconds(),
				"ip", clientIP(r),
			)
		}
	})
}

func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && !s.limiter.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "rate_limited", "请求太频繁，请稍后再试")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  int64
	counts  map[string]int
}

func newRateLimiter(limit int) *rateLimiter {
	return &rateLimiter{limit: limit, counts: make(map[string]int)}
}

func (l *rateLimiter) allow(key string) bool {
	window := time.Now().Unix() / 60
	l.mu.Lock()
	defer l.mu.Unlock()
	if window != l.window {
		l.window = window
		l.counts = make(map[string]int)
	}
	l.counts[key]++
	return l.counts[key] <= l.limit
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

/* ------------------------------------------------------------------ 设备 */

type deviceRequest struct {
	DeviceID string `json:"deviceId"`
	Nickname string `json:"nickname"`
	OptIn    bool   `json:"optIn"`
}

type deviceResponse struct {
	DeviceID string `json:"deviceId"`
	Nickname string `json:"nickname"`
	OptIn    bool   `json:"optIn"`
}

func (s *Server) handleUpsertDevice(w http.ResponseWriter, r *http.Request) {
	var req deviceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !validID(req.DeviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id", "设备标识不合法")
		return
	}
	nickname, ok := normalizeNickname(req.Nickname)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_nickname", "昵称需要 1–16 个字符")
		return
	}

	device, err := s.store.UpsertDevice(req.DeviceID, nickname, req.OptIn)
	if err != nil {
		if errors.Is(err, store.ErrNicknameTaken) {
			writeError(w, http.StatusConflict, "nickname_taken", "这个昵称已经被用了，换一个吧")
			return
		}
		slog.Error("upsert device", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "保存失败")
		return
	}
	s.invalidateLeaderboard()
	writeJSON(w, http.StatusOK, deviceResponse{DeviceID: device.ID, Nickname: device.Nickname, OptIn: device.OptIn})
}

func (s *Server) handlePatchDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("id")
	if !validID(deviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id", "设备标识不合法")
		return
	}
	var req struct {
		Nickname string `json:"nickname"`
		OptIn    bool   `json:"optIn"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	nickname, ok := normalizeNickname(req.Nickname)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_nickname", "昵称需要 1–16 个字符")
		return
	}
	device, err := s.store.UpsertDevice(deviceID, nickname, req.OptIn)
	if err != nil {
		if errors.Is(err, store.ErrNicknameTaken) {
			writeError(w, http.StatusConflict, "nickname_taken", "这个昵称已经被用了，换一个吧")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", "保存失败")
		return
	}
	s.invalidateLeaderboard()
	writeJSON(w, http.StatusOK, deviceResponse{DeviceID: device.ID, Nickname: device.Nickname, OptIn: device.OptIn})
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("id")
	if !validID(deviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id", "设备标识不合法")
		return
	}
	deleted, err := s.store.DeleteDevice(deviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "删除失败")
		return
	}
	s.invalidateLeaderboard()
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

/* ------------------------------------------------------------------ 训练记录 */

type sessionRequest struct {
	ID        string `json:"id"`
	DeviceID  string `json:"deviceId"`
	Day       string `json:"day"`
	StartedAt int64  `json:"startedAt"`
	EndedAt   int64  `json:"endedAt"`
	Seconds   int    `json:"seconds"`
	Mode      string `json:"mode"`
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	var req sessionRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if !validID(req.ID) {
		writeError(w, http.StatusBadRequest, "invalid_session_id", "记录标识不合法")
		return
	}
	if !validID(req.DeviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id", "设备标识不合法")
		return
	}
	if req.Seconds < 60 || req.Seconds > 2400 {
		writeError(w, http.StatusBadRequest, "invalid_seconds", "训练时长不在合理范围")
		return
	}
	if req.Mode != "full" && req.Mode != "partial" {
		writeError(w, http.StatusBadRequest, "invalid_mode", "训练模式不合法")
		return
	}
	if req.StartedAt <= 0 || req.EndedAt < req.StartedAt {
		writeError(w, http.StatusBadRequest, "invalid_time", "时间戳不合法")
		return
	}
	now := time.Now().UnixMilli()
	if req.EndedAt > now+24*60*60*1000 || req.EndedAt < now-8*24*60*60*1000 {
		writeError(w, http.StatusBadRequest, "invalid_time", "训练时间不在合理范围")
		return
	}

	today := todayString()
	if !validDay(req.Day) {
		writeError(w, http.StatusBadRequest, "invalid_day", "归属日不合法")
		return
	}
	diff := dayDiff(today, req.Day)
	if diff < -1 || diff > backfillDays {
		writeError(w, http.StatusBadRequest, "day_out_of_range", "归属日超出允许范围")
		return
	}

	if _, err := s.store.GetDevice(req.DeviceID); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			writeError(w, http.StatusNotFound, "device_not_found", "设备未注册")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", "读取设备失败")
		return
	}

	count, err := s.store.CountSessionsForDay(req.DeviceID, req.Day)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "统计失败")
		return
	}
	if count >= maxSessionsPerDay {
		writeError(w, http.StatusTooManyRequests, "daily_limit", "今天的记录条数已达上限")
		return
	}

	created, err := s.store.InsertSession(store.SessionInput{
		ID:        req.ID,
		DeviceID:  req.DeviceID,
		Day:       req.Day,
		StartedAt: req.StartedAt,
		EndedAt:   req.EndedAt,
		Seconds:   req.Seconds,
		Mode:      req.Mode,
	})
	if err != nil {
		slog.Error("insert session", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "保存失败")
		return
	}
	if created {
		s.invalidateLeaderboard()
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"accepted": true, "duplicate": !created})
}

/* ------------------------------------------------------------------ 榜单 */

type leaderboardRow struct {
	Rank       int    `json:"rank"`
	Nickname   string `json:"nickname"`
	Days       int    `json:"days"`
	Minutes    int    `json:"minutes"`
	TodayCount int    `json:"todayCount"`
}

type leaderboardMe struct {
	Rank       int  `json:"rank"`
	Days       int  `json:"days"`
	Minutes    int  `json:"minutes"`
	TodayCount int  `json:"todayCount"`
	InTop      bool `json:"inTop"`
}

type leaderboardResponse struct {
	WeekStart string           `json:"weekStart"`
	WeekEnd   string           `json:"weekEnd"`
	UpdatedAt int64            `json:"updatedAt"`
	Rows      []leaderboardRow `json:"rows"`
	Me        *leaderboardMe   `json:"me"`
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 100 {
		limit = 100
	}

	today := todayString()
	weekStart, weekEnd := weekRange(today)
	board := s.leaderboardCache(weekStart, weekEnd, today)

	rows := board.Rows
	if len(rows) > limit {
		rows = rows[:limit]
	}

	response := leaderboardResponse{
		WeekStart: board.WeekStart,
		WeekEnd:   board.WeekEnd,
		UpdatedAt: board.UpdatedAt,
		Rows:      make([]leaderboardRow, 0, len(rows)),
	}
	for _, row := range rows {
		response.Rows = append(response.Rows, leaderboardRow{
			Rank:       row.Rank,
			Nickname:   row.Nickname,
			Days:       row.Days,
			Minutes:    row.Minutes,
			TodayCount: row.TodayCount,
		})
	}

	if deviceID := r.URL.Query().Get("deviceId"); deviceID != "" {
		for _, row := range board.Rows {
			if row.DeviceID == deviceID {
				response.Me = &leaderboardMe{
					Rank:       row.Rank,
					Days:       row.Days,
					Minutes:    row.Minutes,
					TodayCount: row.TodayCount,
					InTop:      row.Rank <= len(rows),
				}
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *Server) leaderboardCache(weekStart, weekEnd, today string) store.Leaderboard {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cached != nil && time.Since(s.cachedAt) < leaderboardTTL &&
		s.cached.WeekStart == weekStart && s.cached.WeekEnd == weekEnd {
		return *s.cached
	}

	board, err := s.store.Leaderboard(weekStart, weekEnd, today)
	if err != nil {
		slog.Error("leaderboard", "error", err)
		return store.Leaderboard{WeekStart: weekStart, WeekEnd: weekEnd, UpdatedAt: time.Now().Unix(), Rows: nil}
	}
	s.cached = &board
	s.cachedAt = time.Now()
	return board
}

func (s *Server) invalidateLeaderboard() {
	s.mu.Lock()
	s.cached = nil
	s.mu.Unlock()
}

/* ------------------------------------------------------------------ 健康与静态资源 */

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "error", "db": "down"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "db": "ok"})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found", "接口不存在")
		return
	}

	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	if strings.HasSuffix(r.URL.Path, "/") {
		name = path.Join(name, "index.html")
	}

	info, err := fs.Stat(s.web, name)
	if err != nil || info.IsDir() {
		s.serveEmbedded(w, r, "200.html")
		return
	}
	s.serveEmbedded(w, r, name)
}

func (s *Server) serveEmbedded(w http.ResponseWriter, r *http.Request, name string) {
	data, err := fs.ReadFile(s.web, name)
	if err != nil {
		if fallback, fallbackErr := fs.ReadFile(s.web, "index.html"); fallbackErr == nil {
			writeAsset(w, r, "index.html", fallback)
			return
		}
		http.NotFound(w, r)
		return
	}
	writeAsset(w, r, name, data)
}

func writeAsset(w http.ResponseWriter, r *http.Request, name string, data []byte) {
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	if strings.HasPrefix(contentType, "text/") && !strings.Contains(contentType, "charset") {
		contentType += "; charset=utf-8"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if strings.HasPrefix(name, "_nuxt/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

/* ------------------------------------------------------------------ 工具 */

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	body := http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(body)
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "empty_body", "请求体为空")
			return false
		}
		writeError(w, http.StatusBadRequest, "invalid_json", "请求体不是合法 JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func validID(value string) bool {
	if len(value) < 8 || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' || char == '_' {
			continue
		}
		return false
	}
	return true
}

func normalizeNickname(value string) (string, bool) {
	nickname := strings.TrimSpace(value)
	nickname = strings.Join(strings.Fields(nickname), " ")
	if utf8.RuneCountInString(nickname) < 1 || utf8.RuneCountInString(nickname) > 16 {
		return "", false
	}
	for _, char := range nickname {
		if unicode.IsControl(char) {
			return "", false
		}
	}
	return nickname, true
}

func mustLocation(name string) *time.Location {
	location, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("load timezone %s: %v", name, err))
	}
	return location
}

func todayString() string {
	return time.Now().In(shanghai).Format("2006-01-02")
}

func parseDay(day string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", day, shanghai)
}

func validDay(day string) bool {
	parsed, err := parseDay(day)
	return err == nil && parsed.Format("2006-01-02") == day
}

// dayDiff 返回 a - b 的天数差。
func dayDiff(a, b string) int {
	parsedA, errA := parseDay(a)
	parsedB, errB := parseDay(b)
	if errA != nil || errB != nil {
		return 9999
	}
	return int(parsedA.Sub(parsedB).Hours() / 24)
}

func weekRange(today string) (string, string) {
	parsed, err := parseDay(today)
	if err != nil {
		return today, today
	}
	offset := (int(parsed.Weekday()) + 6) % 7
	start := parsed.AddDate(0, 0, -offset)
	return start.Format("2006-01-02"), start.AddDate(0, 0, 6).Format("2006-01-02")
}
