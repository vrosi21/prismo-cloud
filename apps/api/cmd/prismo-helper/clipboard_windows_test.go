package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
	"unsafe"

	"prismocloud/internal/watch"
)

// These tests use the clipboard for real. So that they neither read nor
// overwrite what the person at the keyboard has copied, the test process
// first moves to a window station of its own: every window station has its
// own clipboard, and nobody is looking at this one.
//
// Run them on Windows:
//
//	go test -c -o helper.test.exe ./cmd/prismo-helper && helper.test.exe

var (
	procCreateWindowStationW       = user32.NewProc("CreateWindowStationW")
	procSetProcessWindowStation    = user32.NewProc("SetProcessWindowStation")
	procCreateDesktopW             = user32.NewProc("CreateDesktopW")
	procSetThreadDesktop           = user32.NewProc("SetThreadDesktop")
	procGetClipboardData           = user32.NewProc("GetClipboardData")
	procEnumClipboardFormats       = user32.NewProc("EnumClipboardFormats")
	procIsClipboardFormatAvailable = user32.NewProc("IsClipboardFormatAvailable")
	procGlobalSize                 = kernel32.NewProc("GlobalSize")
)

// The desktop of the private window station; 0 when it could not be made,
// and then every test here skips itself rather than touch the real clipboard.
var privateDesktop uintptr

func TestMain(m *testing.M) {
	const allAccess = 0x10000000 // GENERIC_ALL
	if station, _, _ := procCreateWindowStationW.Call(0, 0, allAccess, 0); station != 0 {
		if ok, _, _ := procSetProcessWindowStation.Call(station); ok != 0 {
			privateDesktop, _, _ = procCreateDesktopW.Call(uintptr(unsafe.Pointer(utf16ptr("prismo-test"))), 0, 0, 0, allAccess, 0)
		}
	}
	// Format names are registered per window station: do it again over here.
	registerFormats()
	os.Exit(m.Run())
}

// private ties the test to one Windows thread and puts that thread on the
// private desktop.
func private(t *testing.T) {
	t.Helper()
	if privateDesktop == 0 {
		t.Skip("could not make a private window station; not touching the real clipboard")
	}
	runtime.LockOSThread()
	t.Cleanup(runtime.UnlockOSThread)
	if ok, _, err := procSetThreadDesktop.Call(privateDesktop); ok == 0 {
		t.Skipf("could not move to the private desktop (%v); not touching the real clipboard", err)
	}
}

// read returns what the clipboard holds in one format, or nil.
func read(t *testing.T, format uintptr) []byte {
	t.Helper()
	if r, _, err := procOpenClipboard.Call(0); r == 0 {
		t.Fatalf("open clipboard: %v", err)
	}
	defer procCloseClipboard.Call()
	h, _, _ := procGetClipboardData.Call(format)
	if h == 0 {
		return nil
	}
	size, _, _ := procGlobalSize.Call(h)
	at, _, _ := procGlobalLock.Call(h)
	if at == 0 {
		return nil
	}
	defer procGlobalUnlock.Call(h)
	return bytes.Clone(unsafe.Slice((*byte)(ptr(at)), int(size)))
}

func has(format uintptr) bool {
	r, _, _ := procIsClipboardFormatAvailable.Call(format)
	return r != 0
}

// order lists the formats on the clipboard, first choice first.
func order(t *testing.T) []uintptr {
	t.Helper()
	if r, _, err := procOpenClipboard.Call(0); r == 0 {
		t.Fatalf("open clipboard: %v", err)
	}
	defer procCloseClipboard.Call()
	var out []uintptr
	for f, _, _ := procEnumClipboardFormats.Call(0); f != 0; f, _, _ = procEnumClipboardFormats.Call(f) {
		out = append(out, f)
	}
	return out
}

// picture writes a small test picture, part of it see-through, and returns its path.
func picture(t *testing.T, name string) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 5, 3))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	img.SetNRGBA(4, 2, color.NRGBA{B: 255, A: 255})
	var buf bytes.Buffer
	var err error
	switch filepath.Ext(name) {
	case ".png":
		err = png.Encode(&buf, img)
	case ".jpg":
		err = jpeg.Encode(&buf, img, nil)
	case ".gif":
		err = gif.Encode(&buf, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestKeyInputIsWhatWindowsExpects(t *testing.T) {
	// SendInput takes nothing but its own INPUT: 40 bytes on 64-bit Windows,
	// the key at byte 8, "up or down" at 12.
	var k keyInput
	if unsafe.Sizeof(k) != 40 || unsafe.Offsetof(k.vk) != 8 || unsafe.Offsetof(k.flags) != 12 || unsafe.Offsetof(k.extra) != 24 {
		t.Errorf("size %d, key at %d, flags at %d, extra at %d", unsafe.Sizeof(k), unsafe.Offsetof(k.vk), unsafe.Offsetof(k.flags), unsafe.Offsetof(k.extra))
	}
}

func TestCopyText(t *testing.T) {
	private(t)
	const link = "https://cloud.example/i/AbC123.png"
	if err := copyText(link); err != nil {
		t.Fatal(err)
	}
	if got := read(t, cfUnicodeText); !bytes.HasPrefix(got, wide(link)) {
		t.Errorf("clipboard text = %v", got)
	}
}

func TestCopyPNG(t *testing.T) {
	private(t)
	path := picture(t, "shot.png")
	if err := copyFile(path); err != nil {
		t.Fatal(err)
	}
	// PNG first: it is the one with the see-through parts.
	if got := order(t); len(got) < 2 || got[0] != formatPNG || got[1] != cfDIB {
		t.Errorf("formats in order = %v, want PNG (%d) then DIB (%d) first", got, formatPNG, cfDIB)
	}
	file, _ := os.ReadFile(path)
	if got := read(t, formatPNG); !bytes.HasPrefix(got, file) {
		t.Errorf("PNG on the clipboard is not the file (%d bytes against %d)", len(got), len(file))
	}
	bitmap := read(t, cfDIB)
	if len(bitmap) < 40 || binary.LittleEndian.Uint32(bitmap[4:]) != 5 || binary.LittleEndian.Uint32(bitmap[8:]) != 3 {
		t.Errorf("bitmap header = %v", bitmap[:min(len(bitmap), 40)])
	}
	if has(cfHDrop) {
		t.Error("a picture should not also be on the clipboard as a file: chats would attach it twice")
	}
}

func TestCopyJPEGGoesOnAsPNG(t *testing.T) {
	private(t)
	if err := copyFile(picture(t, "photo.jpg")); err != nil {
		t.Fatal(err)
	}
	img, kind, err := image.Decode(bytes.NewReader(read(t, formatPNG)))
	if err != nil || kind != "png" || img.Bounds().Dx() != 5 || img.Bounds().Dy() != 3 {
		t.Errorf("PNG on the clipboard: kind %q, %v, %v", kind, img, err)
	}
}

func TestCopyGIFGoesOnAsFile(t *testing.T) {
	private(t)
	path := picture(t, "party.gif")
	if err := copyFile(path); err != nil {
		t.Fatal(err)
	}
	if got := read(t, cfHDrop); !bytes.HasPrefix(got, dropFiles([]string{path})) {
		t.Errorf("file list on the clipboard = %v", got)
	}
	if effect := read(t, formatDropEffect); len(effect) < 4 || effect[0] != 1 {
		t.Errorf("drop effect = %v, want copy", effect)
	}
	if has(formatPNG) || has(cfDIB) {
		t.Error("a GIF put on as a picture would paste as a still")
	}
}

func TestClipboardNumberCounts(t *testing.T) {
	private(t)
	before := clipboardNumber()
	if err := copyText("x"); err != nil {
		t.Fatal(err)
	}
	if after := clipboardNumber(); after == before {
		t.Error("the clipboard's number did not change after a copy")
	}
}

func TestLinkerLeavesLinkThenCapture(t *testing.T) {
	private(t)
	path := picture(t, "capture.png")
	const link = "https://cloud.example/i/XyZ.png"
	l := &linker{on: true, seen: map[string]uint32{}}

	_ = copyFile(path) // what the capture program does
	l.noticed(path)
	started := time.Now()
	l.uploaded([]watch.Upload{{Path: path, Link: link}})

	if !historyOn() {
		// No history on this computer: the helper must have kept its hands off.
		if time.Since(started) >= historyGap {
			t.Error("waited although there is no clipboard history")
		}
		return
	}
	if time.Since(started) < historyGap {
		t.Error("the capture followed the link too fast for the history to keep both")
	}
	if !has(formatPNG) {
		t.Error("the capture is not what the clipboard holds in the end")
	}
	if has(cfUnicodeText) {
		t.Error("the link is still on the clipboard: Ctrl+V would paste text")
	}
}

func TestLinkerKeepsWhatWasCopiedSince(t *testing.T) {
	private(t)
	path := picture(t, "capture.png")
	l := &linker{on: true, seen: map[string]uint32{}}

	l.noticed(path)
	_ = copyText("copied after the capture")
	number := clipboardNumber()
	l.uploaded([]watch.Upload{{Path: path, Link: "https://cloud.example/i/XyZ.png"}})

	if clipboardNumber() != number {
		t.Error("the clipboard was overwritten although something newer was on it")
	}
}

func TestLinkerSwitchedOff(t *testing.T) {
	private(t)
	path := picture(t, "capture.png")
	l := &linker{on: false, seen: map[string]uint32{}}

	_ = copyFile(path)
	l.noticed(path)
	number := clipboardNumber()
	l.uploaded([]watch.Upload{{Path: path, Link: "https://cloud.example/i/XyZ.png"}})

	if clipboardNumber() != number {
		t.Error("the clipboard was touched with -link=false")
	}
}
