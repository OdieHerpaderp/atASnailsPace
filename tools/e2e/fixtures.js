// fixtures.js - what every spec boots the county with.
//
// Two keys and both of them are seeded with `addInitScript`, which runs before
// the game's first line and not after it: a save read in after boot is a save
// `load()` never saw, and the game's answer to a save it never saw is
// `shuffleOrder()`, which picks a **random** season off `Date.now()`. That is
// the one way this suite could pass while measuring nothing, so nothing here may
// be seeded late and nothing here may be hand-written.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'playwright/test';
import { GFX, GFX_KEY, SAVE_KEY } from './tier.js';

// `__dirname`, and not `import.meta.url`: a `.js` spec is compiled to CommonJS
// before it runs, so `import.meta` is a syntax error in one.
const HERE = __dirname;

/** The game's own save, captured off a running game by `capture.spec.js` and
 *  committed. `load()` wants `v: 2` and a `pool` of exactly 64 entries of
 *  `{attrs, rating}` and it checks both, so a hand-written fixture that missed
 *  one would be rejected **in silence**. */
export const SAVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-save.json'), 'utf8'));

export { GFX, GFX_KEY, SAVE_KEY };

/** How long a boot may take, and it is short on purpose. The county boots in
 *  about two seconds under SwiftShader at 480x300 and has been measured at 3.5 s
 *  wall clock for the slowest spec's first paint, so twenty is ten times the
 *  worst good case. **A longer timeout does not make the suite more patient, it
 *  makes a failure slower to find**: a page that throws in a module body never
 *  reaches `window.__snail`, and every spec that waits for it waits the whole
 *  budget first - twenty-two tests at three minutes each is an hour of a
 *  one-line error. So the wait is short and the errors are surfaced with it. */
export const BOOT_MS = 20000;

/* ================================================================== *
 * The capture
 *
 * **One definition of what `baseline.json` holds, for the spec that writes it
 * and the spec that reads it.** They were two copies of the same expression -
 * the `r4` rounding, the every-eighth-sample lane, the six distances off the
 * centre line - and a copy is a copy until somebody adds a field to one of
 * them. The reader then either compares something the writer never wrote (a
 * silent pass) or expects a field the writer stopped writing (a shape error on
 * a baseline that is still correct). **A capture is a contract with the file it
 * produced**, and a contract with a file on disk needs one definition, not two
 * that are kept in step by hand.
 *
 * These are functions rather than strings because `page.evaluate` takes a
 * function and Playwright serialises its source: the two specs call
 * `page.evaluate(capturePlan, id)` and `page.evaluate(captureSim, id)`, and
 * both execute this text.
 * ================================================================== */

/** Every sample per row: the lane every eighth sample, and the terrain off eight
 *  rows along it - **which is nine samples, `0` and `n` both included**, because
 *  the stride is `n / 8` and the loop starts at `0`. The number written here is
 *  the divisor and not the count of rows, which is the sort of thing that is worth
 *  saying once: reading `GROUND_ROWS` as "how many ground rows there are" gives
 *  eight, and there are nine, and the extra one was the first and last sample.
 *
 *  **Short enough to read when two files disagree and long enough to place a
 *  change**, and both specs reading these from here is what stops the two from
 *  sampling different places. */
export const LANE_STRIDE = 8;
export const GROUND_ROWS = 8;
/** Six distances out from the centre line, in metres. Signed, so the two sides are
 *  not one side and a mirror: `-40, -18, -7, 7, 18, 40`. */
export const GROUND_OUT = [-40, -18, -7, 7, 18, 40];

/** The plan and the track for one course, from a page that has just booted.
 *
 *  **The strides and the six distances arrive as an argument, not as the module's
 *  own constants** - because `page.evaluate` takes a function and ships it to the
 *  page as source, and a module-scope `const` does not travel with it. They
 *  looked like they did: the constants are right above this function, they are
 *  exported, and every call site is in the same folder. `LANE_STRIDE is not
 *  defined` is the answer, and it is the general shape - **a function evaluated
 *  in the page can close over its arguments and nothing else.** So the numbers
 *  are passed in, which is also what makes them the shared definition rather
 *  than two constants that happen to look related.
 *
 *  **`r4` ends in `|| 0`, and that is not tidiness.** `(-0.00004).toFixed(4)` is
 *  `-0.0000` and `JSON.stringify(-0)` is `0`, so a baseline on disk can never
 *  come back as the negative zero the page still holds - one lane sample of five
 *  courses would fail on it, every run, forever. A number that cannot survive
 *  its own round trip does not belong in a golden file, and the fix belongs at
 *  the writer rather than in every comparison. */
export function capturePlan(spec) {
  const { catId, laneStride, groundRows, out } = spec;
  const S = window.__snail;
  const r4 = (v) => (v == null || !isFinite(v) ? null : (+v.toFixed(4) || 0));
  const plan = S.plan(catId);
  const tr = S.track(catId);
  const lane = [];
  for (let i = 0; i <= tr.n; i += laneStride) {
    const q = tr.sm[i];
    lane.push([r4(q.s), r4(q.y), r4(q.ground), r4(q.w), r4(q.water), r4(q.floor),
      r4(q.basin), r4(q.crown), r4(q.grade), r4(q.bend), q.cond, q.rock ? 1 : 0]);
  }
  // **`groundYAt()` is a function of the frame it is handed**, so a frame read off
  // the wrong row is a hillside in the wrong place with the lane above it exactly
  // where it was - and nothing else in this capture would see it.
  const fr = S.newFrame();
  const ground = [];
  const stride = Math.max(1, Math.floor(tr.n / groundRows));
  for (let i = 0; i <= tr.n; i += stride) {
    S.trackAt(tr, tr.sm[i].s, fr);
    ground.push([r4(tr.sm[i].s), r4(fr.y), r4(fr.ground),
      ...out.map((d) => r4(S.groundYAt(fr, d)))]);
  }
  return {
    plan: {
      length: r4(plan.length), midX: r4(plan.midX), tally: plan.tally,
      pts: plan.pts.map((p) => [r4(p.x), r4(p.y), r4(p.z)]),
      meta: plan.meta.map((m) => [m.cond, r4(m.ground), r4(m.w), r4(m.water),
        r4(m.floor), r4(m.basin), r4(m.crown), m.rock ? 1 : 0]),
      leaps: plan.leaps.map((l) => [l.kind, r4(l.x0), r4(l.x1), r4(l.farX), r4(l.lipY),
        r4(l.laneY), r4(l.waterY), r4(l.floorY), r4(l.vy), l.wet ? 1 : 0, l.crate ? 1 : 0]),
    },
    track: {
      catId: tr.catId, n: tr.n, length: r4(tr.length), finish: r4(tr.finish),
      drain: r4(tr.drain),
      leaps: tr.leaps.map((l) => [l.kind, r4(l.s0), r4(l.s1), r4(l.land), r4(l.lipY),
        r4(l.laneY), r4(l.waterY), r4(l.floorY), r4(l.vy), l.wet ? 1 : 0]),
      lane,
      ground,
    },
  };
}

/** The argument both specs hand `capturePlan`, built once here so the call sites
 *  carry a name rather than an object literal - and a name is what makes it
 *  obvious at the call site that the page is being told what to sample. */
export const CAPTURE_SPEC = (catId) => ({
  catId,
  laneStride: LANE_STRIDE,
  groundRows: GROUND_ROWS,
  out: GROUND_OUT,
});

/** A whole race, simulated, for one course. **`standing()` and `mills()` are read
 *  before anything can drop the course** - `dropCourse()` empties the register,
 *  and a report taken afterwards is an empty one that agrees with every other
 *  empty report. */
export function captureSim(catId) {
  const S = window.__snail;
  S.surge(false);
  S.start(catId);
  const r = S.sim(300, 0.04);
  S.surge(false);
  return {
    place: S.race.player.place, points: S.race.player.points,
    time: +r.time.toFixed(6), length: +r.length.toFixed(4), hour: +r.hour.toFixed(6),
    field: r.field.map((f) => [f.name, f.place, f.points, +f.time.toFixed(6), f.rating]),
    standing: S.standing(),
    mills: S.mills(),
  };
}

/** Seed the keys, then go. `gfx: null` seeds the save and **leaves the settings
 *  key alone**, which is how a spec asks "does the tier the game just wrote come
 *  back?" - an init script re-runs on every navigation, so a page armed with the
 *  fixture's tier stamps that tier back over whatever was saved and the reload
 *  proves nothing. */
export async function boot(page, { gfx = GFX } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(
    ([save, gfxKey, saveKey, gfxVal]) => {
      localStorage.setItem(saveKey, save);
      if (gfxVal) localStorage.setItem(gfxKey, JSON.stringify(gfxVal));
    },
    [JSON.stringify(SAVE), GFX_KEY, SAVE_KEY, gfx],
  );
  await page.goto('/snail-race.html', { waitUntil: 'load' });
  // `window.__snail` existing is the game's own statement that its last line
  // ran, and it is the only completion signal here that is not a timeout with a
  // guess in it: `#boot` is removed 700 ms after it goes, so a page that reached
  // `.gone` may already have taken the element the loader would have to read.
  try {
    await page.waitForFunction(() => !!window.__snail, null, { timeout: BOOT_MS });
  } catch (e) {
    // **The module-evaluation throw, printed here rather than as a bare
    // timeout.** A missing or misspelled export is a `ReferenceError` before the
    // first frame, and the boot screen never moves off whichever line the game
    // had reached - which is "loading the meshes…" for anything that throws
    // after the loader and says nothing else at all.
    let said = '(gone)';
    try { said = await page.locator('#boot').textContent({ timeout: 2000 }); } catch {}
    throw new Error(
      `the county did not boot in ${BOOT_MS / 1000}s.\n`
      + `  #boot says: ${said}\n`
      + `  page errors:\n${errors.map((x) => '    ' + x).join('\n') || '    (none)'}\n`
      + `  ${e.message}`);
  }
  return { errors };
}

/** One pageerror fails a spec, and it is the primary gate for the whole change:
 *  **a missing or misspelled export in a module graph throws at
 *  module-evaluation time, before a single frame is drawn**, and no assertion
 *  about what was drawn would ever see it. */
export function noErrors(errors) {
  expect(errors, 'page errors').toEqual([]);
}
