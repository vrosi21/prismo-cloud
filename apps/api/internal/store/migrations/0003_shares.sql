-- Sharing with a specific person: one row gives one Google account access to
-- one jar or one item. "Anyone with the link" is not in here; that is the
-- asset's own visibility, and it is always read-only.
create table shares (
    id            uuid primary key default uuidv7(),
    owner_id      uuid not null references users (id) on delete cascade,
    collection_id uuid references collections (id) on delete cascade,
    asset_id      uuid references assets (id) on delete cascade,
    -- The invited account. The person need not have signed in yet, so this
    -- cannot be a user id. email is the address as the owner typed it, for
    -- showing; email_key is its normalised form (auth.EmailKey), for matching.
    email         text not null,
    email_key     text not null,
    role          text not null check (role in ('view', 'edit')),
    -- Random token for the invitation link. It only names the share, so the
    -- sign-in page can say which account was invited; it grants nothing.
    invite        text not null unique,
    created_at    timestamptz not null default now(),
    check ((collection_id is null) <> (asset_id is null))
);
create unique index shares_collection_email_key on shares (collection_id, email_key) where collection_id is not null;
create unique index shares_asset_email_key on shares (asset_id, email_key) where asset_id is not null;
create index shares_email_key_idx on shares (email_key);
