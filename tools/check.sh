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
  # **`src/*.js` and nothing else**, and the glob is the entry now: `app.js` is
  # the eleventh module and lives in the folder with the other ten. There was a
  # `snail-race.js` on the end of this list for eight steps, and the day it moved
  # into `src/` the list did not need editing - which is the shape of the fix.
  mapfile -t FILES < <(ls -1 "$ROOT"/src/*.js)
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
        src/*.js meshes/palette.js meshes/maps.js meshes/biomes.js); then
    printf '  wired   %d modules\n' "$(ls -1 "$ROOT"/src/*.js | wc -l)"
  else
    fail=1
  fi

  # Two drawers writing one map name, and **a duplicate key in an object literal
  # is legal JavaScript with no warning and no error**: `Object` takes the last
  # assignment, the page draws the second field, and the file on disk is the
  # second field and nobody knows the first one exists. `tools/inspect.html`
  # audits `meshes/maps.js` and the folder, and **both of those are downstream of
  # the drawer** - the manifest is right and the bytes are wrong, which is the one
  # combination the audit cannot see.
  #
  # **This prints `cobblestone-albedo`, `cobblestone-n` and `cobblestone-rgh`
  # today, and it is meant to.** It is a real defect in `meshes/build-textures.html`
  # and it is left red on purpose, with the reason beside it, because **a gate
  # taught to pass is the failure this whole county is written against**. It is
  # also the gate that catches the next one, and the next one is more likely than
  # the first.
  #
  # So it reports and it does not fail the run: the duplicate is a naming bug on a
  # surface nothing wears, and the fix - renaming the limestone drawer - would
  # change what an existing texture's name means to every surface that declares it.
  # The bower's setts are a **new name** (`bowerSetts-*`) precisely because of it.
  dup="$(awk '/^const DRAW = \{/,/^\};/' "$ROOT/meshes/build-textures.html" \
          | grep -oE "'[a-zA-Z0-9]+-(albedo|n|rgh|em|tone)'" | sort | uniq -d | tr '\n' ' ')"
  if [ -n "$dup" ]; then
    printf '  note    two drawers write one map name, and the first is dead code: %s\n' "$dup"
  else
    printf '  drawers every map name is written once\n'
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "check.sh: something in the graph does not hold." >&2
  exit 1
fi
printf 'check.sh: %d files parse and the graph is wired.\n' "${#FILES[@]}"