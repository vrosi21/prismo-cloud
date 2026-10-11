package api

import (
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"prismocloud/internal/auth"
	"prismocloud/internal/store"
)

// Holds state and nonce between leaving for Google and coming back.
const oauthCookie = "prismo_oauth"

const devEmail = "dev@localhost"

// authConfig tells the sign-in page which buttons to show.
func (s *Server) authConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"google": s.google != nil, "dev": s.cfg.DevLogin})
}

func (s *Server) googleCallbackURL() string { return s.cfg.PublicURL + googleCallbackPath }

// googleStart sends the browser to Google.
func (s *Server) googleStart(w http.ResponseWriter, r *http.Request) {
	if s.google == nil {
		writeErr(w, http.StatusNotFound, "Google sign-in is not set up on this server")
		return
	}
	state, nonce := auth.NewSecret(), auth.NewSecret()
	// SameSite=None: Google answers with a cross-site POST, and a browser
	// attaches no other kind of cookie to one. None in turn requires Secure.
	http.SetCookie(w, &http.Cookie{
		Name:     oauthCookie,
		Value:    state + "." + nonce,
		Path:     "/v1/auth/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
	})
	http.Redirect(w, r, s.google.LoginURL(s.googleCallbackURL(), state, nonce), http.StatusFound)
}

// googleCallback receives Google's answer. Whatever goes wrong, the browser
// is sent back to the app with a short reason; details go to the log only.
func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) {
	if s.google == nil {
		writeErr(w, http.StatusNotFound, "Google sign-in is not set up on this server")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Path: "/v1/auth/", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteNoneMode})
	fail := func(reason string, err error) {
		slog.Warn("google sign-in refused", "reason", reason, "err", err)
		http.Redirect(w, r, "/?auth_error="+reason, http.StatusSeeOther)
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		fail("bad_request", err)
		return
	}
	if e := r.PostForm.Get("error"); e != "" {
		fail("cancelled", errors.New(e))
		return
	}
	c, err := r.Cookie(oauthCookie)
	if err != nil {
		fail("expired", err)
		return
	}
	state, nonce, ok := strings.Cut(c.Value, ".")
	if !ok || subtle.ConstantTimeCompare([]byte(state), []byte(r.PostForm.Get("state"))) != 1 {
		fail("expired", errors.New("state does not match"))
		return
	}
	claims, err := s.google.Verify(r.Context(), r.PostForm.Get("id_token"), nonce)
	if err != nil {
		fail("invalid", err)
		return
	}
	if !s.cfg.EmailAllowed(claims.Email) {
		fail("not_allowed", errors.New(claims.Email+" is not in ALLOWED_EMAILS"))
		return
	}
	if err := s.signIn(w, r, claims.Email, &claims.Subject); err != nil {
		fail("server", err)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// devLogin signs in without Google. Only reachable when DEV_LOGIN=1, which
// the configuration accepts on localhost alone.
func (s *Server) devLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DevLogin {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err := s.signIn(w, r, devEmail, nil); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// signIn finds or creates the account and starts a browser session.
func (s *Server) signIn(w http.ResponseWriter, r *http.Request, email string, googleSub *string) error {
	u, created, err := s.store.EnsureUser(r.Context(), email, googleSub)
	if err != nil {
		return err
	}
	if created {
		for _, jar := range []string{"screenshots", "gifs", "stickers"} {
			if _, err := s.store.CollectionByName(r.Context(), u.ID, jar); err != nil {
				return err
			}
		}
		slog.Info("created account", "email", u.Email)
	}
	secret := auth.NewSecret()
	expires := time.Now().Add(sessionTTL)
	if err := s.store.CreateSession(r.Context(), auth.HashSecret(secret), u.ID, expires); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    secret,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   strings.HasPrefix(s.cfg.PublicURL, "https://"),
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = s.store.DeleteSession(r.Context(), auth.HashSecret(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := who(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]string{"id": p.UserID, "email": p.Email},
		"limits": map[string]any{
			"max_upload_bytes":     s.cfg.MaxUploadBytes,
			"gif_max_seconds":      s.cfg.GIFMaxSeconds,
			"trash_retention_days": int(s.cfg.TrashRetention.Hours() / 24),
		},
		"public_url": s.cfg.PublicURL,
	})
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	tokens, err := s.store.ListTokens(r.Context(), who(r).UserID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		Scope      string `json:"scope"`
		Visibility string `json:"default_visibility"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 80 {
		writeErr(w, http.StatusBadRequest, "name is required (80 characters at most)")
		return
	}
	if req.Scope != "upload" && req.Scope != "full" {
		writeErr(w, http.StatusBadRequest, `scope must be "upload" or "full"`)
		return
	}
	if req.Visibility == "" {
		req.Visibility = "unlisted"
	}
	if !validVisibility(req.Visibility) {
		writeErr(w, http.StatusBadRequest, "unknown visibility")
		return
	}
	secret := auth.TokenPrefix + auth.NewSecret()
	t, err := s.store.CreateToken(r.Context(), who(r).UserID, req.Name, auth.HashSecret(secret), req.Scope, req.Visibility)
	if err != nil {
		serverError(w, r, err)
		return
	}
	// The secret is shown once; only its hash is stored.
	writeJSON(w, http.StatusCreated, map[string]any{"token": t, "secret": secret})
}

func (s *Server) deleteToken(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteToken(r.Context(), who(r).UserID, id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
