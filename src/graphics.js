/* ================================================================== *
 * graphics.js
 *
 * The settings ladder, the renderer, the dome, and the hour of the day. Four
 * things, and they are one thing: **every one of them is a row on the panel**,
 * from `antialias: true` on the context down to the eight degrees of sun that
 * make a course at dusk a different picture from the same course at dawn. What
 * the county looks like is decided here and nowhere else - a course module that
 * asked the fog for its distance would have a second opinion about the same
 * number.
 *
 * **The canvas is appended by `app.js` and not from here, and that is the one
 * thing this module cannot do for itself.** `document.body` exists when a module
 * body runs - it is built by the parser before any module is evaluated - but
 * the canvas was landing at the end of the body by a coincidence of *where the
 * script tag is*: `index.html` has the module at line 228 and the closing body
 * at 229, so every element the game looks up by id is already parsed and the
 * append puts the canvas last in the body, where the layout wants it. Move the
 * script into `<head>` - which is where a module belongs - and the append lands
 * before the panels. So the append is now a call in the entry module, which is
 * the file whose business it is, and this module hands out the renderer alone.
 *
 * `world` is here for a second reason of the same kind. The post chain, the
 * frame loop and the two screens all need the scenes, and the scenes are built
 * downstream of this module - so this module owns an empty registry and
 * everybody fills it at module scope. It is an object rather than an import of
 * each scene because `race.js` and `stage.js` import *this* module for the fog
 * and the ladder, and three modules that need each other's data is a cycle; a
 * registry both ends can write is the shape that is not. Nothing waits on it
 * being filled, because `app.js` imports every module before its own body runs.
 * ================================================================== */
import { THREE, TAU, clamp, lerp } from './core.js';

/**
 * Where the county's scenes are, for the code that needs them and does not own
 * them. **Filled at module scope by `surfaces.js`, `race.js` and `stage.js`, read
 * by `post.js`, `scenery.js` and the frame loop.**
 *
 * It is a registry rather than an import of each one because `race.js` and
 * `stage.js` import *this* module for the fog and the ladder, and three modules
 * that need each other's data is a cycle; a registry both ends can write is the
 * shape that is not. Nothing waits on it being filled, because `app.js` imports
 * every module before its own body runs.
 *
 * **`env` and `stageEnv` are here rather than only `scene`, and that is because
 * the post chain reads the light out of them** - `refreshEnvironment()` hangs a
 * pre-filter on both, `updateTimeOfDay()` sets the sun's colour on both, and
 * `applySky()` swaps both domes' geometry - and a module upstream of the two
 * that build them has to be handed them.
 *
 * **`shadowRoots` and `restage` are functions and not lists**, because every one
 * of the things behind them changes with the race: the course's group is built
 * per course and the field is eight snails standing on it. A list filled once at
 * module scope is a list of last race's meshes, and the shadows row would then
 * stamp a course that is no longer in the scene - which is silent, because
 * stamping a missing mesh does nothing at all.
 *
 * `renderScene()` asks `modeOf()` because the discriminator **is** the mode, and
 * it was written here on the belief that `stage.visible` said the same thing. It
 * does not: `stage` is `{group, snail, pool, ...}` and has no `visible` of its
 * own, so the predicate was always false and every frame drew the **county's**
 * scene - an empty scene, on the stable, with no error anywhere: 32 draw calls
 * and 2,750 triangles where there should be 68 and a plinth. The stable group is
 * in the stable scene permanently and the *scene* is what switches, so the mode
 * is the only thing that knows, and the mode is the frame loop's.
 */
export const world = {
  scene: null,
  stageScene: null,
  stage: null,
  env: null,
  stageEnv: null,
  camera: null,
  /** Every water mesh a course has built. Filled by `race.js` with **the array
   *  itself and not a copy of it**, because the pools are made and dropped one
   *  course at a time and `eachWaterSurface()` walks this on every probe sync -
   *  a copy would be a list of the meshes of whichever course happened to be
   *  running when the copy was taken. */
  water: [],
  /** Put down again at the density the rows now say. Filled by `app.js`, and it is
   *  the *debounced* rebuild rather than the rebuild itself: the button grid is one
   *  where a player clicks five times in two seconds, and five thousand tufts
   *  five times is a stutter. `applyGraphics()` asks for it on every apply. */
  restage: () => {},
  /** The course's root, for the shadow walk. Filled by `race.js` and a function
   *  because `race.group` is reassigned on every start and every finish, and a
   *  copied root is a root that no longer exists. */
  raceGroup: () => null,
  /** The roots `applyShadows()` walks: the course and the stable.
   *
   *  **This is a method rather than a field because it is the union of two things
   *  two modules own**, and a field would mean one of them clobbering the other's
   *  list. It is also the one that says the cast-flag stamp is worth having at
   *  all: `scatter()` sets `userData.gfxCast` on every prop it plants, and
   *  nothing reads that flag except this walk - so a registry field nobody filled
   *  was a shadows row that turned props off and nothing on, with no error
   *  anywhere, which is what it was for four steps. */
  shadowRoots() {
    return [this.raceGroup(), this.stage && this.stage.group].filter(Boolean);
  },
  /** The field's eight, for the same walk. Filled by `race.js`. */
  racers: () => [],
  /** Every water material a course has made, so `dropReflections()` can hand
   *  them back. `surfaces.js` fills it because it is the surfaces that make the
   *  pools, and the post chain empties it because the pre-filter hanging off
   *  each one is the reflections row's business - and a list emptied by the
   *  module that does not fill it is a list two modules argue about. */
  courseWater: [],
  /** Which mode the frame loop is in. Filled by `app.js`, and a **function and not
   *  a copied number** because `mode` is a `let` reassigned on every start and
   *  every finish, and a registry field written once is a registry field that is
   *  wrong on the frame after the race ends. */
  modeOf: () => 'stable',
  /** Which season the save is in. Filled by `app.js` too, and a function for the
   *  reason `modeOf` is: a new season is a reassignment, and a registry field
   *  written once is a field that is wrong on the frame after it. */
  seasonOf: () => 1,
  /** The seven things the race needs and cannot have, all of them `app.js`'s.
   *
   *  **They are the app's because the app is downstream of the race, and the race
   *  is downstream of everything else** - so a file about the race reaching up to
   *  the frame loop for a clock is a cycle drawn by a question, exactly as
   *  `seasonOf()` is. Each one is a function because each one reads something the
   *  app reassigns: `clock` every frame, `surging` on every key event, and the
   *  five screens are functions that are the same functions for the whole session
   *  and whose *names* are the only thing this file needs.
   *
   *  `clock()` is the only one of the seven read in the hot path - a particle's
   *  age, a racer's wobble, ten times a second - and it is a call rather than a
   *  copied number for the same reason the mode is: a number written once is a
   *  number that stopped on the frame the race started.
   *
   *  **Seven is a lot, and every one of them arrived the same way**: a name read
   *  bare in `race.js` that the entry declares. `tools/wired.mjs` is what says so,
   *  and it found them one at a time because it had four wrong answers about what
   *  counts as a local of a file's own before it could be trusted to find the
   *  fifth. The alternative to seven fields was a callback threaded down through
   *  `stepRace()` into `stepRacer()`, and a flag passed to six spawn functions
   *  that are also called at setup - which is the same seven things with the
   *  names left off. */
  clock: () => 0,
  /** Whether the player is holding the surge button. The listeners are in
   *  `app.js` - the space bar and the on-screen one - and a racer only ever asks
   *  whether it is down, which is the one question a file about the race should be
   *  asking about the keyboard. */
  surging: () => false,
  /** Set the hour to the start of a race's own stretch of the day, cache and all.
   *  **The cache is the app's too**, so a race asks for the whole of it rather
   *  than half of it and the entry's own reset stays a line beside the function
   *  that owns the flag. */
  forceTimeOfDay: () => {},
  /** The race screen, built once at the start: the markers, the standings, and
   *  then the per-frame half. */
  syncHUD: () => {},
  /** The per-frame half on its own: positions, the bar, the speed, the condition
   *  and the button. Ten times a second, from `stepRace()`. */
  updateHUD: () => {},
  flashGo: () => {},
  showResults: () => {},
  /** The snail's colours onto the plinth's snail, and the two colour inputs and
   *  the style buttons with them. Filled by `app.js` because two thirds of it is a
   *  screen, and asked for by `stage.js` on every rebuild - which is the one
   *  place a rebuilt stable would otherwise come up wearing the county's colours. */
  applyLook: () => {},
  renderScene() {
    const m = this.modeOf();
    return (m === 'stable' || m === 'stroll') ? this.stageScene : this.scene;
  },
};/* ================================================================== *
 * Graphics settings
 *
 * Nine rows under the preset, most of them six steps, and a preset row that
 * cascades: choosing
 * preset *N* writes *N* into every other row the preset owns and the six effect
 * switches. The render scale is the row it does not own, and a preset is a claim
 * about what the machine can afford rather than about what its screen is.
 * Level 3 is today's build in every row except effects, SSAO and reflections,
 * where level 1 is today's build and level 3 is deliberately more. Level 1 targets
 * a machine that cannot pay for a post chain; level 6 is the highest fidelity the
 * renderer can be pushed to.
 *
 * They live in **their own `localStorage` key** and not in the game save. They
 * are the machine's, not the season's: `Delete save` should leave them alone,
 * and `load()` blind-merges everything it is handed, so the only honest way to
 * keep them apart is a second key.
 *
 * **The renderer only ever runs the machinery it needs.** One predicate,
 * `needsComposer()`, and the composer is built on its false->true edge and
 * disposed on its true->false edge - so the bottom tier runs the game's own
 * single `renderer.render()`, with no render target, no extra scene render and
 * no fullscreen pass anywhere in the frame.
 * ================================================================== */
const GFX_KEY = 'snail-grand-prix-gfx-v1';
/** "Native", which is exactly today's `setPixelRatio` call. */
const nativePixelRatio = () => Math.min(devicePixelRatio, 2);

// **Render scale.** Levels 4-6 are supersampling: rendered above native and
// downsampled, which resamples slightly soft and genuinely smooths. The absolute
// figure is capped so a retina panel does not reach 4x on the top tier.
const RENDER_SCALE = [0.5, 0.75, 1, 1.25, 1.5, 2];
const RENDER_SCALE_CAP = 4.0;

/** **How the county's resolution becomes the window's pixels.** Five steps
 *  and not six, because the bottom two are what a machine is afforded -
 *  one tap and four, both hardware - and the top three are what a
 *  picture is asked to look like: sixteen taps each, the same price,
 *  and the only difference between them is sharpness, soft to sharp.
 *  A row with a step nobody would ever choose is a cell spent for
 *  nothing, and a row whose top three cost the same is a row where
 *  the choice is the picture and not the machine.
 *
 *  **The bottom four are bilinear and not nearest on purpose**: nearest
 *  is one fetch and bilinear is four, so nearest is the cheap end, but
 *  at 0.5x a nearest neighbour is four square blocks for every texel
 *  and the row that is meant to make a machine playable is the one
 *  that makes it unplayable.
 *
 *  **The tap count is the caption**, because a filter you cannot see
 *  the cost of is a filter nobody chooses on purpose. The taps are
 *  written out rather than left to the sampler, at texel centres, so
 *  the texture's own `minFilter` cannot change the answer: a row that
 *  reads the bloom's input as well is a row that quietly alters the
 *  bloom. */
const SCALE_NAMES = ['nearest', 'bilinear', 'b-spline', 'mitchell', 'lanczos'];
/** What each one costs a pixel, and the caption's whole content. Written beside
 *  the names and not counted in the shader, so the menu cannot quote a price the
 *  shader does not charge. */
const SCALE_TAPS = [1, 4, 16, 16, 16];
/** What each preset writes onto the scaling row: bilinear everywhere but the
 *  top two, which are b-spline - the softest of the three that cost
 *  sixteen, so a preset that rises in quality rises in smoothness before
 *  it rises in sharpness. A row that does not rise with quality does not
 *  mean what its neighbours mean. */
const SCALE_PRESET = [2, 2, 2, 2, 3, 3];
/** Fog near/far, in metres. Level 3 is `makeEnv(78, 300)` unchanged. */
const FOG_LADDER = [[40, 130], [58, 200], [78, 300], [95, 430], [112, 600], [130, 820]];
/** How far out the meadow ribbon is drawn, in metres. Level 3 is 120. */
const EDGE_LADDER = [85, 100, 120, 165, 220, 285];
const SHADOW_MAP = [512, 1024, 2048, 3072, 4096, 4096];
const SHADOW_RADIUS = [1, 3, 7, 9, 11, 16];
/** Level 1 keeps shadows - the sun's direction is legible off them - and drops
 *  prop casting, which is the expensive half and the one six thousand instanced
 *  tufts and every rock in the county are paying for. */
const SHADOW_CAST = [false, true, true, true, true, true];
const PROP_DENSITY = [0.40, 0.70, 1.00, 1.30, 1.60, 2.00];
const GRASS_DENSITY = [0.25, 0.50, 1.00, 1.50, 2.00, 3.00];
/** Dome segments, [width, height]. Level 3 is the 40x24 it has always been. */
const SKY_LADDER = [[16, 10], [28, 16], [40, 24], [64, 32], [96, 48], [128, 64]];
/**
 * The occlusion row, **which is a 1x2 and not one axis**: sample count on one
 * side of it and indirect light on the other, so the six steps read
 * `{off, 4 spp, 8 spp, 4 spp + GI, 8 spp + GI, 16 spp + GI}`.
 *
 * **It used to be a 2x2**, with the G-buffer's resolution on the other axis and
 * `{off, G half, G full, G+GI half, G+GI full, G+GI full with a finer kernel}` as
 * the six steps. The half-resolution steps are gone and the axis went with them,
 * because **a reflected ray marched against half-res depth breaks against
 * silhouettes** - and on a pool the silhouette that matters is the shoreline. A
 * row with a cell in it that a second effect cannot use is a row that has to be
 * watched, so the cheaper thing to fix is the cell. `sizeGBuffers()` now sizes
 * the G-buffer from `scenePixels()` on every path and there is no step where the
 * buffer a reflection reads is the wrong one.
 *
 * **And the samples had to be re-spread, because deleting the flag alone would
 * have shipped two cells that draw the same frame.** Steps 3 and 4 were
 * half-res-8 against full-res-8, and with `half` gone they are the same entry
 * twice - so `ssao: 4` and `ssao: 5` would have been one picture on two buttons.
 * Step 3 drops to four samples, which also lands it at half the count and twice
 * the sample rate of what it was: **a wash**.
 *
 * **The one cell that gets dearer is step 2**, which was half-res at four samples
 * and is now full-res at four: about four times the samples. That is the honest
 * price of the row having no cell a reflection cannot host, and `ssao: 1` is off
 * and is the answer for a machine that cannot pay it.
 *
 * **The `gi` field is the whole of what a step decides about the bounce** - it is
 * zero on the two G-only steps, so they construct nothing and pay exactly what
 * they paid before, and it is the strength the bounce multiplies its irradiance
 * by on the four that have it. A row that grows a second axis is a row that has
 * to be spread, because the alternative - a seventh `fx` switch - is a second
 * place the same decision is written down.
 *
 * **The gain is a dial on how much the county flattens**, because the term it
 * scales is already the fraction of the county that can see each other. What
 * bounds it is the two denominators, and both are load-bearing: the sum runs over
 * directions *and* steps while `total` held the directions alone, so every hit
 * was counted once per step with nothing taking them back out and a white arch
 * filling one of six directions came back at 1.3 of white. `stepWeights()` is the
 * other one. Between them the term cannot exceed the albedo of what it bounced
 * off, which is what a bounce is - so **a gain above one here is not a brighter
 * bounce, it is a picture with the top of the range already gone**, and the
 * number is deliberately not asked to carry that.
 *
 * Level 1 is `null`: no pass, no G-buffer, and the direct render path.
 */
const AO_LADDER = [
  null,
  { samples: 4, radius: 0.8, blend: 0.95, gi: 0 },
  { samples: 8, radius: 0.8, blend: 0.95, gi: 0 },
  { samples: 4, radius: 0.7, blend: 0.95, gi: 0.95 },
  { samples: 8, radius: 0.7, blend: 0.95, gi: 0.95 },
  { samples: 16, radius: 0.6, blend: 0.95, gi: 0.95 },
];
/**
 * How far a bounce is looked for, in metres, and how deep a surface has to be
 * before the ray point counts as inside it rather than merely behind it.
 *
 * **`uInner` is the number that makes this look like light rather than like
 * haloes**, and it exists because six sample directions are an *angular*
 * average rather than a measure of solid angle. A direction that lands on a
 * mushroom twenty centimetres away is given the same weight as one that lands on
 * a cliff, and the mushroom covers three pixels while the cliff covers half the
 * screen - so the ground under the snail got a full strength wash of the snail's
 * own mint, cut to the snail's own silhouette, and read as a glowing ghost
 * standing on the grass. Nothing about the estimator was wrong; the units were.
 * Starting the march at `uInner` puts the first sample beyond anything a snail
 * could be touching, which on this county's scale - a seven-metre lane, a
 * four-metre tree, a thirty-five-metre cliff - is still well inside "the piece of
 * ground next to this one" and is where a colour cast belongs.
 *
 * `uThick` is the same idea measured the other way: how far inside a surface a
 * ray point has to be before the surface counts as having caught the ray, and it
 * is short because the only things in the county that are thin are props, and a
 * prop is exactly what `uInner` is keeping the march away from.
 */
const GI_RADIUS = 2.6;
const GI_INNER = 0.9;
const GI_THICK = 0.6;
/** Cube probe edge length; 0 is off and the water falls back on the shared
 *  PMREM environment. Levels 5-6 add the fresnel roughness ramp on top. */
const REFL_LADDER = [0, 64, 128, 256, 256, 512];
const REFL_FRESNEL = [false, false, false, false, true, true];
/* ------------------------------------------------------------------ *
 * The effects are six switches and not one row, and a stack is a bundle.
 *
 * They were a **strictly monotonic stack**: level *N* turned on every effect up
 * to *N*, and the order they stacked in is the order of what they cost - a
 * fullscreen quad, a uniform, a composer pass - so level 3 was today's build
 * plus passes that are nearly free and nothing that is not. That is a real
 * reason for the ladder and it is a bad reason for the menu, because a stack
 * gives a player who wants the cloud shade and not the film grain no cell to
 * press: the only way to have that picture is to edit `localStorage` by hand.
 *
 * So the stack survives as what it was always good for, **the set a preset
 * writes**, and the menu gets one switch per effect. A preset is still a full
 * write - pressing `Balanced` puts a grain you had just switched on back off,
 * which is exactly what it always did to the other rows, and it is the reason a
 * preset is never a partial change and never has left a player with a picture
 * they could not get back to.
 *
 * **Film grain and a vignette are off on a fresh install and on every preset**,
 * so they are the two switches with no rung on the ladder at all. A grain is a
 * filter laid over the picture and a vignette is a dimmed one, and neither is a
 * thing the county looks better for being given by default; both cost the same
 * one fullscreen quad between them, and `drawOverlay()` bails when they are both
 * off, so with them off the bottom tier pays nothing for having them at all.
 * ------------------------------------------------------------------ */
/**
 * The six switches, in the order the stack turned them on, so the modal reads the
 * way the ladder did. `cells` is the row's own labels **and its number of states**,
 * which is how the bloom's second strength is carried: `off / bloom / bloom hi` is
 * one effect at two strengths and not two effects, and the ladder had both.
 *
 * **Seven rows and not six, and the seventh is a composer pass** - so it goes
 * above the bloom rather than below it, because both are passes and this list's
 * order is the order the old stack turned things on, with the cheap filters
 * first. **The row is named for the mechanism and not for today's users of it**:
 * "water reflections" would be a row lying the moment a surface outside the list
 * carried a mark, and a shell carrying one is a single line at its plant site.
 *
 * **It is an fx switch and not a seventh ladder row, and that is a shape decision
 * rather than a preference.** `setToggle`'s 0-based clamp is the right clamp here
 * and `setRow`'s 1-based one would put a 1 on the row's *second* cell; `gfxLoad`'s
 * fx loop validates against `cells.length` and an old save with no `fxSsr` keeps
 * the default, so there is no migration and no version bump; and `setPreset`
 * writes `want[r.key] || 0`, which makes `FX_PRESET` the only place the rung is
 * decided at all. The landmine it walks around is `gfxLevelRow()`, which reads
 * the first owned row carrying no table out of `GFX_ROWS` - a new *ladder* row
 * inserted before `distance` would become the level row and every preset would
 * come back `mixed`.
 */
const FX_TOGGLES = [
  { key: 'fxGlow', name: 'Lamp and sun glow', cells: ['off', 'on'], short: 'glow',
    cost: 'additive sprites · no pass' },
  { key: 'fxVig', name: 'Vignette', cells: ['off', 'on'], short: 'vignette',
    cost: 'one fullscreen quad' },
  { key: 'fxGrain', name: 'Film grain', cells: ['off', 'on'], short: 'grain',
    cost: 'one fullscreen quad' },
  { key: 'fxCloud', name: 'Cloud shade', cells: ['off', 'on'], short: 'cloud shade',
    cost: 'a uniform on five materials' },
  { key: 'fxSsr', name: 'Screen reflections', cells: ['off', 'on', 'on hi'], short: 'ssr',
    cost: 'a composer pass · needs ambient occlusion on', live: true },
  { key: 'fxPom', name: 'Parallax relief', cells: ['off','two-sided','relief 4','relief 8','parallax 8','parallax 12'], short: 'pom',
    cost: 'a height march in the course shader' },
  { key: 'fxBloom', name: 'Bloom', cells: ['off', 'bloom', 'bloom hi'], short: 'bloom',
    cost: 'a composer pass' },
  { key: 'fxWind', name: 'Wind', cells: ['off', 'on'], short: 'wind',
    cost: 'a uniform on five materials' },
];
const FX_KEYS = FX_TOGGLES.map((r) => r.key);
/** What each preset writes, and it is the stack with the grain and the vignette
 *  lifted out of it: every level keeps its glow, level 4 its cloud shade, level 5
 *  its bloom and level 6 its wind, so a player climbing the ladder under the new
 *  menu arrives at the picture they chose under the old one. **The reflections
 *  are on the two top steps**, which is where the occlusion row already carries
 *  the bounce, so the top of the ladder is the first place the county is asking
 *  for a frame that traces rays. */
const FX_PRESET = [
  { fxGlow: 1 },
  { fxGlow: 1 },
  { fxGlow: 1 },
  { fxGlow: 1, fxCloud: 1 },
  { fxGlow: 1, fxCloud: 1, fxBloom: 1, fxSsr: 1, fxPom: 4 },
  { fxGlow: 1, fxCloud: 1, fxBloom: 2, fxWind: 1, fxSsr: 2, fxPom: 5 },
];
/** And the stack itself, kept for the one save that still carries it. The same
 *  six levels read out as the same six switches, so a level means what it meant. */
const FX_LEGACY = [
  { fxGlow: 1 },
  { fxGlow: 1, fxVig: 1 },
  { fxGlow: 1, fxVig: 1, fxGrain: 1 },
  { fxGlow: 1, fxVig: 1, fxGrain: 1, fxCloud: 1 },
  { fxGlow: 1, fxVig: 1, fxGrain: 1, fxCloud: 1, fxBloom: 1 },
  { fxGlow: 1, fxVig: 1, fxGrain: 1, fxCloud: 1, fxBloom: 2, fxWind: 1 },
];
const PRESET_NAMES = ['Low', 'Light', 'Balanced', 'High', 'Very high', 'Ultra'];
/** Steps to sample counts. **Three states and not six**, because a multisampled
 *  buffer's sample count is one of one, two or four and a cell saying x3 would be
 *  a cell no machine could honour. The first step is zero samples and not one,
 *  because a one-sample target is the same as no target with more bookkeeping.
 *
 *  **The bottom cell is `direct only` and not `off`, because the frame is smoothed
 *  there.** `getContext` takes a boolean for the context's own multisampled default
 *  framebuffer and no sample count at all, so the direct path is anti-aliased
 *  whatever the row says - `antialias` is true at the renderer below and nothing in
 *  the menu can change it. Zero is what the *compositor's buffer* is built at, and the
 *  buffer is not the only place a pixel can be smoothed, so `off` would be a claim
 *  about the buffer wearing a word about the frame.
 *
 *  `MSAA_SHORT` is the same three answers for the perf panel, which is not the modal:
 *  its value column is 3.4em because the widest value in it is five characters, and
 *  `direct only` is eleven. **A second table rather than a truncation**, because the
 *  panel would otherwise be printing an ellipsis where a word was - the same reason
 *  `short` is a field on `GFX_ROWS` and on every `FX_TOGGLES` row.
 */
const MSAA_LADDER = [0, 2, 4];
const MSAA_NAMES = ['direct only', 'x2', 'x4'];
const MSAA_SHORT = ['direct', 'x2', 'x4'];
/** The parallax relief's march step count, per fxPom cell. **A cell is a
 *  technique and a quality, and the step count is the quality half of it.**
 *  Cells 0 and 1 (off and two-sided) write 0 steps - the two-sided path is
 *  two samples and not a loop - and cells 2-5 (relief 4, relief 8,
 *  parallax 8, parallax 12) write the step count that the coarse march runs.
 *  A cell press is a write of these numbers into `gfxU.uPomSteps`,
 *  `gfxU.uPomTwoSided` and `gfxU.uPomBisect` in `applyEffects()`, the same
 *  one-line-per-effect shape as `uCloudAmt` and `uWindAmp`, so a cell press is
 *  a uniform write and not a recompile, and the off path is byte-identical to
 *  today's frame.
 */
const POM_STEPS = [0, 0, 4, 8, 8, 12];
/** **And which of those cells get the bisection, in a table of its own.** The
 *  first cut read it off `POM_STEPS` - "on exactly the parallax cells, so it
 *  is `uPomSteps > 4.0`" - and that is the shape of this county's favourite
 *  mistake: **cells 3 and 4 are both 8**, one relief and one parallax, so a
 *  flag derived from the number cannot tell a relief-8 from a parallax-8 and
 *  the relief cell was quietly drawing the parallax picture. Two tables keyed
 *  by the same cell is the honest form, and it is the reason the uniform is
 *  `uPomBisect` rather than a comparison in the shader: **a state two buttons
 *  share is a state that cannot say which button is pressed.** */
const POM_BISECT = [0, 0, 0, 0, 1, 1];
/** What each preset writes onto the anti-aliasing row, and **the row has to carry a
 *  table of its own** rather than be written by identity like the other eight: three
 *  states cannot hold six numbers, so a cascade writing *N* into it would put a step
 *  it has no cell for on the row and a cell it cannot reach in the table. Balanced is
 *  `direct only`, which is the picture the composer path has always drawn, and the
 *  top three are x4 - a row that rises with quality or it does not mean what its
 *  neighbours mean. */
const MSAA_PRESET = [1, 1, 1, 2, 3, 3];
const GFX_STEPS = ['1', '2', '3', '4', '5', '6'];
/** The render scale's cells, **read off the ladder rather than written beside it**:
 *  six labels that disagree with the six numbers they name is a menu that lies about
 *  the thing it is setting, and every other row on this list does the same job from
 *  its own numbers. A step of one is `1×` and not `1.0×`, because a trailing zero on
 *  a multiplier nobody writes is a column of noise across six cells. */
const RENDER_NAMES = RENDER_SCALE.map((s) => `${s}×`);
const GFX_ROWS = [
  { key: 'preset', preset: true, name: 'Preset', short: 'preset' },
  // **The one row the preset does not own**, and the reason it is a claim about the
  // screen rather than about the machine: a preset says what this computer can
  // afford, and how many device pixels a pixel of the window is worth is a fact
  // about the panel it is on. So a cascade that wrote *N* into it would override a
  // player who had set theirs to 1× on a retina display because they changed
  // something else, and the fix for a machine that cannot pay for it is the row
  // above the preset, not the answer being decided for them.
  { key: 'render', name: 'Render scale', short: 'render scale', cells: RENDER_NAMES, own: false },
  // beside the render scale on purpose: the two are the same question asked about
  // the frame - how many pixels, and how many of each
  { key: 'msaa', name: 'Anti-aliasing', short: 'msaa', cells: MSAA_NAMES, map: MSAA_PRESET },
  // and beside that one, because it is the third part of the same question: the row
  // above says how many pixels and this one says what becomes them
  { key: 'scale', name: 'Scaling', short: 'scaling', cells: SCALE_NAMES, map: SCALE_PRESET },
  { key: 'distance', name: 'Draw distance', short: 'draw distance' },
  { key: 'shadow', name: 'Shadows', short: 'shadows' },
  { key: 'props', name: 'Prop density', short: 'props' },
  { key: 'grass', name: 'Grass density', short: 'grass' },
  { key: 'sky', name: 'Sky quality', short: 'sky' },
  { key: 'ssao', name: 'Ambient occlusion', short: 'ssao' },
  // **And not "Reflections".** Two rows meaning reflections, one of them on and
  // one of them off, is a menu asking the player which is which - and "sky probe"
  // is also what this row is *for*: it is the fallback a traced reflection falls
  // back to, and on a surface the trace misses the frame is already carrying the
  // probe's answer.
  { key: 'refl', name: 'Sky probe', short: 'reflections' },
];
/** The nine rows below the preset, in the order the cascade writes them, and
 *  **including the one it does not write** - this is the save, the load and the
 *  button rows, and a row missing from it is a setting that does not survive a
 *  reload. */
const GFX_KEYS = GFX_ROWS.filter((r) => !r.preset).map((r) => r.key);
/** The rows a preset is answerable for, which is every row but the preset row and
 *  the render scale. */
const gfxOwned = (row) => !row.preset && row.own !== false;
const gfxRowOf = (key) => GFX_ROWS.find((r) => r.key === key);
/** How many steps a row has, which is its own cell count and six for most of
 *  them: the validation, the clamp and the button row all have to agree or a
 *  step gets written the row cannot draw. */
const gfxRowSteps = (row) => (row && row.cells ? row.cells.length : GFX_STEPS.length);
/** What a row holds at preset level *n*, which is *n* itself unless the row brought
 *  a table. One function for both halves of the preset - what it writes and what it
 *  compares against - because a row whose write and whose test disagree is a preset
 *  that can never be recognised as itself. */
const gfxRowValue = (row, n) => (row.map ? row.map[n - 1] : n);

const gfx = {
  preset: 3, render: 3, msaa: 1, scale: 2, distance: 3, shadow: 3, props: 3,
  grass: 3, sky: 3, ssao: 3, refl: 3,
  fxGlow: 1, fxVig: 0, fxGrain: 0, fxCloud: 0, fxSsr: 0, fxPom: 0, fxBloom: 0, fxWind: 0,
};

/* --- the value each row reads, so the appliers never index a ladder twice --- */
const gfxRenderScale = () => RENDER_SCALE[gfx.render - 1];
const gfxScale = () => gfx.scale - 1;
/**
 * **Two ratios, and the canvas is native whatever the row says.** This used to be
 * one number: the canvas backing store *was* the county's resolution, and the browser
 * stretched that to the window. Which meant the frame's scale was the browser's
 * choice and not ours - and the scaling row had nothing to say, because the only
 * scale in the frame was one WebGL never performed. So the canvas is native and the
 * county is drawn at a share of it, and the resample that puts one onto the other is
 * a pass we own (`presentPass`).
 *
 * The two are equal only at scale 1, so `needsResample()` is the whole of what the
 * render row costs: at 1x the direct path is untouched, and at every other step the
 * county draws into a buffer and one quad puts it on the window.
 */
const canvasRatio = () => nativePixelRatio();
const sceneRatio = () => clamp(nativePixelRatio() * gfxRenderScale(), 0.25, RENDER_SCALE_CAP);
const needsResample = () => Math.abs(gfxRenderScale() - 1) > 1e-3;
const gfxMsaa = () => MSAA_LADDER[gfx.msaa - 1];
const gfxEdge = () => EDGE_LADDER[gfx.distance - 1];
/** The narrowest the ground is ever drawn, and **it is a piece of scenery, not a
 *  radius.** The widest thing the courses put down is a farmstead: its berth is
 *  put twenty-eight metres off the lane, and its own layout runs a further
 *  twenty-eight from that - the house at nil, the windmill at eighteen and
 *  twelve, and a mill six metres across. Seventy-eight is that whole figure with
 *  a little ground behind it, and it is the number the *drawn* outline is checked
 *  against rather than the number a corner would like.
 *
 * **The radius model would not have allowed it, and the measurement says the
 * model is the pessimistic one.** A ground row is the lane's path pushed out to
 * that row's distance, and the local radius of the lane is what decides whether
 * an offset of that distance folds: `0.9 * R` for the tightest bend in reach. On
 * the tightest corner on each of the five courses that is between eleven and
 * fifty metres, so the model caps the ground at the old floor of fifty-eight -
 * and fifty-eight is what it was drawn at, and it was *narrower than its own
 * scenery*, which is the whole of the complaint. Pushed to seventy-eight, and
 * then to a hundred and ten, the **drawn** edge was measured on every course and
 * every sample: the worst turn between real edge segments is 1.7 degrees, the
 * ribbon's width does not vary by a metre along any course, and no edge stands
 * above the terrain it is sitting on. A brief wiggle makes an offset *spike* -
 * reverse a few metres and come back - where the model reads it as a cusp, and a
 * spike in the outline is a wrinkle, not the ribbon crossing itself.
 *
* So the cap is the safety net and the floor is the width, and the floor is
 * above the cap's reach on all five courses - which is worth saying plainly,
 * because it means the bend passes below are **inert here** and are the thing
 * that would hold a course tighter than its scenery. Fifty-eight was not a limit
 * found by measuring; it was a number a model produced, and the scenery was built
 * to a different one.
 *
 * The floor is read through `gfxGroundFloor()`, which is seventy-eight at every
 * draw distance from the middle step up and **follows the edge down below it** -
 * because at eighty-five metres of ribbon the scenery would hang off the end of
 * it, and clamping the floor back up to seventy-eight would answer a shorter
 * reach with a wider one, which is the opposite of what the row is for.
 */
const gfxGroundFloor = () => Math.min(78, gfxEdge());
/** How many rows the country between the verge and the edge is packed on, read
 * through `gfxWideRows()`: a fixed count *per build*, because the ground mesh is
 *  laid on one row stride for the whole course and a sample with a different
 *  number of rows than its neighbour quietly writes over the end of the vertex
 *  array. It scales with the reach so the far-field row spacing stays roughly
 *  constant as the draw distance changes, and it is ten at the middle step, which
 *  is what the far-country work below was tuned at. */
const gfxWideRows = () => Math.max(6, Math.round(10 * gfxEdge() / 120));
const gfxPropDensity = () => PROP_DENSITY[gfx.props - 1];
/** How much more searching a denser scatter is allowed, per piece. One at the
 *  middle step, so today's placement is untouched. */
const triesBoost = () => clamp(1 + (gfxPropDensity() - 1) * 0.5, 1, 2);
const gfxGrassDensity = () => GRASS_DENSITY[gfx.grass - 1];

/** Tufts on a course, which is most of what is out there, **read through the grass
 *  row rather than written down** so a density step is one number. It lives here
 *  and not in the scenery because the settings panel's caption reads it too, and
 *  a caption asking a module further down the graph for a number the module it
 *  is a caption *for* already knows is a caption with a cycle in it. */
const grassCount = () => Math.max(64, Math.round(4800 * gfxGrassDensity()));
const gfxSsao = () => AO_LADDER[gfx.ssao - 1];
const gfxReflSize = () => REFL_LADDER[gfx.refl - 1];
const gfxReflOn = () => gfxReflSize() > 0;

/* --- the preset row is derived, never stored: the rows it owns that agree *are* a
       preset, the six switches matching that level's table make it one, and anything
       else is `mixed` and nothing else is true. Every row is asked with the same
       function, so a row that brings its own table is in the test as much as a row
       that does not ---
       **And the level is read off a row that carries no table.** Not off the first
       row, and not off the first row the preset owns either: the render scale sits
       above the ladders and the preset does not write it, so `GFX_KEYS[0]` would
       read the machine's tier off a player's screen - set the render scale to 1× on a
       machine sitting at Balanced and the whole rest of the county came back
       `mixed`. Taking the first row the preset *does* own is the same bug one row
       out, because the anti-aliasing row owns itself and brings a table with it: it
       holds 1 at Balanced, and a level of 1 asks the whole menu to be Low. Only a
       row written by identity holds the level, so that is the one that is read. */
function gfxLevelRow() { return GFX_ROWS.find((r) => !r.preset && r.own !== false && !r.map); }
function gfxLevel() { return gfx[gfxLevelRow().key]; }
function gfxAgreed() {
  const n = gfxLevel();
  if (!GFX_ROWS.every((r) => !gfxOwned(r) || gfx[r.key] === gfxRowValue(r, n))) return 0;
  const want = FX_PRESET[n - 1];
  return FX_TOGGLES.every((r) => gfx[r.key] === (want[r.key] || 0)) ? n : 0;
}
function setPreset(n) {
  for (const row of GFX_ROWS) {
    if (gfxOwned(row)) gfx[row.key] = gfxRowValue(row, n);
  }
  const want = FX_PRESET[n - 1];
  for (const r of FX_TOGGLES) gfx[r.key] = want[r.key] || 0;
  gfx.preset = n;
}
/** What the button at the foot says it does, and it is every row at its middle -
 *  **including the one the preset does not own**, because the button claims every row
 *  and a reset that quietly leaves one of them alone is a reset that does not reset. */
function setDefaults() {
  setPreset(3);
  for (const row of GFX_ROWS) {
    if (gfxOwned(row)) continue;
    // the middle of six steps is three and the middle of three is two, and both are
    // the cell that means "what this machine did before anybody asked"
    gfx[row.key] = Math.ceil(gfxRowSteps(row) / 2);
  }
}
function setRow(key, n) {
  gfx[key] = clamp(Math.round(n), 1, gfxRowSteps(gfxRowOf(key)));
  gfx.preset = gfxAgreed();
}
/** A switch counts states and not steps, so zero is its first cell and not a
 *  level below the first: the bloom's third cell is 2 and its first is 0. */
function setToggle(key, n) {
  const row = FX_TOGGLES.find((r) => r.key === key);
  gfx[key] = clamp(Math.round(n), 0, row.cells.length - 1);
  gfx.preset = gfxAgreed();
}
function gfxLoad() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(GFX_KEY) || 'null'); } catch (e) { void e; }
  if (d && typeof d === 'object') {
    for (const row of GFX_ROWS) {
      if (row.preset) continue;
      const v = d[row.key];
      // Device configuration, so a value that is not a step of this row is a
      // value from another build rather than a setting: fall back to the default.
      // **Against the row's own count and not against six**, or the msaa row -
      // three states - would read a 4 and keep it.
      if (Number.isInteger(v) && v >= 1 && v <= gfxRowSteps(row)) gfx[row.key] = v;
    }
    for (const r of FX_TOGGLES) {
      const v = d[r.key];
      if (Number.isInteger(v) && v >= 0 && v < r.cells.length) gfx[r.key] = v;
    }
    // **The one migration, off the row the six switches replaced.** The key is the
    // same key, so a machine that saved a level under the stack carries an integer
    // `fx` and not one of these, and the honest reading of that is the picture they
    // chose and not the default they never asked for. Grain and the vignette come
    // across switched on for the levels that had them, because that is what those
    // levels were.
    if (!FX_KEYS.some((k) => k in d) && Number.isInteger(d.fx) && d.fx >= 1 && d.fx <= 6) {
      const want = FX_LEGACY[d.fx - 1];
      for (const r of FX_TOGGLES) gfx[r.key] = want[r.key] || 0;
    }
  }
  gfx.preset = gfxAgreed();
}
/** Written on every change, not on a real event: these are settings for the
 *  machine and the player expects them to be there after a reload, so a crash
 *  half way through choosing a preset should not cost them the earlier choices. */
function gfxSave() {
  try {
    const d = {};
    for (const k of GFX_KEYS) d[k] = gfx[k];
    for (const k of FX_KEYS) d[k] = gfx[k];
    localStorage.setItem(GFX_KEY, JSON.stringify(d));
  } catch (e) { void e; }
}
gfxLoad();

/* ================================================================== *
 * Renderer and sky. A dome rather than a flat clear colour, anchored to
 * the world so the colour at the horizon is the same from every angle and
 * the fog can be set to exactly that colour.
 *
 * **`antialias: true`, so the frame has two smoothing mechanisms again - and one
 * of them is outside anybody's reach.** A context's multisampled default
 * framebuffer is free, and it is the only smoothing a frame drawn straight to the
 * window can have, so it is on and the direct path is anti-aliased. It is also a
 * **context-creation parameter**: `getContext` reads it once, here, and there is no
 * WebGL call that changes it afterwards, so **no row in the menu can touch the
 * direct path's anti-aliasing until the page is reloaded.** The row's `x2` and `x4`
 * are the *compositor buffer's* count and say nothing about this.
 *
 * **And it is a boolean, which is why the row says `direct only` rather than
 * quoting a number for it.** `getContext` has no way to ask the driver for two of
 * anything; it takes a boolean and the driver picks the count, four on most of
 * them. So the direct path is smoothed by a number the game cannot read, cannot
 * state and cannot change, and `gfxCaption()` names it `context MSAA` rather than
 * putting a figure on it. **A menu that quoted the row's ladder here would be
 * quoting a number it does not control** - which is what `MSAA_NAMES`' bottom cell
 * is for.
 *
 * **The wart this leaves, written down because it is visible.** The two counts are
 * not the same number: on a driver that gave the context four, `x2` on the
 * compositor path is *less* smoothed than `direct only` on the direct path. That is
 * inherent rather than a mistake in the wiring - the context's count is not a
 * parameter anybody passes - and the honest response is the caption and the row
 * name rather than a second mechanism pretending to reconcile them.
 * ================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// PCF, and **not** VSM, and the difference is a whole bug.
//
// A variance shadow map stores the mean and the mean-square of the depth and
// decides occlusion from the *spread*, so it is only as good as that spread. On
// a broad surface lying nearly flat to a low sun every texel holds almost the
// same depth, the spread goes to nothing, and the test stops being able to tell
// "something is in the way" from "this surface is nearly edge-on". It answers
// *shadowed*, and it answers it in patches with hard straight edges, because
// the answer is a bound and not a comparison.
//
// The county is the case that breaks it. A course is a wide near-flat ribbon on
// open ground, and a course is raced from dawn or from dusk - `sunH` is 0.30 at
// dawn and **0.16** at dusk, which is nine degrees of sun. The road, the
// meadow and the top of every wall are all nearly edge-on to that light, so the
// shadow came back with whole stretches of the course blacked out, going
// nowhere near an occluder - and *unfixable from the material*, which is what
// made it so hard to name: tint the road any colour you like, a black multiply
// stays a black multiply, and every surface on the course turned out innocent.
//
// PCF compares depths, and a low sun is simply a low sun to it. `radius` is
// still what softens the edge. `blurSamples` is the one that has gone: it is
// VSM's blur and PCF never reads it, and a VSM-only knob left in the file is how
// the variance map comes back.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.84;
// `autoUpdate` off with `needsUpdate` set once a frame in the loop. The loop does
// the shadow pass; anything else that calls `render()` - and on the ambient
// occlusion tiers `GTAOPass` does, once more per frame - must not do it again.
// See the note there.
renderer.shadowMap.autoUpdate = false;
// **`info.autoReset` off and reset once a frame by the loop**, because a frame is
// not one `render()` call. On the composer path it is five or six - the beauty
// pass, the occlusion pass's own render of the whole scene, bloom's downsample
// chain, its upsample chain and the output - plus six more inside a reflection
// probe when one is taken, and with the default reset on, the count the loop ends
// up holding is **whichever call ran last**, which is a blur pass of two triangles
// and says nothing at all. `renderer.info.reset()` does not touch `memory`, so
// the geometry and texture counts the leak test reads are unaffected.
renderer.info.autoReset = false;

const HORIZON = 0xdfeaf2;
const SKY_STOPS = [
  [0.00, 0x2b76c4], [0.20, 0x3f8bcd], [0.36, 0x6aa8dc], [0.46, 0xa8cbe8],
  [0.50, HORIZON], [0.55, 0xcfdedb], [0.72, 0xa4bcaa], [1.00, 0x6b7f73],
];
const SKY_R = 700;
const _skyTmp = new THREE.Color();
function skyColour(t, out) {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    if (t <= SKY_STOPS[i][0] || i === SKY_STOPS.length - 1) {
      const [t0, c0] = SKY_STOPS[i - 1], [t1, c1] = SKY_STOPS[i];
      const u = clamp((t - t0) / (t1 - t0), 0, 1);
      return out.setHex(c0).lerp(_skyTmp.setHex(c1), u);
    }
  }
  return out.setHex(SKY_STOPS[0][1]);
}
/**
 * A dome at `w` by `h` segments, painted with the county's own eight stops.
 *
 * It is a **function and not a constant** because the options menu can rebuild it:
 * the dome is one mesh of vertex colours, so a sky-quality step is a new geometry
 * disposed and swapped in, and `paintSky()` below closes over whatever is current
 * so a repaint after a rebuild lands on the new one.
 */
function buildSkyGeo(w, h) {
  const g = new THREE.SphereGeometry(SKY_R, w, h);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    skyColour((1 - pos.getY(i) / SKY_R) / 2, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
let skyGeo = buildSkyGeo(SKY_LADDER[2][0], SKY_LADDER[2][1]);
const matSky = new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false,
});
// the dome skips tone mapping so its blue survives; the fog lands on lit
// geometry that is tone mapped, so it is a shade brighter to match
const FOG_MATCH = 0xeaf3f9;

/* ================================================================== *
 * The hour of the day
 *
 * A season is raced through a stretch of a day rather than all at noon. The
 * four courses run from first light to the middle of the day, and the finale
 * that closes the season - the marathon - runs from the sun going down into
 * the dark, so the last race of a season is the one you finish by lamp light
 * and the season has a day in it that passes while you are doing it.
 *
 * Each hour is a gradient up the dome, the colour and height of the sun, the
 * bounce off the sky and off the ground, the fog it all fades into, how much
 * the exposure opens up, and how hard the street lighting wants to be on.
 * ================================================================== */
const LAMP_LIGHTS = 16;                     // how many lamps and lanterns can cast real light
const LAMP_SPACING = 15;                   // metres between lamp posts along the course
const LAMP_COLOUR = 0xffd9a0;
const WHITE = new THREE.Color(1, 1, 1);
const HOUR = {
  dawn: {
    clock: 6,                                 // where this hour stands on the clock
    haze: 0.52,
    cloud: 0xf3dcc4,
    sky: [[0.00, 0x1c3a6e], [0.30, 0x3f74b4], [0.44, 0x8fb2cf], [0.50, 0xf0c495],
          [0.545, 0xf7dcb6], [0.66, 0xc3d3cb], [1.00, 0x6f7f7a]],
    sun: 0xffd2a1, sunI: 0.95, sunH: 0.30, sunSide: 1.5,
    hemiSky: 0xc8dcf0, hemiGround: 0x6d6857, hemiI: 0.66,
    fog: 0xecd8c2, exposure: 0.88, lamps: 0.30,
  },
  morning: {
    clock: 9,                                 // where this hour stands on the clock
    haze: 0.30,
    cloud: 0xf6f9fc,
    sky: [[0.00, 0x2a63a8], [0.30, 0x4f8fcd], [0.44, 0x9cc4e0], [0.50, 0xdfeaf2],
          [0.545, 0xe8f0f2], [0.66, 0xb9cfc6], [1.00, 0x66796e]],
    sun: 0xfff0d2, sunI: 1.35, sunH: 0.78, sunSide: 1.1,
    hemiSky: 0xd2e8fb, hemiGround: 0x8b8a72, hemiI: 0.78,
    fog: 0xe9f1f6, exposure: 0.86, lamps: 0.0,
  },
  noon: {
    clock: 12,                                 // where this hour stands on the clock
    haze: 0.25,
    cloud: 0xf6f9fc,
    sky: [[0.00, 0x2b76c4], [0.30, 0x4a90d2], [0.44, 0x9ec6e6], [0.50, 0xdfeaf2],
          [0.545, 0xeaf1f3], [0.66, 0xb6cdc4], [1.00, 0x64776c]],
    sun: 0xfff6e2, sunI: 1.55, sunH: 1.15, sunSide: 0.8,
    hemiSky: 0xd6ecff, hemiGround: 0x9c9c86, hemiI: 0.82,
    fog: 0xeaf3f9, exposure: 0.84, lamps: 0.0,
  },
  dusk: {
    clock: 19.5,                                 // where this hour stands on the clock
    haze: 0.58,
    cloud: 0xecb489,
    sky: [[0.00, 0x101f3f], [0.30, 0x2c3a6b], [0.44, 0x7b5a86], [0.50, 0xe08a63],
          [0.545, 0xf0ab74], [0.66, 0x9c8e93], [1.00, 0x494a55]],
    sun: 0xff9a5c, sunI: 0.80, sunH: 0.16, sunSide: 1.7,
    hemiSky: 0x8f9dc4, hemiGround: 0x554a44, hemiI: 0.52,
    fog: 0xdfa883, exposure: 0.90, lamps: 0.85,
  },
  night: {
    clock: 23,                                 // where this hour stands on the clock
    haze: 0.90,
    cloud: 0x2b3252,
    sky: [[0.00, 0x050a18], [0.30, 0x0a1430], [0.44, 0x16224a], [0.50, 0x243056],
          [0.545, 0x2b3557], [0.66, 0x1b2138], [1.00, 0x14161f]],
    sun: 0x8fa8d8, sunI: 0.22, sunH: 0.9, sunSide: 0.6,
    hemiSky: 0x2c3a5e, hemiGround: 0x1b1c22, hemiI: 0.34,
    fog: 0x1a2036, exposure: 1.02, lamps: 1.0,
  },
};
/** Which stretch of the day a course is raced in. */
const RACE_HOURS = { day: ['dawn', 'noon'], finale: ['dusk', 'night'] };
/** That stretch on the clock: the hour a course starts at, and how long it is. */
function raceClock(finale) {
  const [a, b] = RACE_HOURS[finale ? 'finale' : 'day'];
  return { from: HOUR[a].clock, span: Math.max(0.5, HOUR[b].clock - HOUR[a].clock) };
}
/** The hour on the clock a course of this kind is raced from. */
const raceHour = (finale) => raceClock(finale).from;
/** The clock as a time of day, for anything that wants to show it. */
function clockText(h) {
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t);
  return `${String(hh).padStart(2, '0')}:${String(Math.floor((t - hh) * 60)).padStart(2, '0')}`;
}
const SKY_TS = HOUR.dawn.sky.map((s) => s[0]);       // every hour shares the stops
const _todSky = HOUR.dawn.sky.map(() => new THREE.Color());
const _c2 = new THREE.Color();
const TOD = {
  sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
  fog: new THREE.Color(), cloud: new THREE.Color(),
  sunI: 1, hemiI: 1, exposure: 0.84, lamps: 0, sunH: 1, sunSide: 1, haze: 0.3,
};
/** The hour, `u` of the way through the stretch the course is raced in. */
function timeOfDay(u, finale, out) {
  const [a, b] = RACE_HOURS[finale ? 'finale' : 'day'];
  const A = HOUR[a], B = HOUR[b];
  const t = clamp(u, 0, 1);
  for (let i = 0; i < _todSky.length; i++) {
    _todSky[i].setHex(A.sky[i][1]).lerp(_c2.setHex(B.sky[i][1]), t);
  }
  out.sun.setHex(A.sun).lerp(_c2.setHex(B.sun), t);
  out.hemiSky.setHex(A.hemiSky).lerp(_c2.setHex(B.hemiSky), t);
  out.hemiGround.setHex(A.hemiGround).lerp(_c2.setHex(B.hemiGround), t);
  out.fog.setHex(A.fog).lerp(_c2.setHex(B.fog), t);
  out.cloud.setHex(A.cloud).lerp(_c2.setHex(B.cloud), t);
  out.sunI = lerp(A.sunI, B.sunI, t);
  out.hemiI = lerp(A.hemiI, B.hemiI, t);
  out.exposure = lerp(A.exposure, B.exposure, t);
  out.lamps = lerp(A.lamps, B.lamps, t);
  out.sunH = lerp(A.sunH, B.sunH, t);
  out.sunSide = lerp(A.sunSide, B.sunSide, t);
  out.haze = lerp(A.haze, B.haze, t);
  return out;
}
/**
 * The dome's colour at one point on it, `t` being 0 at the zenith and 1 at the
 * nadir, interpolated across the stops. The dome, the environment map and the
 * fog all read the same eight stops, so this is the one place it happens.
 */
function skyAt(colours, t, out) {
  let k = 1;
  while (k < SKY_TS.length - 1 && t > SKY_TS[k]) k++;
  const u = SKY_TS[k] > SKY_TS[k - 1] ? clamp((t - SKY_TS[k - 1]) / (SKY_TS[k] - SKY_TS[k - 1]), 0, 1) : 0;
  return out.copy(colours[k - 1]).lerp(colours[k], u);
}
/** Repaint the dome, which is one mesh with a colour per vertex. */
/**
 * **The dome is tone mapped on one path and not the other, and is put right here.**
 *
 * `matSky` is `toneMapped: false`, which on the direct path means three leaves the
 * dome's hand-painted vertex colours exactly as they were painted. Rendering into
 * a render target switches three's in-material tone mapping off for *everything*
 * (`WebGLRenderer` reads `_currentRenderTarget === null` before it compiles a tone
 * mapping step into a program), so on the composer path those same colours arrive
 * at `OutputPass` untone-mapped and are ACES-mapped once there instead - and ACES
 * is a curve, not a gain: it takes this county's mid-morning sky down by about
 * half in linear terms, which is a black sky at a low sun.
 *
 * **The correction is on the value, and only on the value.** Three's ACES is two
 * matrices round a rational fit, and *the matrices are the identity on a neutral
 * colour* - each one's columns sum to one, which is the whole of what a colour
 * space round trip is - so for the grey component the chain collapses to that fit
 * alone and the answer is a single scalar per vertex, found by bisection. Scaling
 * the colour by it puts the brightness back exactly and leaves the hue where the
 * painter put it.
 *
 * **Inverting it per channel does not work and did not.** ACES's image is smaller
 * than its input gamut - the input matrices carry negative off-diagonals of about
 * -0.5 - so a saturated dawn orange has no pre-image at all, and an iteration
 * looking for one walks off into negative components and comes back as a magenta
 * band with a cyan one under it. A one-dimensional monotone root cannot do that:
 * every step of it is a positive scale.
 *
 * What is left over is ACES's desaturation, the sky on the composer path sitting
 * a little greyer than the same sky on the direct one, which is the price of not
 * painting a sky that is out of gamut.
 *
 * `TOD.exposure` rather than `renderer.toneMappingExposure`, because `OutputPass`
 * reads the renderer and the hour writes the exposure *after* it has painted the
 * dome - and the two are the same number by the time the frame is drawn.
 */
const rrtFit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
/**
 * The dome's own tone-map correction, and **the chain's up-ness comes in as an
 * argument.** That is the second signature in this file that is not a straight
 * move, and the reason is `refreshEnvironment`'s: `composerUp` is the post
 * chain's, it is a `let` over there, and this module reading it would have had
 * the sky's module import the module that draws the frame.
 *
 * **It is the flag and not `needsComposer()`, and that is deliberate.** The flag
 * and the predicate disagree in exactly one window - while the post-processing
 * addons are still downloading `syncComposer()` returns early and leaves
 * `composerUp` false on a tier that wants the chain - and in that window the
 * dome is painted uncorrected and repainted the instant the addons land, so the
 * two answers converge before a frame is drawn either way. Handing the flag
 * across keeps that exactly as it was; asking the setting would be the better
 * rule and would be a behaviour change inside a move, and a move is not the
 * place for one.
 */
function domeToneFix(c, chainIsUp) {
  if (!chainIsUp) return c;
  const k = TOD.exposure / 0.6;
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  if (l <= 1e-4) return c;
  let lo = 0, hi = 8;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    if (rrtFit(l * mid * k) < l) lo = mid; else hi = mid;
  }
  return c.multiplyScalar((lo + hi) * 0.5);
}
/** Repaint the dome's vertex colours for an hour, corrected for whichever path
 *  the next frame is about to take. */
/**
 * Stand the dome up at a new resolution, and hand the old one back to be
 * disposed. **A function and not a reassignment**, and that is the same
 * `STANDING` lesson the scenery register teaches: `skyGeo` is a `let` here, and a
 * module's live bindings are read-only from outside, so `applySky()` assigning
 * it was a `TypeError: Assignment to constant variable` at boot. Returning the
 * old geometry is also the honest shape - it is the thing the caller disposes,
 * and it is the geometry that is *no longer* the dome.
 */
function setSkyGeo(geo) {
  const old = skyGeo;
  skyGeo = geo;
  return old;
}

function paintSky(colours, chainIsUp) {
  const pos = skyGeo.attributes.position, col = skyGeo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    skyAt(colours, (1 - pos.getY(i) / SKY_R) / 2, _c2);
    domeToneFix(_c2, chainIsUp);
    col.setXYZ(i, _c2.r, _c2.g, _c2.b);
  }
  col.needsUpdate = true;
}

/* ------------------------------------------------------------------ *
 * The environment
 *
 * A PBR surface wants an environment, and there is no image of one anywhere in
 * this project - so it is made. The eight sky stops the dome is painted from
 * are rasterised into a small equirectangular image, which is run through a
 * PMREM generator and handed to both scenes. It is the same sky the player can
 * see, which is the only reason a snail's shell and a pool of water agree with
 * the weather, and it is refreshed in the same block as `paintSky`, on the same
 * cadence, because a stale environment is visible the moment the light moves.
 * ------------------------------------------------------------------ */
const ENV_W = 64, ENV_H = 32;
const envPixels = new Uint16Array(ENV_W * ENV_H * 4);
const envSource = new THREE.DataTexture(envPixels, ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType);
envSource.mapping = THREE.EquirectangularReflectionMapping;
envSource.minFilter = envSource.magFilter = THREE.LinearFilter;
envSource.generateMipmaps = false;
const envPmrem = new THREE.PMREMGenerator(renderer);
let envTarget = null;
/** Rasterise the current sky, with the sun in it, and pre-filter it. */
/**
 * Repaint the environment from the dome's own colours, and hang it on whichever
 * scenes asked for one. **The scenes come in as an argument**, and that is the
 * one signature in this file that is not a straight move: `env` and `stageEnv`
 * are the post chain's, they are `let` over there, and this module reading them
 * would have had the settings panel import the module that draws the frame. The
 * two of them are a list because the call site already has one - it walks the
 * same pair on the line after to set the sun's colour on each.
 */
function refreshEnvironment(colours, envs) {
  // where the sun sits on the dome: the sky's own `t`, 0 at the zenith and 1 at
  // the nadir, and a bearing round it
  const sunT = clamp((1 - TOD.sunH) * 0.5, 0.02, 0.98);
  const sunLon = Math.atan2(TOD.sunSide, 1) * 1.6;
  // A modest sun, deliberately. The key light is the light in this world; the
  // environment's job is the sky's own colour and a soft directional bias for
  // the specular to lean on, and a hot disc in a pre-filtered map is what turns
  // a pool of water into a sheet of white.
  const sunI = 1.9 * clamp(TOD.sunI / 1.55, 0, 1.2);
  const sunR = 0.13;
  for (let y = 0; y < ENV_H; y++) {
    // row 0 is the bottom of the image and the bottom of the sky, so the
    // zenith is the last row
    const t = 1 - (y + 0.5) / ENV_H;
    skyAt(colours, t, _c2);
    for (let x = 0; x < ENV_W; x++) {
      const o = (y * ENV_W + x) * 4;
      // the sun is a soft disc, not a pixel: at this size a hard one is a
      // single bright texel and the pre-filter turns it into a ring
      let dl = Math.abs(t - sunT) * 2.6;
      const dl2 = ((x + 0.5) / ENV_W) * TAU - Math.PI - sunLon;
      dl += Math.abs(Math.atan2(Math.sin(dl2), Math.cos(dl2))) * 0.5;
      const sun = sunI * Math.exp(-(dl * dl) / (sunR * sunR));
      envPixels[o] = THREE.DataUtils.toHalfFloat(_c2.r + sun * 1.0);
      envPixels[o + 1] = THREE.DataUtils.toHalfFloat(_c2.g + sun * 0.94);
      envPixels[o + 2] = THREE.DataUtils.toHalfFloat(_c2.b + sun * 0.80);
      envPixels[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  envSource.needsUpdate = true;
  const next = envPmrem.fromEquirectangular(envSource);
  if (envTarget) envTarget.dispose();
  envTarget = next;
  for (const e of envs) if (e) e.scene.environment = envTarget.texture;
}

/**
 * A scene's light: its dome, its fog, its sun, its three fills and its sixteen
 * lamp slots. **The third argument is whether this env's lamp bank can ever take
 * a lamp**, and it is asked here at construction because the number of lights in
 * a scene is baked into every program drawn in it - a bank that is switched off
 * and on with the binding is a recompile of the county every time the binding
 * moves, and the general form of it is that **a count that decides what is
 * compiled may not be a count that changes with the camera.** The race env says
 * yes; the stable says no and carries sixteen dark lights that never enter its
 * light list, because `lampPosts` is empty there and a light nothing can bind to
 * is a light no fragment should be paying for.
 */
function makeEnv(fogNear, fogFar, lit) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_MATCH, fogNear, fogFar);
  const sky = new THREE.Mesh(skyGeo, matSky);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  // the ground half is a neutral stone, so a vertical rock face is grey
  // rather than picking up the olive of the turf it stands in
  const hemi = new THREE.HemisphereLight(0xd6ecff, 0x9c9c86, 0.80);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff3dc, 1.45);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -13;
  key.shadow.camera.right = 13;
  key.shadow.camera.top = 13;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 36;
  key.shadow.radius = 7;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xbcd8f5, 0.35);
  rim.position.set(-4.5, 2.6, -4.0);
  scene.add(rim);
  // a fill that rides with the eye, so the faces turned away from the sun -
  // the back of a wall, the near side of a bank - are not black holes
  const fill = new THREE.DirectionalLight(0xe4eef8, 0.55);
  scene.add(fill, fill.target);
  // The lamps, which are dark until the hour asks for them - **and which are
  // never switched off**, which is the whole of what the third argument is for.
  //
  // **A light's `visible` is not whether it is lit, it is whether it is in the
  // render state's light list**, and the list is what `NUM_POINT_LIGHTS` is
  // written out of, once per material, once per program. So a lamp handed a light
  // and then handed it back is not one lamp going dark: it is a different number
  // in every program in the county, and every material that draws this frame
  // stops being the program it was and becomes one three has to build. Measured
  // on Grand Marathon by walking the inspector down the lane in 40 cm steps:
  // **19 of 120 frames compiled anything at all, 522 shader compiles in 120
  // frames, and every one of those 19 frames was a frame the visible lamp count
  // had changed on** - and on this machine's own renderer **ten frames out of 250
  // walked cost 682 to 710 ms each**, with the frame average over that walk going
  // from 8.3 ms to 33.2 ms. It is the same sentence the render scale row is
  // written against: **a count that decides what gets compiled may not be a count
  // the camera moves.**
  //
  // So the count is a property of the scene and is settled here, once: sixteen in
  // a race, and **none on the stable, which has no lamps to bind to and so pays
  // for no light it never switches on**. `litLamps()` moves the glass and writes
  // the intensity, and the intensity is the whole of what a dark lamp is.
  const lamps = [];
  for (let i = 0; i < LAMP_LIGHTS; i++) {
    const l = new THREE.PointLight(0xffd9a0, 0, 13, 1.6);
    l.visible = lit;
    scene.add(l);
    lamps.push(l);
  }
  // and **which of the sixteen is standing on a lamp**, which `visible` cannot be
  // asked for any more. One flag per slot beside the bank, because the bank is
  // always in the scene and the binding is always moving: the two stopped being
  // the same fact the moment the count stopped following the binding.
  const lampOn = new Uint8Array(LAMP_LIGHTS);
  // how high and how far round the sun sits, and how much of it there is: the
  // hour of the day writes these, the frame loop follows the snail with them
  return { scene, sky, key, rim, fill, hemi, lamps, lampOn, sunHeight: 1, sunSide: 1, sunI: 1 };
}
// ------------------------------------------------------------------
// What the other modules ask this one for, and the list is the settings
// panel written out: eleven rows, their ladders, the predicates that read
// them, and the renderer itself. **The predicates are here and not in the
// modules that use them** so that "how far is the draw distance on this
// machine" has one answer, and the surface and the course modules ask it
// rather than each keeping their own idea of the row.
// ------------------------------------------------------------------
export {
  gfx, gfxScale, setPreset, setDefaults, setRow, setToggle, gfxSave, gfxLoad,
  RENDER_SCALE, RENDER_SCALE_CAP, SCALE_NAMES, SCALE_TAPS, GFX_STEPS, GFX_ROWS,
  nativePixelRatio, canvasRatio, sceneRatio, needsResample,
  FOG_LADDER, EDGE_LADDER, SHADOW_MAP, SHADOW_RADIUS, SHADOW_CAST,
  PROP_DENSITY, GRASS_DENSITY, SKY_LADDER, AO_LADDER, GI_RADIUS, GI_INNER, GI_THICK,
  REFL_LADDER, REFL_FRESNEL, MSAA_LADDER, MSAA_NAMES, MSAA_SHORT, MSAA_PRESET, POM_STEPS, POM_BISECT, PRESET_NAMES,
  FX_TOGGLES, FX_KEYS, FOG_MATCH,
  gfxMsaa, gfxEdge, gfxGroundFloor, gfxWideRows, gfxPropDensity, gfxGrassDensity, grassCount,
  gfxSsao, gfxReflSize, gfxReflOn, triesBoost,
  renderer,
  buildSkyGeo, setSkyGeo, skyGeo, matSky, paintSky, domeToneFix, timeOfDay,
  envPmrem, makeEnv, refreshEnvironment,
  LAMP_LIGHTS, LAMP_SPACING, LAMP_COLOUR,
  raceClock, raceHour, clockText, TOD, WHITE, _todSky,
};