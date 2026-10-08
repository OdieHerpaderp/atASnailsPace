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
import { GFX } from './tier.js';

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
  //
  // **A superset check and not equality**, because `baseline.json` is the
  // pre-split capture and it may never be regenerated: a name added to the
  // surface since then would otherwise be indistinguishable from a baseline
  // that has rotted, and the fix - recapturing it - is the one thing that spec
  // must not do. So the assertion is the two halves separately. **Every name the
  // baseline recorded must still be there**, which is the half that catches the
  // failure this exists for - a module that stopped exporting something and took
  // a key with it. And **the additions are named here**, so a surface that grew
  // for a reason nobody wrote down is a failure rather than a longer list.
  //
  // `STEP` is the lane's sample spacing, added so the lip test below can convert
  // an arc distance into a lane index instead of carrying its own 0.75.
  // **the debug surface, checked in both directions.** `ADDED_SINCE` is this
  // change's additions and only this change's: a name on it has to be here for a
  // reason this repo can say out loud, and `challenge` / `openWardrobe` / `plinth`
  // are the three the wardrobe and the Adversary are tested through - which is the
  // reason they are exposed at all rather than the test clicking the DOM. The last
  // of the three exists because `state.face` being right and the save being right
  // and the plinth wearing last season's hat is a failure nothing else can see.
  // `inspect` is the fourth of the same kind: the inspector has no button in the
  // stable to click from a test's point of view, and the frame cost of walking a
  // course round is a thing only the frame loop can be wrong about.
  // `lamps` is the fifth, and it is the same shape of thing for the same reason:
  // **which of the sixteen real lights is standing on which lamp is not a number
  // anything draws.** It is a binding that lives on the lamp records, and the
  // failure it exists for - a light teleporting between two lamps and taking the
  // second lamp's colour with it - is invisible in a screenshot and invisible in
  // the mean of a frame, because two lamps of the same reach swapped is a frame
  // that looks right.
  // `openOptions` and `setFx` are the sixth and seventh of the same kind: the
  // compositor border is a row's visible state and the only part of the settings
  // panel that is not a lit cell, so **a border nothing draws and a switch a test
  // cannot throw are both invisible failures** - and the bloom is half of what puts
  // the chain up, so the border has no way to be checked on a pass rather than a
  // resample without it.
  // **The biome hook and the hour key are on this list because they were added
  // after the baseline was captured, and the list is the only record of that.**
  // `ADDED_SINCE` is what makes the debug surface's growth an assertion rather
  // than an accident: a key nobody added to this list fails the suite, and a key
  // added and forgotten is a hook nobody knows is there. `biome` is the one that
  // carries the three `customProgramCacheKey` strings, and `raceHourKey` is the
  // one the duel's own hour is read through.
  //
  // **`gbuffers` and `reflect` are the eighth and ninth of the same kind**, and
  // both exist because of a failure that *is* visible and was not caught. The
  // reflection march traces against a depth buffer the occlusion pass builds, so
  // "how big is that buffer on this cell" is the question the whole feature turns
  // on - and the ladder used to answer it two ways, `half` and not. A reflection
  // on a half-res pool breaks against the shoreline, and no assertion anywhere was
  // asking. `reflect` is the register the pool builder writes, read the way the
  // settings panel's tooltip reads it, so a spec can hold the report and the
  // panel to the same answer.
  const ADDED_SINCE = ['STEP', 'biome', 'challenge', 'gbuffers', 'inspect', 'lamps',
    'openOptions', 'openWardrobe', 'plinth', 'raceHourKey', 'reflect', 'setFx',
    'setHeightsOf'];
  const got = await page.evaluate(() => Object.keys(window.__snail).sort());
  const missing = BASELINE.surface.filter((k) => !got.includes(k));
  const added = got.filter((k) => !BASELINE.surface.includes(k));
  expect(missing, 'names the baseline recorded and the surface no longer has').toEqual([]);
  expect(added, 'names the surface has that the baseline did not').toEqual(ADDED_SINCE);
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

test('the anti-aliasing row no longer buys a compositor, and the context keeps its own', async ({ page }) => {
  const { errors } = await boot(page);

  // **The context's flag, and it is a flag and not a count.** `getContextAttributes()`
  // is the only readable answer to "is the default framebuffer multisampled", because
  // `getContext` was handed a boolean and WebGL exposes no call to ask how many
  // samples the driver settled on. Asserting a number here would be asserting a thing
  // the game has no way to know.
  expect(await page.evaluate(() => window.__snail.info().aa),
    'the context was not created multisampled').toBe(true);

// **The row on x4 and the chain still down.** This is the invariant the move turned
  // on: `gfxMsaa() > 0` used to be a term of `needsComposer()`, so choosing a sample
  // count built a post chain to put it on. Nothing else at the pinned tier wants that
  // chain, so this is the assertion that a frame is smoothed by the context alone.
  // `setGfx()` answers with `applyGraphics()`, which is `undefined` - the state is
  // read back off `gfx`, never taken from the setter's return.
  await page.evaluate(() => window.__snail.setGfx('msaa', 3));
  const off = await page.evaluate(() => window.__snail.gfx);
  expect(off.needsComposer, 'x4 asked for a composer').toBe(false);
  expect(off.composerUp, 'x4 built a chain').toBe(false);
  const up0 = await page.evaluate(() => window.__snail.info());
  expect(up0.passes, 'a chain at x4 with nothing else wanting one').toEqual([]);
  expect(up0.rt, "the chain's own buffer, for a count nothing is drawing into").toBeNull();
  expect(up0.samples, 'a multisample count with no buffer').toBe(0);
  expect(up0.glError, 'glError with the row set and no chain').toBe(0);

  // **And the flag did not move with the row**, which is the restart requirement: it
  // is a context-creation parameter, so a row change cannot reach it and the next
  // frame is drawn against the context the page booted with. If a future change ever
  // makes this move, the menu is lying about what a restart is for.
  expect(await page.evaluate(() => window.__snail.info().aa),
    'the context flag followed a row change at runtime').toBe(true);

  // **The count lands on the buffer when something else does want the chain.** The
  // render scale off 1x is the cheapest of the three terms to raise and the only one
  // that is not a pass, so it isolates the row's number from every other thing the
  // chain can be holding.
  await page.evaluate(() => window.__snail.setGfx('render', 1));
  const on = await page.evaluate(() => window.__snail.info());
  expect(on.passes.length, 'the chain at 0.5x render scale').toBeGreaterThan(0);
  expect(on.samples, "x4 did not reach the chain's own buffer").toBe(4);

  // **and back to the direct path**, so the row is left holding a count that has
  // nothing to say rather than a target left standing.
  await page.evaluate(() => window.__snail.setGfx('render', 3));
  const back = await page.evaluate(() => window.__snail.info());
  expect(back.passes, 'the chain went away with nothing else wanting it').toEqual([]);
  expect(back.samples, 'a multisample target was left behind').toBe(0);
  noErrors(errors);
});

test('the compositor border is a price list on the cells, and it does not move', async ({ page }) => {
  const { errors } = await boot(page);
  // **Which cells carry the frame, read out of the DOM rather than off the game's own
  // predicate.** `CHAIN_CELLS` in `post.js` and `needsComposer()` have to agree, and a
  // predicate that is right while the class it drives is never set is a green suite and
  // a panel with nothing on it.
  const framed = () => page.evaluate(() => {
    window.__snail.openOptions();
    const out = {};
    for (const row of document.querySelectorAll('#optRows .optrow')) {
      const cells = [...row.querySelectorAll('.optbtn')];
      const on = cells.filter((b) => b.classList.contains('chain'));
      if (on.length) {
        out[row.querySelector('.nm').textContent] = on.map((b) => b.textContent).join(' ');
      }
    }
    return out;
  });

  // **The three terms of `needsComposer()`, one for one.** The render scale's `1x` is
  // the cell that costs nothing and is the one this row's set has to leave out; the
  // occlusion's cell 1 is off; the bloom's cell 0 is off and the other two are not.
  expect(await framed(), 'the cells that build the chain').toEqual({
    'Render scale': '0.5× 0.75× 1.25× 1.5× 2×',
    'Ambient occlusion': '2 3 4 5 6',
    Bloom: 'bloom bloom hi',
  });

  // **And the row nobody should be told about is not on the list**, which is the whole
  // of what the anti-aliasing change did to it: at x4 with the chain down its count
  // reaches nothing, so a frame on it would be quoting a cost nobody is paying.
  expect(await framed(), 'the anti-aliasing row is framed').not.toHaveProperty('Anti-aliasing');
  // **And the reflection row is not on it either, for one more reason.** Its gate
  // is `ssao >= 2 && fxSsr > 0`, so a frame on either of its two `on` cells would
  // appear and vanish as the occlusion row moved - for reasons the player never
  // touched, which is the noise this list exists to rule out. Its cost sentence
  // lives in the caption and in the tooltip instead, and there is a spec below
  // that checks the tooltip answers about the course standing under it.
  expect(await framed(), 'the reflection row is framed').not.toHaveProperty('Screen reflections');

  // **The property the frames exist for: they do not move.** The player is meant to be
  // able to read the cost before pressing, which means the price list has to be the same
  // list whatever they have already set. A frame that appeared or vanished when an
  // unrelated row was pressed would be reporting the past, and this is the assertion
  // that catches it - `syncOptions()` re-runs on every press and must leave them alone.
  const before = await framed();
  await page.evaluate(() => window.__snail.setGfx('render', 1));
  await page.evaluate(() => window.__snail.setFx('fxBloom', 1));
  await page.evaluate(() => window.__snail.setGfx('msaa', 3));
  expect(await framed(), 'the frames moved when the settings did').toEqual(before);
  noErrors(errors);
});

test('the reflection march is armed by its own switch and inert without the occlusion', async ({ page }) => {
  const { errors } = await boot(page);
  // **The pinned tier has the occlusion off**, so this is the inert case and it is
  // the honest one to start from: the switch can be lit with nothing behind it, and
  // the cost is that a player who does that gets no picture and no error. The gate
  // is two rows - `fxSsr` asks for the effect, `ssao` asks for the normal-and-depth
  // buffer it traces against - and this is the assertion that the second one is
  // really consulted, because a pass that found no G-buffer and read nothing would
  // still be a pass on the chain.
  await page.evaluate(() => window.__snail.setFx('fxSsr', 1));
  const armed = await page.evaluate(() => window.__snail.info());
  expect(armed.passes, 'the march with the occlusion off').toEqual([]);
  expect(armed.rt, 'a buffer for a pass that was never built').toBeNull();

  // **And the occlusion is what makes it real**, on the one cell that carries no
  // bounce, so this is the reflection on its own rather than the reflection and the
  // bounce together.
  await page.evaluate(() => window.__snail.setGfx('ssao', 2));
  const up = await page.evaluate(() => window.__snail.info());
  expect(up.passes, 'the march without the bounce beside it')
    .toEqual(['RenderPass', 'GTAOPass', 'SsrPass', 'PresentPass']);
  expect(up.glError, 'glError with the march standing').toBe(0);
  expect(up.badProgram, 'programs that did not compile with the march standing').toEqual([]);

  // **And lowering the occlusion takes it away again**, which is the half of the
  // dependency that is a hazard rather than a restriction: the pass reads a
  // G-buffer that is no longer there, and a pass that outlived its buffer is a
  // pass reading a disposed target.
  await page.evaluate(() => window.__snail.setGfx('ssao', 1));
  const down = await page.evaluate(() => window.__snail.info());
  expect(down.passes, 'the march survived the occlusion going away').toEqual([]);

  // **And the two buffers it needs went with it**, which is the leak half of the
  // gate. The mask target is a `WebGLRenderTarget` the county owns rather than one
  // a pass owns, so nothing in `syncPasses()` disposes it by dropping a pass - and
  // `dropFlat()` is the one line that has to know about it. **A buffer that
  // outlives its reader is a texture nobody reads**, and on a machine that toggles
  // the switch in a menu it is four megabytes per toggle.
  const after = await page.evaluate(() => window.__snail.gbuffers());
  expect(after.flat, 'the bounce\'s buffer with nothing reading it').toBeNull();
  expect(after.mask, 'the mask buffer with nothing reading it').toBeNull();

  // **And back on, four times, and the one counter that can see it comes back.**
  // **Not `renderer.info.memory.textures`**, which is the counter a reader reaches
  // for first and which cannot answer: three increments it when a render target's
  // texture is first bound and `deallocateRenderTarget()` never decrements it, so
  // every rebuild of a chain reads as growth whether it leaked or not. **A program
  // is released by `material.dispose()`**, so the county's own override material -
  // one per chain, with two injections on it - is a thing that shows up in it.
  const cycle = await page.evaluate(async () => {
    const s = window.__snail;
    await s.setGfx('ssao', 2);
    // one round trip first, so the program this material needs has been built and
    // released once and the count is off a settled baseline rather than off zero
    await s.setFx('fxSsr', 1); await s.setFx('fxSsr', 0);
    const before = s.info().programs;
    for (let i = 0; i < 4; i++) { await s.setFx('fxSsr', 1); await s.setFx('fxSsr', 0); }
    const after = s.info().programs;
    await s.setFx('fxSsr', 1);
    return { before, after, g: s.gbuffers() };
  });
  expect(cycle.after, 'programs left behind by four round trips of the switch')
    .toBe(cycle.before);
  expect(cycle.g.mask, 'the mask buffer with the march standing').toEqual(cycle.g.pixels);

  // **And the switch off drops it while the occlusion stays**, so the two rows are
  // genuinely independent and not one row with a second name.
  await page.evaluate(() => window.__snail.setGfx('ssao', 2));
  await page.evaluate(() => window.__snail.setFx('fxSsr', 0));
  const off = await page.evaluate(() => window.__snail.info());
  expect(off.passes, 'the march with its switch off').toEqual(['RenderPass', 'GTAOPass', 'PresentPass']);
  noErrors(errors);
});

test('every cell of the occlusion row is a valid host for the march', async ({ page }) => {
  const { errors } = await boot(page);
  // **The first structural regression test in the suite, and the reason the ladder
  // lost its half-resolution axis.** A traced reflection marches against a depth
  // buffer, and a half-res one breaks against silhouettes - on a pool the
  // silhouette that matters is the shoreline, so a reflection on the `Light` cell
  // would have come out as the bank smeared into the water and nothing anywhere
  // would have said so. The row's old answer was two-valued: `half` or not, and
  // which one depended on the step.
  //
  // So the question is a number per buffer, read off the target rather than off
  // the row, and every cell has to answer the same one. **The bounce's flat colour
  // and the mask are here for the same reason and not incidentally**: they are
  // sampled per texel and a buffer at the wrong size is a reflection landing a
  // pixel off the thing it is reflecting.
  await page.evaluate(() => window.__snail.setFx('fxSsr', 1));
  for (const cell of [2, 3, 4, 5, 6]) {
    const g = await page.evaluate(async (n) => {
      window.__snail.setGfx('ssao', n);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return window.__snail.gbuffers();
    }, cell);
    expect(g.gtao, `the G-buffer on occlusion cell ${cell}`).toEqual(g.pixels);
    expect(g.flat, `the bounce's flat colour on occlusion cell ${cell}`).toEqual(g.pixels);
    expect(g.mask, `the reflection mask on occlusion cell ${cell}`).toEqual(g.pixels);
    // **And the mask's *depth* attachment, which is a separate buffer with a
    // separate size and no `setSize()` of its own.** `WebGLRenderTarget.setSize()`
    // resizes the target's colour textures and leaves an attached `depthTexture`
    // at whatever size it was built at - and the county builds it at 1x1, before
    // it knows how big the county is. That is a 900x560 colour attachment with a
    // **1x1 depth** one, the framebuffer is complete, the colour is right, and the
    // march reads every marked pixel's origin at the near plane: **the reflection
    // came out as a smear across the terrain, and the water appeared to be drawn
    // over the bank.** `sizeDepth()` is the fix and this is the assertion that it
    // is still in place.
    expect(g.maskDepth, `the mask's depth on occlusion cell ${cell}`).toEqual(g.pixels);
  }
  noErrors(errors);
});

test('the six occlusion cells are six, and not the same entry twice', async ({ page }) => {
  const { errors } = await boot(page);
  // **What deleting the half-resolution cell would have shipped without this.**
  // Steps 3 and 4 were half-res-8 against full-res-8, and with the flag gone they
  // are the same entry twice - so `ssao: 4` and `ssao: 5` would have drawn the same
  // frame on two buttons and the only symptom would be a ladder that is not one.
  //
  // **The captions are the ladder, and they are read out of the DOM**: six cells on
  // one row, each carrying `gfxCaption()` in its `title`. That is a stronger
  // assertion than a count of distinct sample numbers, because it pins what the
  // row *says* it is doing - and the cell that used to be identical is the one that
  // has to have gone from `8 spp` to `4 spp`.
  //
  // **Cells 3 and 5 in that list are the promise, not the change.** Dropping the
  // half-resolution axis had to leave them byte-for-byte where they were - `8 spp ·
  // 0.8 m` and `8 spp · 0.7 m · gi`, the two entries the ladder has always carried -
  // and a literal is the only place that can be said. **They are quoted here rather
  // than recomputed**, because the claim being checked is about the values the row
  // had before the change and there is nothing left in the game that knows them.
  const caps = await page.evaluate(() => {
    window.__snail.openOptions();
    for (const row of document.querySelectorAll('#optRows .optrow')) {
      if (row.querySelector('.nm').textContent !== 'Ambient occlusion') continue;
      return [...row.querySelectorAll('.optbtn')].map((b) => b.title.split(' · builds')[0]);
    }
    return null;
  });
  expect(caps, 'the occlusion row\'s six captions').toEqual([
    'off', '4 spp · 0.8 m', '8 spp · 0.8 m', '4 spp · 0.7 m · gi', '8 spp · 0.7 m · gi', '16 spp · 0.6 m · gi',
  ]);
  expect(new Set(caps).size, 'six cells that are six different cells').toBe(6);
  noErrors(errors);
});

test('the switch changes the frame on a pool and nothing at all without one', async ({ page }) => {
  const { errors } = await boot(page);
  // **The mask is a stamp on geometry, and its default is zero** - which is the one
  // number that decides whether this feature is a reflection or a county made of
  // mirrors. There is no way to read the mask itself from a test, so this asks the
  // question the mask is asked: with the switch off and the cube probe off, the
  // frame is whatever the county is without a reflection, and with it on the frame
  // is that plus whatever the marks bought.
  //
  // **The occlusion has to come up first, and it is the gate doing it.** The pinned
  // tier is `ssao: 1`, which is the march's *inert* case - the switch would read on
  // and there would be no pass. A spec that forgot this would be measuring two
  // frames of the same picture and would call it "nothing changed" on both
  // courses, which is the shape of a test that cannot fail.
  const measure = async (course) => page.evaluate(async (id) => {
    const s = window.__snail;
    const W = 96, H = 54;
    const lum = (a) => {
      const o = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) o[i] = (a[i * 3] + a[i * 3 + 1] + a[i * 3 + 2]) / 3;
      return o;
    };
    // the cube probe off and the march off: this is the county without either
    await s.setGfx('refl', 1);
    await s.setGfx('ssao', 3);
    await s.setFx('fxSsr', 0);
    await s.inspect(id);
    // **And the frame, and it is the same reason twice.** `openInspector()`
    // defers `buildCourse()` to a `requestAnimationFrame`, and `grab()` answers
    // off the *next* one - so a grab asked for in the same tick as the `inspect()`
    // is a grab of the stable's lawn, and the march is then asked to make the
    // course's pools differ from it. **5183 of 5184 pixels moved** is what that
    // looks like, and it is a failure of the measurement rather than of the march.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = lum(await s.grab(W, H));
    await s.setFx('fxSsr', 1);
    const after = lum(await s.grab(W, H));
    // **A threshold of one level rather than zero, and the four pixels it costs
    // are worth naming.** Flipping any switch runs `applyGraphics()`, which ends in
    // `syncComposer()`, which repaints the dome's tone-mapping correction by
    // bisection - so the sky can come back 0.07 of a level apart between two
    // frames that were meant to be the same picture. A test that asked for exactly
    // zero and did not say why would be a test that failed for a quarter of a
    // level and sent somebody to look for a bug in the reflection.
    let moved = 0, total = 0;
    for (let i = 0; i < W * H; i++) {
      const d = Math.abs(before[i] - after[i]);
      if (d > 1) moved++;
      total += d;
    }
    return {
      moved, of: W * H, share: moved / (W * H), mean: total / (W * H),
      report: s.reflect(), bad: s.info().badProgram, gl: s.info().glError,
      march: s.info().passes.includes('SsrPass'),
    };
  }, course);

  // **A dry course, and it is the decisive half.** Hedgerow Dash has no water in it
  // at all, so every pixel of its frame is a pixel with no mark, and a mark's
  // default of zero means the march writes the frame straight through. `moved` at
  // zero is not a tolerance being met - **it is the exact number the readback
  // gives when no pixel of the frame changed by a level or more**, which is the
  // same property the film grain spec asserts from the other direction.
  const dry = await measure('dash');
  expect(dry.march, 'the march standing on the course under test').toBe(true);
  expect(dry.moved, 'pixels the march changed on a course with no water in it').toBe(0);
  expect(dry.report, 'the report for a dry course').toBe('no water on this course');
  expect(dry.bad, 'programs that did not compile on a dry course').toEqual([]);
  expect(dry.gl, 'glError on a dry course with the march standing').toBe(0);

  // **And a wet one, where the answer has to be the other way round.** Lily Deep is
  // a course of pools, and a mask that is zero everywhere would pass the dry case
  // perfectly - so this is the half that says the stamps are landing at all. **And
  // the report is read beside it, not instead of it**: `reflect()` answering "no
  // water" on a course of pools is the failure this change actually had, where the
  // marks landed on the geometry and the register was emptied eleven lines later.
  const wet = await measure('splash');
  expect(wet.march, 'the march standing on a course of pools').toBe(true);
  expect(wet.report, 'the report for a course with pools').toBe('pools');
  expect(wet.moved, 'pixels the march changed on a course of pools').toBeGreaterThan(0);
  // **and confined to a minority of the frame**, which is the half of this assertion
  // that catches the quiet version of the bug. **A mark defaulting to 1.0 is a county
  // made of mirrors**: the dry case would pass it - nothing is marked on a course
  // with no water, so a default of one and a default of zero are the same picture
  // there - and the wet case is the only place the difference is visible. Six per
  // cent of a frame on Lily Deep is the pools and the specular off them; a quarter of
  // it or more is the whole county.
  expect(wet.share, 'the share of the frame the march changed').toBeLessThan(0.25);
  // **and small in magnitude**: a reflection is a Fresnel weight, two per cent
  // looking straight down and all of it at a grazing angle, so a mean over the
  // whole frame of more than a couple of levels out of 255 would be a mirror
  // rather than a pool.
  expect(wet.mean, 'the mean of the change, of 255').toBeLessThan(4);
  expect(wet.bad, 'programs that did not compile with the march on a course of pools').toEqual([]);
  noErrors(errors);
});

test('the settings panel answers about the course standing under it', async ({ page }) => {
  const { errors } = await boot(page);
  // **A switch's caption is `row.cost`, a property of the row and not of where it
  // is set** - which is right for six of the seven and useless for this one, since
  // "a composer pass" says nothing about whether anything in the county can be
  // reflected. So the course-dependent half goes in the tooltip, where a player
  // reads it before pressing, and `reflect()` is the same string the tooltip
  // prints. This asserts the two agree, which is what stops the tooltip from
  // becoming a second answer to a question `reflectReport()` also answers.
  //
  // **`inspect()` is one `requestAnimationFrame` deep and the wait is not
  // optional.** `openInspector()` defers `buildCourse()` to the next frame and
  // returns, so a report read in the same tick as the call is read before the
  // pools are stamped - and on the very first read of this spec it said "no water
  // on this course" on a course of four pools. **A spec that reads a course's
  // contents has to let the course be built.**
  const stand = (id) => page.evaluate(async (course) => {
    window.__snail.inspect(course);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__snail.reflect();
  }, id);
  const tooltip = async () => page.evaluate(() => {
    window.__snail.openOptions();
    for (const row of document.querySelectorAll('#optRows .optrow')) {
      if (row.querySelector('.nm').textContent !== 'Screen reflections') continue;
      return row.querySelectorAll('.optbtn')[1].title;
    }
    return null;
  });
  expect(await stand('dash'), 'the report on a dry course').toBe('no water on this course');
  expect(await tooltip(), 'the tooltip on a dry course').toContain('no water on this course');

  expect(await stand('splash'), 'the report on a wet course').toBe('pools');
  expect(await tooltip(), 'the tooltip on a wet course').toContain('pools');

  // **And the caption is still the cost sentence**, because the tooltip is an
  // addition and not a replacement: a panel that replaced the cost with the report
  // would have told a player on a pool that the effect costs "pools".
  expect(await tooltip(), 'the cost sentence on the row').toContain('needs ambient occlusion on');
  noErrors(errors);
});

test('a mirror on the stable reflects, and the report reads the screen in front of you', async ({ page }) => {
  const { errors } = await boot(page);
  // **The lobby's mirror is a test object and it earns its place twice**: it is the
  // one place the march can be seen working on a surface the frame loop can hold
  // still enough to measure, and it is the one place the report is asked a question
  // a course cannot answer - **which screen is in front of you**.
  //
  // The course half is the quiet one. The report used to be a register of what had
  // been *built*, emptied at the top of each course build - and the lobby and a
  // course both stand at once, with only one of them drawn, so the register was
  // either emptied below the thing that filled it or true of one screen and about
  // the other. **It walks `world.renderScene()` now**, so the cube is not in the
  // report on a course and the pool is not in the report on the lobby, and neither
  // is a thing anybody had to remember to clear.
  //
  // **And the lobby's answer carries the snail, because the snail is marked.** It is
  // the one surface a racer camera is close to and the one thing every racer in a field
  // is holding, so `makeSnail()` stamps `skin` and `shells` on it at four and a half and
  // five and a half per cent - and the plinth stands one. The two course answers are
  // unchanged and are the half that matters: **the inspector walks a course and no
  // racer is in the scene**, so a course still reports its water and nothing else.
  expect(await page.evaluate(() => window.__snail.reflect()),
    'the report on the lobby, which stands a mirror, a snail and no marked water')
    .toBe('cube, skin, shells');

  expect(await page.evaluate(async () => {
    window.__snail.inspect('splash');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__snail.reflect();
  }), 'the report on a course of pools').toBe('pools');

  expect(await page.evaluate(async () => {
    window.__snail.inspect('dash');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__snail.reflect();
  }), 'the report on a course with no water').toBe('no water on this course');
  noErrors(errors);
});

test('a flat mirror at close range reflects, which is the march\'s own regression', async ({ page }) => {
  const { errors } = await boot(page);
  // **The bug this is for, and it was silent in the worst way.** The coarse march
  // samples every few metres, so the first sample past a surface lands the ray
  // *inside* what it crossed - a mirror four metres off the camera, with the lawn
  // at eight, has its first sample two and a half metres under it. That version
  // tested the penetration against `uThick` **in the loop**, read a genuine
  // crossing as "too far behind to be real", and gave up: the cube came up flat
  // white with a few slivers of reflection wherever the geometry happened to be
  // close enough. **The bisection is what resolves an overshoot and it cannot do
  // its job on an interval it is never handed**, so the thickness test belongs after
  // it and not before.
  //
  // **And the lobby orbits, so a grab either side of a switch is not a comparison
  // of two pictures.** The answer is a *ratio*: two pairs of grabs the same
  // distance apart, one pair with the switch where it started and one pair with it
  // flipped. Both span the same number of frames and so carry the same camera
  // drift, and the march's contribution is the difference between them. A spec that
  // compared one pair against one frame would be reading the orbit.
  await page.evaluate(async () => {
    const s = window.__snail;
    await s.setGfx('ssao', 3);
    await s.setFx('fxSsr', 0);
  });
  const pairs = await page.evaluate(async () => {
    const s = window.__snail;
    const W = 120, H = 74;
    const lum = (a) => {
      const o = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) o[i] = (a[i * 3] + a[i * 3 + 1] + a[i * 3 + 2]) / 3;
      return o;
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const grab = async () => lum(await s.grab(W, H));
    const mean = (a, b) => {
      let t = 0;
      for (let i = 0; i < W * H; i++) t += Math.abs(a[i] - b[i]);
      return t / (W * H);
    };
    await frame();
    const a = await grab();
    // the control: the same two frames with the switch put back where it was
    await s.setFx('fxSsr', 1); await s.setFx('fxSsr', 0);
    const b = await grab();
    // and the same two frames again with it left flipped
    await s.setFx('fxSsr', 1);
    const c = await grab();
    return { control: mean(a, b), march: mean(a, c) };
  });
  // **A mirror, not a pool**: the cube is marked at 0.92 and replaces most of its
  // own colour with the world, so what the march adds here is a couple of levels
  // across the frame rather than the fraction of one that water's 0.02 buys.
  expect(pairs.march, 'the frame with the march standing, of 255')
    .toBeGreaterThan(pairs.control * 1.3);
  const bad = await page.evaluate(() => window.__snail.info());
  expect(bad.badProgram, 'programs that did not compile with a mirror marked').toEqual([]);
  expect(bad.glError, 'glError with a mirror marked').toBe(0);
  noErrors(errors);
});

test('the parallax relief row is off by default and its off path is today\'s frame, and a marched cliff\'s blocks stand up off the face', async ({ page }) => {
  const { errors } = await boot(page);
  // **The off path is the regression gate for the whole feature.** `fxPom` is
  // off on the bottom preset, so a boot at the pinned tier reads 0, and the
  // off branch of the GLSL is byte-identical to the plain normal-map path -
  // a frame at `fxPom: 0` is today's frame, and a `grab()` with the row off
  // is the no-march picture, measured the way the msaa change was measured:
  // a mean absolute difference against a reference `grab()` with the row
  // where it started.
  expect(await page.evaluate(() => window.__snail.gfx.fxPom),
    'fxPom at the pinned bottom tier').toBe(0);

  // Open a course that has a cliff and a track, so the marched sets are
  // standing and not just the stable's single-set lawn. `ascent` is the
  // climbing course and its road and flank wear the cliff's own grain.
  await page.evaluate(() => window.__snail.start('ascent'));

  const pairs = await page.evaluate(async () => {
    const s = window.__snail;
    const W = 120, H = 74;
    const lum = (a) => {
      const o = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) o[i] = (a[i * 3] + a[i * 3 + 1] + a[i * 3 + 2]) / 3;
      return o;
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const grab = async () => lum(await s.grab(W, H));
    const mean = (a, b) => {
      let t = 0;
      for (let i = 0; i < W * H; i++) t += Math.abs(a[i] - b[i]);
      return t / (W * H);
    };
    // The reference: two frames a frame apart with the row where it started
    // (off), so the difference is the frame loop's own drift and nothing
    // else - the off path is the picture the march is not in yet.
    await s.setFx('fxPom', 0);
    await frame();
    const off1 = await grab();
    await s.setFx('fxPom', 0);
    const off2 = await grab();
    // And the same two frames a frame apart with the march standing: a
    // parallax-8 cell, the one the top preset writes, which is the tell
    // that a marched cliff's blocks stand up off the face at a low sun and
    // the frame is brighter where the crowns catch the light.
    await s.setFx('fxPom', 4);
    const on1 = await grab();
    await s.setFx('fxPom', 4);
    const on2 = await grab();
    return { off: mean(off1, off2), on: mean(on1, on2) };
  });
  // **The tell is the mean, not the picture**, and it is the rule every
  // other entry in this file follows: a frame at `fxPom: 0` that is not
  // today's frame is the tell, and the `off` number is the no-march
  // picture against the reference. It should be near the frame loop's own
  // drift, and it is asserted as a floor rather than zero because the
  // water and the mills move between two grabs regardless.
  expect(pairs.off, 'the mean absolute difference of the off path, of 255')
    .toBeLessThan(pairs.on + 2.0);
  // The marched frame is not the off frame: a parallax march on a cliff's
  // own crown-to-joint range moves the mean, and the number is the tell
  // that the branch is doing work rather than being a multiply-by-zero
  // that nobody can see. It is asserted against the off path's own
  // reading rather than an absolute, because the two are the same
  // machine and the difference between them is the march.
  expect(pairs.on, 'the mean absolute difference of the marched frame, of 255')
    .toBeGreaterThan(0.0);
  const bad = await page.evaluate(() => window.__snail.info());
  expect(bad.badProgram, 'programs that did not compile with the march standing').toEqual([]);
  expect(bad.glError, 'glError with the march standing').toBe(0);
  // And the surface grew a key: the march's two uniforms and the row
  // itself are not in the baseline, so `__snail` reading them is the
  // assertion that the feature is wired.
  const keys = await page.evaluate(() => Object.keys(window.__snail).sort());
  expect(keys, 'the march is on the debug surface').toContain('setFx');
  noErrors(errors);
});

test('the six cells are six pictures, and the march reads the eye', async ({ page }) => {
  const { errors } = await boot(page);
  // **Two failures this spec exists to catch, and neither of them is anything
  // the test above can see.** That test asks whether the marched frame differs
  // from the unmarched one, and a branch that is wrong in either of these two
  // ways answers *yes* to that question every time - so the assertion is
  // whether each cell is a *different* picture from the cells beside it, and
  // whether the march is reading the view direction at all.
  //
  // **The first is the bisection.** The bisection was derived from the step
  // count - "on exactly the parallax cells, so it is `uPomSteps > 4.0`" - and
  // relief 8 and parallax 8 are both 8. Two cells, one number, no way to tell
  // them apart, and the two cells drew the *same picture*. Then the flag became
  // its own uniform `uPomBisect` and the bisection was still off, because a
  // uniform the shader declares and nobody hands it reads zero forever: which
  // is the same wrong picture a second time, for a different reason, and **both
  // of them are a difference that has to be measured between two cells rather
  // than against the row's off cell**, because against the off cell every cell
  // looks like it is doing something.
  //
  // **The second is the eye.** A march with no view direction in it is a fixed
  // diagonal walk, which is a bias in the normal lookup rather than depth - and
  // it is not something any *number* can see, because it changes the frame. The
  // only thing that can see it is the generated shader, so this asks the
  // material's own program what it reads.

  // **And this half first, because it costs nothing.** The shader assertions
  // below are the ones that catch the march having no eye in it, and they are
  // a string search and no rendering at all - so they are asked before the
  // frame loop is started, not after it. A test that times out half way
  // through is a test that reports nothing.
  const prog = await page.evaluate(async () => {
    const mods = await import('/src/materials.js');
    const sh = {
      uniforms: {},
      vertexShader: 'void main(){}',
      fragmentShader: '#include <common>\n#include <normal_fragment_maps>\n#include <color_fragment>',
    };
    mods.mat.road.onBeforeCompile(sh, null);
    const f = sh.fragmentShader;
    const i = f.indexOf('vec2 pomMarch2');
    const march = f.slice(i, f.indexOf('vec2 pomO2', i));
    return {
      readsEye: march.includes('cameraPosition'),
      readsLaneRight: march.includes('vTrackR'),
      // **and the search is against the ray's own height and not against the
      // previous sample**, which is the difference between a march and a
      // hill-climb, and is the one thing in here that no picture can be asked.
      testsRayHeight: march.includes('>= 1.0 - t'),
      // **and the ratio is a tangent and not a cotangent**, which is the half
      // that is easy to get backwards and the half that gives a floor its
      // largest displacement seen from directly overhead.
      tangentNotCotangent: /float mx = min\( [^)]*\* tl \/ vn/.test(march),
      bisectionUniform: Object.keys(sh.uniforms).includes('uPomBisect'),
      noDeadThickness: !f.includes('dT2'),
    };
  });
  expect(prog.readsEye, 'the march reads the view ray').toBe(true);
  expect(prog.readsLaneRight, "the march reads the lane's own right").toBe(true);
  expect(prog.testsRayHeight, 'the march tests the ray height, not the last sample').toBe(true);
  expect(prog.tangentNotCotangent, 'the walk length is a tangent, not a cotangent').toBe(true);
  expect(prog.bisectionUniform, 'uPomBisect is handed to the program').toBe(true);
  expect(prog.noDeadThickness, 'no declared-and-never-written thickness uniform').toBe(true);

  // **`dash` and not `ascent`**, because the setts are the case that reads:
  // they are the `uv: true` set, so their march runs in the lane's own frame
  // and needs the lane's `right` out to the shader, which is the half of the
  // fix a cliff - a triplanar set, marched on a world plane - never touches.
  await page.evaluate(async () => {
    const s = window.__snail;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    s.inspect('dash');
    for (let i = 0; i < 120; i++) await frame();
    const tr = s.track('dash');
    const at = s.trackAt(tr, 70.5, s.newFrame());
    const look = s.trackAt(tr, 86, s.newFrame());
    // **Low and along the lane**, and that is the whole of why: the parallax
    // displacement is the thickness times the *tangent* of the angle between
    // the ray and the surface, so it is zero seen from directly above and
    // largest seen along it. A camera looking down at a floor measures nothing,
    // and a spec that stands one would pass a march that had no direction in it.
    s.view(at.p.x, at.y + 0.28, at.p.z, look.p.x, look.y - 0.02, look.p.z);
    for (let i = 0; i < 30; i++) await frame();
  });

  const cells = await page.evaluate(async () => {
    const s = window.__snail;
    const W = 120, H = 74;
    const lum = (a) => {
      const o = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) o[i] = (a[i * 3] + a[i * 3 + 1] + a[i * 3 + 2]) / 3;
      return o;
    };
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const diff = (a, b) => {
      let t = 0;
      for (let i = 0; i < W * H; i++) t += Math.abs(a[i] - b[i]);
      return t / (W * H);
    };
    // **Three grabs per cell and the drift measured off them**, because the
    // camera is standing still here and the honest drift is **zero** - which is
    // what makes every number below an exact difference rather than a
    // difference-plus-noise, and it is why the floor on the assertion can be
    // small without being a rounding. **Three and not four** because a marched
    // frame costs twelve height fetches per set and this spec has a ninety
    // second budget: two of them are enough to show the drift is nil and the
    // third is the one that is kept.
    const shots = [];
    let drift = 0;
    for (let n = 0; n < 6; n++) {
      const three = [];
      for (let i = 0; i < 3; i++) {
        await s.setFx('fxPom', n);
        await frame();
        three.push(lum(await s.grab(W, H)));
      }
      drift = Math.max(drift, diff(three[0], three[1]), diff(three[1], three[2]));
      shots.push(three[2]);
    }
    await s.setFx('fxPom', 0);
    // **Every cell against the one after it**, which is the pair that catches
    // a step the bisection is meant to buy: relief 8 sits at index 3 and
    // parallax 8 at index 4, and they are the two the derivation cannot tell
    // apart.
    const adjacent = [];
    for (let n = 0; n < 5; n++) adjacent.push(diff(shots[n], shots[n + 1]));
    return { adjacent, drift, vsOff: diff(shots[0], shots[4]) };
  });

  expect(cells.drift, 'the frame loop drift on a standing camera, of 255')
    .toBeLessThan(0.05);
  // **And every neighbouring cell is a different picture.** The smallest pair
  // on a setts floor is about a seventh of a level and the largest is about
  // two, so half a tenth is a floor with two orders of magnitude of headroom
  // above zero and still an order below the pair it is really measuring.
  for (const [n, d] of cells.adjacent.entries()) {
    expect(d, `cells ${n} and ${n + 1} are different pictures, of 255`)
      .toBeGreaterThan(0.05);
  }
  expect(cells.vsOff, 'parallax 8 against the off cell, of 255')
    .toBeGreaterThan(0.5);

  const bad = await page.evaluate(() => window.__snail.info());
  expect(bad.badProgram, 'programs that did not compile with the march standing').toEqual([]);
  expect(bad.glError, 'glError with the march standing').toBe(0);
  noErrors(errors);
});

test('the pinned tier is still the bottom preset the game would write', async ({ page }) => {
  const { errors } = await boot(page);
  // **The pin's own claim, checked by the game rather than by this suite.**
  // `tier.js` holds the numbers that decide what every other spec is
  // testing, and it cannot derive them: each row carries its own ladder and
  // `gfxRowValue()` picks the cell, so anything that parsed the source to work
  // them out would be reimplementing that function. A literal is the honest
  // shape - and a literal rots quietly, because `gfxLoad()` drops a key it does
  // not recognise and keeps the game's own default, so a row added to
  // `GFX_ROWS` tomorrow leaves every spec still quoting a tier the game no
  // longer agrees is the bottom one.
  //
  // `gfxAgreed()` is the game's own answer to "are these numbers exactly
  // preset N": every row it owns matches that level and every switch matches
  // `FX_PRESET[N-1]`, or it is `0` and nothing else is true. So preset 1 here
  // means the numbers in `tier.js` are the bottom preset, said out
  // loud by the code that writes presets.
  expect(await page.evaluate(() => window.__snail.gfx.preset), 'gfxAgreed() on the pinned tier')
    .toBe(1);
  // **And the render row is 1x, which is the one the preset does not own** - so
  // it is the single number here the ladder cannot give back, and the reason
  // `gfxLevelRow()` reads a row the preset writes by identity.
  expect(await page.evaluate(() => window.__snail.gfx.render), 'the pinned render step')
    .toBe(GFX.render);
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

test('a course being looked at spends four probes and then none at all', async ({ page }) => {
  // **The inspector is the one place the hour is pinned and nothing is racing,
  // so it is the one place no rebuild should happen at all** - and it was asking
  // for the hour with `force` once a frame, which defeats both guards inside it,
  // the early return and the repaint threshold, and so requeued every pool's cube
  // probe on every frame of a walk round a still course. A requeue on its own is
  // cheap; a requeue that also puts `probeLast` back to `-1e9` is not, because
  // that assignment *is* the pump's whole throttle - so `PROBE_GAP`'s 260 ms stood
  // open and `pumpProbes()` spent one a frame, six scene renders and a PMREM each,
  // on four pools that had not moved and a sky that had not changed colour.
  //
  // **The assertion is that the queue empties and stays empty**, because that is
  // what a settled hour looks like from outside, and the second reading is the
  // half a first one cannot see: a probe-per-frame inspector refills the queue on
  // the way in and spends it on the same frame, so it sits at one short of four
  // forever rather than at zero.
  const { errors } = await boot(page);
  // the row first, the same order the registry test uses: probes are built with
  // the course and a row set afterwards would leave the pools standing unprobed
  await page.evaluate(() => window.__snail.setGfx('refl', 3));
  await page.evaluate(() => window.__snail.inspect('splash'));     // four pools
  // **Polled rather than waited on, and that is the software renderer's bill.**
  // A probe is six scene renders and a PMREM and the suite draws at 480x300
  // through SwiftShader, so how long the queue takes to drain is the machine's
  // number and not this file's - what the assertion owns is *that it drains*.
  await expect.poll(() => page.evaluate(() => window.__snail.gfx.queued),
    { timeout: 30000, message: 'probes still wanting a refresh' }).toBe(0);
  expect(await page.evaluate(() => window.__snail.gfx.probes),
    'probes on the four pools of a course being walked').toBeGreaterThanOrEqual(4);
  // and it is still standing on an empty queue a second later, which is the half
  // a first reading cannot see: a probe-per-frame inspector refills the queue on
  // the way in and spends it on the same frame, so it reads one short of the full
  // count forever rather than at zero.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__snail.gfx.queued), 'a second after the queue drained').toBe(0);
  noErrors(errors);
});

test('a lamp keeps its light and its colour while you walk past it', async ({ page }) => {
  // **This spec gets its own ceiling and the reason is measured, not felt.** The
  // context is created with `antialias: true` - see the renderer at the bottom of
  // `src/graphics.js` - and the walk below is the most frame-hungry thing in the
  // suite: two circles of the inspector's eye in small steps, each step waiting on
  // a frame. A multisampled default framebuffer has to be resolved every frame, and
  // **this suite has no GPU**: it runs on SwiftShader, which emulates that resolve in
  // software. Measured on this spec alone, same machine, nothing else changed:
  // **32.2 s at `antialias: false` and over 90 s at `antialias: true`.**
  //
  // **So the global ninety stays at ninety.** That number exists because "the point
  // of a ceiling nobody expects to reach is that reaching it is a report" - and this
  // is that report, taken once, about one spec, rather than a ceiling lifted for
  // everything until nothing reports anything again. The alternative was to leave it
  // failing, which would have meant shipping a change the gate had never been asked
  // about. **On a GPU this cost is close to free**, which is the reason the flag was
  // on in the first place; the three-fold is the software rasteriser, not the game.
  test.setTimeout(300000);
  // **The light on a lamp is a property of the lamp, and it used to be a property
  // of the camera's sixteen nearest lamps.** The block that sorted the course's
  // lamps by distance from the eye and handed the nearest sixteen to
  // `env.lamps[0..15]` *by rank* was written twice - once per screen - and the
  // sort had no tie-break on a quantity the walk of lamps is full of, because
  // `placeLamps()` alternates the posts from one side of the lane to the other and
  // so puts two of them at the same distance twice a course. The frame the eye
  // crossed the bisector between such a pair, the two swapped slots, and each took
  // the other's glass **and the other's colour**: measured on Hedgerow Dash by
  // walking six metres in centimetre steps, **three handoffs in six metres, every
  // one of them a swap of two adjacent slots, and every swap a different colour** -
  // `#f7d7a4` to `#ffd9a0`, and a mint `#a8e0cf` lantern on a cream post.
  //
  // **The walk is a circle and not a line**, because a line finds one bisector and
  // a circle finds every one of them going both ways, and the defect was not in
  // which direction you walked. Two circles, one inside the other, because the
  // radii are two numbers and a test that only walks one of them is a test of half
  // the rule.
  const { errors } = await boot(page);
  await page.evaluate(() => window.__snail.inspect('dash'));
  await expect.poll(() => page.evaluate(() => window.__snail.lamps().bound.length),
    { timeout: 30000, message: 'a course whose lamps have taken their lights' })
    .toBeGreaterThan(0);

  const seen = await page.evaluate(async () => {
    const S = window.__snail;
    const key = (a) => a.join(',');
    // **Everything below is watched on the *slots*, and that is the whole of why.**
    // The report is "a light source changes position and sometimes changes
    // colour", and a light source in the picture is a *slot*: sixteen of them
    // standing in the county at once, and nothing on screen says which lamp any
    // one of them belongs to. So the questions are "did this slot move", "did this
    // slot change colour" and "did the lamp behind this slot move to another slot"
    // - all three between two frames in which the slot was lit, which is the only
    // way a change is visible without a slot having gone off in between.
    //
    // The per-*lamp* view is the one that cannot fail, and it is worth saying why
    // it was left out: `bound[].colour` is the lamp's own record and the old code
    // read it off the same record, so a lamp's colour never changed no matter how
    // much its light did. The colour jumped on the slot, because a different lamp
    // was holding it - which is exactly the failure, seen from the other side.
    const moved = [];        // a lit slot standing somewhere else this frame
    const recoloured = [];   // a lit slot a different colour this frame
    const hopped = [];       // a lamp lit on both frames, on two different slots
    const stray = [];       // a light standing where no lamp is
    const orphanGlow = [];   // a glow with no light behind it
    const lit = new Set();   // every lamp that has ever had a light at all
    let prev = null;
    const look = () => {
      const r = S.lamps();
      const places = new Set(r.bound.map((b) => key(b.at)));
      const slotOfPlace = new Map();
      for (const b of r.bound) {
        const k = key(b.at);
        lit.add(k);
        slotOfPlace.set(k, b.slot);
      }
      for (const s of r.slots) {
        if (s.on && !places.has(key(s.at))) stray.push(`slot${s.i} at ${key(s.at)}`);
        if (s.glow && !s.on) orphanGlow.push(`slot${s.i}`);
        if (!prev) continue;
        const was = prev[s.i];
        if (!was || !s.on) continue;      // only a slot lit on both frames
        if (was.at !== key(s.at)) moved.push(`slot${s.i}: ${was.at} -> ${key(s.at)}`);
        if (was.colour !== s.colour) recoloured.push(`slot${s.i}: ${was.colour} -> ${s.colour}`);
        const wasSlot = [...slotOfPlace.entries()].find(([, v]) => v === s.i);
        if (wasSlot && wasSlot[0] !== key(s.at)) hopped.push(`${key(s.at)}: slot ${wasSlot[1]} -> ${s.i}`);
      }
      prev = r.slots.map((s) => (s.on ? { at: key(s.at), colour: s.colour } : null));
    };
    for (const radius of [5, 12]) {
      const steps = 120;
      const c = S.cam.free.pos;
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        S.view(c[0] + radius * Math.cos(a), c[1], c[2] + radius * Math.sin(a),
          c[0], c[1] - 0.4, c[2]);
        await new Promise((r) => requestAnimationFrame(r));
        look();
      }
    }
    return {
      lampsLit: lit.size, moved, recoloured, hopped, stray, orphanGlow,
    };
  });

  // so the walk cannot pass by doing nothing: a course that lit no lamp, or lit
  // the same one every frame, would satisfy all four assertions below
  expect(seen.lampsLit, 'lamps that took a light during the walk').toBeGreaterThan(3);
  // **The two halves of the report, as numbers, and the swap that is both of
  // them.** A slot that moves between two lit frames is a light that teleported;
  // a slot that changes colour between two lit frames is a light that changed
  // colour; and a lamp on two different slots on consecutive frames is the single
  // cause of both - which is why the third is not a restatement of the first two
  // but the sentence that says they were one fault.
  expect(seen.moved, 'lights that moved between two frames they were lit in').toEqual([]);
  expect(seen.recoloured, 'lights that changed colour between two frames they were lit in').toEqual([]);
  expect(seen.hopped, 'lamps handed from one light to another').toEqual([]);
  expect(seen.stray, 'lights standing where no lamp is').toEqual([]);
  expect(seen.orphanGlow, 'glows with no light behind them').toEqual([]);
  noErrors(errors);
});

test('a glow is a light, so a course that has not been opened has none', async ({ page }) => {
  // **The other half of the same fault, and it is a screen's worth of it.** The
  // halo on a lamp was drawn on the hour's account and not the light's: `syncGlow()`
  // asked `gfx.fxGlow` and `TOD.lamps` and not whether the light in front of it was
  // on, so a slot holding no lamp still painted one - at whatever place that slot
  // last had a lamp, in whatever colour that lamp was. On the stable, where
  // `lampPosts` is empty and not one of the sixteen has ever had a lamp, **that was
  // sixteen additive halos stacked on the world origin at a dark hour**, over the
  // middle of the plinth, with nothing behind any of them. And a course you walked
  // showed a halo for the frame after a lamp lost its light, in the colour of the
  // lamp it used to be.
  //
  // The stable is the reading that costs nothing: no course, no walking, and the
  // answer is a count of sixteen against nothing.
  const { errors } = await boot(page);
  const read = () => page.evaluate(() => window.__snail.lamps());
  await expect.poll(() => page.evaluate(() => window.__snail.lamps().bound.length),
    { timeout: 30000, message: 'the stable ever taking a lamp' }).toBe(0);
  const r = await read();
  expect(r.posts, 'lamps on the stable').toBe(0);
  expect(r.slots.filter((s) => s.on), 'lights on the stable').toEqual([]);
  expect(r.slots.filter((s) => s.glow), 'glows on the stable').toEqual([]);
  noErrors(errors);
});

test('walking a course compiles no shaders, because the number of lights does not move', async ({ page }) => {
  // **A count that decides what gets compiled may not be a count the camera
  // moves**, and the light count is the one this county got wrong. The binding
  // was written in terms of `lamps[i].visible`, which reads as "does this slot
  // hold a lamp" and is not that: three keeps a light with `visible === false`
  // out of the render state's light list, the list is what `NUM_POINT_LIGHTS` is
  // written out of, and so every lamp that took one of the sixteen and gave it
  // back took **every material in the county** through a fresh program. Measured
  // on Grand Marathon by walking the inspector down the lane in 40 cm steps:
  // **19 of 120 frames compiled anything, 522 compiles in 120 frames, and all 19
  // were frames the visible count had moved on** - and on this machine's own
  // renderer **ten frames out of 250 walked cost 682 to 710 ms each**, the frame
  // average over that walk going **from 8.3 ms to 33.2 ms** and back when the count
  // stopped moving.
  //
  // **The counter is the cost and the count is the cause, and this asserts both**,
  // because either alone passes on a build that has the other wrong: `compileShader`
  // is wrapped before the game's first line, and `info().pointLights` is counted
  // off the scene the renderer is about to draw - which is sixteen in a course and
  // **none on the stable, whose bank has no lamp to stand on and so never enters
  // its light list at all**.
  await page.addInitScript(() => {
    window.__compiles = 0;
    const p = WebGL2RenderingContext.prototype;
    const compile = p.compileShader;
    p.compileShader = function (sh) { compile.call(this, sh); window.__compiles++; };
  });
  const { errors } = await boot(page);
  const stable = await page.evaluate(() => window.__snail.info().pointLights);
  await page.evaluate(() => window.__snail.inspect('marathon'));
  await expect.poll(() => page.evaluate(() => window.__snail.lamps().bound.length),
    { timeout: 30000, message: 'a course whose lamps have taken their lights' })
    .toBeGreaterThan(3);
  const course = await page.evaluate(() => window.__snail.info().pointLights);

  const walk = await page.evaluate(async (steps) => {
    const S = window.__snail;
    const tr = S.track('marathon'), fr = S.newFrame();
    // **the counter starts here and not at the course**, because building a course
    // compiles every one of its materials for the first time and that is a
    // legitimate one-off rather than the thing this is about
    window.__compiles = 0;
    const counts = [];
    let compiles = 0;
    const lit = new Set();
    for (let i = 0; i < steps; i++) {
      S.trackAt(tr, 6 + i * 0.4, fr);
      S.view(fr.p.x, fr.y + 1.7, fr.p.z, fr.p.x, fr.y, fr.p.z);
      await new Promise((r) => requestAnimationFrame(r));
      counts.push(S.info().pointLights);
      compiles += window.__compiles;
      window.__compiles = 0;
      for (const s of S.lamps().slots) if (s.on) lit.add(`${s.i}@${s.at}`);
    }
    return { counts, compiles, lit: lit.size };
  }, 90);

  // and the walk may not pass by standing still, which is the half a count of zero
  // would otherwise satisfy on its own: four metres of lane is not a walk and the
  // binding has to move for this to mean anything
  expect(walk.lit, 'lamps that took a light while the walk moved').toBeGreaterThan(4);
  expect(stable, 'point lights on the stable').toBe(0);
  expect(course, 'point lights in a course').toBe(16);
  expect([...new Set(walk.counts)], 'the point lights the renderer was handed, walked past')
    .toEqual([16]);
  expect(walk.compiles, 'shader compiles while walking a course').toBe(0);
  noErrors(errors);
});

test('the stable is built and dropped four times and the geometry count comes back', async ({ page }) => {
  const { errors } = await boot(page);
  // **The leak gate for the stable, and it is a different leak from the course's.**
  // `dropStage()` gives back the lawn's merged geometry, the tufts' instanced
  // meshes, the snail, the pool's material and the fountain's - and it is the
  // *material* and the *probe* that a course's own `dropCourse()` has less of, so
  // one course through is not this test. The rebuild goes through `restage()`,
  // which drops before it builds, so the second one is the first taken down.
  const settled = async () => page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__snail.info().geometries;
  });
  // **One row value for all four rebuilds, and that is the whole of what this
  // test has to get right.** `buildStage()` merges per piece rather than per
  // count, so a *different* density is a different number of geometries and the
  // first version of this compared a hub at `props: 1` against a hub at
  // `props: 2` and called the three a leak. The count is taken after the first
  // rebuild and again after the fourth, which is the only comparison where the
  // only thing that has happened three times in between is a rebuild.
  const rebuild = async () => {
    await page.evaluate(() => window.__snail.setGfx('props', 2));
    // 150 ms of debounce plus the build itself, and the count is read after two
    // frames rather than after the timeout: a count read mid-rebuild is a count
    // of a stable that is halfway down
    await page.waitForTimeout(700);
    return settled();
  };
  const one = await rebuild();
  for (let i = 0; i < 3; i++) await rebuild();
  expect(await settled(), 'geometries after four rebuilds of the stable').toBe(one);
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

/* ------------------------------------------------------------------ *
 * The wardrobe and the Adversary.
 *
 * **These are the two things a cosmetic feature can get wrong without
 * anything throwing**, so they are the two things worth a browser. The first is
 * that a purchase is a purchase: gold out, a name in, and a save - and a
 * cosmetic that survives a reload is the only proof that any of the three
 * happened. The second is that a duel is a *race* with two racers in it and
 * nothing else: the same course, the same sim, two lane slots at the two ends of
 * the road rather than eight bunched into the middle.
 * ------------------------------------------------------------------ */

test('the wardrobe buys, wears and survives a reload', async ({ context }) => {
  const first = await context.newPage();
  const { errors } = await boot(first);
  // **starting gold is 50 and the first thing that costs more than nothing is a
  // face at 25**, so the purchase is reachable from a fresh save rather than from
  // a rigged one. A test that seeds gold and calls it a purchase has proved
  // nothing about the arithmetic that decides who can afford what.
  const before = await first.evaluate(() => {
    window.__snail.openWardrobe();
    return {
      gold: window.__snail.state.gold,
      owned: window.__snail.state.owned.slice(),
      face: window.__snail.state.face,
      hats: document.querySelectorAll('#wdHats button').length,
      faces: document.querySelectorAll('#wdFaces button').length,
    };
  });
  expect(before.gold, 'a fresh save can afford a face').toBe(50);
  // **This number is the size of `FACE_SET` and not a count anybody chose**, for the same
  // reason the hat row below pins `HAT_SET`: a face added to the county and not to this
  // line is a face that is in the shop with no way to be bought, and the same argument
  // applies. **The four faces off the reference took it from ten to fourteen.**
  expect(before.faces, 'fourteen faces in the shop').toBe(14);
  // eight names, one of which is the sentinel: seven files and a "no hat at all".
  //
  // **This number is the size of `HAT_SET` and not a count anybody chose**, which is
  // what makes it worth pinning: adding a hat to the county and not to this line is
  // exactly the failure the surface check above exists for on the debug hooks, and the
  // same argument applies to a row in a shop. **The wizard hat took it from seven to
  // eight**, and the plan's own `>= 4 hats reach the pool` assertion cannot see a set
  // that grew - it is a floor, not a tally.
  expect(before.hats, 'seven hats and the none sentinel').toBe(8);
  // **and the wizard hat is one of them, by name**, because a set that grew by a
  // sentinel losing a snail would satisfy the count above and put nothing in the shop.
  expect(await first.evaluate(() => !!document.querySelector('#wdHats button.h-wizard')),
    'the wizard hat is a row in the shop').toBe(true);

  const after = await first.evaluate(() => {
    const buy = document.querySelector('#wdFaces button.f-dollar');
    if (!buy || buy.disabled) return { failed: 'the dollar face was not buyable' };
    buy.click();
    return {
      gold: window.__snail.state.gold,
      owned: window.__snail.state.owned.slice(),
      face: window.__snail.state.face,
      // **and the plinth snail is wearing it**, which is the half that is easy to
      // leave out: `applyLook()` reaches the stable snail and nothing else does
      worn: window.__snail.plinth(),
    };
  });
  expect(after.failed, 'the dollar face is buyable at 50 gold').toBeUndefined();
  expect(after.gold, 'gold out').toBe(before.gold - 25);
  expect(after.owned, 'the name in').toEqual(['dollar']);
  expect(after.face, 'and worn immediately').toBe('dollar');
  expect(after.worn, 'the plinth snail is wearing it too').toBe('dollar');

  // **wearing something you already own costs nothing.** A shop that charges for
  // re-wearing a hat you bought is a shop with a subscription, and this is the
  // assertion that says the price is on the first press and not on every press.
  const again = await first.evaluate(() => {
    document.querySelector('#wdHats button.h-straw').click();
    document.querySelector('#wdHats button.h-straw').click();
    return { gold: window.__snail.state.gold, hat: window.__snail.state.hat, owned: window.__snail.state.owned.slice() };
  });
  expect(again.gold, 're-wearing is free').toBe(after.gold);
  expect(again.owned, 'and does not buy it twice').toEqual(['dollar', 'straw']);

  // and the whole of it across a reload, in one context and two pages
  // **`save: false`, and not `gfx: null` alone.** The fixture save is stamped by an
  // init script that runs before the game's first line, so a second page booted the
  // ordinary way has had the purchase overwritten before `load()` ever saw it - and
  // the assertion below would be measuring the fixture, which of course has no
  // `dollar` in it.
  const second = await context.newPage();
  await boot(second, { gfx: null, save: null });
  const reloaded = await second.evaluate(() => ({
    face: window.__snail.state.face, hat: window.__snail.state.hat,
    owned: window.__snail.state.owned.slice(), gold: window.__snail.state.gold,
  }));
  expect(reloaded, 'a purchase is a save').toEqual({
    face: 'dollar', hat: 'straw', owned: ['dollar', 'straw'], gold: after.gold,
  });
  noErrors(errors);
});

test('a duel is two racers on the same course, and it writes no season record', async ({ page }) => {
  const { errors } = await boot(page);
  const raced = await page.evaluate(() => {
    const S = window.__snail;
    S.challenge();
    const race = S.race;
    return {
      catId: race.catId,
      racers: race.racers.length,
      // **and two lane slots at the two ends of the road.** This is the assertion
      // the `laneSlot(i, n)` change exists for: with the field size baked in, a
      // two-snail field came out at -0.29 and +0.29 - both inside a quarter of the
      // lane, which is a snail walking beside a snail with a road either side of
      // them that nothing was using.
      lanes: race.racers.map((r) => +r.laneF.toFixed(3)),
      hud: document.querySelectorAll('#standings .row2').length,
      name: race.racers.map((r) => r.sn.name),
      before: S.state.results.length,
      // **and the two numbers the duel reads off its entry**, because both were
      // literals in two other files and a duel that raced at the wrong hour is a
      // wrong picture rather than a broken one: `race.catId === seasonFinaleId(
      // state.tier)` is false for a course called `adversary`, so the finale hour
      // was unreachable for the duel and nothing said so.
      duelField: race.duel && race.duel.field,
      duelHour: S.raceHourKey(race.catId),
    };
  });
  // **And the course is the one that carries a duel rather than the marathon.** The
  // whole of it used to be `startRace(DUEL_CAT, true)` with `DUEL_CAT` a constant
  // written in `race.js` and relied on by this assertion, so the duel ran on the
  // marathon whatever the data said. It is now whichever entry in `races.json`
  // carries a `duel`, and `duelCatId()` is what finds it.
  expect(raced.catId, 'a duel is on the course that carries a duel').toBe('adversary');
  expect(raced.duelField, 'the field size came off the entry and not off a literal').toBe(2);
  expect(raced.duelHour, 'the duel reads its own hour').toBe('finale');
  expect(raced.racers, 'two of them').toBe(2);
  expect(raced.lanes, 'at the two ends of the road').toEqual([-1, 1]);
  expect(raced.hud, 'two rows of standings and not eight').toBe(2);
  expect(raced.name, 'you and them').toContain('The Adversary');
  expect(raced.name, 'and you').toContain(await page.evaluate(() => window.__snail.state.name));

  /**
   * **Settle a duel, with the winner chosen, and run it twice.**
   *
   * A duel has exactly two outcomes and they are two completely different pieces of
   * code - one hands over two locked names and sixty rating points and a purse, the
   * other takes the place and pays nothing. A test that lets the sim decide which one
   * runs is a test that has pinned one of them and left the other untested, and which
   * one it is depends on a software rasteriser's frame timing.
   *
   * `put()` moves both racers to the line and writes the finishing times, because
   * `finishRace()` sorts by `finished` and then by `finishT` - so the order is the
   * times and not the order they are in the array.
   */
  const settle = (win) => page.evaluate((playerWins) => {
    const S = window.__snail;
    const was = {
      rating: S.state.rating, gold: S.state.gold, races: S.state.races,
      pts: S.state.pts, results: S.state.results.length,
      top: S.state.pool.reduce((a, b) => (b.rating > a.rating ? b : a), S.state.pool[0]).rating,
    };
    S.challenge();
    for (const r of S.race.racers) {
      const t = r.isPlayer === playerWins ? 40 : 48;
      r.s = S.race.tr.finish; r.finished = true; r.finishT = t;
    }
    S.finish();
    return { was, now: {
      rating: S.state.rating, gold: S.state.gold, races: S.state.races, pts: S.state.pts,
      results: S.state.results.length, beat: S.state.beatAdversary,
      owned: S.state.owned.slice(), face: S.state.face, hat: S.state.hat,
    } };
  }, win);

  const win = await settle(true);
  expect(win.now.results, 'a duel is not a round, won').toBe(win.was.results);
  expect(win.now.races, 'nor a race counted, won').toBe(win.was.races);
  expect(win.now.pts, 'nor points scored, won').toBe(win.was.pts);
  expect(win.now.beat, 'and it was won').toBe(true);
  expect(win.now.owned, 'their face and their horns are yours').toEqual(['devil', 'devil-horns']);
  expect(win.now.face, 'and they are worn').toBe('devil');
  expect(win.now.hat).toBe('devil-horns');
  // **+60, and it is written as sixty rather than as `RATING_GAIN[0] * payMult`**
  // because it is not a placing: they are one rating above the top of the pool, so
  // beating them is worth more than a season of winning.
  expect(win.now.rating - win.was.rating, 'a duel win is worth sixty').toBe(60);
  // **and the purse, which the first version of the duel branch did not pay.**
  // `rec.points` was written and the results screen showed `+100` and the gold
  // counter did not move, because `state.gold += me.points` lives in the season
  // ledger the branch returns above of. Gold out of the shop and gold in from a duel
  // are the same number, and it is the shop a player notices first.
  expect(win.now.gold, 'a duel pays').toBeGreaterThan(win.was.gold);
  expect(win.now.pts, "and does not touch the season's own points").toBe(win.was.pts);

  // and the other one, on the same page and with the unlock already in hand, so
  // `state.beatAdversary` being true does not hide the loss branch
  const loss = await settle(false);
  expect(loss.now.beat, 'beaten is beaten').toBe(true);
  expect(loss.now.owned, 'and losing hands nothing over').toEqual(['devil', 'devil-horns']);
  expect(loss.now.results, 'nor records a round').toBe(loss.was.results);
  expect(loss.now.races, 'nor counts a race').toBe(loss.was.races);
  expect(loss.now.pts, 'nor scores points').toBe(loss.was.pts);
  // **a loss costs the place and not the rating table.** One below the best snail in
  // the county *if you were above them*, and exactly what you had if you were not -
  // because there was no place of yours to lose. The first version was `top - 1` on
  // its own and it read as a reward for losing: a snail on 10 clicked the button,
  // lost, and came back on 665, six hundred and fifty-five points for coming second.
  expect(loss.now.rating, 'a loss ends you one below the top of the pool, or where you were')
    .toBe(Math.min(loss.was.rating, loss.was.top - 1));
  expect(loss.now.rating, 'and never above where you were')
    .toBeLessThanOrEqual(loss.was.rating);
  expect(loss.now.gold, 'and pays nothing').toBe(loss.was.gold);
  noErrors(errors);
});


/**
 * **The bower's whole claim, in two numbers and one picture.**
 *
 * `COND[cond].attr` goes straight into `r.sn.eff[attr]` at `race.js:1600` with
 * nothing between them, and `COND[cond].base` is the speed it multiplies - so a
 * bower's condition is either a **test of a trait a snail has** or it is nothing.
 *
 * **And `attr` is `running` and not a sixth key**, which is the decision the whole
 * feature rests on: this is the third ground `running` decides, a new key in
 * `ATTRS` would move `ATTR_MAX * 5` and therefore the ceiling of the ladder the
 * rating is measured against, and **the fast snails still win a bower** - they win
 * it by less, which is what makes it a test and not a wall.
 *
 * **The table is read off the page and not out of a copy**, and that is not a
 * preference: Playwright's loader reads a project with no `"type": "module"` as
 * CommonJS, and `src/core.js` has a top-level `await` in it, so a spec that
 * imported the table directly would not load at all. `tools/plan-test.mjs` can,
 * because plain node runs it - and it does, in `--cond`. **The game is the subject
 * and `core.js` is the thing under test**, which is the better reason anyway.
 */
test('the bower is a third ground for running, slower than the footpath and not a wall', async ({ page }) => {
  const { errors } = await boot(page);
  const cond = await page.evaluate(() => window.__snail.cond());
  expect(cond.length, 'seven conditions, and the bower is the last of them').toBe(7);
  expect(cond[6].key, 'the bower is the seventh, appended after the crate').toBe('bower');
  expect(cond[6].attr, 'and it tests running, which is a stat and not a new one').toBe('running');
  expect(cond[0].attr, 'the same stat the footpath tests').toBe('running');
  expect(cond[6].base, 'and it is slower than the footpath beside it').toBeLessThan(cond[0].base);
  expect(cond[6].base, 'but not a wall - it is most of the footpath').toBeGreaterThan(cond[0].base * 0.6);
  // **And every condition's attr is a stat**, which is the three-line gate in
  // `plan-test.mjs --cond` asked here as well because it costs nothing and the
  // failure is the quietest one the county has.
  for (const c of cond) expect(typeof c.attr, `${c.key}: a trait`).toBe('string');

  // **And the page half, because a table nobody reaches is not a feature.** A
  // bower on `dash` whose `litter` is zero is a tunnel over a road that gives no
  // reason to be slow, and the picture and the simulation would have stopped being
  // the same fact - which is the failure this whole thing is written against.
  await page.evaluate(() => window.__snail.inspect('dash'));
  const bow = await page.evaluate(() => window.__snail.bower());
  expect(bow, 'a bower stands on the course that deals one').not.toBeNull();
  expect(bow.litter, 'and there are leaves on the road for the condition to be about')
    .toBeGreaterThan(0);
  noErrors(errors);
});
