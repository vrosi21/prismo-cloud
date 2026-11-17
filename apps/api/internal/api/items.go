package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"prismocloud/internal/store"
)

// Items: tasks, events, notebooks and boards (see store/items.go). Each
// member has their own; nothing about them is shared yet.

const (
	dayLayout  = "2006-01-02"
	timeLayout = "15:04"
	// Wide enough for four months side by side, or a year at a glance.
	maxItemSpan = 400 * 24 * time.Hour
	maxBody     = 1 << 20 // bytes of Markdown in one item
	maxCanvas   = 4 << 20 // bytes of JSON Canvas in one board
)

var itemKinds = map[string]bool{"task": true, "event": true, "notebook": true, "board": true}
var itemStatuses = map[string]bool{"todo": true, "doing": true, "waiting": true, "done": true}
var itemRepeats = map[string]bool{"daily": true, "weekly": true, "monthly": true, "yearly": true}

// An empty board: JSON Canvas 1.0, which other canvas apps can open too.
var emptyCanvas = []byte(`{"nodes":[],"edges":[]}`)

func validDay(s string) bool {
	_, err := time.Parse(dayLayout, s)
	return err == nil
}

func validTime(s string) bool {
	_, err := time.Parse(timeLayout, s)
	return err == nil && len(s) == len(timeLayout)
}

type optionalInt struct {
	Set   bool
	Value *int
}

func (o *optionalInt) UnmarshalJSON(b []byte) error {
	o.Set = true
	return json.Unmarshal(b, &o.Value)
}

// itemRequest is the body of a create or a change. A field left out stays
// as it is; null clears it.
type itemRequest struct {
	Kind         *string         `json:"kind"`
	Title        *string         `json:"title"`
	Body         *string         `json:"body"`
	Canvas       json.RawMessage `json:"canvas"`
	CollectionID optionalString  `json:"collection_id"`
	Status       optionalString  `json:"status"`
	Date         optionalString  `json:"date"`
	Time         optionalString  `json:"time"`
	EndDate      optionalString  `json:"end_date"`
	Minutes      optionalInt     `json:"minutes"`
	Repeat       optionalString  `json:"repeat"`
	RepeatUntil  optionalString  `json:"repeat_until"`
	Color        optionalInt     `json:"color"`
	Tags         *[]string       `json:"tags"`
	// The whole set of exceptions of a repeat; {} clears them.
	Exceptions *map[string]store.Exception `json:"exceptions"`
	Trashed    *bool                       `json:"trashed"`
	// The version the caller read; a change to the body or the canvas is
	// refused (409) if someone changed them since. 0 skips the check.
	Version int `json:"version"`
	// Create only: link the new item from this one ("add a notebook to this task").
	LinkFrom string `json:"link_from"`
}

// apply writes the request onto f and puts the parts back in order: no
// time without a day, no status on what is not a task, and so on. It
// returns what is wrong, or "".
func (req *itemRequest) apply(f *store.ItemFields, now time.Time) string {
	if req.Kind != nil {
		if !itemKinds[*req.Kind] {
			return "kind is task, event, notebook or board"
		}
		if (*req.Kind == "board") != (f.Kind == "board") && f.Kind != "" {
			return "a board stays a board, and nothing else becomes one"
		}
		f.Kind = *req.Kind
	}
	if req.Title != nil {
		f.Title = strings.TrimSpace(*req.Title)
	}
	if req.Body != nil {
		f.Body = *req.Body
	}
	if req.Canvas != nil {
		f.Canvas = req.Canvas
	}
	setStr := func(o optionalString, to **string) {
		if o.Set {
			*to = o.Value
		}
	}
	setStr(req.CollectionID, &f.CollectionID)
	setStr(req.Status, &f.Status)
	setStr(req.Date, &f.Date)
	setStr(req.Time, &f.Time)
	setStr(req.EndDate, &f.EndDate)
	setStr(req.Repeat, &f.Repeat)
	setStr(req.RepeatUntil, &f.RepeatUntil)
	if req.Minutes.Set {
		f.Minutes = req.Minutes.Value
	}
	if req.Color.Set {
		f.Color = req.Color.Value
	}
	if req.Trashed != nil {
		f.Trashed = *req.Trashed
	}
	if req.Tags != nil {
		tags := cleanTags(*req.Tags)
		if tags == nil {
			return "a tag is at most 40 characters, at most 30 of them"
		}
		f.Tags = tags
	}
	if req.Exceptions != nil {
		f.Exceptions = *req.Exceptions
	}

	// Asking for a time (or a length, a last day, a repeat) on something
	// with no day is a mistake worth saying; taking the day away quietly
	// takes them with it.
	switch {
	case f.Repeat == nil && req.RepeatUntil.Value != nil:
		return "an end of the repeat needs a repeat"
	case f.Repeat == nil && req.Exceptions != nil && len(*req.Exceptions) > 0:
		return "changing one of a repeat needs a repeat"
	case f.Date == nil && (req.Time.Value != nil || req.EndDate.Value != nil || req.Repeat.Value != nil):
		return "a time, a last day or a repeat needs a day"
	case f.Time == nil && req.Minutes.Value != nil:
		return "a length needs a time"
	}

	// What follows from what.
	if f.Kind == "task" && f.Status == nil {
		todo := "todo"
		f.Status = &todo
	}
	if f.Kind != "task" {
		f.Status = nil
	}
	if f.Kind == "board" && f.Canvas == nil {
		f.Canvas = emptyCanvas
	}
	if f.Kind != "board" {
		f.Canvas = nil
	}
	if f.Date == nil {
		f.Time, f.EndDate, f.Repeat = nil, nil, nil
	}
	if f.Repeat == nil {
		f.RepeatUntil, f.Exceptions = nil, nil
	}
	if f.Time == nil {
		f.Minutes = nil
	}
	if f.EndDate != nil && f.Date != nil && *f.EndDate == *f.Date {
		f.EndDate = nil
	}

	// A repeating task ticked off moves on to its next day instead.
	if f.Status != nil && *f.Status == "done" && f.Repeat != nil && f.Date != nil {
		advance(f, now) // the last one, past repeat_until, just stays done
	}
	if msg := cleanExceptions(f); msg != "" {
		return msg
	}
	switch {
	case f.Status != nil && *f.Status == "done":
		if f.DoneAt == nil {
			f.DoneAt = &now
		}
	default:
		f.DoneAt = nil
	}

	// Is it all valid?
	switch {
	case utf8.RuneCountInString(f.Title) > 200:
		return "a title is at most 200 characters"
	case f.Title == "" && (f.Kind == "task" || f.Kind == "event"):
		return "a " + f.Kind + " needs a title"
	case len(f.Body) > maxBody:
		return "the text is longer than 1 MB"
	case f.Status != nil && !itemStatuses[*f.Status]:
		return "status is todo, doing, waiting or done"
	case f.Kind == "event" && f.Date == nil:
		return "an event needs a day"
	case f.Date != nil && !validDay(*f.Date), f.EndDate != nil && !validDay(*f.EndDate):
		return "a day looks like 2026-11-01"
	case f.EndDate != nil && *f.EndDate < *f.Date:
		return "the last day is before the first"
	case f.Time != nil && !validTime(*f.Time):
		return "a time looks like 09:30"
	case f.Minutes != nil && (*f.Minutes < 1 || *f.Minutes > 7*24*60):
		return "a length is 1 minute to 7 days"
	case f.Repeat != nil && !itemRepeats[*f.Repeat]:
		return "repeat is daily, weekly, monthly or yearly"
	case f.RepeatUntil != nil && !validDay(*f.RepeatUntil):
		return "a day looks like 2026-11-01"
	case f.RepeatUntil != nil && *f.RepeatUntil < *f.Date:
		return "the repeat ends before it starts"
	case f.Color != nil && (*f.Color < 1 || *f.Color > 6):
		return "colour is 1 to 6"
	case f.CollectionID != nil && !isUUID(*f.CollectionID):
		return "collection_id is a folder id"
	}
	if f.Canvas != nil {
		if len(f.Canvas) > maxCanvas {
			return "the board is larger than 4 MB"
		}
		var c struct {
			Nodes []json.RawMessage `json:"nodes"`
			Edges []json.RawMessage `json:"edges"`
		}
		if err := json.Unmarshal(f.Canvas, &c); err != nil || c.Nodes == nil || c.Edges == nil {
			return "canvas is a JSON Canvas object with nodes and edges"
		}
		var compact bytes.Buffer
		if json.Compact(&compact, f.Canvas) == nil {
			f.Canvas = compact.Bytes()
		}
	}
	return ""
}

// advance moves a repeating item to its next day, keeping how many days it
// spans, and opens it again. Ticked off late, it goes on to the next day
// that is not past yet: a deadline that went by is not due again. The
// exceptions of the days left behind go with them.
func advance(f *store.ItemFields, now time.Time) {
	from, err := time.Parse(dayLayout, *f.Date)
	if err != nil {
		return
	}
	today := now.Format(dayLayout)
	var next time.Time
	// The n-th step from the start, not one step at a time: the 31st stays
	// the 31st where the month has one.
	for n := 1; n <= 40000; n++ {
		switch *f.Repeat {
		case "daily":
			next = from.AddDate(0, 0, n)
		case "weekly":
			next = from.AddDate(0, 0, 7*n)
		case "monthly":
			next = from.AddDate(0, n, 0)
		case "yearly":
			next = from.AddDate(n, 0, 0)
		default:
			return
		}
		// No 31st in November: that month is skipped, as the calendar does.
		if (*f.Repeat == "monthly" || *f.Repeat == "yearly") && next.Day() != from.Day() {
			continue
		}
		if next.Format(dayLayout) >= today {
			break
		}
	}
	day := next.Format(dayLayout)
	if f.RepeatUntil != nil && day > *f.RepeatUntil {
		return
	}
	for k := range f.Exceptions {
		if k < day {
			delete(f.Exceptions, k)
		}
	}
	if f.EndDate != nil {
		if end, err := time.Parse(dayLayout, *f.EndDate); err == nil {
			e := end.Add(next.Sub(from)).Format(dayLayout)
			f.EndDate = &e
		}
	}
	todo := "todo"
	f.Date, f.Status = &day, &todo
}

// cleanExceptions checks the exceptions of a repeat and drops the empty ones.
func cleanExceptions(f *store.ItemFields) string {
	if len(f.Exceptions) > 500 {
		return "at most 500 changed days in one repeat"
	}
	for day, x := range f.Exceptions {
		if x.Title != nil {
			t := strings.TrimSpace(*x.Title)
			x.Title = &t
			if t == "" {
				x.Title = nil
			}
		}
		if x.Skip {
			x = store.Exception{Skip: true}
		}
		switch {
		case !validDay(day), x.Date != nil && !validDay(*x.Date):
			return "a day looks like 2026-11-01"
		case x.Time != nil && !validTime(*x.Time):
			return "a time looks like 09:30"
		case x.Minutes != nil && (*x.Minutes < 1 || *x.Minutes > 7*24*60):
			return "a length is 1 minute to 7 days"
		case x.Title != nil && utf8.RuneCountInString(*x.Title) > 200:
			return "a title is at most 200 characters"
		}
		if x == (store.Exception{}) {
			delete(f.Exceptions, day)
		} else {
			f.Exceptions[day] = x
		}
	}
	return ""
}

func (s *Server) itemError(w http.ResponseWriter, r *http.Request, err error) bool {
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.As(err, &pgErr) && pgErr.Code == "23503": // foreign key: the folder
		writeErr(w, http.StatusBadRequest, "no such folder")
	case errors.As(err, &pgErr) && pgErr.Code == "23514": // a check the API should have caught
		writeErr(w, http.StatusBadRequest, "that combination is not possible")
	default:
		serverError(w, r, err)
	}
	return true
}

// decodeItem reads a request body big enough for a full board.
func decodeItem(w http.ResponseWriter, r *http.Request, req *itemRequest) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxCanvas+maxBody/4)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "that is too big to save in one go")
		return false
	}
	if err := json.Unmarshal(raw, req); err != nil {
		writeErr(w, http.StatusBadRequest, "request body is not valid JSON")
		return false
	}
	return true
}

// listItems:
//
//	?from=2026-11-01&to=2026-11-30   the calendar: what touches those days
//	&someday=1                        and the tasks with no day
//	?kind=notebook,board              of these kinds
//	?collection=<id>|none             in that folder, or at the top
//	?q=words                          title or text contains them
//	?ids=a,b,c                        exactly these (a board's cards)
//	?trashed=1                        what is in the trash
func (s *Server) listItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	iq := store.ItemQuery{OwnerID: who(r).UserID, Trashed: q.Get("trashed") == "1", Limit: 500, Query: strings.TrimSpace(q.Get("q"))}
	if q.Get("from") != "" || q.Get("to") != "" {
		from, errFrom := time.Parse(dayLayout, q.Get("from"))
		to, errTo := time.Parse(dayLayout, q.Get("to"))
		if errFrom != nil || errTo != nil || to.Before(from) || to.Sub(from) > maxItemSpan {
			writeErr(w, http.StatusBadRequest, "from and to are days (2026-11-01), from first, at most 400 days apart")
			return
		}
		iq.From, iq.To, iq.Someday = q.Get("from"), q.Get("to"), q.Get("someday") == "1"
		iq.Limit = 2000
	}
	if k := q.Get("kind"); k != "" {
		for _, kind := range strings.Split(k, ",") {
			if !itemKinds[kind] {
				writeErr(w, http.StatusBadRequest, "kind is task, event, notebook or board")
				return
			}
			iq.Kinds = append(iq.Kinds, kind)
		}
	}
	if c := q.Get("collection"); c != "" {
		if c != "none" && !isUUID(c) {
			writeErr(w, http.StatusBadRequest, `collection is a folder id or "none"`)
			return
		}
		iq.CollectionID = c
	}
	if ids := q.Get("ids"); ids != "" {
		for _, id := range strings.Split(ids, ",") {
			if !isUUID(id) {
				writeErr(w, http.StatusBadRequest, "ids are item ids")
				return
			}
			iq.IDs = append(iq.IDs, id)
		}
		if len(iq.IDs) > 1000 {
			writeErr(w, http.StatusBadRequest, "at most 1000 ids at once")
			return
		}
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 && n < iq.Limit {
		iq.Limit = n
	}
	items, err := s.store.ListItems(r.Context(), iq)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) getItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	it, err := s.store.GetItem(r.Context(), who(r).UserID, id)
	if s.itemError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, it)
}

func (s *Server) createItem(w http.ResponseWriter, r *http.Request) {
	var req itemRequest
	if !decodeItem(w, r, &req) {
		return
	}
	if req.Kind == nil {
		writeErr(w, http.StatusBadRequest, "kind is task, event, notebook or board")
		return
	}
	owner := who(r).UserID
	if req.CollectionID.Set && !s.checkCollection(w, r, owner, req.CollectionID.Value) {
		return
	}
	var f store.ItemFields
	if msg := req.apply(&f, time.Now()); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if req.LinkFrom != "" && !isUUID(req.LinkFrom) {
		writeErr(w, http.StatusBadRequest, "link_from is an item id")
		return
	}
	it, err := s.store.CreateItem(r.Context(), owner, f)
	if s.itemError(w, r, err) {
		return
	}
	if req.LinkFrom != "" {
		if s.itemError(w, r, s.store.LinkItems(r.Context(), owner, req.LinkFrom, it.ID)) {
			return
		}
		if it, err = s.store.GetItem(r.Context(), owner, it.ID); s.itemError(w, r, err) {
			return
		}
	}
	writeJSON(w, http.StatusCreated, it)
}

func (s *Server) updateItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req itemRequest
	if !decodeItem(w, r, &req) {
		return
	}
	owner := who(r).UserID
	// Only into one of the owner's own folders.
	if req.CollectionID.Set && !s.checkCollection(w, r, owner, req.CollectionID.Value) {
		return
	}
	var bad string
	it, err := s.store.UpdateItem(r.Context(), owner, id, req.Version, func(f *store.ItemFields) error {
		if bad = req.apply(f, time.Now()); bad != "" {
			return errBadItem
		}
		return nil
	})
	switch {
	case errors.Is(err, errBadItem):
		writeErr(w, http.StatusBadRequest, bad)
	case errors.Is(err, store.ErrConflict):
		// The caller gets what is there now, to merge or to choose.
		current, gerr := s.store.GetItem(r.Context(), owner, id)
		if s.itemError(w, r, gerr) {
			return
		}
		writeJSON(w, http.StatusConflict, map[string]any{"error": "changed elsewhere since you opened it", "item": current})
	case !s.itemError(w, r, err):
		writeJSON(w, http.StatusOK, it)
	}
}

var errBadItem = errors.New("bad item change")

// deleteItem moves an item to the trash, or with ?permanent=1 deletes one
// that is already there.
func (s *Server) deleteItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	owner := who(r).UserID
	var err error
	if r.URL.Query().Get("permanent") == "1" {
		err = s.store.DeleteItem(r.Context(), owner, id)
	} else {
		_, err = s.store.UpdateItem(r.Context(), owner, id, 0, func(f *store.ItemFields) error {
			f.Trashed = true
			return nil
		})
	}
	if s.itemError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) linkItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		To string `json:"to"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !isUUID(req.To) || req.To == id {
		writeErr(w, http.StatusBadRequest, "to is another item's id")
		return
	}
	if s.itemError(w, r, s.store.LinkItems(r.Context(), who(r).UserID, id, req.To)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) unlinkItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	other := chi.URLParam(r, "other")
	if !isUUID(other) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if s.itemError(w, r, s.store.UnlinkItems(r.Context(), who(r).UserID, id, other)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
