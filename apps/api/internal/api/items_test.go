package api

import (
	"encoding/json"
	"testing"
	"time"

	"prismocloud/internal/store"
)

func applyJSON(t *testing.T, f *store.ItemFields, body string) string {
	t.Helper()
	var req itemRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatal(err)
	}
	return req.apply(f, time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC))
}

func TestNewTaskIsOpen(t *testing.T) {
	var f store.ItemFields
	if msg := applyJSON(t, &f, `{"kind":"task","title":"  dentist  ","date":"2026-11-20","time":"09:30","minutes":45}`); msg != "" {
		t.Fatal(msg)
	}
	if f.Title != "dentist" || *f.Status != "todo" || *f.Minutes != 45 || f.Canvas != nil {
		t.Fatalf("%+v", f)
	}
}

func TestClearingTheDayClearsWhatHangsOnIt(t *testing.T) {
	var f store.ItemFields
	applyJSON(t, &f, `{"kind":"event","title":"trip","date":"2026-11-20","time":"09:30","minutes":60,"end_date":"2026-11-22","repeat":"yearly"}`)
	if msg := applyJSON(t, &f, `{"kind":"task","date":null}`); msg != "" {
		t.Fatal(msg)
	}
	if f.Time != nil || f.Minutes != nil || f.EndDate != nil || f.Repeat != nil || *f.Status != "todo" {
		t.Fatalf("%+v", f)
	}
	if msg := applyJSON(t, &f, `{"kind":"event"}`); msg != "an event needs a day" {
		t.Fatalf("got %q", msg)
	}
}

func TestRepeatingTaskMovesOnWhenDone(t *testing.T) {
	var f store.ItemFields
	applyJSON(t, &f, `{"kind":"task","title":"rent","date":"2026-01-31","end_date":"2026-02-02","repeat":"weekly"}`)
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-02-07" || *f.EndDate != "2026-02-09" || *f.Status != "todo" || f.DoneAt != nil {
		t.Fatalf("date=%v end=%v status=%v done=%v", *f.Date, *f.EndDate, *f.Status, f.DoneAt)
	}
	applyJSON(t, &f, `{"repeat":null,"status":"done"}`)
	if *f.Status != "done" || f.DoneAt == nil {
		t.Fatalf("%+v", f)
	}
}

func TestBoards(t *testing.T) {
	var f store.ItemFields
	if msg := applyJSON(t, &f, `{"kind":"board","title":"roadmap"}`); msg != "" || string(f.Canvas) != `{"nodes":[],"edges":[]}` {
		t.Fatalf("%q %s", msg, f.Canvas)
	}
	if msg := applyJSON(t, &f, `{"canvas":{"nodes":[{"id":"a"}]}}`); msg == "" {
		t.Fatal("a canvas without edges was accepted")
	}
	if msg := applyJSON(t, &f, `{"kind":"task"}`); msg == "" {
		t.Fatal("a board became a task")
	}
	var task store.ItemFields
	applyJSON(t, &task, `{"kind":"task","title":"x"}`)
	if msg := applyJSON(t, &task, `{"kind":"board"}`); msg == "" {
		t.Fatal("a task became a board")
	}
}

func TestNotebookKeepsNoStatus(t *testing.T) {
	var f store.ItemFields
	applyJSON(t, &f, `{"kind":"task","title":"x","status":"doing"}`)
	if msg := applyJSON(t, &f, `{"kind":"notebook"}`); msg != "" || f.Status != nil {
		t.Fatalf("%q %+v", msg, f)
	}
	if msg := applyJSON(t, &f, `{"color":7}`); msg == "" {
		t.Fatal("colour 7 accepted")
	}
}
