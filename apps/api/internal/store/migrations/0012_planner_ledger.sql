-- A "planner" token: for Claude sessions and the /prismo skill. It reaches the
-- items (tasks, events, notebooks, boards), the folders they go in, and the
-- ledger; no files, no tokens, no shares.
alter table api_tokens drop constraint api_tokens_scope_check;
alter table api_tokens add constraint api_tokens_scope_check
    check (scope in ('upload', 'device', 'full', 'planner'));

-- The ledger: what was changed through a token, and by whom. The server adds
-- a "change" line for every write a token makes; a session adds a "note"
-- (one line on what it did and why). Item ids are kept without a foreign key:
-- the line stays when the item is deleted for good.
create table ledger (
    id        uuid primary key default uuidv7(),
    owner_id  uuid not null references users (id) on delete cascade,
    at        timestamptz not null default now(),
    who       text not null check (char_length(who) between 1 and 60),
    kind      text not null check (kind in ('change', 'note')),
    message   text not null check (char_length(message) between 1 and 500),
    item_ids  uuid[] not null default '{}',
    token_id  uuid references api_tokens (id) on delete set null
);
create index ledger_owner_idx on ledger (owner_id, id desc);
