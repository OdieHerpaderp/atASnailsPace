// smoke.spec.js - does the county come up at all.
//
// Four things, in the order they can fail. The game is served, three.js comes
// off the CDN, the module graph evaluates, and the first frame is drawn. A refactor
// of eleven files breaks the middle of that list and nothing else, so this spec
// is mostly the assertion that **no pageerror happened**, because a missing or
// misspelled export throws at module-evaluation time - before a frame, before a
// shader, before any of the other specs get a page to look at.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import { boot, noErrors } from './fixtures.js';

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8'));

test('the county boots, the boot screen goes, and the surface is the one the baseline recorded', async ({ page }) => {
  const { errors } = await boot(page);
  // `#boot` is removed 700 ms after it goes, so the class is the assertion and
  // the removal is the thing worth waiting for - a page that is up and still
  // showing the boot screen for a second is a page mid-`setTimeout`
  await expect(page.locator('#boot'), 'the boot screen').toHaveClass(/gone/);
  await expect(page.locator('#boot'), 'the boot screen leaves').toHaveCount(0, { timeout: 10000 });
  noErrors(errors);
  // **and the surface, name for name.** `window.__snail` is the one object whose
  // definition reaches every module, so a module that failed to export one of
  // them throws while the object is being built - which is after every module
  // body has run and before a frame has been drawn.
  expect(await page.evaluate(() => Object.keys(window.__snail).sort())).toEqual(BASELINE.surface);
});

test('the stable is what the first frame draws, and not the county', async ({ page }) => {
  const { errors } = await boot(page);
  // **This is the one the registry's empty fields could not fail loudly.** The
  // frame loop asks `world.renderScene()` which scene it is about, and the
  // answer is a predicate over `world.stage` - so a registry whose `stage` was
  // never written answers "not the stable" and draws the county's scene
  // instead: an empty stage, no snail, no plinth, and **no error anywhere**. The
  // first frame came to 32 draw calls and 2,750 triangles where it should be 68
  // and a whole stable, and the texture count was five against twenty-three.
  //
  // So the numbers are pinned, and the triangle count is the one that matters:
  // a blank scene is not a smaller scene, it is the wrong scene.
  const first = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const i = window.__snail.info();
    return { calls: i.calls, tris: i.tris, targets: i.targets, geometries: i.geometries };
  });
  expect(first.calls, 'draw calls on the first frame of the stable').toBeGreaterThan(60);
  expect(first.tris, 'triangles on the first frame of the stable').toBeGreaterThan(20000);
  expect(first.targets, 'the stable\'s own textures are uploaded').toBe(BASELINE.info.targets);
  noErrors(errors);
});

test('a course builds, draws, and leaves no program broken and no gl error', async ({ page }) => {
  const { errors } = await boot(page);
  // the tallest course there is: four pools, five crates, the whole spread of
  // surfaces and every material the county owns
  await page.evaluate(() => window.__snail.start('marathon'));
  // two frames, because the first one after a build is the one that compiles
  const info = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__snail.info();
  });
  expect(info.glError, 'glError after a full course').toBe(0);
  expect(info.badProgram, 'programs that did not compile').toEqual([]);
  expect(info.calls, 'draw calls on a standing course').toBeGreaterThan(0);
  expect(info.tris, 'triangles on a standing course').toBeGreaterThan(1000);
  noErrors(errors);
});

test('the pinned tier is the direct path: no chain, no samples, no target of the chain\'s own', async ({ page }) => {
  const { errors } = await boot(page);
  const info = await page.evaluate(() => window.__snail.info());
  // **The regression gate, and it is the whole reason the tier is pinned at
  // render scale 1x.** `passes: []` is the game's own single `renderer.render()`
  // with no post chain anywhere in the frame, and it is the state the repo
  // documents as the one thing that must not quietly stop being true. At 0.5x
  // the resample alone would build the chain and this assertion would pass on a
  // game that had lost the direct path entirely.
  expect(info.passes, 'composer passes at the bottom tier').toEqual([]);
  expect(info.samples, 'multisample count on a target that should not exist').toBe(0);
  expect(info.rt, 'the chain\'s own buffer').toBeNull();
  expect(info.canvas, 'the canvas is native, and the county is a share of it')
    .toEqual(BASELINE.info.canvas);
  noErrors(errors);
});

test('the backdrop and the G-buffer are the same scene the beauty pass is drawing', async ({ page }) => {
  const { errors } = await boot(page);
  expect(await page.evaluate(() => window.__snail.background())).toEqual(BASELINE.background);
  noErrors(errors);
});

test('a course is built and dropped four times and the geometry count comes back', async ({ page }) => {
  const { errors } = await boot(page);
  // **The standing leak gate.** `buildCourse()` opens with `dropCourse()`, so the
  // second course through is the first one taken down - and a merge that returned
  // null, a `dropCourse()` that was not told about a resource somebody added, and
  // a prop whose instanced mesh was never disposed all show up here and nowhere
  // else. The comparison is *one course against four*, and not against nothing:
  // the last course is still standing, because `finishRace()` does not take a
  // course down and nothing should.
  const settled = async () => page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__snail.info().geometries;
  });
  await page.evaluate(() => window.__snail.start('ascent'));
  const one = await settled();
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__snail.start('ascent'));
  const four = await settled();
  expect(four, 'geometries after four builds of the same course').toBe(one);
  noErrors(errors);
});

test('the registry is filled: pools probed, props stamped, and a density row rebuilding', async ({ page }) => {
  // **Three registry fields, and none of them can fail loudly.** `world` is a
  // registry of things the modules that own them fill, and a field nobody filled
  // has a default - so a default that is an empty list, an empty function or a
  // null reads as *a quiet answer* rather than as a missing one. Four of these
  // sat unfilled for four steps of the split with the whole suite green:
  //
  //  - `world.water`, so `eachWaterSurface()` saw no pools and **no course got a
  //    reflection probe at all** - while the stable's, which comes from
  //    `world.stage` and was filled, kept working, so the row looked alive on the
  //    hub and dead everywhere it was meant to be seen;
  //  - `world.shadowRoots()` and `world.racers()`, so `applyShadows()` walked
  //    nothing and **the shadows row stopped stamping props** - `scatter()` was
  //    still writing `userData.gfxCast` on thousands of pieces for a flag that
  //    nothing read;
  //  - `world.restage()`, so **no density change rebuilt the stable** and four
  //    rows wrote a flag that nothing read.
  //
  // None of those is a number the golden baseline measures, which is exactly why
  // this test exists rather than a tighter tolerance somewhere else.
  const { errors } = await boot(page);

  // the reflections row first, because `startRace()` builds the probes and a row
  // set afterwards would leave the course standing with none
  await page.evaluate(() => window.__snail.setGfx('refl', 3));
  await page.evaluate(() => window.__snail.start('splash'));   // four pools
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // **Four pools and four probes**, and the count is the assertion: a probe per
  // pool is what the row buys, and `syncProbes()` runs inside `startRace()` before
  // the hour is set, so a course built with the row off and switched on afterwards
  // would report nothing here and be right to.
  expect(await page.evaluate(() => window.__snail.gfx.probes), 'probes on a course\'s four pools')
    .toBeGreaterThanOrEqual(4);

  // the shadows row, read off the geometry rather than off the registry: a
  // stamped prop that is still casting when the row says props do not cast is a
  // walk that did not happen
  const cast = async (n) => {
    await page.evaluate((k) => window.__snail.setGfx('shadow', k), n);
    return page.evaluate(() => {
      let stamped = 0, casting = 0;
      for (const root of [window.__snail.race.group]) {
        root.traverse((o) => { if (o.userData.gfxCast) { stamped++; if (o.castShadow) casting++; } });
      }
      return { stamped, casting };
    });
  };
  const off = await cast(1);      // SHADOW_CAST[0] is false
  expect(off.stamped, 'props on a course carrying the cast flag').toBeGreaterThan(50);
  expect(off.casting, 'props still casting with the row at its bottom').toBe(0);
  const on = await cast(4);
  expect(on.casting, 'props casting with the row at four').toBe(off.stamped);

  // and the rebuild, which is the one with a timer in it: `requestRestage()` is
  // debounced by 150 ms, so the assertion waits past the debounce rather than
  // racing it - a test that read the stage a frame after the click would be
  // asserting the debounce is zero, which it is not and is not meant to be
  const before = await page.evaluate(() => window.__snail.stage.group.uuid);
  await page.evaluate(() => window.__snail.setGfx('props', 2));
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__snail.stage.group.uuid), 'the stable after a density row moved')
    .not.toBe(before);
  noErrors(errors);
});

test('the settings are the machine\'s and a preset survives a reload', async ({ context }) => {
  // Two pages in **one context**, and that is the whole of how the reload is
  // honest. An init script re-runs on every navigation, so a page armed with the
  // fixture's tier would stamp the fixture's tier back over whatever the game
  // had just saved, and the test would be asserting that `gfxSave()` ran and not
  // that the value survived. The second page seeds the save and nothing else, so
  // the tier it boots into is the one the first page left in `localStorage`.
  const first = await context.newPage();
  const { errors } = await boot(first);
  await first.evaluate(() => window.__snail.setGfx('distance', 4));
  expect(await first.evaluate(() => JSON.parse(localStorage.getItem('snail-grand-prix-gfx-v1')).distance),
    'the row was written on the change, not on a real event').toBe(4);

  const second = await context.newPage();
  await boot(second, { gfx: null });
  const gfx = await second.evaluate(() => window.__snail.gfx);
  expect(gfx.distance, 'draw distance after a reload').toBe(4);
  // and the preset row is derived, so moving one row off the ladder's value says
  // `mixed` rather than carrying the level it was on
  expect(gfx.preset, 'the preset after one row was moved').toBe(0);
  // which is also what makes it honest to read the *ladder* for whether the
  // chain is wanted: the stored preset says 0 and the answer says otherwise
  expect(gfx.needsComposer, 'bottom preset, 1x render scale, no chain').toBe(false);
  expect(errors).toEqual([]);
  noErrors(errors);
});
