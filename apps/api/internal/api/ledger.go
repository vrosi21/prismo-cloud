package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"prismocloud/internal/store"
)

// The ledger: what Claude sessions (and any other token) changed, newest
// first. Every write a token makes adds a "change" line by itself (record);
// a session adds a "note" saying in a sentence what it did (postLedger).
// Changes made in the browser are the owner's own and are not listed.

const sessionHeader = "X-Prismo-Session"

// whoOf names the writer: the session's own name if it sent one, else the token's.
func whoOf(r *http.Request) string {
	name := strings.Map(func(c rune) rune {
		if unicode.IsControl(c) {
			return -1
		}
		return c
	}, strings.TrimSpace(r.Header.Get(sessionHeader)))
	if name == "" {
		if p := who(r); p.Token != nil {
			name = p.Token.Name
		} else {
			name = "you"
		}
	}
	return cut(name, 60)
}

func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

func plannerToken(r *http.Request) bool {
	p := who(r)
	return p.Token != nil && p.Token.Scope == "planner"
}

// record adds a "change" line for a write made through a token. A failed
// line does not fail the write: it is logged, and the change stands.
func (s *Server) record(r *http.Request, message string, items ...string) {
	p := who(r)
	if p == nil || p.Token == nil {
		return
	}
	if err := s.store.AddLedger(r.Context(), p.UserID, whoOf(r), "change", cut(message, 500), items, &p.Token.ID); err != nil {
		slog.Error("ledger line not written", "err", err)
	}
}

func (s *Server) recordLink(r *http.Request, verb, a, b string) {
	if who(r).Token == nil {
		return
	}
	owner := who(r).UserID
	names := make([]string, 0, 2)
	for _, id := range []string{a, b} {
		if it, err := s.store.GetItem(r.Context(), owner, id); err == nil {
			names = append(names, named(it))
		}
	}
	if len(names) == 2 {
		s.record(r, verb+" "+names[0]+" and "+names[1], a, b)
	}
}

// named: `task "rf lab report"`, or `notebook` when it has no title.
func named(it store.Item) string {
	if it.Title == "" {
		return "untitled " + it.Kind
	}
	return it.Kind + ` "` + cut(it.Title, 80) + `"`
}

func describeNew(it store.Item) string {
	msg := "made " + named(it)
	if it.Date != nil {
		msg += " on " + *it.Date
		if it.Time != nil {
			msg += " " + *it.Time
		}
	}
	if it.Repeat != nil {
		msg += ", " + *it.Repeat
	}
	return msg
}

// describeChange says what a change did, in a line: ticked off, trashed,
// or which parts changed. "" when nothing visible changed. ticked: the
// request set the status to done (a repeat then moves on instead).
func describeChange(b, a store.Item, ticked bool) string {
	switch {
	case b.DeletedAt == nil && a.DeletedAt != nil:
		return "trashed " + named(a)
	case b.DeletedAt != nil && a.DeletedAt == nil:
		return "brought back " + named(a)
	case ticked && deref(b.Status) != "done" && deref(a.Status) == "done":
		return "ticked off " + named(a)
	case ticked && a.Repeat != nil && !eq(b.Date, a.Date):
		return "ticked off " + named(a) + ", next on " + deref(a.Date)
	}
	var parts []string
	add := func(changed bool, what string) {
		if changed {
			parts = append(parts, what)
		}
	}
	if b.Title != a.Title {
		parts = append(parts, `title (was "`+cut(b.Title, 60)+`")`)
	}
	add(b.Kind != a.Kind, "now a "+a.Kind)
	add(!eq(b.Status, a.Status), "status "+deref(a.Status))
	add(!eq(b.Date, a.Date), "day "+deref(a.Date))
	add(!eq(b.Time, a.Time), "time "+deref(a.Time))
	add(!eq(b.EndDate, a.EndDate), "last day")
	add(!same(b.Minutes, a.Minutes), "length")
	add(!eq(b.Repeat, a.Repeat), "repeat "+deref(a.Repeat))
	add(!eq(b.RepeatUntil, a.RepeatUntil), "repeat end")
	add(!jsonEqual(b.Exceptions, a.Exceptions), "one of its appearances")
	add(!same(b.Color, a.Color), "colour")
	pinB, pinA := pinOf(b.Tags), pinOf(a.Tags)
	add(pinB != pinA && pinA != "", "pinned in "+pinA)
	add(pinB != pinA && pinA == "", "unpinned")
	add(!slices.Equal(withoutPins(b.Tags), withoutPins(a.Tags)), "tags")
	add(!eq(b.CollectionID, a.CollectionID), "folder")
	add(deref(b.Body) != deref(a.Body), "notes")
	add(string(b.Canvas) != string(a.Canvas), "the board")
	if len(parts) == 0 {
		return ""
	}
	return "changed " + named(a) + ": " + strings.Join(parts, ", ")
}

func eq(a, b *string) bool { return deref(a) == deref(b) && (a == nil) == (b == nil) }

func same[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func deref(s *string) string {
	if s == nil {
		return "none"
	}
	return *s
}

func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func pinOf(tags []string) string {
	for _, t := range tags {
		if p, ok := strings.CutPrefix(t, "pin:"); ok {
			return p
		}
	}
	return ""
}

func withoutPins(tags []string) []string {
	out := []string{}
	for _, t := range tags {
		if !strings.HasPrefix(t, "pin:") {
			out = append(out, t)
		}
	}
	return out
}

// GET /v1/ledger?before=<id>&who=<name>&limit=<n>
func (s *Server) listLedger(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	before := q.Get("before")
	if before != "" && !isUUID(before) {
		writeErr(w, http.StatusBadRequest, "before is an entry id")
		return
	}
	limit := 100
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 && n <= 500 {
		limit = n
	}
	entries, err := s.store.ListLedger(r.Context(), who(r).UserID, before, q.Get("who"), limit)
	if err != nil {
		serverError(w, r, err)
		return
	}
	resp := map[string]any{"entries": entries}
	if len(entries) == limit {
		resp["next"] = entries[len(entries)-1].ID
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /v1/ledger {"message": "...", "items": [ids], "who": "..."}: a note.
func (s *Server) postLedger(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Message string   `json:"message"`
		Items   []string `json:"items"`
		Who     string   `json:"who"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || utf8.RuneCountInString(req.Message) > 500 {
		writeErr(w, http.StatusBadRequest, "a note is 1 to 500 characters")
		return
	}
	if len(req.Items) > 50 {
		writeErr(w, http.StatusBadRequest, "at most 50 items in one note")
		return
	}
	for _, id := range req.Items {
		if !isUUID(id) {
			writeErr(w, http.StatusBadRequest, "items are item ids")
			return
		}
	}
	name := whoOf(r)
	if w := strings.TrimSpace(req.Who); w != "" {
		name = cut(w, 60)
	}
	p := who(r)
	var token *string
	if p.Token != nil {
		token = &p.Token.ID
	}
	if err := s.store.AddLedger(r.Context(), p.UserID, name, "note", req.Message, req.Items, token); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
