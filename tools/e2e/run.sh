#!/usr/bin/env bash
# run.sh - the suite, from a checkout that has no node_modules in it.
#
#   tools/e2e/run.sh                 every spec
#   tools/e2e/run.sh golden          the specs whose names match
#   CAPTURE=1 tools/e2e/run.sh        and the capture, which rewrites the baseline
#   GOLDEN=1 tools/e2e/run.sh         and the golden specs, which read it
#   PORT=9000 tools/e2e/run.sh        and a specific port rather than a free one
#   tools/e2e/run.sh -c tools/playwright.config.js smoke.spec.js
#
# **Two env vars and not one, and they do opposite things.** `CAPTURE` *writes* the
# committed artifacts and may only ever be taken from the pre-split game. `GOLDEN`
# *reads* them and is off by default, because the rating scale moved under them:
# `makePool()` now spreads the pool over the attributes a snail can actually hold, so
# the fields it draws are different animals and the whole-race comparisons in
# `golden.spec.js` are comparing against numbers from a game that no longer exists.
# The plan, the lane and the terrain in that same file are unchanged and still true,
# so the file is gated rather than deleted - **and a default run that reported 26
# passes with it in would be claiming to have compared numbers it never compared.**
# `tools/playwright.config.js` is the line that reads `GOLDEN`; this comment is the
# other half of it.
#
# **The repo has no package manager and no dependencies, and the runner is not
# the exception.** Playwright lives in npm's npx cache, and the cache holds
# three of them pinned to three different chromium revisions:
#
#     1.56.0-alpha   chromium 1191      (not installed)
#     1.62.1         chromium 1234      (installed)
#     1.64.0-alpha   chromium 1247      (not installed)
#
# **A runner pointed at a browser it did not ship spends the whole suite looking
# for a download**, so the version is not a preference here - it is the one
# number that decides whether the suite runs at all, and `npx playwright` on its
# own resolves to whichever is newest in the registry, which is neither of the
# three above. So this script *reads* the answer rather than pinning a number
# that goes stale: it finds the browser, then the runner that shipped it.
#
# `NODE_PATH` is the second half and it is not a workaround, it is how a
# `require` finds a package in a tree that is not an ancestor of the file asking
# for it. The specs are in the repo and the runner is in the cache, and there is
# no `node_modules` in the repo to walk up to - which is the whole of the repo's
# premise, and this is the one place it has to be worked around rather than
# surrendered.
set -euo pipefail

CACHE="${HOME}/.npm/_npx"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"

if [ ! -d "$CACHE" ]; then
  echo "run.sh: no npx cache at $CACHE - run 'npx playwright@1.62.1 --version' once" >&2
  exit 1
fi

# the chromium revision actually on the machine, from the directory name
REV="$(ls -1 "$BROWSERS" 2>/dev/null | sed -n 's/^chromium-\([0-9]*\)$/\1/p' | sort -n | tail -1)"
if [ -z "$REV" ]; then
  echo "run.sh: no chromium in $BROWSERS - run 'npx playwright install chromium'" >&2
  exit 1
fi

# the cached runner whose browsers.json names that revision, newest first
TREE=""
for d in "$CACHE"/*/node_modules/playwright-core; do
  [ -f "$d/browsers.json" ] || continue
  if node -e '
    const b = require(process.argv[1]).browsers.find((x) => x.name === "chromium");
    process.exit(b && b.revision === process.argv[2] ? 0 : 1);
  ' "$d/browsers.json" "$REV" 2>/dev/null; then
    v="$(node -p "require('${d}/../playwright/package.json').version" 2>/dev/null || echo '?')"
    # keep the highest version that matched, so the order of the glob cannot
    # decide which runner the suite gets
    if [ -z "$TREE" ] || [ "$(printf '%s\n%s\n' "$V" "$v" | sort -V | tail -1)" = "$v" ]; then
      TREE="$(dirname "$d")"; V="$v"
    fi
  fi
done

if [ -z "$TREE" ]; then
  echo "run.sh: no cached playwright ships chromium $REV - 'npx playwright install chromium' is the fix" >&2
  exit 1
fi

echo "run.sh: chromium $REV, playwright $V  ($TREE)"

# **A port of this run's own, and the reason is that two suites cannot share
#  one.** The config used to name 8713 and reuse whatever held it, which is the
#  one arrangement in which a green run means nothing: a checkout whose
#  `src/app.js` throws on its first line, with no `meshes/` at all, reported
#  twenty-five passes against a healthy server somebody else had left running.
#  `reuseExistingServer` is off now, so a port in use is a hard error - and
#  giving each run its own is what keeps that error rare instead of constant.
#  `PORT=9000 tools/e2e/run.sh` still asks for a specific one, which is what a
#  machine with 8713 held by the dev server wants.
if [ -z "${PORT:-}" ]; then
  # **A port the OS says is free, asked for and not assumed.** `listen(0)` binds
  # an ephemeral port and hands it back, which is the only authority on what is
  # free on a machine with a dev server, a browser and whatever else already
  # running - and the ephemeral range is disjoint from 8713-8799, so a test run
  # can never land on the port `tools/serve.py` documents. There is a small race
  # between closing and the suite binding it, which is why the config does not
  # reuse a server: the run fails loudly on a taken port rather than quietly
  # testing somebody else's county.
  PORT="$(node -e '
    const s = require("net").createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => process.stdout.write(String(p)));
    });
  ')"
fi
echo "run.sh: port $PORT"

export NODE_PATH="$TREE"
export PORT
if [ "${CAPTURE:-}" ]; then export CAPTURE=1; fi
exec node "$TREE/playwright/cli.js" test --config "$(dirname "$0")/../playwright.config.js" "$@"
