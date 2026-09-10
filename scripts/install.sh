#!/bin/sh
# the one line an operator runs, served beside the release it installs from:
#
#   curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh
#
# it puts one file on the machine — the console binary for this platform, checked against the
# release's own checksums.txt — and then runs it. one paste ends at the cloudflare sign-in opening
# in the operator's browser; nothing else is installed and nothing else is configured.
#
# **the one thing it configures is the name, and only where the install landed off PATH.** an
# operator who cannot type `better-giving` has a console they cannot use, and the line that fixes
# it is one an operator who has never heard of PATH cannot be asked to write. so this appends it
# for them: one line, to the startup file their login program actually reads, and never anywhere
# else. it is append-only — nothing already in that file is rewritten, reordered or removed —
# idempotent, so a file already adding this directory is left exactly as it stands, and never
# fatal: a startup file that could not be read or written leaves a console that is installed and
# reachable by its whole location, which is what an install that hands nothing over then says.
#
# **the handover is an exec, and its input is /dev/tty.** this script's own stdin is the pipe curl
# is feeding it, so a console started plainly would find no keystrokes and refuse every question it
# has: ../packages/console/internal/terminal/prompt.go reads both ends of a prompt and puts none
# where either is not a terminal. replacing this process with the console, its input reattached to
# the terminal the operator is sitting at, is what makes that reading come out true.
#
# **no question stands in front of it.** the console puts its own in front of everything it does —
# the account picker, the confirm before a carry, the door in front of a migration — so nothing
# irreversible happens on the far side of this without the operator answering for it, and a paste
# that ended at a file they then have to find and type is the step this exists to remove.
#
# **a machine with no terminal is handed nothing.** a CI job, a provisioning script or a Dockerfile
# piping this into a log has no /dev/tty to reattach to, and there the install ends where it
# otherwise does: what was installed, how to start it, and exit 0. BETTER_GIVING_INSTALL_ONLY is
# that same ending asked for on a machine that does have one.
#
# **the work directory is removed before the exec, and its trap given up with it.** an exec discards
# this process and every trap on it, so an EXIT trap left holding that removal never runs.
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
	fail "$archive holds no better-giving console, so nothing was installed."

[ -n "${HOME:-}" ] ||
	fail 'this machine reports no HOME, so there is nowhere to install to. set BETTER_GIVING_INSTALL_DIR to a directory you can write to and run this again.'

# where the console goes: a directory of this operator's own that is already on PATH, and
# $HOME/.local/bin where they have none.
#
# **a directory already on PATH is preferred over the standard one, because macos puts nothing of
# the user's on PATH at all.** $HOME/.local/bin is where a linux distribution's own ~/.profile
# looks, and only for a directory that existed at login; macos has no equivalent line anywhere, so
# an install there ends in a console whose name the operator cannot type. an operator who has set a
# directory up for their own binaries has already answered this question, and this reads their
# answer rather than asking it again.
#
# **the two conventional names are taken before anything else on PATH.** the rest of what a machine
# carries under $HOME is some other tool's — a package manager's bin directory is on PATH and
# writable and is not a place to put a console.
#
# **which directory this is decides whether ./startup_file is written at all.** an install that
# landed on PATH is a console the operator can already type, and nothing is added to any file of
# theirs.
mine() {
	on_path "$HOME/.local/bin" && return 0
	on_path "$HOME/bin" && return 0
	(
		IFS=:
		for one in $PATH; do
			case "$one" in
				"$HOME"/*)
					if [ -d "$one" ] && [ -w "$one" ]; then
						printf '%s\n' "$one"
						exit 0
					fi
					;;
			esac
		done
		printf '%s\n' "$HOME/.local/bin"
	)
}

# whether one directory is on this machine's PATH and can be written to, printing it where it is.
on_path() {
	[ -d "$1" ] && [ -w "$1" ] || return 1
	case ":${PATH:-}:" in
		*":$1:"*) printf '%s\n' "$1" ;;
		*) return 1 ;;
	esac
}

# the file this operator's login program reads when a terminal opens, printed as its whole path, and
# non-zero for a login program this script has no such file for.
#
# **it is worked out from $SHELL and never from the process this script is running in**, which is
# whatever /bin/sh the pipe in the header handed it and is nobody's login program.
#
# **a login program this script does not know is answered with nothing, and non-zero.** ~/.profile
# is the widest answer only among the programs that read it: fish reads it never and could not parse
# the line if it did, so writing there would leave this script saying it taught a terminal a name
# the terminal will not know. an operator whose program is not named here is told the whole location
# instead, which is true on every machine.
startup_file() {
	shell=${SHELL:-}
	case "${shell##*/}" in
		zsh) printf '%s\n' "$HOME/.zprofile" ;;
		# macos's bash reads ~/.bash_profile at login and ~/.profile only where that is absent; a
		# linux distribution's reads ~/.profile and ships one already written.
		bash)
			if [ "$os" = darwin ]; then
				printf '%s\n' "$HOME/.bash_profile"
			else
				printf '%s\n' "$HOME/.profile"
			fi
			;;
		sh | dash | ksh | ksh93 | mksh | '') printf '%s\n' "$HOME/.profile" ;;
		*) return 1 ;;
	esac
}

# whether the file `$2` already adds the directory `$1` to PATH.
#
# **any line naming both is a line that already answers this**, whether an earlier run of this
# script wrote it or the operator did, and however they spelled the rest of it. the alternative is
# matching this script's own spelling exactly, which appends a second line to a file that already
# works.
#
# the name is matched as text rather than as a pattern, because a home directory is a path and a
# path is full of characters a regular expression reads as its own.
already_added() {
	[ -r "$2" ] && grep -F "$1" "$2" 2> /dev/null | grep -q PATH
}

# the one line appended to the file `$2`, adding the directory `$1` to what the terminal searches.
# non-zero where that file could not be added to, which is not a failed install.
#
# **the line is written under whatever is already there and nothing else is touched.** a startup
# file is the operator's own and may carry anything; a script that rewrote a line of it would be
# editing something it never read.
add_line() {
	# **each write is its own subshell with its stderr thrown away.** what a file it may not open
	# costs is the shell's own complaint about the redirection, printed by this process and not by
	# the printf inside it — so a `2>` on the printf silences nothing and the operator reads a line
	# of dash's diagnostics above the sentence written for them.
	#
	# a file whose last byte is not a newline would take this onto the end of what is already
	# there. $( ) drops trailing newlines, so a non-empty last byte is a last line left open.
	if [ -s "$2" ] && [ -n "$(tail -c 1 "$2" 2> /dev/null)" ]; then
		( printf '\n' >> "$2" ) 2> /dev/null || return 1
	fi
	( printf 'export PATH="%s:$PATH"\n' "$1" >> "$2" ) 2> /dev/null
}

# how an operator starts a console their terminal cannot yet reach by name.
by_location() {
	say 'start it with the whole location:'
	say "  $dir/better-giving start"
}

dir=${BETTER_GIVING_INSTALL_DIR:-$(mine)}
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

# whether the console can be typed by name in the terminal the operator is standing in, and where
# it cannot, the one line that makes future ones know it.
#
# `taught` is what the startup file was left as: nothing to do, a line just written, a line already
# there, a file that could not be added to, or a login program with no file this script can write —
# none of which is a failed install, and none of which stops this script (./startup_file).
taught=nothing
case ":${PATH:-}:" in
	*":$dir:"*) ;;
	*)
		if ! file=$(startup_file); then
			taught=unknown
		elif already_added "$dir" "$file"; then
			taught=already
		elif add_line "$dir" "$file"; then
			taught=written
		else
			taught=unwritable
		fi
		;;
esac

# whether this script hands the run to the console it just installed.
#
# `BETTER_GIVING_INSTALL_ONLY` is the install on its own, asked for on a machine that does have a
# terminal: a fork's own provisioning, or a contributor pointing this at a release they built and
# served themselves. set to anything at all it means the same thing.
#
# **the terminal is opened rather than assumed.** a machine can carry /dev/tty and refuse to open
# it — a process with no controlling terminal is exactly that — and a console handed a reattach that
# failed is one that draws its first question at nothing.
handing_over() {
	[ -z "${BETTER_GIVING_INSTALL_ONLY:-}" ] || return 1
	( : < /dev/tty ) 2> /dev/null
}

if handing_over; then
	# the smallest true thing, and only where this run wrote the line: the console takes the screen
	# on the next line, and what an operator does with a terminal they open later is type the name.
	if [ "$taught" = written ]; then
		say "taught your terminal the name — any terminal you open from now on knows better-giving."
	fi

	# **removed here and the trap given up with it, because an exec fires neither.** what replaces
	# this process is the console, and a work directory left behind is left behind on every install.
	rm -rf "$work"
	trap - EXIT

	# **stdin and nothing else.** this script's own is the pipe curl is feeding it; where the
	# operator sent the output somewhere of their own the console reads that as a question it may
	# not put, which is its rule and not this script's to overrule
	# (../packages/console/internal/terminal/prompt.go).
	exec "$dir/better-giving" start < /dev/tty
fi

# what an operator does on a machine this script handed nothing to: the terminal it ran in either
# knows the name or will once another is opened, and the whole location works in both until then.
case "$taught" in
	nothing)
		say 'set your deployment up with: better-giving start'
		;;
	written)
		# the file is named because it is the whole of what changed on this machine, and deleting
		# that line is how it is undone.
		say ''
		say "taught your terminal the name, by adding a line to $file."
		say 'any terminal you open from now on knows better-giving. until then:'
		by_location
		;;
	already)
		# nothing is said about the line: it was written by a run before this one, and an operator
		# told about a line nothing just did has to work out whether something went wrong.
		say ''
		say 'any terminal you open from now on knows better-giving. until then:'
		by_location
		;;
	unwritable)
		say ''
		say "your terminal doesn't know that name yet, and $file could not be added to."
		by_location
		;;
	*)
		# the login program is one this script cannot teach (./startup_file), so nothing is claimed
		# about future terminals: what is said is what is true wherever this ran.
		say ''
		say "your terminal doesn't know that name yet."
		by_location
		;;
esac
