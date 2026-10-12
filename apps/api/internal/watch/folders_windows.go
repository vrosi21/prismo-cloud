//go:build windows

package watch

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// ScreenshotsDir asks Windows where it saves screenshots (Win+PrtScn, the
// Snipping Tool). The folder can be moved (OneDrive does that, and sometimes
// renames it), so Pictures\Screenshots is only the fallback.
func ScreenshotsDir() string {
	if dir, err := windows.KnownFolderPath(windows.FOLDERID_Screenshots, windows.KF_FLAG_DONT_VERIFY); err == nil && isDir(dir) {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Pictures", "Screenshots")
}

// ShareXDir is where ShareX saves its captures, or "" when ShareX is not
// set up on this computer.
func ShareXDir() string {
	docs, err := windows.KnownFolderPath(windows.FOLDERID_Documents, windows.KF_FLAG_DONT_VERIFY)
	if err != nil {
		return ""
	}
	home := filepath.Join(docs, "ShareX")
	dir := filepath.Join(home, "Screenshots")

	// ShareX can be told to save somewhere else; it says so in its settings.
	if raw, err := os.ReadFile(filepath.Join(home, "ApplicationConfig.json")); err == nil {
		var cfg struct {
			UseCustomScreenshotsPath bool
			CustomScreenshotsPath    string
		}
		raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf")) // written with a byte order mark
		if json.Unmarshal(raw, &cfg) == nil && cfg.UseCustomScreenshotsPath && cfg.CustomScreenshotsPath != "" {
			dir = os.ExpandEnv(cfg.CustomScreenshotsPath)
		}
	}
	if !isDir(dir) {
		return ""
	}
	return dir
}

func isDir(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}
