//go:build !windows

package watch

import (
	"os"
	"path/filepath"
)

// ScreenshotsDir is the usual place for screenshots; say -dir when yours differs.
func ScreenshotsDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Pictures", "Screenshots")
}

// ShareXDir: ShareX is a Windows program.
func ShareXDir() string { return "" }
