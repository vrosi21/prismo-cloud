package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// What the picker needs from Prismo Cloud: a list, small previews, and the
// files themselves. All of it is asked for with the token, which never
// reaches the picker's page.

type cloud struct {
	base   string
	token  string
	client *http.Client
	cache  string // files that were pasted are kept here, to paste again fast

	mu     sync.Mutex
	listed map[string]item   // everything the lists have shown, by id
	thumbs map[string]string // small previews, ready for an <img>
	slots  chan struct{}     // so a list of sixty does not open sixty connections
}

// item is an asset as the API describes it; only the parts used here.
type item struct {
	ID       string            `json:"id"`
	Kind     string            `json:"kind"`
	Status   string            `json:"status"`
	Title    string            `json:"title"`
	Filename string            `json:"filename"`
	Mime     string            `json:"mime"`
	URLs     map[string]string `json:"urls"`
}

// tile is what the picker's page is told about one item.
type tile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func newCloud(base, token, cache string) *cloud {
	return &cloud{
		base:   strings.TrimRight(base, "/"),
		token:  token,
		client: &http.Client{Timeout: 2 * time.Minute},
		cache:  cache,
		listed: map[string]item{},
		thumbs: map[string]string{},
		slots:  make(chan struct{}, 6),
	}
}

// get asks the cloud for a path such as "/v1/assets?kind=sticker".
func (c *cloud) get(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, errors.New("cannot reach prismo cloud")
	}
	if resp.StatusCode < 300 {
		return resp, nil
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return nil, errors.New("the token was not accepted. was it revoked?")
	case http.StatusForbidden:
		return nil, errors.New(`this token may only add files. in prismo: settings, make one that may "add files and look"`)
	}
	var body struct {
		Error string `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if json.Unmarshal(raw, &body) != nil || body.Error == "" {
		body.Error = resp.Status
	}
	return nil, errors.New(body.Error)
}

// search lists what can be pasted, newest first. kind is "sticker", "gif",
// "image", "video", or "" for all of them.
func (c *cloud) search(ctx context.Context, query, kind string) ([]tile, error) {
	q := url.Values{"limit": {"80"}}
	if query != "" {
		q.Set("q", query)
	}
	if kind != "" {
		q.Set("kind", kind)
	}
	resp, err := c.get(ctx, "/v1/assets?"+q.Encode())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var page struct {
		Assets []item `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, errors.New("did not understand the answer from prismo cloud")
	}

	tiles := []tile{}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, it := range page.Assets {
		// Still being processed, or nothing a chat could show.
		if it.Status != "ready" || it.Kind == "file" || it.URLs["file"] == "" {
			continue
		}
		c.listed[it.ID] = it
		name := it.Title
		if name == "" {
			name = it.Filename
		}
		tiles = append(tiles, tile{ID: it.ID, Name: name, Kind: it.Kind})
	}
	return tiles, nil
}

func (c *cloud) item(id string) (item, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.listed[id]
	if !ok {
		return item{}, errors.New("that one is not in the list any more")
	}
	return it, nil
}

// thumb returns a small preview as a data: URL, which an <img> shows as is.
func (c *cloud) thumb(ctx context.Context, id string) (string, error) {
	it, err := c.item(id)
	if err != nil {
		return "", err
	}
	// A picture that never got a preview is small enough to be its own.
	path := it.URLs["thumb"]
	if path == "" && (it.Kind == "image" || it.Kind == "sticker" || it.Kind == "gif") {
		path = it.URLs["file"]
	}
	if path == "" {
		return "", errors.New("no preview")
	}
	c.mu.Lock()
	ready, ok := c.thumbs[path]
	c.mu.Unlock()
	if ok {
		return ready, nil
	}

	c.slots <- struct{}{}
	defer func() { <-c.slots }()
	resp, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", err
	}
	kind := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(kind, "image/") {
		return "", errors.New("no preview")
	}
	ready = "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(raw)
	c.mu.Lock()
	if len(c.thumbs) >= 500 {
		c.thumbs = map[string]string{} // enough kept; start over rather than grow for ever
	}
	c.thumbs[path] = ready
	c.mu.Unlock()
	return ready, nil
}

var extByMime = map[string]string{
	"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
	"image/avif": ".avif", "image/bmp": ".bmp", "video/mp4": ".mp4", "video/webm": ".webm",
	"video/quicktime": ".mov", "video/x-matroska": ".mkv",
}

// fetch brings the file to paste onto this computer and says where it is.
// What has a GIF version (a recording, an animated WebP) is pasted as that:
// it is the one thing that plays by itself in every chat.
func (c *cloud) fetch(ctx context.Context, id string) (string, error) {
	it, err := c.item(id)
	if err != nil {
		return "", err
	}
	path, ext := it.URLs["file"], extByMime[it.Mime]
	if it.URLs["gif"] != "" {
		path, ext = it.URLs["gif"], ".gif"
	}
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(it.Filename))
	}
	name := it.Title
	if name == "" {
		// "clip.mp4" pasted as a GIF is "clip.gif", not "clip.mp4.gif".
		name = strings.TrimSuffix(it.Filename, filepath.Ext(it.Filename))
	}

	// The address ends in "v=" and the start of the file's hash, so the same
	// address is always the same bytes: once fetched, never again.
	version := "0"
	if u, err := url.Parse(path); err == nil && u.Query().Get("v") != "" {
		version = u.Query().Get("v")
	}
	dir := filepath.Join(c.cache, it.ID+"-"+safeName(version, ""))
	local := filepath.Join(dir, safeName(name, ext))
	if st, err := os.Stat(local); err == nil && st.Size() > 0 {
		return local, nil
	}

	resp, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Written under another name first, so a download that breaks off never
	// passes for the whole file.
	part := local + ".part"
	f, err := os.Create(part)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(f, resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(part)
		return "", fmt.Errorf("the download broke off: %w", err)
	}
	if err := os.Rename(part, local); err != nil {
		return "", err
	}
	return local, nil
}

// tidy removes pasted files that have not been used for a month.
func (c *cloud) tidy() {
	entries, err := os.ReadDir(c.cache)
	if err != nil {
		return
	}
	old := time.Now().AddDate(0, -1, 0)
	for _, e := range entries {
		if info, err := e.Info(); err == nil && e.IsDir() && info.ModTime().Before(old) {
			os.RemoveAll(filepath.Join(c.cache, e.Name()))
		}
	}
}
