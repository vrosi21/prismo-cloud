// Package api is the HTTP surface: JSON under /v1, public media under /i and /s.
package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"prismocloud/internal/auth"
	"prismocloud/internal/blob"
	"prismocloud/internal/config"
	"prismocloud/internal/googleid"
	"prismocloud/internal/store"
)

// Access levels, lowest to highest. A capture client gets an upload-only
// token, so a leaked ShareX config cannot read or delete the library.
const (
	levelUpload  = 1 // API token with scope "upload": may add files
	levelDevice  = 2 // API token with scope "device": may also look
	levelFull    = 3 // API token with scope "full": may also change and delete
	levelSession = 4 // logged-in browser
)

const sessionCookie = "prismo_session"
const sessionTTL = 30 * 24 * time.Hour

// Where Google posts its answer. The same path must be listed as an
// authorised redirect URI on the Google OAuth client.
const googleCallbackPath = "/v1/auth/google/callback"

type Server struct {
	cfg    config.Config
	store  *store.Store
	blob   *blob.Client
	google *googleid.Verifier // nil when Google sign-in is not configured
}

func New(cfg config.Config, st *store.Store, bl *blob.Client) *Server {
	s := &Server{cfg: cfg, store: st, blob: bl}
	if cfg.GoogleClientID != "" {
		s.google = googleid.New(cfg.GoogleClientID)
	}
	return s
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer, s.originOnly, requestLog)

	r.Get("/healthz", s.health)
	r.Get("/i/{name}", s.publicFile)
	r.Get("/s/{slug}", s.sharePage)

	r.Route("/v1", func(r chi.Router) {
		r.Use(s.sameOrigin)
		r.Get("/auth/config", s.authConfig)
		r.Get("/auth/google/start", s.googleStart)
		r.Post("/auth/google/callback", s.googleCallback)
		r.Post("/auth/dev", s.devLogin)
		r.Post("/auth/logout", s.logout)
		r.Get("/invites/{token}", s.inviteInfo)

		r.Group(func(r chi.Router) {
			r.Use(s.require(levelUpload))
			r.Post("/upload", s.uploadDirect)
			r.Post("/assets", s.createAsset)
			r.Post("/assets/{id}/complete", s.completeAsset)
		})

		// Looking: a browser, or a program on the owner's computer.
		r.Group(func(r chi.Router) {
			r.Use(s.require(levelDevice))
			r.Get("/me", s.me)
			r.Get("/stats", s.stats)
			r.Get("/tags", s.tags)
			r.Get("/assets", s.listAssets)
			r.Get("/assets/{id}", s.getAsset)
			r.Get("/assets/{id}/file", s.assetFile)
			r.Get("/collections", s.listCollections)
			r.Get("/shared", s.sharedWithMe)
			r.Get("/shared/folders/{id}/assets", s.sharedFolderAssets)
		})

		// Changing and deleting.
		r.Group(func(r chi.Router) {
			r.Use(s.require(levelFull))
			r.Patch("/assets/{id}", s.updateAsset)
			r.Delete("/assets/{id}", s.deleteAsset)
			r.Post("/assets/{id}/restore", s.restoreAsset)

			// A guest has no library of their own to organise.
			r.Group(func(r chi.Router) {
				r.Use(s.memberOnly)
				r.Post("/assets/bulk", s.bulkAssets)
				r.Post("/collections", s.createCollection)
				r.Patch("/collections/{id}", s.updateCollection)
				r.Delete("/collections/{id}", s.deleteCollection)
			})
		})

		// Minting tokens and sharing need a real login by a member, so a token
		// can never create a stronger token or hand out access.
		r.Group(func(r chi.Router) {
			r.Use(s.require(levelSession), s.memberOnly)
			r.Get("/tokens", s.listTokens)
			r.Post("/tokens", s.createToken)
			r.Patch("/tokens/{id}", s.updateToken)
			r.Delete("/tokens/{id}", s.deleteToken)
			r.Get("/shares", s.listShares)
			r.Post("/shares", s.createShare)
			r.Patch("/shares/{id}", s.updateShare)
			r.Delete("/shares/{id}", s.deleteShare)
		})
	})
	return r
}

// --- Auth middleware ----------------------------------------------------------

// principal is who is making a request.
type principal struct {
	UserID string
	Email  string // empty for API tokens
	Level  int
	Token  *store.APIToken
	// Member: on the list of people who have a library here. Everyone else
	// who can sign in is a guest and only reaches what was shared with them.
	Member bool
}

// shareKey is the form the account's address has in the shares table. API
// tokens have none: a token acts for its owner only.
func (p *principal) shareKey() string {
	if p.Email == "" {
		return ""
	}
	return auth.EmailKey(p.Email)
}

type principalKey struct{}

func who(r *http.Request) *principal {
	p, _ := r.Context().Value(principalKey{}).(*principal)
	return p
}

func (s *Server) authenticate(r *http.Request) (*principal, error) {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		t, err := s.store.TokenByHash(r.Context(), auth.HashSecret(strings.TrimPrefix(h, "Bearer ")))
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		level := levelUpload
		switch t.Scope {
		case "device":
			level = levelDevice
		case "full":
			level = levelFull
		}
		// Only members can mint tokens, so a token always speaks for one.
		return &principal{UserID: t.OwnerID, Level: level, Token: &t, Member: true}, nil
	}
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		u, err := s.store.UserBySession(r.Context(), auth.HashSecret(c.Value))
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &principal{UserID: u.ID, Email: u.Email, Level: levelSession, Member: s.isMember(u.Email)}, nil
	}
	return nil, nil
}

func (s *Server) require(level int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, err := s.authenticate(r)
			switch {
			case err != nil:
				serverError(w, r, err)
			case p == nil:
				writeErr(w, http.StatusUnauthorized, "not signed in")
			case p.Level < level:
				writeErr(w, http.StatusForbidden, "this token is not allowed to do that")
			default:
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
			}
		})
	}
}

// isMember: listed in ALLOWED_EMAILS, or the development account.
func (s *Server) isMember(email string) bool {
	return s.cfg.EmailAllowed(email) || (s.cfg.DevLogin && email == devEmail)
}

// memberOnly keeps guests out of everything that manages a library.
func (s *Server) memberOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !who(r).Member {
			writeErr(w, http.StatusForbidden, "guests cannot do that")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// originOnly makes the server deaf to anyone but the Cloudflare proxy, when
// a shared secret is configured: requests without it get the same 404 as a
// path that does not exist. With no secret configured (local use) it does
// nothing.
func (s *Server) originOnly(next http.Handler) http.Handler {
	secret := []byte(s.cfg.OriginSecret)
	if len(secret) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Origin-Auth")), secret) != 1 {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// sameOrigin blocks cross-site requests that ride on the session cookie.
// Token requests carry no ambient credentials, so they are left alone.
func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		safe := r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions
		// Google's answer is a cross-site POST by design. It carries no
		// session; it is checked against the state cookie and Google's
		// signature instead.
		if r.URL.Path == googleCallbackPath {
			safe = true
		}
		if origin := r.Header.Get("Origin"); !safe && origin != "" && r.Header.Get("Authorization") == "" {
			if !s.originAllowed(origin, r.Host) {
				writeErr(w, http.StatusForbidden, "cross-site request refused")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) originAllowed(origin, host string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if u.Host == host {
		return true
	}
	for _, o := range s.cfg.CORSOrigins {
		if origin == o {
			return true
		}
	}
	return false
}

func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		if r.URL.Path == "/healthz" {
			return
		}
		slog.Info("http", "method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"bytes", ww.BytesWritten(), "ms", time.Since(start).Milliseconds())
	})
}

// --- Small helpers ------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func serverError(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeErr(w, http.StatusInternalServerError, "something went wrong on the server")
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "request body is not valid JSON")
		return false
	}
	return true
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isUUID(s string) bool { return uuidRe.MatchString(s) }

// pathID reads the {id} URL parameter, answering 404 itself when it is not a
// uuid so the database never sees a malformed id.
func pathID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		writeErr(w, http.StatusNotFound, "not found")
		return "", false
	}
	return id, true
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.store.Pool.Ping(ctx); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "database unreachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
