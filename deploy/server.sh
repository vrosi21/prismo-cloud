#!/usr/bin/env bash
# Runs ON THE SERVER. deploy/deploy.sh installs it as ~/prismo-cloud/bin/prismo.
#
#   prismo init            create .env with fresh secrets (does nothing if it exists)
#   prismo setenv KEY      store a setting; the value is read from standard input
#   prismo load IMAGE      read a `docker save` stream from standard input, make it live
#   prismo configured      exit 0 once the public address has been set
#   prismo up              start or update the containers, wait until the API answers
#   prismo status          containers and health
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
			exit 0
		fi
		sleep 3
	done
	echo "the API did not come up; last log lines:" >&2
	compose logs --tail 30 api >&2
	exit 1
	;;

status)
	compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
	healthy && echo "API: answers" || echo "API: does not answer"
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
	sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
	exit 1
	;;
esac
