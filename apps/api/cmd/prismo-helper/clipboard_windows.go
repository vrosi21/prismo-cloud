package main

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

// Putting things on the Windows clipboard.
//
// One clipboard entry can hold the same thing in several formats; the
// program pasted into picks the one it likes best. A picture goes on as PNG
// (with its see-through parts, for programs that know PNG: every chat does)
// and as a plain bitmap (for everything else). A GIF or a video goes on as a
// file, the way Explorer copies files, because no picture format on the
// clipboard can move.

// Formats beyond the handful Windows defines go by name; Windows gives each
// name a number for as long as the session lasts.
var formatPNG, formatDropEffect uintptr

func init() { registerFormats() }

func registerFormats() {
	formatPNG, _, _ = procRegisterClipboardFormatW.Call(uintptr(unsafe.Pointer(utf16ptr("PNG"))))
	formatDropEffect, _, _ = procRegisterClipboardFormatW.Call(uintptr(unsafe.Pointer(utf16ptr("Preferred DropEffect"))))
}

// One thing in one format.
type shape struct {
	format uintptr
	data   []byte
}

// fill empties the clipboard and puts one thing on it, in the given formats.
// Their order matters: a program that knows several takes the first it knows,
// so the best one goes first.
func fill(shapes ...shape) error {
	// Opening and closing must happen on one and the same Windows thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// Another program may be holding the clipboard for a moment.
	opened := waitFor(time.Second, func() bool {
		r, _, _ := procOpenClipboard.Call(0)
		return r != 0
	})
	if !opened {
		return errors.New("the clipboard is busy")
	}
	defer procCloseClipboard.Call()
	if r, _, err := procEmptyClipboard.Call(); r == 0 {
		return fmt.Errorf("emptying the clipboard: %w", err)
	}
	for _, s := range shapes {
		format, data := s.format, s.data
		h, _, err := procGlobalAlloc.Call(gmemMoveable, uintptr(len(data)))
		if h == 0 {
			return fmt.Errorf("memory for the clipboard: %w", err)
		}
		at, _, err := procGlobalLock.Call(h)
		if at == 0 {
			procGlobalFree.Call(h)
			return fmt.Errorf("memory for the clipboard: %w", err)
		}
		copy(unsafe.Slice((*byte)(ptr(at)), len(data)), data)
		procGlobalUnlock.Call(h)
		if r, _, err := procSetClipboardData.Call(format, h); r == 0 {
			procGlobalFree.Call(h)
			return fmt.Errorf("putting it on the clipboard: %w", err)
		}
		// From here on the memory belongs to the clipboard.
	}
	return nil
}

func copyText(text string) error {
	return fill(shape{cfUnicodeText, wide(text)})
}

// copyFiles puts files on the clipboard as files: pasting uploads or copies them.
func copyFiles(paths ...string) error {
	return fill(
		shape{cfHDrop, dropFiles(paths)},
		shape{formatDropEffect, []byte{1, 0, 0, 0}}, // "copy", not "move"
	)
}

// copyFile puts one file on the clipboard the way it pastes best: a PNG or
// JPEG as a picture, anything else as a file.
func copyFile(path string) error {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
		return copyFiles(path)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	img, kind, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		// Not the picture its name says it is: let the other program look.
		return copyFiles(path)
	}
	asPNG := raw
	if kind != "png" {
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return err
		}
		asPNG = buf.Bytes()
	}
	return fill(shape{formatPNG, asPNG}, shape{cfDIB, dib(img)})
}

// clipboardNumber goes up by one every time anything is put on the clipboard,
// by anyone. Two equal readings mean: nothing was copied in between.
func clipboardNumber() uint32 {
	n, _, _ := procGetClipboardSequenceNumber.Call()
	return uint32(n)
}

// historyOn says whether Windows keeps a clipboard history (Win+V).
func historyOn() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Clipboard`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	on, _, err := k.GetIntegerValue("EnableClipboardHistory")
	return err == nil && on == 1
}
