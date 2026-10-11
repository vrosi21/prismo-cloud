#!/usr/bin/env bash
# Run on your own computer to put the backend of the current commit on the server.
#
#   bash deploy/deploy.sh <user@host>
#
# The image is built here and sent over ssh, so the server never compiles anything
# (it is small, and it has neighbours). What happens, in order:
#
#   1. builds the API/worker image from apps/api
#   2. server: installs deploy/compose.yaml, the garage config and the `prismo` helper,
#      and creates .env with fresh secrets on the first run
#   3. sends the image
#   4. starts or updates the containers and waits until the API answers
#
# Needs: Docker and ssh access to the server. The web app is not part of this: it lives
# on Cloudflare Pages (deploy/setup-cloudflare.sh). On Windows run it from Git Bash.

set -euo pipefail

target="${1:?usage: deploy.sh <user@host>}"
cd "$(dirname "$0")/.."

tag="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
image="prismo-api:$tag"

echo "==> 1/4 building $image"
docker build --quiet --tag "$image" apps/api >/dev/null

echo "==> 2/4 server: configuration"
tar -c -C deploy compose.yaml server.sh -C ../infra garage.toml | ssh "$target" '
	set -e
	mkdir -p ~/prismo-cloud/bin ~/prismo-cloud/backups
	tar -x -C ~/prismo-cloud
	mv ~/prismo-cloud/server.sh ~/prismo-cloud/bin/prismo
	chmod +x ~/prismo-cloud/bin/prismo
	~/prismo-cloud/bin/prismo init'

echo "==> 3/4 sending the image"
docker save "$image" | gzip | ssh "$target" "prismo-cloud/bin/prismo load $image"

echo "==> 4/4 starting"
if ssh "$target" 'prismo-cloud/bin/prismo configured'; then
	ssh "$target" 'prismo-cloud/bin/prismo up'
	echo "Deployed $image."
else
	echo "    $image is on the server but not started: it does not know its public"
	echo "    address yet. Run deploy/setup-cloudflare.sh next; that sets it and starts it."
fi
