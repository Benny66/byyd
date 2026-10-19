package store

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrNicknameTaken  = errors.New("nickname_taken")
	ErrDeviceNotFound = errors.New("device_not_found")
)

// Store 是 SQLite 的唯一入口。
type Store struct {
	db *sql.DB
}

type Device struct {
	ID        string
	Nickname  string
	OptIn     bool
	CreatedAt int64
}

type SessionInput struct {
	ID        string
	DeviceID  string
	Day       string
	StartedAt int64
	EndedAt   int64
	Seconds   int
	Mode      string
}

// LeaderRow 是对外榜单行；DeviceID 只用于定位“我”，不参与序列化。
type LeaderRow struct {
	DeviceID   string `json:"-"`
	Rank       int    `json:"rank"`
	Nickname   string `json:"nickname"`
	Days       int    `json:"days"`
	Minutes    int    `json:"minutes"`
	TodayCount int    `json:"todayCount"`
}

type Leaderboard struct {
	WeekStart string
	WeekEnd   string
	UpdatedAt int64
	Rows      []LeaderRow
}

func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create data dir: %w", err)
		}
	}

	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)",
		path,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Ping() error { return s.db.Ping() }

type migration struct {
	version int
	stmts   []string
}

var migrations = []migration{
	{
		version: 1,
		stmts: []string{
			`CREATE TABLE IF NOT EXISTS devices (
				id TEXT PRIMARY KEY,
				nickname TEXT NOT NULL,
				opt_in INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_nickname ON devices(nickname COLLATE NOCASE)`,
			`CREATE TABLE IF NOT EXISTS sessions (
				id TEXT NOT NULL,
				device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
				day TEXT NOT NULL,
				started_at INTEGER NOT NULL,
				ended_at INTEGER NOT NULL,
				seconds INTEGER NOT NULL,
				mode TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (device_id, id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_device_day ON sessions(device_id, day)`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day)`,
		},
	},
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	for _, m := range migrations {
		var applied int
		if err := s.db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, m.version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %d: %w", m.version, err)
		}
		if applied > 0 {
			continue
		}

		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.version, err)
		}
		for _, stmt := range m.stmts {
			if _, err := tx.Exec(stmt); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("apply migration %d: %w", m.version, err)
			}
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, m.version, time.Now().Unix()); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.version, err)
		}
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") || strings.Contains(message, "constraint failed")
}

// UpsertDevice 注册或更新设备；昵称大小写不敏感唯一。
func (s *Store) UpsertDevice(id, nickname string, optIn bool) (Device, error) {
	now := time.Now().Unix()

	var owner string
	err := s.db.QueryRow(`SELECT id FROM devices WHERE nickname = ? COLLATE NOCASE`, nickname).Scan(&owner)
	if err == nil && owner != id {
		return Device{}, ErrNicknameTaken
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Device{}, err
	}

	_, err = s.db.Exec(`
		INSERT INTO devices (id, nickname, opt_in, created_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			nickname = excluded.nickname,
			opt_in = excluded.opt_in,
			last_seen_at = excluded.last_seen_at`,
		id, nickname, boolToInt(optIn), now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return Device{}, ErrNicknameTaken
		}
		return Device{}, err
	}

	var device Device
	var opt int
	if err := s.db.QueryRow(`SELECT id, nickname, opt_in, created_at FROM devices WHERE id = ?`, id).
		Scan(&device.ID, &device.Nickname, &opt, &device.CreatedAt); err != nil {
		return Device{}, err
	}
	device.OptIn = opt == 1
	return device, nil
}

func (s *Store) GetDevice(id string) (Device, error) {
	var device Device
	var opt int
	err := s.db.QueryRow(`SELECT id, nickname, opt_in, created_at FROM devices WHERE id = ?`, id).
		Scan(&device.ID, &device.Nickname, &opt, &device.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Device{}, ErrDeviceNotFound
	}
	if err != nil {
		return Device{}, err
	}
	device.OptIn = opt == 1
	return device, nil
}

func (s *Store) DeleteDevice(id string) (bool, error) {
	result, err := s.db.Exec(`DELETE FROM devices WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// InsertSession 幂等写入，返回是否真的新增。
func (s *Store) InsertSession(in SessionInput) (bool, error) {
	result, err := s.db.Exec(`
		INSERT INTO sessions (id, device_id, day, started_at, ended_at, seconds, mode, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(device_id, id) DO NOTHING`,
		in.ID, in.DeviceID, in.Day, in.StartedAt, in.EndedAt, in.Seconds, in.Mode, time.Now().Unix())
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func (s *Store) CountSessionsForDay(deviceID, day string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(1) FROM sessions WHERE device_id = ? AND day = ?`, deviceID, day).Scan(&count)
	return count, err
}

type dayAggregate struct {
	deviceID   string
	nickname   string
	createdAt  int64
	days       int
	fullSecs   int64
	todayCount int
}

// Leaderboard 返回本周完整榜单（已排序、已编号），调用方按需截断与定位“我”。
func (s *Store) Leaderboard(weekStart, weekEnd, today string) (Leaderboard, error) {
	rows, err := s.db.Query(`
		SELECT s.device_id, d.nickname, d.created_at, s.day,
		       SUM(CASE WHEN s.mode = 'full' THEN s.seconds ELSE 0 END) AS full_secs,
		       SUM(CASE WHEN s.mode = 'full' THEN 1 ELSE 0 END) AS full_count,
		       COUNT(1) AS total_count
		FROM sessions s
		JOIN devices d ON d.id = s.device_id
		WHERE s.day BETWEEN ? AND ? AND d.opt_in = 1
		GROUP BY s.device_id, s.day`,
		weekStart, weekEnd)
	if err != nil {
		return Leaderboard{}, err
	}
	defer rows.Close()

	aggregates := make(map[string]*dayAggregate)
	for rows.Next() {
		var deviceID, nickname, day string
		var createdAt, fullSecs int64
		var fullCount, totalCount int
		if err := rows.Scan(&deviceID, &nickname, &createdAt, &day, &fullSecs, &fullCount, &totalCount); err != nil {
			return Leaderboard{}, err
		}
		agg, ok := aggregates[deviceID]
		if !ok {
			agg = &dayAggregate{deviceID: deviceID, nickname: nickname, createdAt: createdAt}
			aggregates[deviceID] = agg
		}
		if fullCount > 0 {
			agg.days++
			agg.fullSecs += fullSecs
		}
		_ = totalCount
	}
	if err := rows.Err(); err != nil {
		return Leaderboard{}, err
	}

	todayRows, err := s.db.Query(`
		SELECT s.device_id, COUNT(1)
		FROM sessions s
		JOIN devices d ON d.id = s.device_id
		WHERE s.day = ? AND d.opt_in = 1
		GROUP BY s.device_id`, today)
	if err != nil {
		return Leaderboard{}, err
	}
	defer todayRows.Close()
	for todayRows.Next() {
		var deviceID string
		var count int
		if err := todayRows.Scan(&deviceID, &count); err != nil {
			return Leaderboard{}, err
		}
		if agg, ok := aggregates[deviceID]; ok {
			agg.todayCount = count
		}
	}
	if err := todayRows.Err(); err != nil {
		return Leaderboard{}, err
	}

	list := make([]*dayAggregate, 0, len(aggregates))
	for _, agg := range aggregates {
		list = append(list, agg)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].days != list[j].days {
			return list[i].days > list[j].days
		}
		if list[i].fullSecs != list[j].fullSecs {
			return list[i].fullSecs > list[j].fullSecs
		}
		return list[i].createdAt < list[j].createdAt
	})

	result := Leaderboard{
		WeekStart: weekStart,
		WeekEnd:   weekEnd,
		UpdatedAt: time.Now().Unix(),
		Rows:      make([]LeaderRow, 0, len(list)),
	}
	for index, agg := range list {
		result.Rows = append(result.Rows, LeaderRow{
			DeviceID:   agg.deviceID,
			Rank:       index + 1,
			Nickname:   agg.nickname,
			Days:       agg.days,
			Minutes:    int(math.Round(float64(agg.fullSecs) / 60)),
			TodayCount: agg.todayCount,
		})
	}
	return result, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
