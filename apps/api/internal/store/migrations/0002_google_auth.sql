-- Sign-in is by Google account only. Nothing here stores a password any more.
alter table users drop column password_hash;

-- Google's stable id for the account ("sub"). An email address can change
-- hands; this cannot.
alter table users add column google_sub text;
create unique index users_google_sub_key on users (google_sub) where google_sub is not null;
