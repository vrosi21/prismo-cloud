// Command prismo-watch uploads new files from a folder to Prismo Cloud.
// Point it at the Windows Screenshots folder and every Win+PrtScn or
// Snipping Tool capture lands in the cloud by itself.
//
//	prismo-watch -url https://cloud.example.com -token prismo_...
//
// The token can also come from PRISMO_TOKEN, the URL from PRISMO_URL.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var mediaExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".bmp": true,
	".mp4": true, ".webm": true, ".mov": true, ".mkv": true,
}

type state struct {
	// Files changed after this moment still need uploading.
	Since time.Time `json:"since"`
}

func main() {
	home, _ := os.UserHomeDir()
	cache, _ := os.UserCacheDir()
	var (
		dir        = flag.String("dir", filepath.Join(home, "Pictures", "Screenshots"), "folder to watch")
		baseURL    = flag.String("url", os.Getenv("PRISMO_URL"), "Prismo Cloud address")
		token      = flag.String("token", os.Getenv("PRISMO_TOKEN"), "API token (upload scope is enough)")
		collection = flag.String("collection", "screenshots", "collection new files go into")
		visibility = flag.String("visibility", "private", "private, unlisted or public")
		interval   = flag.Duration("interval", 2*time.Second, "how often to look for new files")
		backfill   = flag.Bool("backfill", false, "also upload files that are already in the folder")
		statePath  = flag.String("state", filepath.Join(cache, "prismo-watch", "state.json"), "where progress is remembered")
	)
	flag.Parse()
	if *baseURL == "" || *token == "" {
		log.Fatal("both -url and -token are required (or PRISMO_URL and PRISMO_TOKEN)")
	}
	endpoint := strings.TrimRight(*baseURL, "/") + "/v1/upload"

	st := loadState(*statePath)
	switch {
	case *backfill:
		st.Since = time.Time{}
	case st.Since.IsZero():
		st.Since = time.Now() // first run: start from now, leave old files alone
	}
	log.Printf("watching %s -> %s (collection %q, %s)", *dir, endpoint, *collection, *visibility)

	// A file is uploaded once its size is the same on two looks in a row,
	// so a capture still being written is not sent half-finished.
	sizes := map[string]int64{}
	for {
		entries, err := os.ReadDir(*dir)
		if err != nil {
			log.Printf("cannot read folder: %v", err)
		}
		newest := st.Since
		for _, e := range entries {
			if e.IsDir() || !mediaExt[strings.ToLower(filepath.Ext(e.Name()))] {
				continue
			}
			info, err := e.Info()
			if err != nil || !info.ModTime().After(st.Since) {
				continue
			}
			path := filepath.Join(*dir, e.Name())
			if last, seen := sizes[path]; !seen || last != info.Size() || info.Size() == 0 {
				sizes[path] = info.Size()
				continue
			}
			link, err := upload(endpoint, *token, path, *collection, *visibility)
			if err != nil {
				log.Printf("upload %s failed, will retry: %v", e.Name(), err)
				continue
			}
			log.Printf("uploaded %s -> %s", e.Name(), link)
			delete(sizes, path)
			if info.ModTime().After(newest) {
				newest = info.ModTime()
			}
		}
		// Advance only when nothing is waiting, so a failed upload is not
		// skipped over by a later success.
		if len(sizes) == 0 && newest.After(st.Since) {
			st.Since = newest
			saveState(*statePath, st)
		}
		time.Sleep(*interval)
	}
}

func upload(endpoint, token, path, collection, visibility string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	// Stream through a pipe: the file is never held in memory as a whole.
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			for k, v := range map[string]string{"collection": collection, "visibility": visibility, "source": "watcher"} {
				if err := mw.WriteField(k, v); err != nil {
					return err
				}
			}
			part, err := mw.CreateFormFile("file", filepath.Base(path))
			if err != nil {
				return err
			}
			if _, err := io.Copy(part, f); err != nil {
				return err
			}
			return mw.Close()
		}()
		pw.CloseWithError(err)
	}()

	req, err := http.NewRequest(http.MethodPost, endpoint, pr)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out struct {
		URL      string `json:"url"`
		ShareURL string `json:"share_url"`
		Error    string `json:"error"`
	}
	_ = json.Unmarshal(bytes.TrimSpace(body), &out)
	if resp.StatusCode >= 300 {
		if out.Error == "" {
			out.Error = resp.Status
		}
		return "", fmt.Errorf("%s", out.Error)
	}
	return out.ShareURL, nil
}

func loadState(path string) state {
	var st state
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &st)
	}
	return st
}

func saveState(path string, st state) {
	raw, _ := json.Marshal(st)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
		err = os.WriteFile(path, raw, 0o644)
		if err != nil {
			log.Printf("cannot save progress: %v", err)
		}
	}
}
