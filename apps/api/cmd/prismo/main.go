// Command prismo is the Prismo Cloud server. One binary, two roles:
//
//	prismo serve   HTTP API
//	prismo work    background jobs (needs ffmpeg and ffprobe on PATH)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"prismocloud/internal/api"
	"prismocloud/internal/blob"
	"prismocloud/internal/config"
	"prismocloud/internal/store"
	"prismocloud/internal/worker"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if len(os.Args) != 2 || (os.Args[1] != "serve" && os.Args[1] != "work") {
		fmt.Fprintln(os.Stderr, "usage: prismo serve | prismo work")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1]); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, role string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		return err
	}
	bl, err := blob.New(cfg.S3)
	if err != nil {
		return err
	}
	if err := waitForStorage(ctx, bl); err != nil {
		return err
	}

	if role == "work" {
		worker.New(cfg, st, bl).Run(ctx)
		return nil
	}

	if err := bl.EnsureCORS(ctx, cfg.CORSOrigins); err != nil {
		// Only browser uploads depend on this; everything else still works.
		slog.Warn("could not set bucket CORS rules; browser uploads may be refused", "err", err)
	}
	switch {
	case cfg.GoogleClientID == "" && !cfg.DevLogin:
		slog.Warn("GOOGLE_CLIENT_ID is not set; nobody can sign in")
	case cfg.GoogleClientID != "" && len(cfg.AllowedEmails) == 0:
		slog.Warn("ALLOWED_EMAILS is empty; Google sign-in will refuse everyone")
	case cfg.DevLogin:
		slog.Warn("DEV_LOGIN=1: anyone who can reach this server can sign in without Google")
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           api.New(cfg, st, bl).Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	failed := make(chan error, 1)
	go func() { failed <- srv.ListenAndServe() }()
	slog.Info("api listening", "addr", cfg.HTTPAddr, "public_url", cfg.PublicURL)

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	// Let requests in flight (uploads, mostly) finish before exiting.
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// waitForStorage gives the object store time to come up and create the bucket.
func waitForStorage(ctx context.Context, bl *blob.Client) error {
	deadline := time.Now().Add(60 * time.Second)
	for {
		err := bl.Ready(ctx)
		if err == nil {
			return nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return fmt.Errorf("object storage not ready: %w", err)
		}
		time.Sleep(2 * time.Second)
	}
}
