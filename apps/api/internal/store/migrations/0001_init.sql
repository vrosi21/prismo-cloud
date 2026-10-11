create table users (
    id            uuid primary key default uuidv7(),
    email         text not null,
    password_hash text not null,
    created_at    timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
    token_hash bytea primary key,
    user_id    uuid not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create table collections (
    id         uuid primary key default uuidv7(),
    owner_id   uuid not null references users (id) on delete cascade,
    name       text not null,
    created_at timestamptz not null default now()
);
create unique index collections_owner_name_key on collections (owner_id, lower(name));

create table api_tokens (
    id                 uuid primary key default uuidv7(),
    owner_id           uuid not null references users (id) on delete cascade,
    name               text not null,
    token_hash         bytea not null unique,
    scope              text not null check (scope in ('upload', 'full')),
    default_visibility text not null default 'unlisted'
                       check (default_visibility in ('private', 'unlisted', 'public')),
    created_at         timestamptz not null default now(),
    last_used_at       timestamptz
);

-- One row per stored object. Key in the bucket is derived from the hash, so
-- identical files are stored once no matter how many assets point at them.
create table blobs (
    sha256     text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
    bytes      bigint not null,
    mime       text not null,
    created_at timestamptz not null default now()
);

create table assets (
    id            uuid primary key default uuidv7(),
    owner_id      uuid not null references users (id) on delete cascade,
    collection_id uuid references collections (id) on delete set null,
    blob_sha      text references blobs (sha256),
    expected_sha  text,
    kind          text not null default 'file'
                  check (kind in ('image', 'gif', 'video', 'sticker', 'file')),
    status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'ready', 'failed')),
    error         text,
    title         text not null default '',
    filename      text not null default '',
    mime          text not null default 'application/octet-stream',
    bytes         bigint not null default 0,
    width         integer,
    height        integer,
    duration_ms   integer,
    visibility    text not null default 'private'
                  check (visibility in ('private', 'unlisted', 'public')),
    slug          text not null unique,
    source        text not null default 'web',
    tags          text[] not null default '{}',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    deleted_at    timestamptz
);
-- uuidv7 ids sort by creation time, so "newest first" pages walk this index.
create index assets_owner_live_idx on assets (owner_id, id desc) where deleted_at is null;
create index assets_owner_trash_idx on assets (owner_id, id desc) where deleted_at is not null;
create index assets_owner_collection_idx on assets (owner_id, collection_id, id desc) where deleted_at is null;
create index assets_owner_blob_idx on assets (owner_id, blob_sha);
create index assets_blob_idx on assets (blob_sha);
create index assets_tags_idx on assets using gin (tags);

create table variants (
    asset_id uuid not null references assets (id) on delete cascade,
    role     text not null check (role in ('thumb', 'mp4', 'gif')),
    blob_sha text not null references blobs (sha256),
    mime     text not null,
    bytes    bigint not null,
    primary key (asset_id, role)
);
create index variants_blob_idx on variants (blob_sha);

create table jobs (
    id           bigint generated always as identity primary key,
    kind         text not null,
    payload      jsonb not null default '{}',
    status       text not null default 'queued'
                 check (status in ('queued', 'running', 'done', 'failed')),
    attempts     integer not null default 0,
    max_attempts integer not null default 4,
    run_at       timestamptz not null default now(),
    locked_at    timestamptz,
    last_error   text,
    created_at   timestamptz not null default now()
);
create index jobs_queued_idx on jobs (run_at) where status = 'queued';
