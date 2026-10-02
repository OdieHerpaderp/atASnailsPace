#!/usr/bin/env bash
# check.sh - the two static gates on the game's module graph.
#
#   tools/check.sh                  every module in src/ and the entry file
#   tools/check.sh src/plan.js      just this file, parsed
#
# **The copy to `.mjs` is the first gate and not a workaround.** `node --check`
# reads the extension to decide whether the source is a module or a script, so a
# file called `snail-race.js` is parsed as CommonJS and a bare `import` at the
# top of it is a syntax error - which is why the check has always copied the file
# out under a name the checker will read as ESM. One file became eleven, so the
# copy became a loop, and **the copy stayed**, because the copy is the reason the
# check works at all.
#
# The second gate is `wired.mjs`, and it exists because of what the first one
# cannot do. `node --check` parses each file on its own, so a name that is read
# bare in one file and *declared in another that does not export it* is a valid
# program to it: `_todSky` is the hour of the day's scratch colour, it moved into
# `graphics.js` with the renderer, and the frame loop went on reading it, and the
# only thing that said so was a boot screen saying "loading the meshes…". **After
# a declaration moves out, every bare read of it has to have become an import**,
# and a checker that reads the import lists is the only thing that can say so
# before a browser does.
#
# Neither gate resolves a runtime: a plan built from the wrong course, a module
# that throws in its body, a chain that draws the wrong scene. That is
# `tools/e2e/`, and it is a separate command on purpose.
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
  if node --check "$TMP/$base.mjs" >/dev/null 2>&1; then
    printf '  parse   %s\n' "$f"
  else
    printf '  FAIL    %s\n' "$f"
    node --check "$TMP/$base.mjs" || true
    fail=1
  fi
done

# the graph, and only on a whole run - one file on its own is not a graph
if [ "$#" -eq 0 ]; then
  if (cd "$ROOT" && node "$HERE/wired.mjs" \
        src/*.js meshes/palette.js meshes/maps.js snail-race.js); then
    printf '  wired   %d modules\n' "$(ls -1 "$ROOT"/src/*.js | wc -l)"
  else
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "check.sh: something in the graph does not hold." >&2
  exit 1
fi
printf 'check.sh: %d files parse and the graph is wired.\n' "${#FILES[@]}"