package main

import (
	"log"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The handful of Windows calls the helper needs, with the names Windows
// gives them. Each is a thin wrapper; what they are used for is in the files
// that use them.

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	shcore   = windows.NewLazySystemDLL("shcore.dll")

	procRegisterClassExW       = user32.NewProc("RegisterClassExW")
	procCreateWindowExW        = user32.NewProc("CreateWindowExW")
	procDefWindowProcW         = user32.NewProc("DefWindowProcW")
	procGetMessageW            = user32.NewProc("GetMessageW")
	procTranslateMessage       = user32.NewProc("TranslateMessage")
	procDispatchMessageW       = user32.NewProc("DispatchMessageW")
	procPostMessageW           = user32.NewProc("PostMessageW")
	procPostQuitMessage        = user32.NewProc("PostQuitMessage")
	procShowWindow             = user32.NewProc("ShowWindow")
	procSetWindowPos           = user32.NewProc("SetWindowPos")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procGetForegroundWindow    = user32.NewProc("GetForegroundWindow")
	procIsWindow               = user32.NewProc("IsWindow")
	procGetClassNameW          = user32.NewProc("GetClassNameW")
	procLoadCursorW            = user32.NewProc("LoadCursorW")
	procRegisterHotKey         = user32.NewProc("RegisterHotKey")
	procSendInput              = user32.NewProc("SendInput")
	procGetAsyncKeyState       = user32.NewProc("GetAsyncKeyState")
	procMonitorFromWindow      = user32.NewProc("MonitorFromWindow")
	procMonitorFromPoint       = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW        = user32.NewProc("GetMonitorInfoW")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procMessageBoxW            = user32.NewProc("MessageBoxW")
	procSetDpiAwarenessContext = user32.NewProc("SetProcessDpiAwarenessContext")
	procGetDpiForMonitor       = shcore.NewProc("GetDpiForMonitor")

	procOpenClipboard              = user32.NewProc("OpenClipboard")
	procCloseClipboard             = user32.NewProc("CloseClipboard")
	procEmptyClipboard             = user32.NewProc("EmptyClipboard")
	procSetClipboardData           = user32.NewProc("SetClipboardData")
	procRegisterClipboardFormatW   = user32.NewProc("RegisterClipboardFormatW")
	procGetClipboardSequenceNumber = user32.NewProc("GetClipboardSequenceNumber")

	procGlobalAlloc  = kernel32.NewProc("GlobalAlloc")
	procGlobalLock   = kernel32.NewProc("GlobalLock")
	procGlobalUnlock = kernel32.NewProc("GlobalUnlock")
	procGlobalFree   = kernel32.NewProc("GlobalFree")
)

const (
	wmDestroy  = 0x0002
	wmSize     = 0x0005
	wmActivate = 0x0006
	wmClose    = 0x0010
	wmHotkey   = 0x0312
	wmApp      = 0x8000

	wsPopup        = 0x80000000
	wsExTopmost    = 0x00000008
	wsExToolWindow = 0x00000080 // no button on the taskbar

	swHide        = 0
	swpShowWindow = 0x0040
	hwndTopmost   = ^uintptr(0) // -1

	vkReturn  = 0x0D
	vkShift   = 0x10
	vkControl = 0x11
	vkMenu    = 0x12 // Alt
	vkLWin    = 0x5B
	vkRWin    = 0x5C
	vkV       = 0x56

	modNoRepeat = 0x4000

	cfDIB         = 8
	cfUnicodeText = 13
	cfHDrop       = 15
	gmemMoveable  = 0x0002

	mbIconError = 0x10
)

type point struct{ x, y int32 }

type rect struct{ left, top, right, bottom int32 }

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   windows.Handle
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSm     uintptr
}

type monitorInfo struct {
	size    uint32
	monitor rect
	work    rect // the monitor without the taskbar
	flags   uint32
}

// keyInput is INPUT with its keyboard half filled in: 40 bytes on 64-bit
// Windows, the size SendInput insists on.
type keyInput struct {
	kind  uint32 // 1: keyboard
	_     uint32
	vk    uint16
	scan  uint16
	flags uint32 // 2: key up
	time  uint32
	_     uint32
	extra uintptr
	_     [8]byte
}

// ptr turns an address handed out by Windows into a pointer. The memory is
// not Go's, so the garbage collector neither moves nor frees it.
func ptr(addr uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&addr)) }

func utf16ptr(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

func foregroundWindow() uintptr {
	h, _, _ := procGetForegroundWindow.Call()
	return h
}

func isWindow(h uintptr) bool {
	r, _, _ := procIsWindow.Call(h)
	return h != 0 && r != 0
}

func className(h uintptr) string {
	buf := make([]uint16, 128)
	n, _, _ := procGetClassNameW.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return windows.UTF16ToString(buf[:n])
}

func keyDown(vk uintptr) bool {
	r, _, _ := procGetAsyncKeyState.Call(vk)
	return r&0x8000 != 0
}

// pressCtrlV types Ctrl+V into whatever window has the keyboard.
func pressCtrlV() {
	const keyUp = 2
	keys := []keyInput{
		{kind: 1, vk: vkControl},
		{kind: 1, vk: vkV},
		{kind: 1, vk: vkV, flags: keyUp},
		{kind: 1, vk: vkControl, flags: keyUp},
	}
	sent, _, err := procSendInput.Call(uintptr(len(keys)), uintptr(unsafe.Pointer(&keys[0])), unsafe.Sizeof(keys[0]))
	if int(sent) != len(keys) {
		// A window run as administrator does not take keys from an ordinary program.
		log.Printf("could not press Ctrl+V there (%v); the item is on the clipboard", err)
	}
}

// waitFor looks every few milliseconds until ok says yes or the time is up.
func waitFor(limit time.Duration, ok func() bool) bool {
	deadline := time.Now().Add(limit)
	for !ok() {
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(10 * time.Millisecond)
	}
	return true
}

// complain shows a message box. The helper has no console, so this is the
// only way to say why it will not start.
func complain(text string) {
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(utf16ptr(text))), uintptr(unsafe.Pointer(utf16ptr("Prismo Cloud helper"))), mbIconError)
}
