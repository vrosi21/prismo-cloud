package main

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

// The picker: a small window that a hotkey brings up over whatever is being
// used. Type, pick, and it is pasted into the window that was there before.
//
// What the window shows is a web page (ui.html), drawn by WebView2, the
// browser engine that comes with Windows. The page has no network of its own:
// it asks this program for everything, and this program asks the cloud.

//go:embed ui.html
var page string

//go:embed vt323.woff2
var font []byte

// The picker's size as a web page counts it. On a dense screen Windows wants
// more pixels than that; show() works out how many.
const (
	pickerWidth  = 760
	pickerHeight = 520
)

type picker struct {
	cloud  *cloud
	hotkey string // as it was spelled, for showing
	theme  string
	data   string // where WebView2 keeps its own files

	hwnd    uintptr
	web     *edge.Chromium
	visible bool
	before  uintptr // the window that had the keyboard when the picker came up

	mu    sync.Mutex
	queue []func() // work waiting for the window's own thread
}

// Windows calls windowProc with a window handle and nothing else, so the one
// picker there is has to be findable from there.
var thePicker *picker

// run makes the window, hidden, and then serves it for as long as the helper
// lives. It only comes back when something is wrong.
func (p *picker) run(mods, key uint32) error {
	// A window belongs to the thread that made it, and so do its messages.
	runtime.LockOSThread()
	thePicker = p

	var instance windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &instance)
	arrow, _, _ := procLoadCursorW.Call(0, 32512)
	class := utf16ptr("PrismoCloudPicker")
	wc := wndClassEx{wndProc: windows.NewCallback(windowProc), instance: instance, cursor: arrow, className: class}
	wc.size = uint32(unsafe.Sizeof(wc))
	if r, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return fmt.Errorf("making the window: %w", err)
	}
	// A bare rectangle: no frame, no taskbar button, above other windows.
	hwnd, _, err := procCreateWindowExW.Call(
		wsExTopmost|wsExToolWindow,
		uintptr(unsafe.Pointer(class)),
		uintptr(unsafe.Pointer(utf16ptr("Prismo Cloud"))),
		wsPopup,
		0, 0, pickerWidth, pickerHeight,
		0, 0, uintptr(instance), 0,
	)
	if hwnd == 0 {
		return fmt.Errorf("making the window: %w", err)
	}
	p.hwnd = hwnd

	web := edge.NewChromium()
	web.DataPath = p.data
	web.MessageCallback = p.received
	if !web.Embed(p.hwnd) {
		return errors.New("WebView2 did not start. It comes with Windows 11 and with Edge; on Windows 10 it may need installing")
	}
	p.web = web
	if settings, err := web.GetSettings(); err == nil {
		// It is a page, but nobody should be able to tell.
		_ = settings.PutAreDefaultContextMenusEnabled(false)
		_ = settings.PutAreDevToolsEnabled(false)
		_ = settings.PutIsStatusBarEnabled(false)
		_ = settings.PutIsZoomControlEnabled(false)
		_ = settings.PutAreBrowserAcceleratorKeysEnabled(false) // F5, Ctrl+P and the like
	}
	web.NavigateToString(strings.NewReplacer(
		"{{FONT}}", base64.StdEncoding.EncodeToString(font),
		"{{THEME}}", html.EscapeString(p.theme),
		"{{HOTKEY}}", html.EscapeString(p.hotkey),
	).Replace(page))
	_ = web.Hide()

	if r, _, err := procRegisterHotKey.Call(p.hwnd, 1, uintptr(mods|modNoRepeat), uintptr(key)); r == 0 {
		return fmt.Errorf("the hotkey %s is already used by another program (%v). Pick another with -hotkey", p.hotkey, err)
	}
	log.Printf("picker ready, hotkey %s", p.hotkey)

	var m msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return errors.New("the picker's window was closed")
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func windowProc(hwnd, message, wparam, lparam uintptr) uintptr {
	p := thePicker
	switch uint32(message) {
	case wmHotkey:
		if p.visible {
			p.hide(true)
		} else {
			p.show()
		}
		return 0
	case wmApp:
		p.drain()
		return 0
	case wmSize:
		if p.web != nil {
			p.web.Resize()
		}
		return 0
	case wmActivate:
		// Low half zero: another window was chosen. The picker gets out of
		// the way, and leaves the keyboard where the user just put it.
		if wparam&0xFFFF == 0 {
			p.hide(false)
		}
	case wmClose:
		p.hide(true) // Alt+F4 puts it away; the helper keeps running
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, message, wparam, lparam)
	return r
}

// onWindowThread runs f on the thread that owns the window, which is the
// only one allowed to touch it or the page.
func (p *picker) onWindowThread(f func()) {
	p.mu.Lock()
	p.queue = append(p.queue, f)
	p.mu.Unlock()
	procPostMessageW.Call(p.hwnd, wmApp, 0, 0)
}

func (p *picker) drain() {
	p.mu.Lock()
	queue := p.queue
	p.queue = nil
	p.mu.Unlock()
	for _, f := range queue {
		f()
	}
}

// show brings the picker up on the screen that is being used.
func (p *picker) show() {
	p.before = foregroundWindow()

	const nearest = 2
	monitor, _, _ := procMonitorFromWindow.Call(p.before, nearest)
	if p.before == 0 {
		var at point
		procGetCursorPos.Call(uintptr(unsafe.Pointer(&at)))
		// A point is passed as one 64-bit value: x in the low half, y in the high.
		monitor, _, _ = procMonitorFromPoint.Call(uintptr(uint32(at.x))|uintptr(uint32(at.y))<<32, nearest)
	}
	info := monitorInfo{}
	info.size = uint32(unsafe.Sizeof(info))
	procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&info)))

	// 96 dots per inch is "100%"; a screen set to 150% reports 144.
	dpi := uint32(96)
	var dpiX, dpiY uint32
	if r, _, _ := procGetDpiForMonitor.Call(monitor, 0, uintptr(unsafe.Pointer(&dpiX)), uintptr(unsafe.Pointer(&dpiY))); r == 0 && dpiX > 0 {
		dpi = dpiX
	}
	w := int32(pickerWidth * dpi / 96)
	h := int32(pickerHeight * dpi / 96)
	area := info.work
	x := area.left + (area.right-area.left-w)/2
	y := area.top + (area.bottom-area.top-h)/3

	p.visible = true
	procSetWindowPos.Call(p.hwnd, hwndTopmost, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpShowWindow)
	_ = p.web.Show()
	p.web.Resize()
	procSetForegroundWindow.Call(p.hwnd)
	p.web.Focus()
	p.web.Eval("opened()")
}

// hide puts the picker away. giveBack hands the keyboard back to the window
// it came up over; not wanted when the user has already clicked another one.
func (p *picker) hide(giveBack bool) {
	if !p.visible {
		return
	}
	p.visible = false
	procShowWindow.Call(p.hwnd, swHide)
	_ = p.web.Hide()
	if giveBack && isWindow(p.before) {
		procSetForegroundWindow.Call(p.before)
	}
}

// request is what the page sends: which of the answers below it wants.
type request struct {
	ID     int               `json:"id"`
	Method string            `json:"method"`
	Params []json.RawMessage `json:"params"`
}

// received gets every message the page posts. It runs on the window's thread.
func (p *picker) received(text string) {
	var req request
	if json.Unmarshal([]byte(text), &req) != nil {
		return
	}
	// The cloud can take its time, and the window has to keep answering
	// Windows meanwhile: the work is done elsewhere and only the answer
	// comes back to this thread.
	go func() {
		value, err := p.answer(req)
		reply := map[string]any{"id": req.ID, "ok": err == nil, "value": value}
		if err != nil {
			reply["error"] = err.Error()
		}
		raw, _ := json.Marshal(reply)
		p.onWindowThread(func() { p.web.Eval("answered(" + string(raw) + ")") })
	}()
}

func (p *picker) answer(req request) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	text := func(i int) string {
		var s string
		if i < len(req.Params) {
			_ = json.Unmarshal(req.Params[i], &s)
		}
		return s
	}
	switch req.Method {
	case "search":
		return p.cloud.search(ctx, text(0), text(1))
	case "thumb":
		return p.cloud.thumb(ctx, text(0))
	case "pick":
		return nil, p.pick(ctx, text(0))
	case "close":
		p.onWindowThread(func() { p.hide(true) })
		return nil, nil
	}
	return nil, fmt.Errorf("the picker asked for %q, which is not a thing", req.Method)
}

// pick fetches an item, puts it on the clipboard, hands the keyboard back to
// the window the picker came up over, and pastes there.
func (p *picker) pick(ctx context.Context, id string) error {
	path, err := p.cloud.fetch(ctx, id)
	if err != nil {
		return err
	}
	if err := copyFile(path); err != nil {
		return err
	}
	target := make(chan uintptr, 1)
	p.onWindowThread(func() {
		target <- p.before
		p.hide(true)
	})
	go paste(<-target)
	return nil
}

// paste presses Ctrl+V in the given window, once it really has the keyboard.
func paste(target uintptr) {
	if !isWindow(target) {
		return
	}
	// The desktop and the taskbar have nowhere to paste into. The item is on
	// the clipboard all the same.
	switch className(target) {
	case "Progman", "WorkerW", "Shell_TrayWnd":
		return
	}
	if !waitFor(700*time.Millisecond, func() bool { return foregroundWindow() == target }) {
		log.Print("the window to paste into did not come back to the front; the item is on the clipboard")
		return
	}
	// A key that is still held down would turn Ctrl+V into something else.
	waitFor(time.Second, func() bool {
		return !keyDown(vkReturn) && !keyDown(vkShift) && !keyDown(vkControl) && !keyDown(vkMenu) && !keyDown(vkLWin) && !keyDown(vkRWin)
	})
	time.Sleep(50 * time.Millisecond)
	pressCtrlV()
}
