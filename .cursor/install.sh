#!/usr/bin/env bash
# Idempotent Cursor cloud-agent install.
#
# NODE_FLOOR is the @react-router/* engines floor. Root package.json engines is
# >=22, and .npmrc is engine-strict, so a 22 below the floor fails `pnpm install`.
# The image PATH lists /exec-daemon/node (v22.14) first.
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_FLOOR=22.22.0
PNPM_VERSION=10.19.0
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# install, start, and an agent can run this at the same time.
lock=/tmp/better-giving-install.lock
exec 9>"$lock"
flock 9

version_ge() {
	# $1 >= $2
	[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

if [ -s "$NVM_DIR/nvm.sh" ]; then
	# nvm.sh is not safe under set -e.
	set +e
	# shellcheck disable=SC1091
	. "$NVM_DIR/nvm.sh"
	set -e
fi

best=""
if [ -d "$NVM_DIR/versions/node" ]; then
	for dir in "$NVM_DIR/versions/node"/v*; do
		[ -x "$dir/bin/node" ] || continue
		ver="${dir##*/v}"
		if version_ge "$ver" "$NODE_FLOOR"; then
			best="$ver"
		fi
	done
fi

if [ -n "$best" ]; then
	nvm alias default "$best" >/dev/null
	nvm use "$best" >/dev/null || true
elif [ -s "$NVM_DIR/nvm.sh" ]; then
	nvm install 22
	nvm alias default 22 >/dev/null
	nvm use 22 >/dev/null || true
else
	sums="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)"
	tarball="$(printf '%s\n' "$sums" | awk '/linux-x64\.tar\.xz$/ { print $2; exit }')"
	[ -n "$tarball" ]
	tmp="$(mktemp)"
	curl -fsSL "https://nodejs.org/dist/latest-v22.x/${tarball}" -o "$tmp"
	expected="$(printf '%s\n' "$sums" | awk -v f="$tarball" '$2 == f { print $1; exit }')"
	echo "${expected}  ${tmp}" | sha256sum -c -
	sudo tar -xJf "$tmp" -C /usr/local --strip-components=1
	rm -f "$tmp"
	hash -r || true
fi

if [ -n "${NVM_BIN:-}" ]; then
	export PATH="$NVM_BIN:$PATH"
elif [ -x /usr/local/bin/node ]; then
	export PATH="/usr/local/bin:$PATH"
fi
hash -r || true

current="$(node -p 'process.versions.node' 2>/dev/null || true)"
if ! version_ge "$current" "$NODE_FLOOR"; then
	echo "node ${current:-missing} is below ${NODE_FLOOR}" >&2
	exit 1
fi

# install and start run under bash -l, which sources /etc/profile and ~/.profile
# (~/.profile sources ~/.bashrc).
snippet="$HOME/.better-giving-node.sh"
cat >"$snippet" <<'EOF'
# Sourced from ~/.bashrc, ~/.profile, and /etc/profile.d. nvm's Node must precede
# /exec-daemon/node, which is v22.14 and below the 22.22 floor this repo requires.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
	# shellcheck disable=SC1091
	. "$NVM_DIR/nvm.sh" || true
fi
if [ -n "${NVM_BIN:-}" ]; then
	PATH="$NVM_BIN:$PATH"
	export PATH
fi
EOF

source_line='[ -f "$HOME/.better-giving-node.sh" ] && . "$HOME/.better-giving-node.sh"'
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
	if [ -f "$rc" ] && grep -q 'better-giving-node.sh' "$rc"; then
		continue
	fi
	printf '\n%s\n' "$source_line" >>"$rc"
done
sudo tee /etc/profile.d/better-giving-node.sh >/dev/null <<'EOF'
# Login shells. The agent command shell does not source this; see ~/.better-giving-node.sh.
[ -f "$HOME/.better-giving-node.sh" ] && . "$HOME/.better-giving-node.sh"
EOF

if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version)" != "$PNPM_VERSION" ]; then
	npm install -g "pnpm@${PNPM_VERSION}"
fi

# /usr/local/cargo/bin is ahead of /exec-daemon on the image PATH. Linking here is what
# makes `node` resolve to nvm's Node in a shell that sources no profile.
link_bin="$(dirname "$(command -v node)")"
sudo mkdir -p /usr/local/cargo/bin
for cmd in node npm npx corepack pnpm; do
	if [ -x "$link_bin/$cmd" ]; then
		sudo ln -sfn "$link_bin/$cmd" "/usr/local/cargo/bin/$cmd"
	fi
done
hash -r || true
node --version
pnpm --version

pnpm install --frozen-lockfile
