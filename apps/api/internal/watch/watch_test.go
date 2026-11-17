package watch

import (
	"testing"
	"time"
)

func TestFolderFor(t *testing.T) {
	at := time.Date(2026, 3, 9, 23, 30, 0, 0, time.Local)
	for pattern, want := range map[string]string{
		"screenshots/{year}/{month}": "screenshots/2026/03",
		"screenshots":                "screenshots",
		"{year}-{month} captures":    "2026-03 captures",
		"":                           "",
	} {
		if got := FolderFor(pattern, at); got != want {
			t.Errorf("FolderFor(%q) = %q, want %q", pattern, got, want)
		}
	}
}
