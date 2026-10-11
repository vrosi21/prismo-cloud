package auth

import "testing"

func TestEmailKey(t *testing.T) {
	for in, want := range map[string]string{
		"John.Smith@Gmail.com":     "johnsmith@gmail.com",
		"johnsmith+news@gmail.com": "johnsmith@gmail.com",
		"j.o.h.n@googlemail.com":   "john@gmail.com",
		"  Someone@Example.com ":   "someone@example.com",
		"first.last@example.com":   "first.last@example.com", // dots only fold for Gmail
		"first+tag@example.com":    "first+tag@example.com",
		"not-an-address":           "not-an-address",
	} {
		if got := EmailKey(in); got != want {
			t.Errorf("EmailKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLooksLikeEmail(t *testing.T) {
	for in, want := range map[string]bool{
		"a@b.co": true, "john.smith+x@gmail.com": true,
		"": false, "nobody": false, "a@b": false, "a b@c.de": false, "@b.co": false,
		"a@.co": false, "a@b.co.": false, "a@b.co, c@d.ef": false, "<a@b.co>": false,
	} {
		if got := LooksLikeEmail(in); got != want {
			t.Errorf("LooksLikeEmail(%q) = %v, want %v", in, got, want)
		}
	}
}
