#!/usr/bin/env bash
# run.sh - the suite, from a checkout that has no node_modules in it.
#
#   tools/e2e/run.sh                 every spec
#   tools/e2e/run.sh golden          the specs whose names match
#   CAPTURE=1 tools/e2e/run.sh        and the capture, which rewrites the baseline
#   tools/e2e/run.sh -c tools/playwright.config.js smoke.spec.js
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
export NODE_PATH="$TREE"
if [ "${CAPTURE:-}" ]; then export CAPTURE=1; fi
exec node "$TREE/playwright/cli.js" test --config "$(dirname "$0")/../playwright.config.js" "$@"
