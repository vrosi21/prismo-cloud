# Prismo Cloud

Self-hosted media cloud. Capture on your PC, it lands on your server, sorted into
folders, with links that preview inline in chats. Drawn like BMO's screen, set in
Prismo's Time Room.

## Layout

```
apps/api      Go. One binary: `prismo serve` (HTTP API) and `prismo work` (ffmpeg jobs).
              cmd/prismo-helper is the desktop helper for Windows, cmd/prismo-watch
              the plain folder watcher.
apps/web      React + Vite single-page app.
infra         Caddy and Garage configuration for running locally.
compose.yaml  The whole stack on your own machine: Caddy, API, worker, Postgres, Garage.
deploy        How it runs for real: server stack, deploy and Cloudflare scripts.
scripts       smoke.mjs, an end-to-end test of a running stack; building and
              installing the desktop helper.
```

How a file travels:

1. Client asks the API for an upload slot and gets a short-lived URL.
2. Client sends the bytes straight to object storage (never through the API).
3. Worker verifies the bytes, stores them under their SHA-256, makes a
   thumbnail, and a GIF for short recordings or an MP4 for GIFs. An animated
   WebP, which is what most sites save a "GIF" as, counts as a GIF and gets a
   real one made from it: ffmpeg cannot read that format, so the worker plays
   it itself ([webpanim.go](apps/api/internal/worker/webpanim.go)).
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

## Folders

Files live in folders, and folders can sit inside folders. The sidebar shows the tree;
the main view shows one folder at a time: its subfolders, then the files directly in it.
"By type" in the sidebar is the other way to look: every picture, GIF, recording or sticker
across all folders.

- Drag files onto a folder (in the tree, on a tile, or on a step of the path) to move them.
- Ctrl+click picks single files, Shift+click a range, Ctrl+A everything in view,
  Delete moves the selection to the trash, Escape lets go of it.
- Deleting a folder takes its subfolders with it. Its files are either moved to the trash
  or kept and moved up one level; the app asks which.
- A picture put into a folder called "stickers" becomes a sticker.
- Whether a file is a picture, a GIF or a sticker is worked out from the file itself,
  not from its name or folder. Where that is wrong, "listed as" in the file's view changes it.
- A capture program can name a folder by path (`screenshots/2026`); missing folders are made.
- Search looks in titles, file names and tags.

## Stickers

Open a picture and press **make sticker**. The original is never changed; the result is
saved as a new, private file in "stickers".

- **crop**: drag a box, press "crop to box".
- **erase colour**: click a colour and it is erased as far as it reaches from there;
  "erase background" does that from the edges inward, for a picture on a plain background.
  The blended pixels along the edge are taken apart too, so no pale rim is left.
- **rub out**: by hand, for what is left.
- **smart cut-out**: finds the subject by itself, for photos. A small neural network
  (U2-Net p, 4.4 MB, [notice](apps/web/public/models/NOTICE.txt)) does it in the browser:
  the picture is sent nowhere, and both the network and its runtime are served by the
  site itself, fetched only when somebody asks for a cut-out.

Give the sticker a name: that is what you type to find it again, here and in the picker.

## Sharing

Two different things, on purpose:

| | By link | With a person |
|---|---|---|
| Who gets in | anyone holding the link | one Google account |
| Set where | item -> "anyone with link": unlisted or public | folder -> "share", or file -> "share with a person" |
| Can do | look and download, nothing else, ever | **view**: look and download. **edit**: also add files to a shared folder, rename, tag, move to trash |
| Take it back | set the item to private | revoke in the same dialog; works at once |

A link can be forwarded, so a link never allows changing anything. Whoever is to edit
has to sign in.

Sharing a folder shares everything in it, subfolders included. Sharing with a person makes
them a **guest**: they can sign in with that Google account
although they are not in `ALLOWED_EMAILS`, see only what was shared with them, and have
no library of their own. Files a guest adds to a shared folder belong to the folder's owner and
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

On the server, `~/prismo-cloud/bin/prismo` does the rest: `status`, `logs`, `backup`, `front`.

**The site shows error 525, or uploads fail, while `status` says every container runs.**
The front door is shut. The Caddy on ports 80 and 443 belongs to another project on the
server; Prismo is two blocks in that Caddy's file. When that project is deployed with a
file that does not have them, Prismo keeps running and nobody can reach it.
`prismo status` says so ("Front door: CLOSED"), and this puts the blocks back without
touching anything else in the file:

```bash
ssh <server> prismo-cloud/bin/prismo front
```

Every `deploy.sh` run does the same check. To stop it from happening at all, the other
project's own Caddyfile has to carry the two blocks.
`backup` dumps the database to `~/prismo-cloud/backups/` and keeps the newest fourteen.
Uploaded files are in the Docker volume `prismo_garage-data` and are **not** in that dump.

Limit worth knowing: uploads through the public address (ShareX, the folder watcher)
pass through Cloudflare, which caps a request at 100 MB on the free plan. Uploads from
the web app go straight to the storage name and are only capped by `MAX_UPLOAD_MB`.

## Capture

Settings -> programs that upload for you -> create a token. A token may:

| | add files | look | change, delete |
|---|---|---|---|
| **add files** | yes | | |
| **add files and look** | yes | yes | |
| **do everything** | yes | yes | yes |

A leaked "add files" token cannot read anything. "New files" on a token decides what
happens to what it sends: private (the default), or openable by whoever has the link.

### Desktop helper (Windows)

One small program in the background, [cmd/prismo-helper](apps/api/cmd/prismo-helper).
Its token has to be one that may add files and look.

```
powershell -ExecutionPolicy Bypass -File scripts\build-helper.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-helper.ps1 -Url https://<your site> -Token prismo_...
```

The web app hands you the second line ready to paste, right after creating the token.
Building needs Docker, nothing else. What the helper does:

- **Uploads every capture.** It watches the folder Windows saves screenshots to and the
  one ShareX saves to, subfolders included. Nothing is lost while the PC is offline: it
  carries on from where it stopped.
- **Leaves the link behind the capture.** After the upload, Ctrl+V still pastes the
  picture, and the clipboard history (Win+V) has its link one step back. If you copied
  something else in the meantime, the clipboard is left alone. `-NoLink` switches this off.
- **Picker.** Press Win+Shift+G anywhere: type a few letters, Enter, and the sticker or
  GIF is pasted into the window you were in. Tab goes through stickers, GIFs, pictures,
  everything; Esc closes. A picture is pasted as a picture (with its see-through parts),
  a GIF as a file, because that is the only way it keeps moving. `-Hotkey ctrl+f9`
  picks another key, `-Hotkey off` none.

With the helper uploading, ShareX should only capture: in its "After capture tasks"
leave "Copy image to clipboard" and "Save image to file" on, and switch "Upload image to
host" off. Otherwise both upload (the cloud keeps one copy, but ShareX then puts its
link on the clipboard instead of the picture).

`scripts\install-helper.ps1 -Remove` takes it off the PC again.

### ShareX alone

Download the config offered right after creating a token and double-click it. Every
capture uploads; what lands on the clipboard afterwards is ShareX's choice ("After
upload tasks": "Copy URL to clipboard" on or off). Make one config per folder and bind
each to its own hotkey. A token that may only add files is enough.

### Folder watcher

Uploads whatever appears in a folder and does nothing else. It has no window and runs
on any system; on Windows the helper does the same and more.

```bash
cd apps/api && go build -o prismo-watch ./cmd/prismo-watch
./prismo-watch -url https://cloud.example.com -token prismo_... -dir ~/Pictures/Screenshots
```

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
