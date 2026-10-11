#!/usr/bin/env bash
# Run on your own computer to put the site online at its Cloudflare Pages address, and
# again whenever the web app changes.
#
#   bash deploy/setup-cloudflare.sh <user@host> <pages-project> <origin-url> <storage-url>
#
#   e.g.  bash deploy/setup-cloudflare.sh me@203.0.113.5 prismo-cloud \
#             https://prismo.203-0-113-5.sslip.io https://prismo-s3.203-0-113-5.sslip.io
#
# <origin-url> and <storage-url> are names that point at the server and that nobody needs
# to remember. The first connects Cloudflare to the API; the second is where browsers send
# uploads directly. Run deploy/deploy.sh once before this (it puts the image on the server). What the script does, in order:
#
#   1. On the server: tells the Caddy that owns port 443 to answer for both names. Caddy
#      fetches the certificates by itself.
#   2. Signs wrangler (Cloudflare's command-line tool) in; a browser window asks you.
#   3. Creates the Pages project if it does not exist yet, and notes its public address.
#   4. Stores the origin URL and the shared secret on the Pages project. The secret goes
#      from the server into a temporary file and on to Cloudflare; it is never displayed.
#   5. Tells the server its public address, starts it, and waits until both names answer
#      over HTTPS.
#   6. Builds the web app and uploads it with the proxy (apps/web/public/_worker.js).
#
# Needs: ssh access to the server, Node.js with pnpm, curl. Safe to run again.
# On Windows run it from Git Bash.

set -euo pipefail

usage="usage: setup-cloudflare.sh <user@host> <pages-project> <origin-url> <storage-url>"
target="${1:?$usage}"
project="${2:?$usage}"
origin="${3:?$usage}"
storage="${4:?$usage}"
for u in "$origin" "$storage"; do
	[[ "$u" == https://* ]] || { echo "both URLs must start with https://" >&2; exit 1; }
done
origin="${origin%/}"
storage="${storage%/}"
cd "$(dirname "$0")/.."

wrangler() { npx --yes wrangler@4 "$@"; }

echo "==> 1/6 server: answering for ${origin#https://} and ${storage#https://}"
ssh "$target" 'bash -s' -- "${origin#https://}" "${storage#https://}" <<'REMOTE'
set -euo pipefail
api_name="$1"
s3_name="$2"
container="$(docker ps --filter publish=443 --format '{{.Names}}' | head -n 1)"
[[ -n "$container" ]] || { echo "no container on this server publishes port 443" >&2; exit 1; }
caddyfile="$(docker inspect "$container" --format \
	'{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
[[ -f "$caddyfile" ]] || { echo "could not find the Caddyfile of container '$container'" >&2; exit 1; }

if grep -qF "$api_name" "$caddyfile" && grep -qF "$s3_name" "$caddyfile"; then
	echo "    $caddyfile already mentions both names"
else
	backup="$caddyfile.bak-$(date +%Y%m%d%H%M%S)"
	cp "$caddyfile" "$backup"
	# Appending keeps the file's identity, which a single-file Docker mount depends on.
	cat >>"$caddyfile" <<EOF

# Prismo Cloud API. Requests arrive from the Cloudflare Pages proxy; the API ignores
# anything that does not carry the shared secret.
$api_name {
	reverse_proxy prismo-api:8080
}

# Prismo Cloud object storage. Browsers upload here directly, with short-lived URLs
# that the API signs.
$s3_name {
	reverse_proxy prismo-s3:3900
}
EOF
	if ! docker exec "$container" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
		cat "$backup" >"$caddyfile"
		echo "the new blocks did not validate; $caddyfile was put back as it was" >&2
		exit 1
	fi
	echo "    added two blocks to $caddyfile (previous version: $backup)"
fi
docker exec "$container" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
echo "    reloaded '$container'"
REMOTE

echo "==> 2/6 signing in to Cloudflare"
# `whoami` exits 0 either way, so go by what it says.
if wrangler whoami 2>&1 | grep -qi "not authenticated"; then
	echo "    a browser window opens: press Allow there within about a minute."
	wrangler login
else
	echo "    already signed in"
fi

echo "==> 3/6 Pages project '$project'"
domain_of() {
	wrangler pages project list --json 2>/dev/null |
		node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(p=>p["Project Name"]===process.argv[1]);if(p)console.log(p["Project Domains"].split(",")[0].trim())})' "$project"
}
domain="$(domain_of)"
if [[ -z "$domain" ]]; then
	# --force: newer wrangler versions try to create a Workers project instead and
	# refuse without it. This setup is a Pages project (a pages.dev address with
	# _worker.js in front of the files), so ask for exactly that.
	wrangler pages project create "$project" --production-branch main --force >/dev/null
	domain="$(domain_of)"
	echo "    created"
fi
[[ -n "$domain" ]] || { echo "could not find the project's address" >&2; exit 1; }
public="https://$domain"
echo "    $public"

echo "==> 4/6 storing ORIGIN_URL and ORIGIN_SECRET on the Pages project"
secrets="$(mktemp)"
trap 'rm -f "$secrets"' EXIT
chmod 600 "$secrets"
{
	printf 'ORIGIN_URL=%s\n' "$origin"
	ssh "$target" 'grep "^ORIGIN_SECRET=" ~/prismo-cloud/.env'
} >"$secrets"
grep -q '^ORIGIN_SECRET=.\{32,\}' "$secrets" || { echo "could not read ORIGIN_SECRET from the server" >&2; exit 1; }
wrangler pages secret bulk "$secrets" --project-name "$project" >/dev/null
rm -f "$secrets"
echo "    stored"

echo "==> 5/6 server: public address"
printf '%s\n' "$public" | ssh "$target" 'prismo-cloud/bin/prismo setenv PUBLIC_URL' >/dev/null
printf '%s\n' "$storage" | ssh "$target" 'prismo-cloud/bin/prismo setenv S3_PUBLIC_ENDPOINT' >/dev/null
ssh "$target" 'prismo-cloud/bin/prismo up'

echo "    waiting for the certificates"
for attempt in $(seq 1 30); do
	# Without the secret the API must answer 404; any answer at all means HTTPS works.
	code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$origin/healthz" || true)"
	s3code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$storage/" || true)"
	[[ "$code" == 404 && "$s3code" =~ ^[234] ]] && break
	sleep 4
done
if [[ "$code" != 404 ]]; then
	echo "$origin does not answer over HTTPS yet (got '$code', expected 404)." >&2
	echo "Look at the Caddy log on the server for the certificate error, then run this again." >&2
	exit 1
fi
[[ "$s3code" =~ ^[234] ]] || { echo "$storage does not answer over HTTPS yet (got '$s3code')." >&2; exit 1; }
echo "    both are up; the API refuses requests without the secret"

echo "==> 6/6 building and uploading the web app"
(cd apps/web && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
wrangler pages deploy apps/web/dist --project-name "$project" --branch main --commit-dirty=true >/dev/null

echo
echo "==> $public"
for attempt in $(seq 1 15); do
	answer="$(curl -s -m 15 "$public/v1/auth/config" || true)"
	[[ "$answer" == *'"google"'* ]] && break
	sleep 4
done
if [[ "$answer" == *'"google"'* ]]; then
	echo "The site is online. Sign-in options: $answer"
	echo "Google must list exactly this under 'Authorised redirect URIs' of the OAuth client:"
	echo "    $public/v1/auth/google/callback"
else
	echo "The address does not answer as expected yet (got: ${answer:0:120})." >&2
	exit 1
fi
