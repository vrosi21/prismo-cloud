// Package watch uploads new files from folders to Prismo Cloud. It is the
// part the folder watcher and the desktop helper have in common.
package watch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var mediaExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".bmp": true,
	".mp4": true, ".webm": true, ".mov": true, ".mkv": true,
}

// Capture programs sort their files into subfolders (ShareX: one a month).
// Deeper than this is somebody's archive, not a capture folder.
const maxDepth = 3

// Options says what to watch and where to send it.
type Options struct {
	Dirs       []string      // folders to watch, subfolders included
	URL        string        // Prismo Cloud address
	Token      string        // may add files; nothing more is needed
	Folder     string        // folder in the cloud, by path; made when missing
	Visibility string        // empty: whatever the token is set to
	Source     string        // what the cloud shows as "via"
	Interval   time.Duration // how often to look
	Backfill   bool          // also upload what is already there
	StatePath  string        // where progress is remembered

	// Seen, when set, is called once for every new file, when it is first noticed.
	Seen func(path string)
	// Uploaded, when set, is called after a look that uploaded something,
	// with what it uploaded, oldest first.
	Uploaded func(done []Upload)
}

// Upload is one file that made it to the cloud.
type Upload struct {
	Path string // the file on this computer
	Link string // where it is now
}

type state struct {
	// Files changed after this moment still need uploading.
	Since time.Time `json:"since"`
}

type found struct {
	path    string
	size    int64
	modTime time.Time
}

// A file the cloud keeps refusing is not sent again and again.
type attempt struct {
	failures int
	next     time.Time
}

// Run watches until ctx is done.
func Run(ctx context.Context, o Options) error {
	if o.URL == "" || o.Token == "" {
		return errors.New("both the address and the token are needed")
	}
	if len(o.Dirs) == 0 {
		return errors.New("no folder to watch")
	}
	if o.Interval <= 0 {
		o.Interval = 2 * time.Second
	}
	endpoint := strings.TrimRight(o.URL, "/") + "/v1/upload"

	st := loadState(o.StatePath)
	switch {
	case o.Backfill:
		st.Since = time.Time{}
	case st.Since.IsZero():
		st.Since = time.Now() // first run: start from now, leave old files alone
	}
	log.Printf("watching %s -> %s (folder %q)", strings.Join(o.Dirs, ", "), endpoint, o.Folder)

	// A file is uploaded once its size is the same on two looks in a row,
	// so a capture still being written is not sent half-finished.
	sizes := map[string]int64{}
	tries := map[string]*attempt{}
	for {
		var done []Upload
		newest := st.Since
		for _, f := range candidates(o.Dirs, st.Since) {
			last, seen := sizes[f.path]
			if !seen && o.Seen != nil {
				o.Seen(f.path)
			}
			if !seen || last != f.size || f.size == 0 {
				sizes[f.path] = f.size
				continue
			}
			if t := tries[f.path]; t != nil && time.Now().Before(t.next) {
				continue
			}
			link, err := upload(ctx, endpoint, f.path, o)
			var refused *refusedError
			switch {
			case err == nil:
				log.Printf("uploaded %s -> %s", filepath.Base(f.path), link)
				done = append(done, Upload{Path: f.path, Link: link})
			case errors.As(err, &refused):
				// The cloud will say the same next time: give this file up.
				log.Printf("%s was refused and is skipped: %v", filepath.Base(f.path), err)
			default:
				t := tries[f.path]
				if t == nil {
					t = &attempt{}
					tries[f.path] = t
				}
				t.failures++
				wait := min(time.Duration(1<<min(t.failures, 6))*5*time.Second, 5*time.Minute)
				t.next = time.Now().Add(wait)
				log.Printf("upload of %s failed, next try in %s: %v", filepath.Base(f.path), wait, err)
				continue
			}
			delete(sizes, f.path)
			delete(tries, f.path)
			if f.modTime.After(newest) {
				newest = f.modTime
			}
		}
		// Advance only when nothing is waiting, so a failed upload is not
		// skipped over by a later success.
		if len(sizes) == 0 && newest.After(st.Since) {
			st.Since = newest
			saveState(o.StatePath, st)
		}
		if len(done) > 0 && o.Uploaded != nil {
			o.Uploaded(done)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(o.Interval):
		}
	}
}

// candidates lists the media files changed after since, oldest first.
func candidates(dirs []string, since time.Time) []found {
	var out []found
	for _, root := range dirs {
		root = filepath.Clean(root)
		_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				if path == root {
					log.Printf("cannot read folder: %v", err)
				}
				return fs.SkipDir
			}
			if d.IsDir() {
				if depth(root, path) > maxDepth {
					return fs.SkipDir
				}
				return nil
			}
			if !mediaExt[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			info, err := d.Info()
			if err != nil || !info.ModTime().After(since) {
				return nil
			}
			out = append(out, found{path: path, size: info.Size(), modTime: info.ModTime()})
			return nil
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].modTime.Before(out[j].modTime) })
	return out
}

// depth is how many folders below root a path is; root itself is 0.
func depth(root, path string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return 0
	}
	return strings.Count(rel, string(filepath.Separator)) + 1
}

// refusedError is an answer about the file itself, which will not change by
// asking again: it is too big, or not something the cloud takes.
type refusedError struct{ msg string }

func (e *refusedError) Error() string { return e.msg }

func upload(ctx context.Context, endpoint, path string, o Options) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	fields := map[string]string{"collection": o.Folder, "visibility": o.Visibility, "source": o.Source}
	// Stream through a pipe: the file is never held in memory as a whole.
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			for k, v := range fields {
				if v == "" {
					continue
				}
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

	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, pr)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+o.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out struct {
		URL      string `json:"url"`
		GifURL   string `json:"gif_url"`
		ShareURL string `json:"share_url"`
		Error    string `json:"error"`
	}
	_ = json.Unmarshal(bytes.TrimSpace(body), &out)
	if resp.StatusCode >= 300 {
		if out.Error == "" {
			out.Error = resp.Status
		}
		switch resp.StatusCode {
		case http.StatusBadRequest, http.StatusRequestEntityTooLarge, http.StatusUnsupportedMediaType, http.StatusUnprocessableEntity:
			return "", &refusedError{out.Error}
		}
		// Anything else may pass: a token can be replaced, a server restarted.
		return "", fmt.Errorf("%s", out.Error)
	}
	// The link that shows the capture itself: for a recording its GIF.
	for _, link := range []string{out.GifURL, out.URL, out.ShareURL} {
		if link != "" {
			return link, nil
		}
	}
	return "", nil
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
