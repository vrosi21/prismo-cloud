#!/usr/bin/env bash
# Run once, on your own computer (Git Bash on Windows), to let GitHub Actions deploy.
#
#   bash deploy/setup-ci.sh <user@host> <owner/repo>
#
# Before: deploy/deploy.sh has run once with this version (it installs `prismo ci` on
# the server), and you have a Cloudflare API token that may edit Pages: Cloudflare
# dashboard > My Profile > API Tokens > Create Token > "Edit Cloudflare Workers"
# template, or a custom one with Account > Cloudflare Pages > Edit. The script asks
# for it and for your account id (dashboard > Workers & Pages, right column); neither
# is shown or written to a file.
#
# What it does, in order:
#   1. makes a new SSH key pair that exists only for deploys
#   2. adds the public half to the server, pinned to one command (`prismo ci`), so the
#      key cannot open a shell or do anything but ship an image
#   3. stores the private half, the server's address and host key, and the Cloudflare
#      token and account id as GitHub Actions secrets, and switches deploying on
#   4. deletes the private half from this computer; GitHub holds the only copy
#
# Needs: ssh access to the server and the GitHub CLI, signed in (`gh auth status`).
# After DSAI Vault's script of the same name.
set -euo pipefail

target="${1:?usage: setup-ci.sh <user@host> <owner/repo>}"
repo="${2:?usage: setup-ci.sh <user@host> <owner/repo>}"
host="${target#*@}"
dir="$(mktemp -d)"
key="$dir/prismo_deploy"
trap 'rm -rf "$dir"' EXIT

echo "==> checking the server and its host key"
remote_home="$(ssh "$target" 'printf %s "$HOME"')"
ssh "$target" "grep -q '^ci)' '$remote_home/prismo-cloud/bin/prismo'" ||
	{ echo "the server's prismo helper has no 'ci' yet: run deploy/deploy.sh $target first" >&2; exit 1; }
# The host key this computer already trusts, rather than asking the network again.
known_hosts="$(ssh-keygen -F "$host" | grep -v '^#' || true)"
[[ -n "$known_hosts" ]] || { echo "no known_hosts entry for $host: connect with ssh once first" >&2; exit 1; }

echo "==> Cloudflare (input is not shown)"
read -rsp "    API token that may edit Pages: " cf_token
echo
read -rp "    account id: " cf_account
[[ -n "$cf_token" && "$cf_account" =~ ^[0-9a-f]{32}$ ]] ||
	{ echo "need both: the token, and the account id (32 characters, 0-9 and a-f)" >&2; exit 1; }

echo "==> creating the deploy key"
ssh-keygen -q -t ed25519 -N "" -C "github-actions deploy ($repo)" -f "$key"

echo "==> adding it to the server, limited to 'prismo ci'"
line="restrict,command=\"$remote_home/prismo-cloud/bin/prismo ci\" $(cat "$key.pub")"
printf '%s\n' "$line" | ssh "$target" '
	umask 077
	mkdir -p ~/.ssh
	touch ~/.ssh/authorized_keys
	read -r line
	printf "%s\n" "$line" >> ~/.ssh/authorized_keys'

echo "==> storing the secrets in $repo"
gh secret set DEPLOY_SSH_KEY --repo "$repo" <"$key"
printf '%s\n' "$known_hosts" | gh secret set DEPLOY_KNOWN_HOSTS --repo "$repo"
printf '%s' "$target" | gh secret set DEPLOY_TARGET --repo "$repo"
printf '%s' "$cf_token" | gh secret set CLOUDFLARE_API_TOKEN --repo "$repo"
printf '%s' "$cf_account" | gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$repo"
unset cf_token
gh variable set DEPLOY_ENABLED --repo "$repo" --body true

echo "==> checking that the key is confined"
# Anything but "deploy <commit>" must be refused by `prismo ci`.
if ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes "$target" 'id' 2>&1 | grep -q "may only run"; then
	echo "    good: the key can only deploy"
else
	echo "    WARNING: the key was not refused as expected. Check ~/.ssh/authorized_keys on the server." >&2
fi

echo
echo "Done. The next push to main deploys by itself: tests, then the server (with a"
echo "backup first), then the web app. Watch it with: gh run watch --repo $repo"
echo "To revoke: delete the line ending in 'github-actions deploy ($repo)' from"
echo "~/.ssh/authorized_keys on the server, and the secrets in the repository's settings."
