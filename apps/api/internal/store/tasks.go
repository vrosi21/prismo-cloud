package store

import (
	"context"
	"time"
)

// Task is one thing to do. Date is "2006-01-02" and Time "15:04", both in
// the owner's own local time: a task at 9:00 is at 9:00 wherever they are.
type Task struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Date      *string    `json:"date"`
	Time      *string    `json:"time"`
	Done      bool       `json:"done"`
	DoneAt    *time.Time `json:"done_at"`
	CreatedAt time.Time  `json:"created_at"`
}

const taskColumns = `id::text, title, to_char(due_date, 'YYYY-MM-DD'), to_char(due_time, 'HH24:MI'), done_at, created_at`

func scanTask(row interface{ Scan(...any) error }) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.Title, &t.Date, &t.Time, &t.DoneAt, &t.CreatedAt)
	t.Done = t.DoneAt != nil
	return t, err
}

// ListTasks returns the tasks dated from..to (both included), and every task
// without a date that is not done or was done in the last two weeks: ticked
// ones stay in sight for a while, then stop piling up.
func (s *Store) ListTasks(ctx context.Context, ownerID, from, to string) ([]Task, error) {
	rows, err := s.Pool.Query(ctx,
		`select `+taskColumns+` from tasks
		 where owner_id = $1
		   and (due_date between $2::date and $3::date
		        or (due_date is null and (done_at is null or done_at > now() - interval '14 days')))
		 order by due_date nulls last, due_time nulls first, created_at`, ownerID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) CreateTask(ctx context.Context, ownerID, title string, date, at *string) (Task, error) {
	return scanTask(s.Pool.QueryRow(ctx,
		`insert into tasks (owner_id, title, due_date, due_time) values ($1, $2, $3::date, $4::time)
		 returning `+taskColumns, ownerID, title, date, at))
}

// TaskChange says what to change; a nil field is left as it is. ClearDate
// and ClearTime take the date or time away.
type TaskChange struct {
	Title     *string
	Date      *string
	ClearDate bool
	Time      *string
	ClearTime bool
	Done      *bool
}

func (s *Store) UpdateTask(ctx context.Context, ownerID, id string, c TaskChange) (Task, error) {
	t, err := scanTask(s.Pool.QueryRow(ctx,
		`update tasks set
		   title    = coalesce($3, title),
		   due_date = case when $5 then null else coalesce($4::date, due_date) end,
		   due_time = case when $5 or $7 then null else coalesce($6::time, due_time) end,
		   done_at  = case when $8::boolean is null then done_at
		                   when $8 then coalesce(done_at, now())
		                   else null end
		 where id = $1 and owner_id = $2
		 returning `+taskColumns,
		id, ownerID, c.Title, c.Date, c.ClearDate, c.Time, c.ClearTime, c.Done))
	return t, notFound(err)
}

func (s *Store) DeleteTask(ctx context.Context, ownerID, id string) error {
	tag, err := s.Pool.Exec(ctx, `delete from tasks where id = $1 and owner_id = $2`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
