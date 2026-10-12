// Command prismo-watch uploads new files from a folder to Prismo Cloud.
// Point it at a screenshots folder and every capture lands in the cloud by
// itself. It has no window and runs anywhere; on Windows the desktop helper
// (cmd/prismo-helper) does the same and more.
//
//	prismo-watch -url https://cloud.example.com -token prismo_...
//
// The token can also come from PRISMO_TOKEN, the URL from PRISMO_URL.
package main

import (
	"context"
	"flag"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"prismocloud/internal/watch"
)

func main() {
	cache, _ := os.UserCacheDir()
	var (
		dir        = flag.String("dir", watch.ScreenshotsDir(), "folder to watch, subfolders included")
		baseURL    = flag.String("url", os.Getenv("PRISMO_URL"), "Prismo Cloud address")
		token      = flag.String("token", os.Getenv("PRISMO_TOKEN"), "API token (one that may add files is enough)")
		folder     = flag.String("folder", "screenshots", "folder in the cloud new files go into, e.g. screenshots/2026")
		visibility = flag.String("visibility", "", "private, unlisted or public; empty: as the token is set")
		interval   = flag.Duration("interval", 2*time.Second, "how often to look for new files")
		backfill   = flag.Bool("backfill", false, "also upload files that are already in the folder")
		statePath  = flag.String("state", filepath.Join(cache, "prismo-watch", "state.json"), "where progress is remembered")
		logPath    = flag.String("log", "", "also write the log to this file (for running without a window)")
	)
	flag.Parse()
	if *logPath != "" {
		if f, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			log.SetOutput(io.MultiWriter(os.Stderr, f))
		}
	}
	err := watch.Run(context.Background(), watch.Options{
		Dirs:       []string{*dir},
		URL:        *baseURL,
		Token:      *token,
		Folder:     *folder,
		Visibility: *visibility,
		Source:     "watcher",
		Interval:   *interval,
		Backfill:   *backfill,
		StatePath:  *statePath,
	})
	log.Fatal(err)
}
