//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

// screenshotsDir asks Windows where screenshots are saved. The folder can be
// moved (OneDrive does that, and sometimes renames it), so the usual
// Pictures\Screenshots is only a guess.
func screenshotsDir() string {
	const shellFolders = `Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`
	const screenshots = "{B7BEDE81-DF94-4682-A7D8-57A52620B86F}"

	k, err := registry.OpenKey(registry.CURRENT_USER, shellFolders, registry.QUERY_VALUE)
	if err != nil {
		return guessDir()
	}
	defer k.Close()
	dir, _, err := k.GetStringValue(screenshots)
	if err != nil || dir == "" {
		return guessDir()
	}
	if expanded, err := registry.ExpandString(dir); err == nil {
		dir = expanded
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return guessDir()
	}
	return dir
}
