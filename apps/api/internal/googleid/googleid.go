// Package googleid signs people in with their Google account.
//
// The flow used is OpenID Connect with response_type=id_token and
// response_mode=form_post: the browser goes to Google, and Google posts a
// signed statement ("ID token") about who signed in back to this server.
// Checking that signature needs only Google's public keys, so the server
// holds no client secret at all.
package googleid

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	googleAuthURL = "https://accounts.google.com/o/oauth2/v2/auth"
	googleKeysURL = "https://www.googleapis.com/oauth2/v3/certs"
)

var googleIssuers = []string{"https://accounts.google.com", "accounts.google.com"}

type Claims struct {
	Subject string
	Email   string
	Name    string
}

type Verifier struct {
	ClientID string
	AuthURL  string
	KeysURL  string
	Issuers  []string
	HTTP     *http.Client
	Now      func() time.Time

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

func New(clientID string) *Verifier {
	return &Verifier{
		ClientID: clientID,
		AuthURL:  googleAuthURL,
		KeysURL:  googleKeysURL,
		Issuers:  googleIssuers,
		HTTP:     &http.Client{Timeout: 10 * time.Second},
		Now:      time.Now,
	}
}

// LoginURL is where the browser is sent to sign in. state comes back
// unchanged and proves the answer belongs to a sign-in this browser started;
// nonce is baked into the signed token, so a token cannot be replayed into
// another sign-in.
func (v *Verifier) LoginURL(redirectURI, state, nonce string) string {
	q := url.Values{
		"client_id":     {v.ClientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"id_token"},
		"response_mode": {"form_post"},
		"scope":         {"openid email profile"},
		"state":         {state},
		"nonce":         {nonce},
		"prompt":        {"select_account"},
	}
	return v.AuthURL + "?" + q.Encode()
}

// Verify checks an ID token end to end and returns who it is about. Every
// check must pass: signed by Google, issued for this app, not expired, made
// for this exact sign-in attempt, and the email address confirmed by Google.
func (v *Verifier) Verify(ctx context.Context, token, nonce string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, errors.New("not a signed token")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodePart(parts[0], &header); err != nil {
		return Claims{}, fmt.Errorf("token header: %w", err)
	}
	// Only the algorithm Google uses. Accepting whatever the token names
	// would let a forged token pick "none".
	if header.Alg != "RS256" {
		return Claims{}, fmt.Errorf("unexpected signing algorithm %q", header.Alg)
	}
	key, err := v.key(ctx, header.Kid)
	if err != nil {
		return Claims{}, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, errors.New("token signature is not valid base64")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
		return Claims{}, errors.New("token signature does not match")
	}

	var body struct {
		Issuer        string          `json:"iss"`
		Audience      string          `json:"aud"`
		Subject       string          `json:"sub"`
		Email         string          `json:"email"`
		EmailVerified json.RawMessage `json:"email_verified"`
		Name          string          `json:"name"`
		Nonce         string          `json:"nonce"`
		Expires       int64           `json:"exp"`
	}
	if err := decodePart(parts[1], &body); err != nil {
		return Claims{}, fmt.Errorf("token body: %w", err)
	}
	issuerOK := false
	for _, iss := range v.Issuers {
		issuerOK = issuerOK || body.Issuer == iss
	}
	switch {
	case !issuerOK:
		return Claims{}, fmt.Errorf("token was issued by %q", body.Issuer)
	case body.Audience != v.ClientID:
		return Claims{}, errors.New("token was issued for a different app")
	case v.Now().Unix() > body.Expires+60:
		return Claims{}, errors.New("token has expired")
	case nonce == "" || subtle.ConstantTimeCompare([]byte(body.Nonce), []byte(nonce)) != 1:
		return Claims{}, errors.New("token does not belong to this sign-in attempt")
	case body.Subject == "" || body.Email == "":
		return Claims{}, errors.New("token names no account")
	}
	// Normally a JSON true; a few Google endpoints write it as a string.
	if verified := string(body.EmailVerified); verified != "true" && verified != `"true"` {
		return Claims{}, errors.New("email address is not verified by Google")
	}
	return Claims{Subject: body.Subject, Email: body.Email, Name: body.Name}, nil
}

func decodePart(part string, into any) error {
	raw, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

// key returns Google's public key with that id. Keys are cached; Google
// rotates them, so an unknown id triggers a fresh download, at most once a
// minute so junk tokens cannot make this server hammer Google.
func (v *Verifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := v.Now()
	if k, ok := v.keys[kid]; ok && now.Sub(v.fetched) < 6*time.Hour {
		return k, nil
	}
	if v.keys != nil && now.Sub(v.fetched) < time.Minute {
		if k, ok := v.keys[kid]; ok {
			return k, nil
		}
		return nil, errors.New("token was signed with an unknown key")
	}
	keys, err := v.download(ctx)
	if err != nil {
		if k, ok := v.keys[kid]; ok {
			return k, nil // Google unreachable: keep working with what we have
		}
		return nil, fmt.Errorf("fetch Google's keys: %w", err)
	}
	v.keys, v.fetched = keys, now
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, errors.New("token was signed with an unknown key")
}

func (v *Verifier) download(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.KeysURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := v.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", res.StatusCode)
	}
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&set); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(k.N)
		e, errE := base64.RawURLEncoding.DecodeString(k.E)
		if errN != nil || errE != nil || len(e) == 0 || len(e) > 4 {
			continue
		}
		exponent := 0
		for _, b := range e {
			exponent = exponent<<8 | int(b)
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}
	}
	if len(keys) == 0 {
		return nil, errors.New("no usable keys in the answer")
	}
	return keys, nil
}
