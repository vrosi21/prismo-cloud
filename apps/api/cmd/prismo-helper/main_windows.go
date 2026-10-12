// Command prismo-helper is Prismo Cloud's desktop helper for Windows. It sits
// in the background and does three things:
//
//   - uploads every new capture from the screenshot folders, as prismo-watch does;
//
//   - after such an upload, leaves the link in the clipboard history, one
//     step behind the capture itself: Ctrl+V pastes the picture, Win+V has
//     the link;
//
//   - on a hotkey, brings up the picker: type, Enter, and a sticker or GIF
//     from the cloud is pasted into the window that was being used.
//
//     prismo-helper -url https://cloud.example.com -token prismo_...
//
// The token can also come from PRISMO_TOKEN, the URL from PRISMO_URL. The
// picker needs a token that may "add files and look". The helper has no
// console; what it does is written to -log.
package main

import (
	"context"
	"flag"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows"

	"prismocloud/internal/watch"
)

// Windows' clipboard history only keeps both of two things copied one after
// the other when they are this far apart. Measured: 150 ms loses the first,
// 300 ms keeps it.
const historyGap = 450 * time.Millisecond

// folders collects every -dir given.
type folders []string

func (f *folders) String() string     { return strings.Join(*f, ", ") }
func (f *folders) Set(v string) error { *f = append(*f, v); return nil }

func main() {
	cache, _ := os.UserCacheDir() // %LOCALAPPDATA%
	home := filepath.Join(cache, "PrismoCloud")
	var dirs folders
	flag.Var(&dirs, "dir", "folder to watch, subfolders included; may be given more than once (default: where Windows and ShareX save captures)")
	var (
		baseURL    = flag.String("url", os.Getenv("PRISMO_URL"), "Prismo Cloud address")
		token      = flag.String("token", os.Getenv("PRISMO_TOKEN"), `API token; the picker needs one that may "add files and look"`)
		hotkey     = flag.String("hotkey", "win+shift+g", `brings up the picker, e.g. ctrl+f9; "off" for no picker`)
		theme      = flag.String("theme", "timeroom", "look of the picker: timeroom, multiverse or bmo")
		uploads    = flag.Bool("watch", true, "upload new captures from the watched folders")
		folder     = flag.String("folder", "screenshots", "folder in the cloud captures go into, e.g. screenshots/2026")
		visibility = flag.String("visibility", "", "private, unlisted or public; empty: as the token is set")
		link       = flag.Bool("link", true, "after an upload, leave the link in the clipboard history behind the capture")
		logPath    = flag.String("log", filepath.Join(home, "helper.log"), "where the log is written")
	)
	flag.Parse()

	// Without this Windows would draw the picker small and stretch it: blurry.
	const perMonitorV2 = ^uintptr(3) // -4
	procSetDpiAwarenessContext.Call(perMonitorV2)

	_ = os.MkdirAll(home, 0o755)
	log.SetOutput(openLog(*logPath))

	// Two helpers would upload everything twice and fight over the hotkey.
	if _, err := windows.CreateMutex(nil, false, utf16ptr(`Local\PrismoCloudHelper`)); err == windows.ERROR_ALREADY_EXISTS {
		log.Print("already running; this second one goes away")
		return
	}
	if *baseURL == "" || *token == "" {
		fail("The helper needs the address of your Prismo Cloud and a token.\n\nRun scripts\\install-helper.ps1 with -Url and -Token (the web app gives you the whole line: settings, programs that upload for you).")
	}
	log.Printf("helper started for %s", *baseURL)

	if *uploads {
		if len(dirs) == 0 {
			dirs = defaultDirs()
		}
		links := &linker{on: *link, seen: map[string]uint32{}}
		go func() {
			err := watch.Run(context.Background(), watch.Options{
				Dirs:       dirs,
				URL:        *baseURL,
				Token:      *token,
				Folder:     *folder,
				Visibility: *visibility,
				Source:     "helper",
				Interval:   time.Second,
				StatePath:  filepath.Join(home, "state.json"),
				Seen:       links.noticed,
				Uploaded:   links.uploaded,
			})
			log.Printf("uploading stopped: %v", err)
		}()
	}

	if strings.EqualFold(*hotkey, "off") || *hotkey == "" {
		select {} // uploading is all there is to do
	}
	mods, key, err := parseHotkey(*hotkey)
	if err != nil {
		fail("The hotkey for the picker is not usable: " + err.Error())
	}
	files := newCloud(*baseURL, *token, filepath.Join(home, "pasted"))
	go files.tidy()
	p := &picker{cloud: files, hotkey: strings.ToLower(*hotkey), theme: *theme, data: filepath.Join(home, "webview")}
	err = p.run(mods, key)
	log.Printf("picker stopped: %v", err)
	if !*uploads {
		fail("The picker could not start: " + err.Error())
	}
	// No picker, then. Captures are still uploaded.
	complain("Prismo Cloud's picker could not start, uploading goes on:\n\n" + err.Error())
	select {}
}

// defaultDirs is where captures appear on this computer without anybody
// having said so: Windows' own screenshots folder and ShareX's.
func defaultDirs() []string {
	var out []string
	for _, dir := range []string{watch.ScreenshotsDir(), watch.ShareXDir()} {
		if dir == "" {
			continue
		}
		known := false
		for _, have := range out {
			known = known || strings.EqualFold(have, dir)
		}
		if !known {
			out = append(out, dir)
		}
	}
	return out
}

// linker leaves the link of a fresh capture in the clipboard history.
//
// A capture program puts the picture on the clipboard. Once the upload is
// through, the helper puts the link there, and right after it the capture
// again. The clipboard then pastes the picture as before, and its history
// (Win+V) holds the link one step back.
type linker struct {
	on   bool
	mu   sync.Mutex
	seen map[string]uint32 // capture -> the clipboard's number when it appeared
}

func (l *linker) noticed(path string) {
	l.mu.Lock()
	l.seen[path] = clipboardNumber()
	l.mu.Unlock()
}

func (l *linker) uploaded(done []watch.Upload) {
	last := done[len(done)-1] // of several at once, the newest is the one in hand
	l.mu.Lock()
	number, known := l.seen[last.Path]
	for _, u := range done {
		delete(l.seen, u.Path)
	}
	l.mu.Unlock()

	switch {
	case !l.on || last.Link == "" || !known:
		return
	case number != clipboardNumber():
		// Something was copied since the capture. That is what belongs on
		// the clipboard now; it is left alone.
		return
	case !historyOn():
		// Without a history the link would only be in the way for a moment.
		return
	}
	if err := copyText(last.Link); err != nil {
		log.Printf("link not put on the clipboard: %v", err)
		return
	}
	time.Sleep(historyGap)
	if err := copyFile(last.Path); err != nil {
		log.Printf("capture not put back on the clipboard: %v", err)
	}
}

// openLog starts the log over once it has grown past a megabyte.
func openLog(path string) io.Writer {
	if st, err := os.Stat(path); err == nil && st.Size() > 1<<20 {
		_ = os.Remove(path)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return io.Discard
	}
	return f
}

func fail(text string) {
	log.Print(strings.ReplaceAll(text, "\n", " "))
	complain(text)
	os.Exit(1)
}
