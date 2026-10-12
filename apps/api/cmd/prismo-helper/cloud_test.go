package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeCloud answers like Prismo Cloud does, for one small library. Every
// file it hands out is counted.
func fakeCloud(t *testing.T) (c *cloud, served *atomic.Int32, lastQuery *atomic.Value) {
	t.Helper()
	served = &atomic.Int32{}
	lastQuery = &atomic.Value{}
	file := func(id, rest string) string { return "/v1/assets/" + id + "/file?" + rest }
	library := []item{
		{ID: "s1", Kind: "sticker", Status: "ready", Title: "happy cat", Filename: "IMG_0001.PNG", Mime: "image/png",
			URLs: map[string]string{"file": file("s1", "v=aaa111"), "thumb": file("s1", "variant=thumb&v=bbb222")}},
		{ID: "g1", Kind: "gif", Status: "ready", Filename: "party parrot.gif", Mime: "image/gif",
			URLs: map[string]string{"file": file("g1", "v=ccc333"), "thumb": file("g1", "variant=thumb&v=ddd444")}},
		{ID: "v1", Kind: "video", Status: "ready", Filename: "recording.mp4", Mime: "video/mp4",
			URLs: map[string]string{"file": file("v1", "v=eee555"), "gif": file("v1", "variant=gif&v=fff666")}},
		{ID: "p1", Kind: "image", Status: "processing", Filename: "not yet.png", Mime: "image/png", URLs: map[string]string{}},
		{ID: "f1", Kind: "file", Status: "ready", Filename: "notes.pdf", Mime: "application/pdf", URLs: map[string]string{"file": file("f1", "v=999")}},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/assets", func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Authorization") {
		case "Bearer good":
		case "Bearer add-only":
			w.WriteHeader(http.StatusForbidden)
			return
		default:
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		lastQuery.Store(r.URL.RawQuery)
		_ = json.NewEncoder(w).Encode(map[string]any{"assets": library})
	})
	mux.HandleFunc("GET /v1/assets/{id}/file", func(w http.ResponseWriter, r *http.Request) {
		served.Add(1)
		switch r.URL.Query().Get("variant") {
		case "thumb":
			w.Header().Set("Content-Type", "image/webp")
		case "gif":
			w.Header().Set("Content-Type", "image/gif")
		}
		_, _ = w.Write([]byte("bytes of " + r.PathValue("id") + " " + r.URL.Query().Get("variant")))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return newCloud(srv.URL+"/", "good", t.TempDir()), served, lastQuery
}

func TestSearchListsWhatCanBePasted(t *testing.T) {
	c, _, lastQuery := fakeCloud(t)
	tiles, err := c.search(context.Background(), "cat", "sticker")
	if err != nil {
		t.Fatal(err)
	}
	// Not the one still being processed, not the PDF.
	var got []string
	for _, tl := range tiles {
		got = append(got, tl.ID+":"+tl.Name+":"+tl.Kind)
	}
	want := "s1:happy cat:sticker g1:party parrot.gif:gif v1:recording.mp4:video"
	if strings.Join(got, " ") != want {
		t.Errorf("tiles = %v\nwant    %s", got, want)
	}
	if q := lastQuery.Load().(string); !strings.Contains(q, "q=cat") || !strings.Contains(q, "kind=sticker") {
		t.Errorf("asked the cloud with %q", q)
	}
}

func TestThumbIsReadyForAnImgAndAskedForOnce(t *testing.T) {
	c, served, _ := fakeCloud(t)
	if _, err := c.search(context.Background(), "", ""); err != nil {
		t.Fatal(err)
	}
	first, err := c.thumb(context.Background(), "s1")
	if err != nil || !strings.HasPrefix(first, "data:image/webp;base64,") {
		t.Fatalf("thumb = %.40q, %v", first, err)
	}
	again, _ := c.thumb(context.Background(), "s1")
	if again != first || served.Load() != 1 {
		t.Errorf("second thumb fetched again: %d downloads", served.Load())
	}
	// A recording without a preview picture has none; that is not a crash.
	if _, err := c.thumb(context.Background(), "v1"); err == nil {
		t.Error("expected no preview for the recording")
	}
	if _, err := c.thumb(context.Background(), "never listed"); err == nil {
		t.Error("expected an error for something that was never in a list")
	}
}

func TestFetchKeepsTheFileUnderAReadableName(t *testing.T) {
	c, served, _ := fakeCloud(t)
	if _, err := c.search(context.Background(), "", ""); err != nil {
		t.Fatal(err)
	}
	path, err := c.fetch(context.Background(), "s1")
	if err != nil {
		t.Fatal(err)
	}
	// The title, not the camera's file name, and the right ending for a PNG.
	if filepath.Base(path) != "happy cat.png" {
		t.Errorf("saved as %q", filepath.Base(path))
	}
	if raw, _ := os.ReadFile(path); string(raw) != "bytes of s1 " {
		t.Errorf("content = %q", raw)
	}
	if _, err := os.Stat(path + ".part"); err == nil {
		t.Error("the half-written file was left behind")
	}
	again, _ := c.fetch(context.Background(), "s1")
	if again != path || served.Load() != 1 {
		t.Errorf("fetched a second time: %d downloads", served.Load())
	}

	// A recording is pasted as its GIF.
	gif, err := c.fetch(context.Background(), "v1")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(gif) != "recording.gif" {
		t.Errorf("recording saved as %q", filepath.Base(gif))
	}
	if raw, _ := os.ReadFile(gif); string(raw) != "bytes of v1 gif" {
		t.Errorf("recording content = %q", raw)
	}
}

func TestErrorsSayWhatToDo(t *testing.T) {
	c, _, _ := fakeCloud(t)
	ctx := context.Background()

	c.token = "add-only"
	if _, err := c.search(ctx, "", ""); err == nil || !strings.Contains(err.Error(), "add files and look") {
		t.Errorf("token that may only add files: %v", err)
	}
	c.token = "revoked"
	if _, err := c.search(ctx, "", ""); err == nil || !strings.Contains(err.Error(), "not accepted") {
		t.Errorf("revoked token: %v", err)
	}
	c.base = "http://127.0.0.1:9" // nothing listens there
	if _, err := c.search(ctx, "", ""); err == nil || !strings.Contains(err.Error(), "cannot reach") {
		t.Errorf("cloud that is away: %v", err)
	}
}

func TestTidyDropsWhatWasNotPastedForAMonth(t *testing.T) {
	c, _, _ := fakeCloud(t)
	old, fresh := filepath.Join(c.cache, "old"), filepath.Join(c.cache, "fresh")
	for _, dir := range []string{old, fresh} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	long := time.Now().AddDate(0, -2, 0)
	if err := os.Chtimes(old, long, long); err != nil {
		t.Fatal(err)
	}
	c.tidy()
	if _, err := os.Stat(old); err == nil {
		t.Error("the old one is still there")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Error("the fresh one is gone")
	}
}
