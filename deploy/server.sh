#!/usr/bin/env bash
# Runs ON THE SERVER. deploy/deploy.sh installs it as ~/prismo-cloud/bin/prismo.
#
#   prismo init            create .env with fresh secrets (does nothing if it exists)
#   prismo setenv KEY      store a setting; the value is read from standard input
#   prismo load IMAGE      read a `docker save` stream from standard input, make it live
#   prismo configured      exit 0 once the public address has been set
#   prismo up              start or update the containers, wait until the API answers
#   prismo front           make the server's front Caddy answer for Prismo's two names
#   prismo status          containers, health, and whether the front Caddy still knows us
#   prismo logs [service]  recent log lines
#   prismo backup          dump the database to backups/, keep the newest 14
#
# Everything runs in Docker as an ordinary user; nothing needs root.

set -euo pipefail

home="${PRISMO_HOME:-$HOME/prismo-cloud}"
cd "$home"

compose() { docker compose --project-directory "$home" --env-file "$home/.env" -f "$home/compose.yaml" "$@"; }
rand_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
setting() { sed -n "s/^$1=//p" .env | head -n 1; }
missing_settings() {
	for key in PUBLIC_URL S3_PUBLIC_ENDPOINT FRONT_NETWORK ORIGIN_SECRET; do
		[[ -n "$(setting "$key")" ]] || printf ' %s' "$key"
	done
}

healthy() {
	# Asked from inside the API container, with the secret, the way Cloudflare asks.
	compose exec -T api wget -q -O /dev/null --header "X-Origin-Auth: $(setting ORIGIN_SECRET)" \
		http://localhost:8080/healthz 2>/dev/null
}

# --- the front door ------------------------------------------------------------
# Ports 80 and 443 belong to a Caddy that some other project on this server
# runs. Prismo is reachable only while that Caddy's file holds two blocks: one
# for the API's name, one for the storage's. The file is not ours, and whoever
# deploys that other project may write it anew without them. So the blocks can
# be checked for, and put back, from here.

front_container() {
	# Whoever publishes port 443, unless FRONT_CONTAINER names it outright.
	local named
	named="$(setting FRONT_CONTAINER)"
	if [[ -n "$named" ]]; then
		printf '%s\n' "$named"
	else
		docker ps --filter publish=443 --format '{{.Names}}' | head -n 1
	fi
}
front_file() {
	docker inspect "$1" --format \
		'{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}'
}
# The bare name in a setting that holds an address: https://name/path -> name
name_in() {
	local url
	url="$(setting "$1")"
	url="${url#https://}"
	printf '%s' "${url%%/*}"
}
# Prints the names the front Caddy has no block for. Nothing printed: all is well.
front_missing() {
	local file="$1" name
	for name in "$(name_in ORIGIN_URL)" "$(name_in S3_PUBLIC_ENDPOINT)"; do
		# A block starts with its name at the beginning of a line.
		awk -v name="$name" '$1 == name { found = 1 } END { exit !found }' "$file" || printf ' %s' "$name"
	done
}

case "${1:-}" in
init)
	if [[ -f .env ]]; then
		echo "    .env already exists; left as it is"
		exit 0
	fi
	# The network of whichever container owns port 443: the API joins it so that
	# container can reach it by name.
	owner="$(docker ps --filter publish=443 --format '{{.Names}}' | head -n 1)"
	[[ -n "$owner" ]] || { echo "no container on this server publishes port 443" >&2; exit 1; }
	front="$(docker inspect "$owner" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' | head -n 1)"
	umask 077
	cat >.env <<EOF
# Secrets, generated on this server. Never copy them into the repository.
POSTGRES_PASSWORD=$(rand_hex 24)
S3_ACCESS_KEY=GK$(rand_hex 12)
S3_SECRET_KEY=$(rand_hex 32)
GARAGE_RPC_SECRET=$(rand_hex 32)
GARAGE_ADMIN_TOKEN=$(rand_hex 24)
ORIGIN_SECRET=$(rand_hex 32)

# Settings. Change them with: prismo setenv KEY
FRONT_NETWORK=$front
PUBLIC_URL=
S3_PUBLIC_ENDPOINT=
GOOGLE_CLIENT_ID=
ALLOWED_EMAILS=
WORKER_CONCURRENCY=1
EOF
	echo "    created .env (front network: $front)"
	;;

setenv)
	key="${2:?usage: prismo setenv KEY  (value on standard input)}"
	[[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "not a setting name: $key" >&2; exit 1; }
	IFS= read -r value || true
	value="${value%$'\r'}"
	umask 077
	{ grep -v "^$key=" .env || true; printf '%s=%s\n' "$key" "$value"; } >.env.new
	mv .env.new .env
	echo "    $key stored"
	;;

load)
	image="${2:?usage: prismo load IMAGE  (docker save stream on standard input)}"
	gunzip -c | docker load >/dev/null
	docker tag "$image" prismo-api:live
	echo "    $image is now prismo-api:live"
	;;

configured)
	# Quiet yes/no: has the public address been set yet?
	[[ -z "$(missing_settings)" ]]
	;;

up)
	missing="$(missing_settings)"
	if [[ -n "$missing" ]]; then
		echo "not started:$missing not set yet (prismo setenv KEY)" >&2
		exit 1
	fi
	compose up -d --remove-orphans 2>&1 | grep -v -E 'Running|Waiting|Healthy' || true
	for _ in $(seq 1 40); do
		if healthy; then
			echo "    the API answers"
			# Running is not the same as reachable: see "the front door" above.
			[[ -z "$(setting ORIGIN_URL)" ]] || "$0" front
			exit 0
		fi
		sleep 3
	done
	echo "the API did not come up; last log lines:" >&2
	compose logs --tail 30 api >&2
	exit 1
	;;

front)
	[[ -n "$(setting ORIGIN_URL)" && -n "$(setting S3_PUBLIC_ENDPOINT)" ]] ||
		{ echo "not set yet: ORIGIN_URL and S3_PUBLIC_ENDPOINT (prismo setenv KEY)" >&2; exit 1; }
	container="$(front_container)"
	[[ -n "$container" ]] || { echo "no container on this server publishes port 443" >&2; exit 1; }
	file="$(front_file "$container")"
	[[ -f "$file" ]] || { echo "could not find the Caddyfile of container '$container'" >&2; exit 1; }

	missing="$(front_missing "$file")"
	if [[ -z "$missing" ]]; then
		echo "    front Caddy '$container' answers for both names"
		exit 0
	fi
	backup="$file.bak-$(date +%Y%m%d%H%M%S)"
	cp "$file" "$backup"
	# Appended, never rewritten: the container sees this one file through a
	# mount that is tied to the file itself, and a new file in its place would
	# stay invisible to it. Whatever else is in there is not touched.
	for name in $missing; do
		if [[ "$name" == "$(name_in ORIGIN_URL)" ]]; then
			about="API. Requests arrive from the Cloudflare Pages proxy; the API ignores
# anything that does not carry the shared secret."
			to=prismo-api:8080
		else
			about="object storage. Browsers upload here directly, with short-lived URLs
# that the API signs."
			to=prismo-s3:3900
		fi
		printf '\n# Prismo Cloud %s\n%s {\n\treverse_proxy %s\n}\n' "$about" "$name" "$to" >>"$file"
	done
	if ! docker exec "$container" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
		cat "$backup" >"$file"
		echo "the added blocks did not validate; $file was put back as it was" >&2
		exit 1
	fi
	# A reload swaps the configuration without dropping a connection, so the
	# other sites on this Caddy do not notice.
	docker exec "$container" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
	echo "    front Caddy '$container' had lost:$missing"
	echo "    put back in $file (as it was before: $backup) and reloaded"
	;;

status)
	compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
	healthy && echo "API: answers" || echo "API: does not answer"
	if [[ -n "$(setting ORIGIN_URL)" ]]; then
		container="$(front_container)"
		file="$([[ -n "$container" ]] && front_file "$container" || true)"
		if [[ ! -f "$file" ]]; then
			echo "Front door: cannot find the Caddy that owns port 443"
		elif missing="$(front_missing "$file")" && [[ -n "$missing" ]]; then
			echo "Front door: CLOSED. '$container' no longer answers for:$missing"
			echo "            the site shows errors (525) until this is run:  prismo front"
		else
			echo "Front door: '$container' answers for both names"
		fi
	fi
	;;

logs)
	compose logs --tail 100 ${2:+"$2"}
	;;

backup)
	mkdir -p backups
	file="backups/prismo-$(date +%Y%m%d-%H%M%S).sql.gz"
	compose exec -T postgres pg_dump -U prismo prismo | gzip >"$file"
	# The database only. Uploaded files live in the garage-data volume and are not in here.
	ls -1t backups/prismo-*.sql.gz | tail -n +15 | xargs -r rm -f
	echo "    $file ($(du -h "$file" | cut -f1))"
	;;

*)
	sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
	exit 1
	;;
esac
