package api

import (
	"testing"

	"prismocloud/internal/store"
)

func sp(s string) *string { return &s }

func TestDescribeChange(t *testing.T) {
	base := store.Item{Kind: "task", Title: "rl lab report", Status: sp("todo"), Date: sp("2026-11-19"), Repeat: sp("weekly"), Tags: []string{"dsai"}}
	cases := []struct {
		name   string
		change func(*store.Item)
		ticked bool
		want   string
	}{
		{"nothing", func(*store.Item) {}, false, ""},
		{"day and time", func(a *store.Item) { a.Date, a.Time = sp("2026-11-20"), sp("17:00") }, false, `changed task "rl lab report": day 2026-11-20, time 17:00`},
		{"repeat moves on", func(a *store.Item) { a.Date = sp("2026-11-26") }, true, `ticked off task "rl lab report", next on 2026-11-26`},
		{"done", func(a *store.Item) { a.Repeat, a.Status = nil, sp("done") }, true, `ticked off task "rl lab report"`},
		{"pinned", func(a *store.Item) { a.Tags = []string{"dsai", "pin:labs"} }, false, `changed task "rl lab report": pinned in labs`},
		{"renamed", func(a *store.Item) { a.Title = "rl lab 2" }, false, `changed task "rl lab 2": title (was "rl lab report")`},
	}
	for _, c := range cases {
		a := base
		a.Tags = append([]string{}, base.Tags...)
		c.change(&a)
		if got := describeChange(base, a, c.ticked); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
