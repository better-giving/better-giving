#!/bin/sh
# the one line an operator runs, served beside the release it installs from:
#
#   curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh
#
# it puts one file on the machine — the console binary for this platform, checked against the
# release's own checksums.txt — and says how to reach it. nothing else is installed and nothing is
# configured: signing in to cloudflare is `better-giving open` and a press in the browser.
#
# **posix sh, because the line above pipes it into whatever /bin/sh is.** no arrays, no `local`, no
# `[[`, no `pipefail`: those are bash, and debian's /bin/sh is dash.
#
# **the archive's name is .goreleaser.yaml's `archives.name_template`, worked out from `uname`.**
# the two files spell a platform the same way or every download here is a 404, which is why that
# template carries a comment pointing back at this one.
#
# nothing here checks install.sh itself. a checksum of this file, served from the release this file
# downloads from, is a check on the channel it arrived over made over that same channel — what it
# would catch is a corrupted download, which every line below already fails on.
set -eu

repo=better-giving/better-giving

fail() {
	printf 'better-giving: %s\n' "$1" >&2
	exit 1
}

say() {
	printf '%s\n' "$1"
}

# what this machine is, in the two words the archive is named with.
#
# windows is named rather than left to the last arm: an operator running this under git bash meets
# a sentence about their platform instead of one about `uname` output nobody wrote for them.
os=$(uname -s)
case "$os" in
	Darwin) os=darwin ;;
	Linux) os=linux ;;
	MINGW* | MSYS* | CYGWIN* | Windows_NT)
		fail 'windows is out of scope: the console is built for macos and linux only, and nothing was installed. windows subsystem for linux is a linux machine to this script and works.' ;;
	*) fail "the console is built for macos and linux only, and this machine reports $os. nothing was installed." ;;
esac

arch=$(uname -m)
case "$arch" in
	x86_64 | amd64) arch=amd64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) fail "the console is built for amd64 and arm64, and this machine reports $arch. nothing was installed." ;;
esac

# curl or wget, whichever this machine has. both are asked to fail loudly on an http error rather
# than writing the error page to disk as though it were an archive.
if command -v curl > /dev/null 2>&1; then
	download() { curl -fsSL "$1" -o "$2"; }
elif command -v wget > /dev/null 2>&1; then
	download() { wget -q -O "$2" "$1"; }
else
	fail 'neither curl nor wget is on this machine, so there is nothing to download with. install one and run this again.'
fi

# sha256sum on linux, shasum on macos, and they read the same file format — which is why the
# wanted line is cut out of checksums.txt and handed over as a file rather than compared by eye.
if command -v sha256sum > /dev/null 2>&1; then
	verify() { sha256sum -c "$1" > /dev/null 2>&1; }
elif command -v shasum > /dev/null 2>&1; then
	verify() { shasum -a 256 -c "$1" > /dev/null 2>&1; }
else
	fail 'neither sha256sum nor shasum is on this machine, so the download could not be checked. nothing was installed.'
fi

# where the assets are.
#
# `BETTER_GIVING_DOWNLOAD_BASE` is for a contributor pointing this at their own `goreleaser release
# --snapshot` output, and is documented in CONTRIBUTING.md and nowhere an operator reads.
if [ -n "${BETTER_GIVING_DOWNLOAD_BASE:-}" ]; then
	base=${BETTER_GIVING_DOWNLOAD_BASE%/}
elif [ -n "${BETTER_GIVING_VERSION:-}" ]; then
	# the tag is `v` and the version; a value written either way names the same release.
	base="https://github.com/$repo/releases/download/v${BETTER_GIVING_VERSION#v}"
else
	base="https://github.com/$repo/releases/latest/download"
fi

work=$(mktemp -d 2> /dev/null || mktemp -d -t better-giving)
trap 'rm -rf "$work"' EXIT
trap 'exit 130' HUP INT TERM

archive="better-giving_${os}_${arch}.tar.gz"

say "downloading $archive"
download "$base/$archive" "$work/$archive" ||
	fail "$base/$archive could not be downloaded. check this machine's connection, and that the version you asked for exists. nothing was installed."
download "$base/checksums.txt" "$work/checksums.txt" ||
	fail "$base/checksums.txt could not be downloaded, so the download could not be checked. nothing was installed."

# one line of checksums.txt, which covers every asset in the release. a release naming no archive
# for this platform is a release this script cannot check, and an unchecked install is the one
# thing it will not do.
wanted=$(grep -E "[[:space:]]\*?$archive\$" "$work/checksums.txt" || true)
[ -n "$wanted" ] ||
	fail "checksums.txt names no $archive, so there was nothing to check the download against. nothing was installed."
printf '%s\n' "$wanted" > "$work/wanted.txt"
# in the work directory, because the name in that line is a bare filename.
(cd "$work" && verify wanted.txt) ||
	fail "$archive does not match the checksum the release publishes for it. nothing was installed. try again, and if it happens twice say so at https://github.com/$repo/issues."

tar -xzf "$work/$archive" -C "$work" ||
	fail "$archive could not be unpacked, so nothing was installed."
[ -f "$work/better-giving" ] ||
	fail "$archive holds no better-giving binary, so nothing was installed."

dir=${BETTER_GIVING_INSTALL_DIR:-$HOME/.local/bin}
mkdir -p "$dir" ||
	fail "$dir could not be made, so nothing was installed. set BETTER_GIVING_INSTALL_DIR to a directory you can write to and run this again."
chmod +x "$work/better-giving"
# written beside the name and renamed onto it, so installing over a console that is running
# replaces the file rather than writing into the one this machine is executing.
if ! cp "$work/better-giving" "$dir/.better-giving.$$" ||
	! mv -f "$dir/.better-giving.$$" "$dir/better-giving"; then
	rm -f "$dir/.better-giving.$$"
	fail "$dir could not be written to, so nothing was installed. set BETTER_GIVING_INSTALL_DIR to a directory you can write to and run this again."
fi

say "installed $dir/better-giving"
case ":${PATH:-}:" in
	*":$dir:"*)
		say 'open the console with: better-giving open'
		;;
	*)
		say ''
		say "$dir is not on this machine's PATH. either open the console with the whole path:"
		say "  $dir/better-giving open"
		say 'or add this line to your shell profile — ~/.zprofile on macos, ~/.profile on linux — and open a new terminal:'
		say "  export PATH=\"$dir:\$PATH\""
		;;
esac
