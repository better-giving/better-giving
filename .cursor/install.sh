#!/usr/bin/env bash
# Idempotent Cursor cloud-agent install. No secrets, no deploy, no remote migration.
#
# Node: there is no .nvmrc. package.json engines is >=22, and CI's setup-node uses
# node-version 22. @react-router/* 8.3.0 requires >=22.22.0 and .npmrc is engine-strict,
# so a 22 below that fails `pnpm install`.
# pnpm: package.json packageManager, exactly 10.19.0.
# Go: packages/console/go.mod, exactly 1.24.2. The console tests need it; pnpm does not.
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_FLOOR=22.22.0
PNPM_VERSION=10.19.0
GO_VERSION=1.24.2

node_meets_floor() {
	command -v node >/dev/null 2>&1 || return 1
	local current
	current="$(node -p 'process.versions.node' 2>/dev/null || true)"
	[ -n "$current" ] || return 1
	[ "$(printf '%s\n%s\n' "$NODE_FLOOR" "$current" | sort -V | head -n1)" = "$NODE_FLOOR" ]
}

# /usr/local/bin is not always first on PATH. Prefer a toolchain already installed there
# before deciding the pinned versions are missing.
if [ -x /usr/local/bin/node ] || [ -x /usr/local/bin/go ]; then
	export PATH="/usr/local/bin:${PATH}"
	hash -r || true
fi

if ! node_meets_floor; then
	sums="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)"
	tarball="$(printf '%s\n' "$sums" | awk '/linux-x64\.tar\.xz$/ { print $2; exit }')"
	[ -n "$tarball" ]
	tmp="$(mktemp)"
	curl -fsSL "https://nodejs.org/dist/latest-v22.x/${tarball}" -o "$tmp"
	expected="$(printf '%s\n' "$sums" | awk -v f="$tarball" '$2 == f { print $1; exit }')"
	echo "${expected}  ${tmp}" | sha256sum -c -
	sudo tar -xJf "$tmp" -C /usr/local --strip-components=1
	rm -f "$tmp"
fi

# /usr/local/bin is not always first on PATH. Prefer the node this script installed.
if [ -x /usr/local/bin/node ]; then
	export PATH="/usr/local/bin:${PATH}"
	hash -r || true
fi

if ! node_meets_floor; then
	echo "node $(node -p 'process.versions.node' 2>/dev/null || echo missing) is below ${NODE_FLOOR}" >&2
	exit 1
fi

if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version)" != "$PNPM_VERSION" ]; then
	npm install -g "pnpm@${PNPM_VERSION}"
fi

if ! go version 2>/dev/null | grep -q "go${GO_VERSION} "; then
	tmp="$(mktemp)"
	curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o "$tmp"
	sudo rm -rf /usr/local/go
	sudo tar -C /usr/local -xzf "$tmp"
	rm -f "$tmp"
	sudo ln -sfn /usr/local/go/bin/go /usr/local/bin/go
	sudo ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt
fi

hash -r || true
node --version
pnpm --version
go version

pnpm install --frozen-lockfile
(cd packages/console && go mod download)
