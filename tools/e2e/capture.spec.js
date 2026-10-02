// capture.spec.js - the two committed artifacts, and the only moment either can
// be taken.
//
//     tools/e2e/run.sh capture.spec.js
//
// Run against the **pre-split** game and never again: `fixture-save.json` is the
// game's own `save()` payload for a fresh snail, read out of a running page
// rather than written by hand, and `baseline.json` is every number
// `window.__snail` can be asked that is deterministic. Once the code has moved
// there is no version of this that is worth running, because a baseline
// regenerated from the thing it is meant to check is a baseline that agrees with
// whatever is broken.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import { GFX, GFX_KEY, SAVE_KEY, COURSES } from './tier.js';
import { BOOT_MS, capturePlan, captureSim, CAPTURE_SPEC } from './fixtures.js';

// `__dirname` and not `import.meta.url`, and that is a fact about the runner: a
// `.js` spec is compiled to a CommonJS module before it is evaluated, so
// `import.meta` is a syntax error in one and the directory this file sits in is
// the one thing a spec that reads a committed fixture has to know.
const HERE = __dirname;

test('capture the fixture save and the golden baseline', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [GFX_KEY, GFX]);
  await page.goto('/snail-race.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__snail, null, { timeout: BOOT_MS });

  // --- the save, as the game itself would write it ---
  const save = await page.evaluate(() => JSON.stringify(Object.assign({ v: 2 }, window.__snail.state)));
  fs.writeFileSync(path.join(HERE, 'fixture-save.json'), save + '\n');
  const sv = JSON.parse(save);
  console.log(`fixture-save.json  v=${sv.v} season=${sv.season} tier=${sv.tier} ` +
    `rating=${sv.rating} gold=${sv.gold} pool=${sv.pool.length} results=${sv.results.length}`);
  // **and re-arm the seeding with it, before anything else runs.** The load above
  // found no save, so it fell through to `shuffleOrder()` and drew a random
  // season - which is fine for a save being *captured* and poison for one being
  // *compared against*. Every reload below has to boot into the save the suite
  // will boot into, or the second race runs on the first race's result: a moved
  // rating, a rewritten pool, and a field of rivals whose own numbers have all
  // shifted under them.
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, save]);

  const baseline = {
    captured: 'pre-split snail-race.js, 11833 lines, three.js 0.160.0',
    courses: {},
  };

  // --- the plan and the track, per course ---
  //
  // **`capturePlan` and `captureSim` are `fixtures.js`'s, not this file's**, and
  // that is the whole of why a baseline can be trusted for as long as it exists.
  // The two used to be written out here and in `golden.spec.js` independently -
  // same `r4`, same every-eighth-sample lane, same six distances off the centre
  // line - and nothing checked that the writer and the reader of `baseline.json`
  // were describing the same fields. A field added to one is a field the other
  // silently stops comparing; a rounding changed in one is a diff with no cause.
  // **A capture is a contract with the file it produced**, and a contract with a
  // committed file needs one definition.
  for (const id of COURSES) {
    const row = await page.evaluate(capturePlan, CAPTURE_SPEC(id));
    baseline.courses[id] = row;
    console.log(`  ${id.padEnd(9)} plan ${row.plan.length} m  track ${row.track.length} m  ` +
      `n=${row.track.n} finish=${row.track.finish}  ${JSON.stringify(row.plan.tally)}`);
  }

  // --- a whole race, simulated, per course ---
  //
  // **One reload each, and that is load-bearing.** `finishRace()` writes the
  // result into `state`, moves the rating and rewrites the rivals' ratings in
  // `state.pool`, so a second race run in the same page starts from a save the
  // first one produced. That is still deterministic, and it is still a
  // perfectly good gate - but it is a gate on the *sequence*, so a failure says
  // "the fourth course is wrong" and not "the fourth course is wrong", and
  // reordering the loop would move every number in it.
  for (const id of COURSES) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__snail, null, { timeout: BOOT_MS });
    const res = await page.evaluate(captureSim, id);
    baseline.courses[id].sim = res;
    console.log(`  sim ${id.padEnd(9)} ${res.place} of 8  ${res.time.toFixed(3)} s  ` +
      res.field.map((f) => `${f[0]}:${f[1]}`).join(' '));
    console.log(`      standing ${JSON.stringify(res.standing)}`);
  }

  // --- the tier's own numbers, at the tier the fixture pinned ---
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__snail, null, { timeout: BOOT_MS });
  // **The surface itself, and it is the check that the split is finished.**
  // `window.__snail` is the one object in the county whose definition reaches
  // every module - `state` from the race, `planTrack` from the planner,
  // `groundYAt` from the course, `renderer` and `composer` from the chain - so a
  // module that failed to export one of them throws while the object is being
  // built, which is after every module body has run and before the frame loop
  // has drawn anything. Listing the names rather than asserting on the values
  // is what makes it that check: a name that goes missing is a name this file
  // no longer agrees about.
  baseline.surface = await page.evaluate(() => Object.keys(window.__snail).sort());
  const i = await page.evaluate(() => window.__snail.info());
  baseline.info = {
    mode: i.mode, targets: i.targets, passes: i.passes, samples: i.samples,
    rt: i.rt, canvas: i.canvas, pixelRatio: i.pixelRatio, glError: i.glError, badProgram: i.badProgram,
  };
  baseline.background = await page.evaluate(() => window.__snail.background());
  console.log(`  info  targets=${i.targets} passes=${JSON.stringify(i.passes)} ` +
    `samples=${i.samples} canvas=${JSON.stringify(i.canvas)} glError=${i.glError} ` +
    `badProgram=${JSON.stringify(i.badProgram)}`);
  console.log(`  background ${JSON.stringify(baseline.background)}`);

  fs.writeFileSync(path.join(HERE, 'baseline.json'), JSON.stringify(baseline, null, 1) + '\n');
  console.log(`\nbaseline.json  ${COURSES.length} courses, ${errors.length} page errors`);
  for (const e of errors) console.log('  ' + e);
  expect(errors, 'page errors').toEqual([]);
});
