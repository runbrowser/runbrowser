#!/bin/sh
#
# Install runbrowser.
#
#   curl -fsSL https://runbrowser.com/install | sh
#
# Downloads the binary for this platform from the latest GitHub release,
# verifies it against the published checksums, and puts it on your PATH.
# Nothing else is required — the binary is self-contained, with no Node, Bun
# or npm involved.
#
# Environment:
#   RUNBROWSER_VERSION   install a specific version instead of the latest
#   RUNBROWSER_BIN_DIR   where to install (default: ~/.local/bin, or
#                        /usr/local/bin when it is writable)
#   RUNBROWSER_NO_SKILL  do not install the agent skill

set -eu

REPO="termio-sh/runbrowser"

say() { printf '%s\n' "$*"; }
die() { printf 'runbrowser: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed."; }

need curl
need tar
need uname

# ---------------------------------------------------------------------------
# Which build
# ---------------------------------------------------------------------------

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) die "unsupported operating system: $os. Build from source: https://github.com/$REPO" ;;
esac

case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) die "unsupported architecture: $arch. Build from source: https://github.com/$REPO" ;;
esac

target="runbrowser-$os-$arch"

# Only some combinations are published. Say which, rather than 404ing.
case "$target" in
  runbrowser-darwin-arm64|runbrowser-darwin-x64|runbrowser-linux-x64) ;;
  *)
    die "no published build for $os-$arch yet.
  Open an issue at https://github.com/$REPO/issues and it will be added —
  the code is platform-aware, it simply has not been run there."
    ;;
esac

# ---------------------------------------------------------------------------
# Which version
# ---------------------------------------------------------------------------

version="${RUNBROWSER_VERSION:-}"
if [ -z "$version" ]; then
  version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$version" ] || die "could not determine the latest release. Set RUNBROWSER_VERSION to install a specific one."
fi
version="${version#v}"

base="https://github.com/$REPO/releases/download/v$version"
archive="$target-$version.tar.gz"

# ---------------------------------------------------------------------------
# Download, verify, install
# ---------------------------------------------------------------------------

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading runbrowser $version for $os-$arch..."
curl -fsSL "$base/$archive" -o "$tmp/$archive" \
  || die "download failed: $base/$archive"

# Checksums are published alongside. A silently corrupted 60 MB binary is a
# worse afternoon than a failed install.
if curl -fsSL "$base/SHA256SUMS.txt" -o "$tmp/SHA256SUMS.txt" 2>/dev/null; then
  expected=$(grep " $archive\$" "$tmp/SHA256SUMS.txt" | awk '{print $1}')
  if [ -n "$expected" ]; then
    if command -v shasum >/dev/null 2>&1; then
      actual=$(shasum -a 256 "$tmp/$archive" | awk '{print $1}')
    elif command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp/$archive" | awk '{print $1}')
    else
      actual=""
    fi
    if [ -n "$actual" ] && [ "$actual" != "$expected" ]; then
      die "checksum mismatch for $archive
  expected $expected
  got      $actual"
    fi
    [ -n "$actual" ] && say "Checksum verified."
  fi
fi

tar xzf "$tmp/$archive" -C "$tmp" || die "could not unpack $archive"
[ -f "$tmp/runbrowser" ] || die "archive did not contain a runbrowser binary"
chmod +x "$tmp/runbrowser"

# Prefer a directory already on PATH that we can write to without sudo.
bindir="${RUNBROWSER_BIN_DIR:-}"
if [ -z "$bindir" ]; then
  if [ -w /usr/local/bin ] 2>/dev/null; then
    bindir=/usr/local/bin
  else
    bindir="$HOME/.local/bin"
  fi
fi
mkdir -p "$bindir" || die "could not create $bindir"

mv "$tmp/runbrowser" "$bindir/runbrowser" || die "could not install into $bindir"

say "Installed $("$bindir/runbrowser" --version 2>/dev/null || echo "$version") to $bindir/runbrowser"

case ":$PATH:" in
  *":$bindir:"*)
    # On PATH is not the same as first on PATH. An older install earlier in the
    # search order silently wins, and every command afterwards is the old one —
    # which looks like the install failing to take effect.
    found=$(command -v runbrowser 2>/dev/null || true)
    if [ -n "$found" ] && [ "$found" != "$bindir/runbrowser" ]; then
      say ""
      say "Another runbrowser comes first on your PATH and will be used instead:"
      say "  $found  ($("$found" --version 2>/dev/null || echo 'unknown version'))"
      say "  $bindir/runbrowser  ($version, just installed)"
      say ""
      case "$found" in
        */node_modules/*|*/.npm*|*/npm/*)
          say "That one looks like a global npm install. Remove it with:"
          say "  npm rm -g \$(basename \"\$(dirname \"\$(readlink \"$found\" 2>/dev/null || echo \"$found\")\")\")"
          ;;
        *)
          say "Remove it, or put $bindir earlier on your PATH."
          ;;
      esac
    fi
    ;;
  *)
    say ""
    say "$bindir is not on your PATH. Add it:"
    say "  echo 'export PATH=\"$bindir:\$PATH\"' >> ~/.zshrc && exec zsh"
    ;;
esac

# ---------------------------------------------------------------------------
# The agent skill
# ---------------------------------------------------------------------------
#
# runbrowser exists to be driven by an agent, and an agent only reaches a tool
# it knows about. Installing the skill is part of installing the tool, and
# re-running this script to update refreshes it: `skill install` compares the
# shipped copy by hash, rewriting a stale one and staying quiet when it is
# already current.
#
# Two limits keep that from being presumptuous. It writes only where an agent
# already keeps skills, so a machine with no agent on it gets no directories
# it never asked for. And `skill install` refuses to touch a file it did not
# write, or one that has been edited since — an install is not a licence to
# overwrite someone's own work.
if [ -z "${RUNBROWSER_NO_SKILL:-}" ] && { [ -d "$HOME/.claude" ] || [ -d "$HOME/.agents" ]; }; then
  say ""
  "$bindir/runbrowser" skill install -g || say "Skipped the agent skill. Install it with: runbrowser skill install -g"
fi

say ""
say "Next: install the Chrome extension, then click its icon on a tab."
say "  https://github.com/$REPO#the-extension"
say ""
say "Then:  runbrowser status"
