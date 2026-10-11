package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type S3 struct {
	Endpoint       string // reached from inside the stack, e.g. http://garage:3900
	PublicEndpoint string // reached by browsers, used only to sign upload URLs
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
}

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	PublicURL   string
	S3          S3
	CORSOrigins []string

	// Sign-in. GoogleClientID switches Google sign-in on; AllowedEmails says
	// which Google accounts may come in (empty: nobody).
	GoogleClientID string
	AllowedEmails  []string
	// DevLogin offers a one-click sign-in without Google. Config refuses it
	// anywhere but localhost.
	DevLogin bool
	// OriginSecret, when set, must arrive on every request in the
	// X-Origin-Auth header. The Cloudflare proxy adds it; nobody else can.
	OriginSecret string

	MaxUploadBytes    int64
	WorkerConcurrency int
	TrashRetention    time.Duration
	GIFMaxSeconds     int
}

func Load() (Config, error) {
	c := Config{
		HTTPAddr:    env("HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		PublicURL:   strings.TrimRight(env("PUBLIC_URL", "http://localhost:8080"), "/"),
		S3: S3{
			Endpoint:       os.Getenv("S3_ENDPOINT"),
			PublicEndpoint: os.Getenv("S3_PUBLIC_ENDPOINT"),
			Region:         env("S3_REGION", "garage"),
			Bucket:         env("S3_BUCKET", "prismo"),
			AccessKey:      os.Getenv("S3_ACCESS_KEY"),
			SecretKey:      os.Getenv("S3_SECRET_KEY"),
		},
		GoogleClientID:    strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")),
		DevLogin:          os.Getenv("DEV_LOGIN") == "1",
		OriginSecret:      strings.TrimSpace(os.Getenv("ORIGIN_SECRET")),
		MaxUploadBytes:    int64(envInt("MAX_UPLOAD_MB", 500)) << 20,
		WorkerConcurrency: envInt("WORKER_CONCURRENCY", 2),
		TrashRetention:    time.Duration(envInt("TRASH_RETENTION_DAYS", 30)) * 24 * time.Hour,
		GIFMaxSeconds:     envInt("GIF_MAX_SECONDS", 30),
	}
	if c.S3.PublicEndpoint == "" {
		c.S3.PublicEndpoint = c.S3.Endpoint
	}

	for name, v := range map[string]string{
		"DATABASE_URL":  c.DatabaseURL,
		"S3_ENDPOINT":   c.S3.Endpoint,
		"S3_ACCESS_KEY": c.S3.AccessKey,
		"S3_SECRET_KEY": c.S3.SecretKey,
	} {
		if v == "" {
			return c, fmt.Errorf("%s is required", name)
		}
	}
	for name, v := range map[string]string{
		"PUBLIC_URL":         c.PublicURL,
		"S3_ENDPOINT":        c.S3.Endpoint,
		"S3_PUBLIC_ENDPOINT": c.S3.PublicEndpoint,
	} {
		if u, err := url.Parse(v); err != nil || u.Scheme == "" || u.Host == "" {
			return c, fmt.Errorf("%s must be a full URL, got %q", name, v)
		}
	}

	if c.DevLogin {
		// Fail at start rather than quietly leave an open door on a server.
		if host := mustHost(c.PublicURL); host != "localhost" && host != "127.0.0.1" && host != "::1" {
			return c, errors.New("DEV_LOGIN=1 is only allowed when PUBLIC_URL is on localhost")
		}
	}
	for _, e := range strings.Split(os.Getenv("ALLOWED_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AllowedEmails = append(c.AllowedEmails, e)
		}
	}

	c.CORSOrigins = []string{c.PublicURL}
	for _, o := range strings.Split(os.Getenv("CORS_ORIGINS"), ",") {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" && o != c.PublicURL {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	if c.WorkerConcurrency < 1 {
		c.WorkerConcurrency = 1
	}
	return c, nil
}

// EmailAllowed reports whether a Google account may sign in.
func (c Config) EmailAllowed(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, allowed := range c.AllowedEmails {
		if email == allowed {
			return true
		}
	}
	return false
}

func mustHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return n
	}
	return fallback
}
