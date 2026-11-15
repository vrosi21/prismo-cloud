-- Tasks: the time wall's to-do list and calendar. A task with a date shows
-- on that day; one without sits in "someday". A time needs a date.
create table tasks (
    id         uuid primary key default uuidv7(),
    owner_id   uuid not null references users (id) on delete cascade,
    title      text not null check (char_length(title) between 1 and 200),
    due_date   date,
    due_time   time,
    done_at    timestamptz,
    created_at timestamptz not null default now(),
    check (due_time is null or due_date is not null)
);
create index tasks_owner_date_idx on tasks (owner_id, due_date);
