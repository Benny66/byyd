package main

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"beiyun/server/internal/api"
	"beiyun/server/internal/store"
	"beiyun/server/internal/web"
)

// 环境变量统一加 BEIYUN_ 前缀，避免与同机其他项目或 shell profile 里的
// ADDR / DB_PATH 之类通用名撞车。
const envPrefix = "BEIYUN_"

func main() {
	addr := env("ADDR", ":8787")
	dbPath := env("DB_PATH", "data/app.db")

	st, err := store.Open(dbPath)
	if err != nil {
		slog.Error("open store", "error", err)
		os.Exit(1)
	}
	defer func() { _ = st.Close() }()

	webRoot, err := fs.Sub(web.Assets, "dist")
	if err != nil {
		slog.Error("mount web assets", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           api.New(st, webRoot).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		slog.Info("beiyun server listening", "addr", addr, "db", dbPath)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		slog.Error("shutdown", "error", err)
	}
}

// env 只认带前缀的变量。发现还配着旧的无前缀变量时直接退出而不是回落默认值：
// 否则会带着 `data/app.db` 这样的相对路径启动，看起来像数据凭空消失。
func env(key, fallback string) string {
	prefixed := envPrefix + key
	if value := os.Getenv(prefixed); value != "" {
		return value
	}
	if legacy := os.Getenv(key); legacy != "" {
		slog.Error(
			"检测到未加前缀的环境变量，请改名后重启",
			"ignored", key,
			"expected", prefixed,
		)
		os.Exit(1)
	}
	return fallback
}
