// tier.js - the machine's two answers, in one place, so nothing else has to know
// them: which tier the county is drawn at, and which course ids the suite walks.
//
// **The tier is a fact about the build and not about the browser**, so it is
// seeded from `localStorage` before the game's first line rather than set on the
// page afterwards. The bottom preset at **render scale 1x**, and the render scale
// is the number that is worth an argument:
//
//   `needsResample()` is true at every step of that row but one, and it is one of
//   the four things that makes `needsComposer()` true, so **the bottom preset at
//   0.5x builds the post chain anyway**. That is the tier the repo documents as
//   the one that must not regress - the one that spends no render target and runs
//   the game's own single `renderer.render()` - and pinning it at 0.5x would have
//   left nothing in the suite able to see it. 480x300 at 1x is 144 thousand
//   pixels, which SwiftShader manages, so the honest tier costs nothing.
//
// `ssao: 1` is `null` in `AO_LADDER`, `refl: 1` is `0` in `REFL_LADDER`, `fxBloom`
// is off and `msaa: 1` is zero samples: no occlusion pass, no cube probes, no
// target at all. That is what `passes: []` and `targets` at its floor mean, and
// those two numbers are the ones the golden spec compares.
//
// **This object is a literal, and it is checked against the game rather than
//  derived from it.** Deriving it out of `src/graphics.js` was tried and is worse
//  than the literal, for a reason worth recording: there is no preset table in
//  there to read. Each row carries its own ladder and `gfxRowValue(row, n)` picks
//  the cell, so a version of this file that parsed the source would be
//  reimplementing that function - which is the duplication this file exists to
//  remove, wearing a regex as a disguise. `scale: 2` and `fxGlow: 1` are the two
//  that a guess gets wrong: bilinear is written onto the bottom four levels
//  because a row that does not rise with quality does not mean what its
//  neighbours mean, and the glow is a sprite rather than a pass, so it is on at
//  every level.
//
// **So the check is the other half.** `smoke.spec.js` boots the county at exactly
//  this object and asserts that the game's own `gfxAgreed()` reads it back as
//  preset 1 - which is the game agreeing, out loud, that these seventeen numbers
//  are the bottom preset. A row added to `GFX_ROWS`, a ladder given a new
//  bottom cell, or a switch moved in `FX_PRESET` makes that assertion fail and
//  names the row, instead of every spec continuing to quote a tier the game no
//  longer recognises. `gfxLoad()` drops a key it does not know and keeps the
//  game's own default, which is how a stale pin goes quiet.
// **And no `import.meta` in this file**, which is the same reason `fixtures.js`
// uses `__dirname`: a `.js` spec is compiled to CommonJS before it runs, so
// `import.meta` is a syntax error in one and `__dirname` is the only spelling
// that is true in both this file and the three that import it. The root is the
// parent of this file's folder.
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(__dirname, '../..');

export const GFX_KEY = 'snail-grand-prix-gfx-v1';
export const SAVE_KEY = 'snail-grand-prix-v1';

export const GFX = {
  preset: 1, render: 3, msaa: 1, scale: 2, distance: 1, shadow: 1,
  props: 1, grass: 1, sky: 1, ssao: 1, refl: 1,
  fxGlow: 1, fxVig: 0, fxGrain: 0, fxCloud: 0, fxBloom: 0, fxWind: 0,
};

/** The same tier with the render scale off 1x, which is the cheapest way to make
 *  `needsComposer()` true without switching a single effect on - and so the step
 *  that proves the chain is *built* as well as the step that proves it is not. */
export const GFX_RESAMPLED = { ...GFX, render: 1 };

/** Every course in `races.json`, in the order the file lists them - **read, not
 *  written**, which is the one of the two that can be derived honestly. A sixth
 *  course would otherwise be in the game, out of the suite and out of the
 *  baseline, with nothing failing anywhere: `capture.spec.js` walks this list and
 *  `golden.spec.js` asserts against the baseline, so a course missing from it is
 *  a course nobody tests rather than a course that fails. */
export const COURSES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'races.json'), 'utf8'),
).map((c) => c.id);

if (!COURSES.length) throw new Error('tier.js: races.json lists no courses');