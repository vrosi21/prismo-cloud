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
	applyJSON(t, &f, `{"kind":"task","title":"rent","date":"2026-11-14","end_date":"2026-11-16","repeat":"weekly"}`)
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-11-21" || *f.EndDate != "2026-11-23" || *f.Status != "todo" || f.DoneAt != nil {
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

func TestRepeatStopsAtItsLastDay(t *testing.T) {
	var f store.ItemFields
	applyJSON(t, &f, `{"kind":"task","title":"lab report","date":"2026-11-22","repeat":"weekly","repeat_until":"2026-11-29"}`)
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-11-29" || *f.Status != "todo" {
		t.Fatalf("first tick: %v %v", *f.Date, *f.Status)
	}
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-11-29" || *f.Status != "done" || f.DoneAt == nil {
		t.Fatalf("last tick should stay done on its day: %v %v", *f.Date, *f.Status)
	}
	if msg := applyJSON(t, &f, `{"repeat_until":"2026-11-01"}`); msg == "" {
		t.Fatal("an end before the start was accepted")
	}
	applyJSON(t, &f, `{"repeat":null}`)
	if f.RepeatUntil != nil {
		t.Fatal("no repeat, no end of it")
	}
	if msg := applyJSON(t, &f, `{"repeat_until":"2026-12-31"}`); msg == "" {
		t.Fatal("an end without a repeat was accepted")
	}
}

func TestTagsAreCleaned(t *testing.T) {
	var f store.ItemFields
	if msg := applyJSON(t, &f, `{"kind":"event","title":"x","date":"2026-11-20","tags":[" DSAI ","course:MAI3","dsai",""]}`); msg != "" {
		t.Fatal(msg)
	}
	if len(f.Tags) != 2 || f.Tags[0] != "dsai" || f.Tags[1] != "course:mai3" {
		t.Fatalf("%q", f.Tags)
	}
}

// Ticked off long after its day (the tests' today is 2026-11-16), a repeat
// goes on to the first day that is not past, not to the one after the old day.
func TestLateTickGoesToTheNextDayNotPast(t *testing.T) {
	var f store.ItemFields
	applyJSON(t, &f, `{"kind":"task","title":"report","date":"2026-01-31","repeat":"weekly"}`)
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-11-21" || *f.Status != "todo" {
		t.Fatalf("weekly: %v %v", *f.Date, *f.Status)
	}
	applyJSON(t, &f, `{"date":"2026-01-31","repeat":"monthly"}`)
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-12-31" {
		t.Fatalf("monthly from the 31st: %v", *f.Date)
	}
	applyJSON(t, &f, `{"date":"2026-11-16","repeat":"daily"}`)
	applyJSON(t, &f, `{"status":"done"}`)
	if *f.Date != "2026-11-17" {
		t.Fatalf("done on its day: %v", *f.Date)
	}
}

func TestExceptions(t *testing.T) {
	var f store.ItemFields
	msg := applyJSON(t, &f, `{"kind":"event","title":"rf lab","date":"2026-11-18","time":"17:00","repeat":"weekly",
		"exceptions":{"2026-11-18":{"title":"  rf lab 2  "},"2026-11-25":{"date":"2026-11-26","time":"18:00"},
		"2026-12-02":{"skip":true,"title":"gone"},"2026-12-09":{}}}`)
	if msg != "" {
		t.Fatal(msg)
	}
	if len(f.Exceptions) != 3 || *f.Exceptions["2026-11-18"].Title != "rf lab 2" || *f.Exceptions["2026-11-25"].Time != "18:00" ||
		f.Exceptions["2026-12-02"] != (store.Exception{Skip: true}) {
		t.Fatalf("%+v", f.Exceptions)
	}
	for _, bad := range []string{
		`{"exceptions":{"18.11.":{"title":"x"}}}`,
		`{"exceptions":{"2026-11-18":{"time":"5pm"}}}`,
		`{"exceptions":{"2026-11-18":{"date":"tomorrow"}}}`,
		`{"exceptions":{"2026-11-18":{"minutes":0}}}`,
	} {
		g := f
		g.Exceptions = map[string]store.Exception{}
		if msg := applyJSON(t, &g, bad); msg == "" {
			t.Fatalf("accepted %s", bad)
		}
	}
	// A ticked-off repeating task leaves the exceptions of past days behind.
	var task store.ItemFields
	applyJSON(t, &task, `{"kind":"task","title":"rl report","date":"2026-11-19","repeat":"weekly",
		"exceptions":{"2026-11-19":{"title":"rl lab 2: submit"},"2026-11-26":{"title":"rl lab 3: submit"}}}`)
	applyJSON(t, &task, `{"status":"done"}`)
	if *task.Date != "2026-11-26" || len(task.Exceptions) != 1 || task.Exceptions["2026-11-26"].Title == nil {
		t.Fatalf("%v %+v", *task.Date, task.Exceptions)
	}
	applyJSON(t, &f, `{"repeat":null}`)
	if len(f.Exceptions) != 0 {
		t.Fatal("no repeat, no exceptions")
	}
	if msg := applyJSON(t, &f, `{"exceptions":{"2026-11-18":{"title":"x"}}}`); msg == "" {
		t.Fatal("exceptions without a repeat were accepted")
	}
}
