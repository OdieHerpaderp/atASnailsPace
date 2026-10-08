// bench.mjs - frame rates for a cup's courses, raced on the card the machine has.
//
//   node tools/bench.mjs                          the first cup, at High, 1280x720
//   node tools/bench.mjs --cup gp --preset 6
//   node tools/bench.mjs --w 2560 --h 1440        the panel's own pixels
//   node tools/bench.mjs --courses dash,splash    two of them
//   node tools/bench.mjs --secs 20                a fixed window, not a whole race
//   PORT=9000 node tools/bench.mjs                a server you have already got
//   --arg=--use-angle=swiftshader                to watch the refusal below fire
//
// **It is not `tools/e2e/`, and the difference is the whole of what it is.** The
// suite runs SwiftShader at 480x300 because it asserts numbers rather than
// pictures and a software rasteriser holds a county of 144 thousand pixels sixty
// times a second. A frame rate measured that way is a fact about a CPU. So this
// asks the browser for the **real** renderer, and **refuses to print a table if
// it cannot get one** - a software rasteriser would hand back a plausible number
// and nothing anywhere would say it was a number about SwiftShader, which is the
// failure this project is written against, so it is a hard exit rather than a
// warning in the corner.
//
// Everything else about a frame rate is a fact about the machine and not about the
// build, so the whole of the environment is written into the results file and the
// table's own header carries it: the card, the window, the render scale, the
// preset, the display's refresh, and the passes the frame went through. **A frame
// rate without those five is not a number, it is an anecdote.**
//
// ## What it measures, and what it does not
//
// The window opens when the countdown ends, **after the probe queue has drained
// and after a settle**, and it closes when the race finishes. Both are load
// bearing. A cube probe is six scene renders and a PMREM and one is pumped every
// 260 ms, so a window that opens with three queued is measuring the county
// catching up with itself rather than the county.
//
// **The frame time is the raw gap between rAF callbacks** and it is the game's own
// frame interval: the sampler is a second `requestAnimationFrame` in the same page
// and every callback in one frame is handed the same timestamp, so the gap it
// records is the gap `src/app.js` would push into `perfPush()`. Nothing here
// re-derives the loop's `dt`, which is clamped to 50 ms and would report a
// stutter as exactly 20 fps.
//
// **And it is vsync-quantised, which is the shape of every number in the table.**
// With a display's own refresh standing, a frame is either one refresh interval
// or it is the next one up, so the medians are 8.3 or 16.7 and nothing between,
// and an "average" is a blend of two rates rather than a rate. The `missed`
// column is the honest one: **a frame is missed when it lands on the next vsync
// deadline, not when it is slow**, so `missed` counts the frames that took the
// longer step and `avg fps` says how often that happened.
//
// ## Why there is no `--uncapped`
//
// It is the obvious next flag and it does not work. `--disable-gpu-vsync
// --disable-frame-rate-limit` takes the refresh out of the loop, and then rAF is
// no longer paced by a display that is answering every frame - measured on this
// machine's own RX 6800 at 2560x1440, Hedgerow Dash came back with a **204 ms
// worst frame and a 1% low of 18 fps** on a course the vsync run put at a 16.7 ms
// median, every `worst` came back 4x to 10x the vsync run's, and the browser
// closed on the fifth course. **There is no number off that run**, and a flag
// that produces a table of them is worse than no flag.
//
// So the ceiling a card can reach at a given preset is asked the only way that
// answers honestly: **raise the work** - a bigger window, a higher preset - and
// read the frame time once the median has left the refresh interval.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HERE = path.join(ROOT, 'tools');
const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i < 0 ? d : argv[i + 1];
};
const has = (k) => argv.includes('--' + k);

/* ------------------------------------------------------------------ *
 * What to race
 * ------------------------------------------------------------------ */

const SEASONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'seasons.json'), 'utf8'));
const RACES = JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'), 'utf8'));
const byId = (id) => RACES.find((c) => c.id === id);

const CUP_ID = flag('cup', SEASONS[0].id);
const CUP = SEASONS.find((s) => s.id === CUP_ID);
if (!CUP) {
  console.error(`bench.mjs: no cup called '${CUP_ID}'. The county has: `
    + SEASONS.map((s) => `${s.id} (${s.name})`).join(', '));
  process.exit(1);
}

/** **The roster is read and not written**, the same argument `tools/e2e/tier.js`
 *  makes for the course list: a course added to `races.json` is a course this
 *  benches, and a sixth tier in `seasons.json` is a cup this can be asked for by
 *  name, and neither is a line somebody has to remember to add here. */
const COURSES = flag('courses', '')
  ? flag('courses', '').split(',')
  : [...CUP.races, CUP.finale];
for (const id of COURSES) {
  if (!byId(id)) {
    console.error(`bench.mjs: races.json has no course called '${id}'.`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ *
 * The preset
 * ------------------------------------------------------------------ */

/** The six names, **written here because they cannot be imported**: `PRESET_NAMES`
 *  is exported by `src/graphics.js`, and node cannot import that file at all,
 *  because it builds its renderer at module scope - `new THREE.WebGLRenderer()` on
 *  line 748, so `THREE` is null in a terminal and the import throws before the
 *  first name is read. Which is the same reason `tools/e2e/tier.js` keeps a
 *  literal for its tier. */
const PRESET_NAMES = ['Low', 'Light', 'Balanced', 'High', 'Very high', 'Ultra'];
const PRESET_RAW = flag('preset', 'High');
const PRESET = (() => {
  const n = Number(PRESET_RAW);
  if (Number.isFinite(n) && n >= 1 && n <= PRESET_NAMES.length) return n;
  const i = PRESET_NAMES.findIndex((x) => x.toLowerCase() === String(PRESET_RAW).toLowerCase());
  if (i >= 0) return i + 1;
  console.error(`bench.mjs: '${PRESET_RAW}' is not a preset. One of: ${PRESET_NAMES.join(', ')}, or 1-6.`);
  process.exit(1);
})();

/* ------------------------------------------------------------------ *
 * The window, and the save it boots on
 * ------------------------------------------------------------------ */

const W = +flag('w', 1280);
const H = +flag('h', 720);
/** **A fixed window rather than the whole race**, because a whole race is not
 *  comparable between courses: the Grand Marathon at the Sunday Cup's scale is
 *  300 m and Hedgerow Dash is 151, so `--secs` samples the same stretch of lane
 *  on both and the number answers "this course at this point". The default is a
 *  whole race, which is the other question - "this course as a player meets it" -
 *  and it is the right default because the table says so. */
const SECS = +flag('secs', 0);
/** `--sections` prints the per-section split as each course finishes. **It is on
 *  by default for a reason that is not brevity**: the whole-race total cannot tell
 *  a course that is slow everywhere from one that is slow in one place, and the
 *  second is the one anybody can act on. It is a flag so a long run can be quiet. */
const SECTIONS = !argv.includes('--quiet');
/** How often the scene's own counters are read. **See the poll's own note**: this
 *  is the resolution of the `tris/frame` and `calls` columns inside a section, and
 *  the frame-time columns do not care. */
const POLL_MS = +flag('poll', 700);
const OUT_DIR = path.resolve(ROOT, flag('out', 'bench'));

/** The game's own save, off the committed capture every spec boots with - **and
 *  two fields rewritten, because a save of the wrong season benches the wrong
 *  course.** `load()` keeps a `tier` it recognises rather than re-deriving one, so
 *  the field is what `seasonScale()` reads and the season's `scale` is what sets a
 *  course's length: the Grand Marathon is 287 m in the Sunday Cup and 824 at the
 *  GP, and a benchmark of one of them labelled as the other is a benchmark of
 *  nothing. `field: null` lets the cup draw its own field, because the fixture's
 *  seven rivals are the Sunday Cup's and the tiers do not all race the same
 *  number of snails. */
const SAVE = {
  ...JSON.parse(fs.readFileSync(path.join(HERE, 'e2e/fixture-save.json'), 'utf8')),
  tier: CUP.id,
  field: null,
};
/** **The settings key is deliberately not seeded.** A browser launched for this run
 *  has a profile of its own, so `localStorage` is empty and the county applies its
 *  own defaults - Balanced, render scale 1× - before the preset is pressed below.
 *  Seeding the key instead would mean writing nine rows and seven switches out of
 *  `setPreset()` a second time, in this file, where nothing checks them. */
const SAVE_KEY = 'snail-grand-prix-v1';

/* ------------------------------------------------------------------ *
 * Playwright out of the npx cache
 * ------------------------------------------------------------------ */

/**
 * **`import()` of a CommonJS entry hands back a namespace whose `default` is
 *  `module.exports`**, so `mod.chromium` is undefined on the two cache routes and
 *  `mod.default.chromium` is not - and the failure reads as a null-ish
 *  `Cannot read properties of undefined (reading 'launch')` from three hundred
 *  lines below the line that got it wrong. `require()` needs no such step, so one
 *  branch goes through `createRequire` and the other does not.
 */
const unwrap = (m) => (m && m.chromium ? m : m.default);

/**
 * The repo has no package manager and no `node_modules`, so `import 'playwright'`
 * cannot resolve - which is the whole of the repo's premise and the one place it
 * has to be worked around. **`tools/e2e/run.sh` resolves the same thing in bash
 * and the rule is the same: the runner whose `browsers.json` names the chromium
 * revision actually installed on this machine, newest runner first.** A runner
 * pointed at a browser it did not ship spends the whole run looking for a
 * download, and the three playwright versions in one npx cache ship three
 * different chromium revisions, so this is a fact to ask for rather than a number
 * to pin.
 *
 * It is the same rule written twice, in two languages, and that is worth saying:
 * the alternative was a `bench.sh` wrapping a `.mjs`, which is one more file for
 * the same rule and one more place for it to rot.
 */
async function playwright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch { void 0; }
  const env = process.env.PLAYWRIGHT_NODE_PATH;
  if (env) return unwrap(await import(path.join(env, 'index.js')));

  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(os.homedir(), '.cache/ms-playwright');
  const revs = (fs.existsSync(browsers) ? fs.readdirSync(browsers) : [])
    .map((d) => /^chromium-(\d+)$/.exec(d))
    .filter(Boolean)
    .map((m) => m[1])
    .sort((a, b) => Number(a) - Number(b));
  if (!revs.length) {
    console.error(`bench.mjs: no chromium in ${browsers}\n`
      + '  the fix is `npx playwright install chromium`');
    process.exit(1);
  }
  // **A string and not a number, because that is what `browsers.json` holds** -
  // `"revision": "1234"` - so a `===` against the number parsed out of the folder
  // name is false for every runner in the cache. Nothing throws: the scan finds
  // nothing and prints a confident instruction to install a browser that is
  // already installed, which is the shape of the quiet answer this project keeps
  // running into.
  const rev = revs[revs.length - 1];
  const cache = path.join(os.homedir(), '.npm', '_npx');
  const found = [];
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache)) {
      const core = path.join(cache, d, 'node_modules/playwright-core');
      const pkg = path.join(cache, d, 'node_modules/playwright');
      try {
        const b = JSON.parse(fs.readFileSync(path.join(core, 'browsers.json'), 'utf8'));
        const c = b.browsers.find((x) => x.name === 'chromium');
        if (!c || c.revision !== rev) continue;
        found.push({ v: JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version, dir: pkg });
      } catch { void 0; }
    }
  }
  found.sort((a, b) => a.v.localeCompare(b.v, undefined, { numeric: true }));
  if (!found.length) {
    console.error(`bench.mjs: no cached playwright ships chromium ${rev} - `
      + '`npx playwright@1.62.1 install chromium` is the fix');
    process.exit(1);
  }
  console.log(`bench.mjs: chromium ${rev}, playwright ${found[found.length - 1].v}`);
  return unwrap(await import(path.join(found[found.length - 1].dir, 'index.js')));
}

/* ------------------------------------------------------------------ *
 * A dev server of this run's own
 * ------------------------------------------------------------------ */

/**
 * **A port the OS says is free, and a server this run started and stopped**,
 * which is `tools/e2e/run.sh`'s rule for the same reason: a gate that reuses
 * whatever holds a port tests whatever is holding it. Here it is a tool rather
 * than a gate, so the rule is about the number rather than the verdict - a bench
 * pointed at a dev server somebody left running is a bench of that server.
 *
 * `PORT` is honoured when it is set, because a machine with 8713 held by the dev
 * server wants to say so rather than be sent to an ephemeral port every time.
 */
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

async function waitForServer(url, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { void 0; }
    if (Date.now() > until) throw new Error(`bench.mjs: nothing answered ${url} in ${ms / 1000}s`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/* ------------------------------------------------------------------ *
 * The two things that run in the page
 * ------------------------------------------------------------------ */

/**
 * The sampler. **One `requestAnimationFrame` callback of its own, in the same
 *  page as the frame loop**, because that is the only way to get the game's frame
 *  interval without instrumenting the game: every callback in one frame is handed
 *  the same `now`, so the gap between two of them is the gap between two frames.
 * It is switched on and off rather than run throughout, and it starts with
 * `last` at zero so a frame that straddles the switch cannot contribute half a
 * gap.
 *
 * **Every frame is tagged with the racer's own arc position**, which costs one
 * property read and is what makes `--sections` possible. It is the answer to the
 * question a course's total cannot answer: **whether the cost is spread along the
 * lane or piled into one stretch of it.** A course can be slow everywhere, and
 * the total says slow; it cannot say why, and a player watching from the outside
 * can - watching Hedgerow Dash at 2560x1440 came out at **68 fps on the open
 * road and 61 inside the bower**, and the whole-race median reads 16.7 ms either
 * side of the tunnel because the course is already missing most of the refresh
 * and a median that saturates cannot see a bump.
 */
const INSTALL = () => {
  window.__bench = { on: false, t: [], s: [], last: 0 };
  const loop = (now) => {
    requestAnimationFrame(loop);
    const b = window.__bench;
    const pl = window.__snail.race.player;
    if (!b.on || !pl) { b.last = 0; return; }
    if (b.last) { b.t.push(now - b.last); b.s.push(pl.s); }
    b.last = now;
  };
  requestAnimationFrame(loop);
};

/** **The display's own refresh, measured on a blank page and not on the game's
 *  stable.** The first version of this asked the stable, and got **16.7 ms - a
 *  59.9 Hz answer on a 120 Hz panel** - because the stable is itself a scene at
 *  High preset and its own frame time came back wearing the question's answer.
 *  Every "missed" count in that run was then counted against a floor twice the
 *  real one, which is the same as not counting it. */
const REFRESH = () => new Promise((res) => {
  const t = [];
  let last = 0, n = 0;
  const loop = (now) => {
    if (last) t.push(now - last);
    last = now;
    if (++n < 100) requestAnimationFrame(loop);
    else {
      const s = t.slice(10).sort((a, b) => a - b);
      res(s[Math.floor(s.length / 2)]);
    }
  };
  requestAnimationFrame(loop);
});

/* ------------------------------------------------------------------ *
 * The numbers
 * ------------------------------------------------------------------ */

/**
 * `q(p)` is a percentile of the **frame time**, and the frame rates beside it are
 * its reciprocals - **which is not the same as a percentile of the frame rate.**
 * The two disagree about which end is the bad one: a hundred frames where ninety
 * are 8.3 ms and ten are 250 ms is a 99th-percentile frame time of 250 ms and a
 * 99th-percentile frame rate of 68, and only the first of those says what a
 * player would have seen.
 */
function stats(gaps, wallMs, floor) {
  const n = gaps.length;
  const s = gaps.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const mean = gaps.reduce((a, b) => a + b, 0) / n;
  /** **The floor this run actually ran at, read off its own fastest frame.**
   *  With vsync standing the fastest frame the county can draw is one refresh
   *  interval and nothing is quicker, so the minimum gap *is* the display's
   *  period - and it is the smaller of the two measurements on purpose, because a
   *  course fast enough to beat the refresh must not be told its floor is the
   *  refresh. */
  const f = Math.min(s[0], floor);
  const late = f * 1.5;
  return {
    frames: n,
    wallS: +(wallMs / 1000).toFixed(2),
    avgFps: +(n / (wallMs / 1000)).toFixed(1),
    msAvg: +mean.toFixed(2),
    msMed: +q(0.5).toFixed(2),
    ms95: +q(0.95).toFixed(2),
    ms99: +q(0.99).toFixed(2),
    msBest: +s[0].toFixed(2),
    msWorst: +s[n - 1].toFixed(2),
    fps1low: +(1000 / q(0.99)).toFixed(1),
    fpsMin: +(1000 / s[n - 1]).toFixed(1),
    /** **Missed is counted against this run's own floor and not against the
     *  display's nominal one**, so a panel running its refresh slightly slow
     *  (`119.95` on this one, not `120`) does not fail every frame in the race. */
    missed: gaps.filter((g) => g > late).length,
    hitches: gaps.filter((g) => g > late * 4).length,
    /** **And whether the number is the display's answer rather than the card's**,
     *  which is the one thing about a frame rate that a reader has to be told and
     *  cannot derive: a course averaging 119.6 with a median of 8.3 ms is at the
     *  refresh and says nothing about what the card could do. */
    capped: mean < f * 1.25,
  };
}

/* ------------------------------------------------------------------ *
 * Where along the lane
 * ------------------------------------------------------------------ */

/**
 * The window split by section, which is the only view that can tell **a course
 * that is slow everywhere** from **a course that is slow in one place**.
 *
 * **The sections are the bower's own ranges where the plan dealt a bower, and ten
 * equal arcs of the lane where it did not.** That is not a presentational
 * preference: a bower is thirty metres of laid-down lane with a known arc range
 * (`bowerReport().s`), and a tenth of the lane is the finest division that means
 * something on a course with nothing in it. **A split on named features is the
 * whole question** - "is it the tunnel" is only askable when the tunnel's metres
 * are known to the reader.
 *
 * **The mean is carried beside the median because the median saturates.** With the
 * display's refresh standing, every frame time is one interval or the next one
 * up, so on a course already missing most of its deadlines the median reads the
 * same value in every section - Hedgerow Dash's is 16.7 ms on open road and 16.7
 * ms under the bower, which is a true statement about the median and a false one
 * about the course: the means are **14.76 and 16.38 ms**, and watching from the
 * outside is what found them. **A median that has hit the refresh has no
 * resolution left, and the mean is what is still measuring.** Both are printed
 * because the median is the honest answer to "how does this feel" and the mean is
 * the only one left that can answer "is this section worse".
 */
function sections(samp, snaps, bower, length) {
  const ranges = [];
  if (bower && bower.s) {
    for (let k = 0; k < bower.s.length; k += 2) {
      ranges.push({ name: `bower ${bower.s[k]}–${bower.s[k + 1]} m`, s0: bower.s[k], s1: bower.s[k + 1] });
    }
  } else {
    for (let k = 0; k < 10; k++) {
      ranges.push({
        name: `${Math.round(length * k / 10)}–${Math.round(length * (k + 1) / 10)} m`,
        s0: length * k / 10, s1: length * (k + 1) / 10,
      });
    }
  }
  const hit = (s, r) => s >= r.s0 && s < r.s1;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const median = (a) => {
    const x = a.slice().sort((p, q) => p - q);
    return x.length ? x[Math.floor(x.length / 2)] : NaN;
  };
  /** One row, and **the two series are filtered by the same predicate rather than
   *  by a shared index**: the frames are one sample per 8.3 ms and the polls one
   *  per two seconds, so a frame index is not a poll index and pairing them would
   *  be a number about a different part of the course than the one being printed. */
  const one = (name, inIt) => {
    const ms = samp.t.filter((_, i) => inIt(samp.s[i]));
    const sn = snaps.filter((x) => inIt(x.s));
    return {
      name, frames: ms.length,
      msMed: +median(ms).toFixed(2), msAvg: +avg(ms).toFixed(2),
      fps: ms.length ? +(1000 / avg(ms)).toFixed(1) : 0,
      trisM: sn.length ? +(median(sn.map((x) => x.tris)) / 1e6).toFixed(1) : null,
      calls: sn.length ? median(sn.map((x) => x.calls)) : null,
    };
  };
  const rows = ranges.map((r) => one(r.name, (s) => hit(s, r)));
  // **And the rest of the lane**, which is the baseline a bower is measured
  // against. A bower printed without it is a number with nothing to be different
  // from, which is the whole of what an observation needs beside it.
  const inAny = (s) => ranges.some((r) => hit(s, r));
  const rest = one('the rest of the lane', (s) => !inAny(s));
  if (rest.frames >= 20) rows.push(rest);
  return rows;
}

/** **Every numeric cell is `—` on a section the window never covered**, and that is
 *  not a rounding of zero: the snail starts at `START_S` rather than at zero and
 *  the race ends when it crosses `tr.finish`, which is short of `tr.length`, so
 *  the first and last stretch of the lane carry no frames at all. Printing them
 *  as `NaN` would be a number about nothing in a file somebody reads in a month,
 *  and `0 fps` reads as "this stretch was free" where it means "this stretch was
 *  not raced". */
const covered = (r) => r.frames > 0;
const SEC_COLS = [
  ['section', (r) => r.name],
  ['frames', (r) => (covered(r) ? r.frames : '—')],
  ['fps', (r) => (covered(r) ? r.fps : '—')],
  ['mean ms', (r) => (covered(r) ? r.msAvg : '—')],
  ['med ms', (r) => (covered(r) ? r.msMed : '—')],
  ['tris/frame', (r) => (r.trisM == null ? '—' : r.trisM + ' M')],
  ['calls', (r) => (r.calls == null ? '—' : r.calls)],
];

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

const COLS = [
  /**
   * **The course cell carries the two marks a reader cannot get from the numbers
   *  beside it**, and it is the course cell rather than a column of its own
   *  because both of them are sentences: *at the refresh* says the average is the
   *  display's and not the card's, and *race did not finish* says the window is
   *  shorter than the course and every percentile in the row is off a shorter
   *  sample. A column of booleans would be two more things to scan past.
   */
  ['course', (r) => r.name
    + (r.capped ? ' (at the refresh)' : '')
    + (r.finished ? '' : ' (race did not finish)')],
  ['metres', (r) => r.metres],
  ['biome', (r) => r.biome],
  ['avg fps', (r) => r.avgFps],
  ['med', (r) => r.msMed],
  ['p95', (r) => r.ms95],
  ['worst', (r) => r.msWorst],
  ['1% low', (r) => r.fps1low],
  ['missed vsync', (r) => `${(100 * r.missed / r.frames).toFixed(0)}%`],
  ['calls', (r) => r.calls],
  ['tris/frame', (r) => (r.trisK / 1000).toFixed(1) + ' M'],
  ['build', (r) => r.buildMs + ' ms'],
];

/** Markdown, because the table is going into a file somebody reads in a month and
 *  `│` and `┼` do not survive a copy out of a terminal. */
function table(rows) {
  const head = `| ${COLS.map(([t]) => t).join(' | ')} |`;
  const rule = `|${COLS.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${COLS.map(([, f]) => f(r)).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

function envTable(run) {
  const rows = [
    ['card', run.gl],
    ['window', `${W}×${H} @ dpr ${run.dpr}`],
    ['county drawn at', run.rt ? `${run.rt[0]}×${run.rt[1]}` : 'n/a'],
    ['preset', `${run.gfx.preset} (${PRESET_NAMES[run.gfx.preset - 1] || 'mixed'})`],
    ['refresh floor', `${run.refreshMs.toFixed(2)} ms · ${(1000 / run.refreshMs).toFixed(1)} Hz`],
    ['path', `${run.gfx.composerUp ? 'compositor' : 'direct'} · ${(run.passes || []).join(' → ') || 'renderer.render()'}`],
    ['cup', `${CUP.name} · scale ${CUP.scale}`],
    ['window per course', SECS > 0 ? `${SECS}s fixed` : 'a whole race'],
  ];
  return `| | |\n|---|---|\n${rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n')}`;
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

const { chromium } = await playwright();

let server = null;
let url;
if (process.env.PORT) {
  url = `http://127.0.0.1:${process.env.PORT}`;
} else {
  const port = await freePort();
  server = spawn('python3', [path.join(HERE, 'serve.py')], {
    cwd: HERE, env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  process.on('exit', () => { if (server) server.kill(); });
  url = `http://127.0.0.1:${port}`;
}

/** The browser. **Headed and on the card**, and the launch flags are the whole
 *  difference from the suite's: `--use-angle=swiftshader` is what the suite wants
 *  and exactly what this must not inherit, so it is not passed - **and its absence
 *  is checked against the renderer string rather than trusted**, because a
 *  headful chromium on a machine with no card falls back to SwiftShader with no
 *  warning at all. `--arg` appends, which is how the refusal below is tested
 *  without a machine that has no card: `--arg=--use-angle=swiftshader` makes this
 *  tool do the thing it exists to refuse. */
const browser = await chromium.launch({
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    ...argv.filter((a) => a.startsWith('--arg=')).map((a) => a.slice('--arg='.length))],
});

const errors = [];
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
page.on('console', (m) => {
  // **The favicon's 404 is not a finding.** Every other console error is, and the
  // URL is in `location()` rather than in the message, which is why the first
  // version of this could not filter it.
  if (m.type() === 'error' && !/favicon/.test((m.location() || {}).url || '')) {
    errors.push('console: ' + m.text());
  }
});

await page.addInitScript(([saveJson, key]) => localStorage.setItem(key, saveJson),
  [JSON.stringify(SAVE), SAVE_KEY]);
await page.goto(`${url}/snail-race.html`, { waitUntil: 'load' });
try {
  await waitForServer(`${url}/snail-race.html`);
  await page.waitForFunction(() => !!window.__snail, null, { timeout: 60000 });
} catch (e) {
  console.error(`${e.message}\n  the boot screen says: `
    + (await page.locator('#boot').textContent().catch(() => '(gone)')).trim()
    + `\n  page errors:\n    ${errors.join('\n    ') || '(none)'}`);
  await browser.close();
  process.exit(1);
}
await page.evaluate(INSTALL);

/* --- the card, and the refusal ------------------------------------- */

const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c.getExtension('WEBGL_debug_renderer_info');
  return d ? String(c.getParameter(d.UNMASKED_RENDERER_WEBGL)) : String(c.getParameter(c.RENDERER));
});

/** **The gate, and it is the one that makes the rest of the table mean anything.**
 *  The suite's own launch flags ask for SwiftShader by name, and a headless
 *  chromium with no GPU falls back to it silently - so the two ways this tool can
 *  quietly measure a CPU instead of a card are a flag somebody copies and a
 *  machine with no card, and **neither throws**. A number off a software
 *  rasteriser is not wrong-looking: it is 3.7 megapixels of honest arithmetic at
 *  about a fortieth of the speed, which is a table with no way to tell it from a
 *  slow card. So this exits rather than writing it. */
if (/swiftshader|llvmpipe|software|basic render/i.test(gl)) {
  console.error(`bench.mjs: the card is not a card.\n`
    + `  WebGL2 reports: ${gl}\n`
    + '  A frame rate off a software rasteriser is a fact about a CPU, and it is\n'
    + '  indistinguishable from a slow card once it is in a table. Pass\n'
    + '  --allow-software if that is genuinely what you want measured.');
  if (!has('allow-software')) {
    await browser.close();
    process.exit(1);
  }
}

/* --- the preset, pressed and not written ---------------------------- */

/**
 * **The settings key is seeded empty and the button is clicked**, because the
 * preset row writes nine rows and seven switches in one call and a hand-written
 * literal in this file would be a second implementation of `setPreset()` that
 * rots the moment a row is added - which is the exact failure
 * `tools/e2e/tier.js` documents for the tier it pins. **The game's own read-back
 * is the check**: `gfx.preset` is derived from the rows agreeing, so a preset that
 * did not land is a `0` here and a report rather than a table of the wrong
 * settings.
 */
await page.evaluate(() => window.__snail.openOptions());
await page.locator('#optRows .optrow.preset .optbtns button',
  { hasText: new RegExp(`^${PRESET_NAMES[PRESET - 1]}$`) }).first().click();
await page.waitForTimeout(1000);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const gfx = await page.evaluate(() => window.__snail.gfx);
if (gfx.preset !== PRESET) {
  console.error(`bench.mjs: asked for ${PRESET_NAMES[PRESET - 1]} and the county read back `
    + `preset ${gfx.preset} (0 is 'mixed', which is what a row that did not land says). `
    + 'The numbers below would be of a different preset, so there are none.');
  await browser.close();
  process.exit(1);
}

/* --- and the season, which sets the lengths ------------------------- */

const tier = await page.evaluate(() => window.__snail.state.tier);
if (tier !== CUP.id) {
  console.error(`bench.mjs: asked for the ${CUP.name} and the county is on '${tier}'. `
    + 'A course is `races.json` × the course\'s own scale × the season\'s, so a save on the\n'
    + '  wrong tier is a benchmark of a length nobody races. There are none.');
  await browser.close();
  process.exit(1);
}

const refreshMs = await (async () => {
  const blank = await browser.newPage();
  const v = await blank.evaluate(REFRESH);
  await blank.close();
  return v;
})();

console.log(`\n${CUP.name} · preset ${PRESET} (${PRESET_NAMES[PRESET - 1]}) · ${W}×${H}`);
console.log(`card: ${gl}`);
console.log(`refresh floor: ${refreshMs.toFixed(2)} ms (${(1000 / refreshMs).toFixed(1)} Hz)\n`);

/* --- the courses --------------------------------------------------- */

const out = [];
for (const id of COURSES) {
  const cat = byId(id);
  const build = await page.evaluate((cid) => {
    const t0 = performance.now();
    window.__snail.start(cid);
    return performance.now() - t0;
  }, id);

  await page.waitForFunction(() => window.__snail.race.phase === 'countdown', null, { timeout: 60000 });
  await page.waitForFunction(() => window.__snail.race.phase === 'running', null, { timeout: 60000 });
  // The settle, in the order the county needs it: the probe queue first (a probe
  // is six scene renders and a PMREM) and the sky after it, because the probes
  // are made off the repainted dome.
  await page.waitForFunction(() => window.__snail.gfx.queued === 0, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => { window.__bench.t.length = 0; window.__bench.s.length = 0; window.__bench.on = true; });
  /**
   * **The scene's own numbers are medians over the window and not the last
   *  frame's.** `renderer.info` is reset once per frame and read again after it,
   * so a single `info()` is whatever the camera happened to be looking at when
   * the race ended - and a snail crossing a bower draws a different frame from
   * the same snail on open road. Hedgerow Dash measured **27.9 M triangles read
   * at the finish line and 27.1 M six seconds in**, on the same preset at the same
   * resolution, and a table that printed whichever it read would be a table of
   * where the race stopped. A poll every two seconds and a median is the honest
   * version of a number that moves with the view.
   *
   * **Each poll carries the arc position with it**, so the medians can be split by
   * section on the same samples rather than on a separate run - one measurement
   * answering two questions, which is the only reason the two agree.
   *
   * **And 700 ms rather than two seconds**, because a section's triangle and call
   * counts are only as good as the samples behind them: at 2 s a 74-second race
   * gives 37 polls, **three or four of them inside a bower**, and a median of four
   * samples is a number about four frames. The frame-time columns are unaffected -
   * they have 800 frames in the same section - so this buys resolution exactly
   * where there was none. `info()` walks the scene for its light count, so it is
   * not free, and 700 ms is the point where it is under a tenth of a percent of
   * the frame.
   */
  const snaps = [];
  let polling = false;
  const poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      snaps.push(await page.evaluate(() => {
        const i = window.__snail.info();
        i.s = window.__snail.race.player ? window.__snail.race.player.s : 0;
        return i;
      }));
    } catch { void 0; }
    polling = false;
  }, POLL_MS);
  const t0 = Date.now();
  let finished = true;
  if (SECS > 0) {
    await page.waitForTimeout(SECS * 1000);
  } else {
    try {
      await page.waitForFunction(() => window.__snail.race.phase === 'done', null, { timeout: 900000 });
    } catch { finished = false; }
  }
  clearInterval(poll);
  const wall = Date.now() - t0;
  const samp = await page.evaluate(() => {
    window.__bench.on = false;
    return { t: window.__bench.t.slice(), s: window.__bench.s.slice() };
  });
  const gaps = samp.t;
  if (gaps.length < 30) {
    console.error(`bench.mjs: ${cat.name} gave ${gaps.length} frames in ${wall / 1000}s - `
      + 'that is not a measurement. Skipped rather than printed.');
    continue;
  }
  if (!snaps.length) {
    snaps.push(await page.evaluate(() => {
      const i = window.__snail.info();
      i.s = window.__snail.race.player ? window.__snail.race.player.s : 0;
      return i;
    }));
  }

  const info = snaps[snaps.length - 1];
  /** The median of a column, and **the median rather than the mean** because one
   *  frame over a bower or a lamp is the thing these columns are about and a mean
   *  of thirty-odd samples would have already spent it. */
  const med = (f) => {
    const a = snaps.map(f).sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const race = await page.evaluate(() => ({
    metres: +window.__snail.race.tr.length.toFixed(1),
    place: window.__snail.race.player.place,
    t: +window.__snail.race.t.toFixed(2),
    field: window.__snail.race.racers.length,
    bower: window.__snail.bower(),
  }));

  const row = {
    id, name: cat.name, biome: cat.biome, metres: race.metres, field: race.field,
    buildMs: Math.round(build), finished,
    ...stats(gaps, wall, refreshMs),
    calls: med((s) => s.calls), trisK: Math.round(med((s) => s.tris) / 1000),
    tex: med((s) => s.targets), geo: med((s) => s.geometries),
    prog: med((s) => s.programs), lamps: med((s) => s.pointLights),
    passes: info.passes, samples: info.samples, snapshots: snaps.length,
    canvas: info.canvas, rt: info.rt, dpr: info.pixelRatio,
    racePlace: race.place, raceTime: race.t, bower: race.bower,
  };
  /** **The split is computed whether or not anybody asked to see it** and printed
   *  on `--sections`, because the tag is one property read per frame and the run
   *  that did not have it is the run that could not answer the question. */
  row.sections = sections(samp, snaps, race.bower, race.metres);
  out.push(row);
  console.log(`  ${cat.name.padEnd(16)} ${String(row.metres).padStart(6)} m  `
    + `${String(row.avgFps).padStart(6)} fps  1% low ${String(row.fps1low).padStart(5)}  `
    + `worst ${String(row.msWorst).padStart(5)} ms  `
    + `${(100 * row.missed / row.frames).toFixed(0)}% missed`
    + (row.capped ? '  [at the refresh]' : '')
    + (row.finished ? '' : '  [race did not finish]'));
  if (SECTIONS) {
    for (const s of row.sections) {
      if (!s.frames) { console.log(`      ${s.name.padEnd(22)} not covered by the window`); continue; }
      console.log(`      ${s.name.padEnd(22)} ${String(s.fps).padStart(6)} fps  `
        + `mean ${String(s.msAvg).padStart(5)} ms  med ${String(s.msMed).padStart(5)} ms  `
        + `${s.trisM == null ? '  —' : String(s.trisM) + ' M'} tris  ${s.calls == null ? '—' : s.calls} calls`);
    }
  }

  // The next course replaces this one, and `skip()` is the button the results
  // screen offers: leaving a race running under a second course means two sets of
  // snails, two sets of lamps and both courses' scenery in one frame, which is a
  // number about nothing.
  await page.evaluate(() => { if (window.__snail.race.phase === 'running') window.__snail.skip(); });
  await page.waitForTimeout(1200);
}

/* --- the files ------------------------------------------------------ */

const run = {
  when: new Date().toISOString(),
  cup: CUP.id, cupName: CUP.name, preset: PRESET,
  window: [W, H], secs: SECS || null,
  gl, refreshMs: +refreshMs.toFixed(3), gfx, errors,
  courses: out,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = run.when.replace(/[:.]/g, '-').slice(0, 19);
const name = path.join(OUT_DIR, `${CUP.id}-p${PRESET}-${W}x${H}-${stamp}`);

/** **The JSON is the measurement and the markdown is a rendering of it**, in that
 *  order, because a table pasted into a commit and a table nobody can check are
 *  two different artefacts and only one of them can be re-derived. The JSON also
 *  carries the errors, because a run with a page error in it is a run whose
 *  numbers nobody should quote, and the table says so at the foot. */
fs.writeFileSync(`${name}.json`, JSON.stringify(run, null, 1));

const md = [
  `# ${CUP.name} frame rates`,
  '',
  `\`node tools/bench.mjs --cup ${run.cup} --preset ${run.preset}\` on ${run.when},`
  + ` ${W}×${H} at dpr ${out[0] ? out[0].dpr : 1}, racing ${run.secs ? `${run.secs}s` : 'a whole race'}`
  + ` of each course.`,
  '',
  '**A frame rate is a fact about a machine and not about the build**, which is why',
  'the environment is in the file beside the numbers and not in a commit message:',
  'the same course on another card, at another resolution or one preset up is a',
  'different number and this table says which of those it is.',
  '',
  envTable({ gl, dpr: out[0] ? out[0].dpr : 1, rt: out[0] ? out[0].rt : null, gfx, refreshMs, passes: out[0] ? out[0].passes : null }),
  '',
  table(out),
  '',
  ...out.filter((r) => r.sections && r.sections.length).flatMap((r) => ([
    `### ${r.name} along the lane`,
    '',
    `| ${SEC_COLS.map(([t]) => t).join(' | ')} |`,
    `|${SEC_COLS.map(() => '---').join('|')}|`,
    ...r.sections.map((s) => `| ${SEC_COLS.map(([, f]) => f(s)).join(' | ')} |`),
    '',
  ])),
  `**\`mean ms\` is the column with resolution left where \`med ms\` has none.**
  With the`,
  'refresh standing, every frame time is one interval or the next one up, so on a',
  'course already missing most of its deadlines the median reads the same value in',
  'every section - Hedgerow Dash\'s is 16.7 ms on open road and 16.7 ms under the',
  'bower, which is true of the median and false of the course. **The sections are',
  "the bower's own arc ranges where the plan dealt one, and ten arcs of the lane",
  'where it did not.** A section the window never covered prints `—`: the snail',
  'starts at `START_S` and the race ends at `tr.finish`, so the first and last',
  'stretch of the lane carry no frames.',
  '',
  `**\`missed vsync\` is the honest column and \`avg fps\` is not.** With the`,
  `refresh standing, a frame is either one interval (${refreshMs.toFixed(2)} ms) or the`,
  'next one up, so the medians are quantised to two values and an average is a',
  'blend of two rates. `missed` counts the frames that took the longer step; a',
  'course marked *(at the refresh)* is being paced by the display and its average',
  'says nothing about what the card could do. *(race did not finish)* means the',
  'window is shorter than the course and the percentiles are off a shorter sample.',
  '',
  `**\`tris/frame\` is the whole frame, not the scene, and it is a median.**
 * \`renderer.info\` is reset once per frame and read again after it, so one`,
  'reading is whatever the camera happened to be looking at; these are medians over',
  'a poll every two seconds of the window. The occlusion and indirect-light passes',
  'each rasterise the scene again, so the number is larger than the county is.',
  ...(errors.length ? ['', '**This run had page errors and its numbers should not be quoted:**', '', ...errors.map((e) => '- ' + e)] : []),
  '',
].join('\n');
fs.writeFileSync(`${name}.md`, md);

console.log(`\n${table(out)}\n`);
console.log(`wrote ${path.relative(ROOT, name)}.json and ${path.relative(ROOT, name)}.md`);
if (errors.length) {
  console.error(`\n${errors.length} page error(s) - the numbers are printed and the file says so:`);
  for (const e of errors.slice(0, 5)) console.error('  ' + e);
}

await browser.close();
if (server) server.kill();
process.exit(errors.length ? 1 : 0);
