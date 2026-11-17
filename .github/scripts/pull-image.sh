#!/usr/bin/env bash
# Fetch the Docker images a CI job needs, patiently.
#
#   bash .github/scripts/pull-image.sh golang:1.27-alpine dxflrs/garage:v2.4.1
#
# GitHub's runners share a small set of addresses with every other project, and Docker
# Hub limits anonymous downloads per address. So a pull now and then fails with
# "toomanyrequests" through no fault of this repository, and a red run on main means no
# deploy. Each image is tried at its mirrors and at Docker Hub, several rounds with a
# growing pause, and then named as the Dockerfiles and compose.yaml name it, so later
# steps find it on the machine. (After DSAI Vault's script of the same name.)

set -euo pipefail

ROUNDS=4

fetch() {
	local image="$1" round source sources
	if [[ "$image" == */* ]]; then
		sources=("mirror.gcr.io/$image" "docker.io/$image")
	else
		# An official image: Amazon's and Google's copies, then Docker Hub.
		sources=("public.ecr.aws/docker/library/$image" "mirror.gcr.io/library/$image" "docker.io/library/$image")
	fi
	for round in $(seq 1 "$ROUNDS"); do
		for source in "${sources[@]}"; do
			if docker pull --quiet "$source" >/dev/null 2>&1; then
				[[ "$source" == "$image" ]] || docker tag "$source" "$image"
				echo "$image: from ${source%%/*}"
				return 0
			fi
		done
		if ((round < ROUNDS)); then
			echo "$image: every registry refused, waiting $((round * 10)) s (round $round of $ROUNDS)"
			sleep "$((round * 10))"
		fi
	done
	echo "$image: could not be fetched from any registry" >&2
	return 1
}

(($# > 0)) || {
	echo "usage: $0 <image:tag> [<image:tag> ...]" >&2
	exit 2
}
for image in "$@"; do
	fetch "$image"
done
