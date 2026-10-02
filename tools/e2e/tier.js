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

/** Every course in `races.json`, in the order the file lists them. */
export const COURSES = ['dash', 'ascent', 'splash', 'sky', 'marathon'];
