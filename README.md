# Prismo Cloud

Self-hosted media cloud. Capture on your PC, it lands on your server, sorted into
jars, with links that preview inline in chats. Drawn like BMO's screen, set in
Prismo's Time Room.

## Layout

```
apps/api      Go. One binary: `prismo serve` (HTTP API) and `prismo work` (ffmpeg jobs).
              cmd/prismo-watch is the Windows folder watcher.
apps/web      React + Vite single-page app.
infra         Caddy and Garage configuration for running locally.
compose.yaml  The whole stack on your own machine: Caddy, API, worker, Postgres, Garage.
deploy        How it runs for real: server stack, deploy and Cloudflare scripts.
scripts       smoke.mjs, an end-to-end test of a running stack.
```

How a file travels:

1. Client asks the API for an upload slot and gets a short-lived URL.
2. Client sends the bytes straight to object storage (never through the API).
3. Worker verifies the bytes, stores them under their SHA-256, makes a
   thumbnail, and a GIF for short recordings or an MP4 for GIFs.
4. Asset turns `ready`. `/i/<slug>` serves it, `/s/<slug>` is the preview page.

ShareX cannot do step 1 and 2 separately, so `POST /v1/upload` takes a plain
multipart upload as well.

## Run it locally

Needs Docker.

```bash
cp .env.example .env    # then set the secrets inside
docker compose up --build
```

Open http://localhost:8080 and press **development sign-in**. That button exists only
while `DEV_LOGIN=1` and the address is localhost; the server refuses to start with it
anywhere else.

Check a running stack end to end (needs an empty database):

```bash
docker compose down -v && docker compose up -d --build
node scripts/smoke.mjs
```

## Sign-in

There are no passwords. People sign in with Google. Members, the accounts listed in
`ALLOWED_EMAILS`, have a library. Anyone else gets in only as a guest, while something is
shared with their account (see Sharing).

The server sends the browser to Google; Google posts back a signed statement of who
signed in; the server checks the signature against Google's public keys
([googleid.go](apps/api/internal/googleid/googleid.go)). Because nothing but public keys
is needed for that check, the server holds **no client secret**: only the client id.

In Google Cloud Console, the OAuth client (type "Web application") must list this under
"Authorised redirect URIs", exactly:

```
https://<your public address>/v1/auth/google/callback
```

## Sharing

Two different things, on purpose:

| | By link | With a person |
|---|---|---|
| Who gets in | anyone holding the link | one Google account |
| Set where | item -> "anyone with link": unlisted or public | jar -> "share jar", or item -> "share with a person" |
| Can do | look and download, nothing else, ever | **view**: look and download. **edit**: also add files to a shared jar, rename, tag, move to trash |
| Take it back | set the item to private | revoke in the same dialog; works at once |

A link can be forwarded, so a link never allows changing anything. Whoever is to edit
has to sign in.

Sharing with a person makes them a **guest**: they can sign in with that Google account
although they are not in `ALLOWED_EMAILS`, see only what was shared with them, and have
no library of their own. Files a guest adds to a shared jar belong to the jar's owner and
start private. Only the owner can delete for good, change who has the link, or share
further. The dialog gives an invitation link to send; opening it shows which account was
invited, and no other account gets in.

While the Google project behind `GOOGLE_CLIENT_ID` is in "Testing" mode, Google itself
only lets listed test users through: a guest then also has to be added in Google Cloud
Console (Google Auth Platform -> Audience -> Test users), or the app published.

## The live site

Addresses of the server are deliberately not written in this repository. `<server>`
stands for the SSH address (`user@host`).

```
 visitor ─► https://<project>.pages.dev         Cloudflare Pages
              │  web app files are served right there
              │  /v1/ /i/ /s/ are passed on, with a secret header     apps/web/public/_worker.js
              ▼
            the server's main Caddy (HTTPS)
              ▼
            api  ──► postgres, garage          deploy/compose.yaml
            worker (ffmpeg jobs)

 browser uploads ─► https://<storage name> ─► main Caddy ─► garage   (signed URLs, no API in between)
```

- The server already had a Caddy on ports 80 and 443, so the stack joins that Caddy's
  Docker network instead of competing for the ports.
- The API ignores every request that does not carry the shared secret, so it cannot be
  reached around Cloudflare.
- Everything runs in Docker as an ordinary user. Nothing needs root.

First time, and after changing anything under `deploy/` or `apps/api/`:

```bash
bash deploy/deploy.sh <server>
```

First time, and after changing the web app:

```bash
bash deploy/setup-cloudflare.sh <server> <pages-project> <origin-url> <storage-url>
```

Then the two sign-in settings, once:

```bash
echo "<client id>.apps.googleusercontent.com" | ssh <server> prismo-cloud/bin/prismo setenv GOOGLE_CLIENT_ID
echo "you@gmail.com"                          | ssh <server> prismo-cloud/bin/prismo setenv ALLOWED_EMAILS
ssh <server> prismo-cloud/bin/prismo up
```

On the server, `~/prismo-cloud/bin/prismo` does the rest: `status`, `logs`, `backup`.
`backup` dumps the database to `~/prismo-cloud/backups/` and keeps the newest fourteen.
Uploaded files are in the Docker volume `prismo_garage-data` and are **not** in that dump.

Limit worth knowing: uploads through the public address (ShareX, the folder watcher)
pass through Cloudflare, which caps a request at 100 MB on the free plan. Uploads from
the web app go straight to the storage name and are only capped by `MAX_UPLOAD_MB`.

## Capture

Settings -> capture clients -> create a token. Then either:

- **ShareX**: download the config offered right after creating the token and
  double-click it. Every capture uploads and its link goes to the clipboard.
  Make one config per jar and bind each to its own hotkey.
- **Folder watcher**: uploads whatever appears in a folder, by default
  `Pictures\Screenshots` (Win+PrtScn, Snipping Tool).

  ```bash
  cd apps/api && GOOS=windows go build -o prismo-watch.exe ./cmd/prismo-watch
  ```

  ```
  prismo-watch.exe -url https://cloud.example.com -token prismo_...
  ```

Tokens made for capture are upload-only: a leaked one cannot read or delete.

## Work on the UI without the backend

```bash
cd apps/web
pnpm install
node mock/server.mjs     # fake API with sample data, port 8099
node mock/dev.mjs        # Vite dev server wired to it, port 5173
```

Press **development sign-in** on the mock.

## Growing past one server

| Limit hit        | Move                                                              |
| ---------------- | ----------------------------------------------------------------- |
| Disk full        | Point `S3_ENDPOINT` at an external bucket, or add Garage nodes    |
| Processing slow  | Run more `prismo work` containers, on any machine                 |
| Media traffic    | Put a CDN in front of `/i/`                                       |
| API load         | Run more `prismo serve` containers behind the proxy               |
| Database load    | Move Postgres to its own machine, add read replicas               |

None of these need code changes: the API keeps no state of its own, files are
addressed by hash, and workers pull jobs from a shared queue.
