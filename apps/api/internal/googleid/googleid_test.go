package googleid

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const clientID = "test-client.apps.googleusercontent.com"

var b64 = base64.RawURLEncoding

// fakeGoogle serves a key set and signs tokens with the matching private key.
type fakeGoogle struct {
	key    *rsa.PrivateKey
	server *httptest.Server
	hits   int
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	g := &fakeGoogle{key: key}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.hits++
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "key-1", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": b64.EncodeToString(key.N.Bytes()),
			"e": b64.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(g.server.Close)
	return g
}

func (g *fakeGoogle) verifier() *Verifier {
	v := New(clientID)
	v.KeysURL = g.server.URL
	return v
}

func goodClaims() map[string]any {
	return map[string]any{
		"iss": "https://accounts.google.com", "aud": clientID, "sub": "1234567890",
		"email": "someone@example.com", "email_verified": true, "name": "Some One",
		"nonce": "the-nonce", "exp": time.Now().Add(time.Hour).Unix(),
	}
}

func sign(t *testing.T, key *rsa.PrivateKey, header, claims map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	unsigned := b64.EncodeToString(h) + "." + b64.EncodeToString(c)
	digest := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return unsigned + "." + b64.EncodeToString(sig)
}

var rs256 = map[string]any{"alg": "RS256", "kid": "key-1", "typ": "JWT"}

func TestVerifyAcceptsAGoodToken(t *testing.T) {
	g := newFakeGoogle(t)
	claims, err := g.verifier().Verify(context.Background(), sign(t, g.key, rs256, goodClaims()), "the-nonce")
	if err != nil {
		t.Fatalf("good token refused: %v", err)
	}
	if claims.Subject != "1234567890" || claims.Email != "someone@example.com" {
		t.Fatalf("wrong claims: %+v", claims)
	}
}

func TestVerifyRefuses(t *testing.T) {
	g := newFakeGoogle(t)
	stranger, _ := rsa.GenerateKey(rand.Reader, 2048)
	with := func(change func(c map[string]any)) map[string]any {
		c := goodClaims()
		change(c)
		return c
	}
	noSignature := func() string {
		h, _ := json.Marshal(map[string]any{"alg": "none", "kid": "key-1"})
		c, _ := json.Marshal(goodClaims())
		return b64.EncodeToString(h) + "." + b64.EncodeToString(c) + "."
	}

	cases := map[string]struct {
		token string
		nonce string
		want  string
	}{
		"token for another app":   {sign(t, g.key, rs256, with(func(c map[string]any) { c["aud"] = "other.apps.googleusercontent.com" })), "the-nonce", "different app"},
		"expired token":           {sign(t, g.key, rs256, with(func(c map[string]any) { c["exp"] = time.Now().Add(-time.Hour).Unix() })), "the-nonce", "expired"},
		"another sign-in's nonce": {sign(t, g.key, rs256, goodClaims()), "some-other-nonce", "sign-in attempt"},
		"empty expected nonce":    {sign(t, g.key, rs256, with(func(c map[string]any) { c["nonce"] = "" })), "", "sign-in attempt"},
		"wrong issuer":            {sign(t, g.key, rs256, with(func(c map[string]any) { c["iss"] = "https://evil.example" })), "the-nonce", "issued by"},
		"unverified email":        {sign(t, g.key, rs256, with(func(c map[string]any) { c["email_verified"] = false })), "the-nonce", "not verified"},
		"signed by someone else":  {sign(t, stranger, rs256, goodClaims()), "the-nonce", "does not match"},
		"unknown key id":          {sign(t, g.key, map[string]any{"alg": "RS256", "kid": "key-9"}, goodClaims()), "the-nonce", "unknown key"},
		"alg none":                {noSignature(), "the-nonce", "algorithm"},
		"garbage":                 {"not.a.token", "the-nonce", "header"},
		"two parts":               {"only.two", "the-nonce", "not a signed token"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := g.verifier().Verify(context.Background(), tc.token, tc.nonce)
			if err == nil {
				t.Fatal("token was accepted")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("refused for the wrong reason: %v (wanted %q)", err, tc.want)
			}
		})
	}
}

func TestVerifyRefusesAPayloadChangedAfterSigning(t *testing.T) {
	g := newFakeGoogle(t)
	parts := strings.Split(sign(t, g.key, rs256, goodClaims()), ".")
	forged, _ := json.Marshal(func() map[string]any {
		c := goodClaims()
		c["email"] = "attacker@example.com"
		return c
	}())
	parts[1] = b64.EncodeToString(forged)
	if _, err := g.verifier().Verify(context.Background(), strings.Join(parts, "."), "the-nonce"); err == nil {
		t.Fatal("tampered token was accepted")
	}
}

func TestKeysAreCachedAndUnknownIdsDoNotHammerGoogle(t *testing.T) {
	g := newFakeGoogle(t)
	v := g.verifier()
	good := sign(t, g.key, rs256, goodClaims())
	unknown := sign(t, g.key, map[string]any{"alg": "RS256", "kid": "key-9"}, goodClaims())
	for i := 0; i < 5; i++ {
		if _, err := v.Verify(context.Background(), good, "the-nonce"); err != nil {
			t.Fatal(err)
		}
		v.Verify(context.Background(), unknown, "the-nonce")
	}
	if g.hits != 1 {
		t.Fatalf("keys were downloaded %d times, want 1", g.hits)
	}
}

func TestLoginURL(t *testing.T) {
	u, err := url.Parse(New(clientID).LoginURL("https://app.example/v1/auth/google/callback", "st", "no"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	want := map[string]string{
		"client_id": clientID, "redirect_uri": "https://app.example/v1/auth/google/callback",
		"response_type": "id_token", "response_mode": "form_post", "state": "st", "nonce": "no",
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, q.Get(k), v)
		}
	}
	if u.Host != "accounts.google.com" || !strings.Contains(q.Get("scope"), "openid") {
		t.Errorf("unexpected login URL: %s", u)
	}
}
