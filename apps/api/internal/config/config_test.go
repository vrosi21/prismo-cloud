package config

import "testing"

func TestEmailAllowed(t *testing.T) {
	c := Config{AllowedEmails: []string{"owner@gmail.com"}}
	for email, want := range map[string]bool{
		"owner@gmail.com":       true,
		"Owner@Gmail.com":       true, // addresses are not case sensitive
		" owner@gmail.com ":     true,
		"other@gmail.com":       false,
		"owner@gmail.com.evil":  false,
		"xowner@gmail.com":      false,
		"":                      false,
		"owner@gmail.com,other": false,
	} {
		if got := c.EmailAllowed(email); got != want {
			t.Errorf("EmailAllowed(%q) = %v, want %v", email, got, want)
		}
	}
}

func TestAnEmptyListLetsNobodyIn(t *testing.T) {
	if (Config{}).EmailAllowed("anyone@gmail.com") {
		t.Fatal("an empty ALLOWED_EMAILS must refuse everyone")
	}
}

func TestDevLoginIsRefusedOffLocalhost(t *testing.T) {
	base := map[string]string{
		"DATABASE_URL": "postgres://x", "S3_ENDPOINT": "http://garage:3900",
		"S3_ACCESS_KEY": "k", "S3_SECRET_KEY": "s", "DEV_LOGIN": "1",
	}
	for publicURL, wantErr := range map[string]bool{
		"http://localhost:8080":         false,
		"http://127.0.0.1:8080":         false,
		"https://prismo.example.com":    true,
		"https://localhost.example.com": true,
		"https://example.pages.dev":     true,
	} {
		for k, v := range base {
			t.Setenv(k, v)
		}
		t.Setenv("PUBLIC_URL", publicURL)
		_, err := Load()
		if (err != nil) != wantErr {
			t.Errorf("PUBLIC_URL=%s with DEV_LOGIN=1: err = %v, want error: %v", publicURL, err, wantErr)
		}
	}
}
