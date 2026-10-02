#!/usr/bin/env bash
# check.sh - `node --check` over the game's modules.
#
#   tools/check.sh              every file in src/
#   tools/check.sh src/plan.js  just this one
#
# **The copy to `.mjs` is the point and not a workaround.** `node --check` reads
# the extension to decide whether the source is a module or a script, so a file
# called `snail-race.js` is parsed as CommonJS and a bare `import` at the top of
# it is a syntax error - which is why the check has always copied the file out
# under a name the checker will read as ESM. One file became eleven, so the copy
# became a loop, and **the copy stayed**, because the copy is the reason the check
# works at all.
#
# What this does *not* do is resolve an import. `node --check` parses each file
# on its own, so a renamed export that is still syntactically valid sails through
# it and the failure arrives in the browser as a module-evaluation throw before a
# single frame is drawn. That is what `tools/e2e/` is for, and it is why the two
# are separate commands and not one.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  mapfile -t FILES < <(ls -1 "$ROOT"/src/*.js "$ROOT"/snail-race.js 2>/dev/null)
fi

fail=0
for f in "${FILES[@]}"; do
  base="$(basename "$f" .js)"
  cp "$ROOT/$f" "$TMP/$base.mjs" 2>/dev/null || cp "$f" "$TMP/$base.mjs"
  if node --check "$TMP/$base.mjs"; then
    printf '  ok   %s\n' "$f"
  else
    printf '  FAIL %s\n' "$f"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "check.sh: at least one file does not parse." >&2
  exit 1
fi
printf 'check.sh: %d files parse.\n' "${#FILES[@]}"
