// snail-race.js - the whole game. Split out of snail-race.html.
/* ================================================================== *
 * Snail Grand Prix
 * A racing game in a walled valley: rock walls to climb, ponds to swim
 * and gaps to fly; every snail carries five traits and the course you are
 * on decides which one is working.
 * ================================================================== */
// The county's palette, and the three builders in meshes/ that paint from the
// same jar. It is a plain module and imports nothing, so it loads before this
// one and costs no round trip of its own.
import { COUNTY as C, FLOWER_COLORS as FLOWER_HEX, GREEN as GREEN_T, STONE as STONE_T } from './meshes/palette.js';
import { CONVERTED, MAPS, SURFACE, allMaps, allParts, mapSlots, mapsFor, slotFor } from './meshes/maps.js';
let THREE;
try {
  THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
} catch (err) {
  document.getElementById('boot').textContent = 'Could not load three.js from the CDN — connect and reload.';
  throw err;
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x) => x * x * (3 - 2 * x);
const $ = (id) => document.getElementById(id);

/* ================================================================== *
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

/** **How the county's resolution becomes the window's pixels.** Three steps and not
 *  six, because the middle of the ladder is bilinear and the top two are bicubic and
 *  a row with a step nobody would ever choose is a cell spent for nothing. The
 *  bottom four are bilinear and not nearest on purpose: nearest is one fetch and
 *  bilinear is four, so nearest is the cheap end, but at 0.5x a nearest neighbour is
 *  four square blocks for every texel and the row that is meant to make a machine
 *  playable is the one that makes it unplayable.
 *
 *  **Nearest and bilinear are hardware and bicubic is not**, so the first two are
 *  four and one explicit taps and the third is sixteen - and the tap count is the
 *  caption, because a filter you cannot see the cost of is a filter nobody chooses
 *  on purpose. The taps are written out rather than left to the sampler, at texel
 *  centres, so the texture's own `minFilter` cannot change the answer: a row that
 *  reads the bloom's input as well is a row that quietly alters the bloom. */
const SCALE_NAMES = ['nearest', 'bilinear', 'bicubic'];
/** What each one costs a pixel, and the caption's whole content. Written beside
 *  the names and not counted in the shader, so the menu cannot quote a price the
 *  shader does not charge. */
const SCALE_TAPS = [1, 4, 16];
/** What each preset writes onto the scaling row: bilinear everywhere but the top
 *  two, which are bicubic. A row that does not rise with quality does not mean what
 *  its neighbours mean. */
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
 * The occlusion row, **which is a 2x2 and not one axis**: resolution on one side
 * of it and indirect light on the other, so the six steps read
 * `{off, G half, G full, G+GI half, G+GI full, G+GI full with a finer kernel}`.
 *
 * **The `gi` field is the whole of what a step decides about the new pass** - it
 * is zero or absent on the two G-only steps, so they construct nothing and pay
 * exactly what they paid before this, and it is the `uGIStrength` the composite
 * multiplies the irradiance by on the four that have it. A row that grows a
 * second axis is a row that has to be spread, because the alternative - a seventh
 * `fx` switch - is a second place the same decision is written down.
 *
 * **And `half` is now the answer to two questions at once.** It already sized the
 * existing G-buffer, and it sizes the new albedo buffer with it, so the "Light
 * G+GI" step at index 3 runs the ray march over a quarter of the pixels for the
 * same reason level 1 exists at all: that step is the one a machine that cannot
 * pay for the top one can still be given something better than no light at all.
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
  { half: true, samples: 4, radius: 0.8, blend: 0.95, gi: 0 },
  { samples: 8, radius: 0.8, blend: 0.95, gi: 0 },
  { half: true, samples: 8, radius: 0.7, blend: 0.95, gi: 0.95 },
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
  { key: 'fxBloom', name: 'Bloom', cells: ['off', 'bloom', 'bloom hi'], short: 'bloom',
    cost: 'a composer pass' },
  { key: 'fxWind', name: 'Wind', cells: ['off', 'on'], short: 'wind',
    cost: 'a uniform on five materials' },
];
const FX_KEYS = FX_TOGGLES.map((r) => r.key);
/** What each preset writes, and it is the stack with the grain and the vignette
 *  lifted out of it: every level keeps its glow, level 4 its cloud shade, level 5
 *  its bloom and level 6 its wind, so a player climbing the ladder under the new
 *  menu arrives at the picture they chose under the old one. */
const FX_PRESET = [
  { fxGlow: 1 },
  { fxGlow: 1 },
  { fxGlow: 1 },
  { fxGlow: 1, fxCloud: 1 },
  { fxGlow: 1, fxCloud: 1, fxBloom: 1 },
  { fxGlow: 1, fxCloud: 1, fxBloom: 2, fxWind: 1 },
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
 *  because a one-sample target is the same as no target with more bookkeeping. */
const MSAA_LADDER = [0, 2, 4];
const MSAA_NAMES = ['off', 'x2', 'x4'];
/** What each preset writes onto the anti-aliasing row, and **the row has to carry a
 *  table of its own** rather than be written by identity like the other eight: three
 *  states cannot hold six numbers, so a cascade writing *N* into it would put a step
 *  it has no cell for on the row and a cell it cannot reach in the table. Balanced is
 *  `off`, which is the picture the composer path has always drawn, and the top three
 *  are x4 - a row that rises with quality or it does not mean what its neighbours
 *  mean. */
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
  { key: 'refl', name: 'Reflections', short: 'reflections' },
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
  fxGlow: 1, fxVig: 0, fxGrain: 0, fxCloud: 0, fxBloom: 0, fxWind: 0,
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
/** The drawn ribbon's *width*, and **it is a piece of scenery, not a radius** - the
 *  widest thing a course puts down is a farmstead whose berth stands twenty-eight
 *  metres off the lane. So a draw distance that reaches less than that has its
 *  floor pulled down with it, rather than being clamped back up to it. */
const gfxGroundFloor = () => Math.min(78, gfxEdge());
/** How many rows the country between the verge and the edge is packed on. A fixed
 *  count, because the ground mesh is laid on one row stride for the whole course
 *  and a sample with a different number of rows than its neighbour quietly writes
 *  over the end of the vertex array. Scaled with the reach so the far-field row
 *  spacing stays roughly constant - and exactly 10 at level 3, as it has always
 *  been. */
const gfxWideRows = () => Math.max(6, Math.round(10 * gfxEdge() / 120));
const gfxPropDensity = () => PROP_DENSITY[gfx.props - 1];
/** How much more searching a denser scatter is allowed, per piece. One at the
 *  middle step, so today's placement is untouched. */
const triesBoost = () => clamp(1 + (gfxPropDensity() - 1) * 0.5, 1, 2);
const gfxGrassDensity = () => GRASS_DENSITY[gfx.grass - 1];
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

// The courses and the seasons live in their own files, so a season can be
// rebalanced, a tier moved up the ladder, or a course resized without touching
// any code. A season names the races it runs and the one that closes it; a
// course's `scale` multiplies its length: 1, 1.5 and 3 are the sizes that have
// been played, and anything in between works.
async function loadData(file, what) {
  let res;
  try {
    res = await fetch(file);
  } catch (err) {
    document.getElementById('boot').textContent = `Could not load ${file} — is it being served next to the page?`;
    throw err;
  }
  if (!res.ok) {
    document.getElementById('boot').textContent = `Could not load ${file} (${res.status}).`;
    throw new Error(file + ' ' + res.status);
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    document.getElementById('boot').textContent = `${file} did not contain a list of ${what}.`;
    throw new Error(file + ' is not a list of ' + what);
  }
  return data;
}
const [SEASONS, RACES] = await Promise.all([
  loadData('seasons.json', 'seasons'),
  loadData('races.json', 'courses'),
]);
const CATS = RACES;
for (const c of CATS) {
  if (typeof c.len !== 'number' || typeof c.scale !== 'number' || c.scale <= 0) {
    document.getElementById('boot').textContent = `races.json: "${c.id || '?'}" needs a positive len and scale.`;
    throw new Error('bad course ' + c.id);
  }
  // the length the course is actually laid out to
  c.len = c.len * c.scale;
}
const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));

/* ================================================================== *
 * The meshes live in meshes/ as .glb files: a prop is written once and
 * drawn a thousand times, and a snail is one file that is cloned per racer
 * and recoloured. Only the course itself is still built here, because it is
 * built out of the numbers in races.json - the ground, the bed, the skirt,
 * the water and the start and finish furniture all come from the track.
 * ================================================================== */
const MESH_FILES = [
  'conifer', 'evergreen', 'broadleaf', 'bush', 'rock', 'mossy-rock', 'tuft', 'marker', 'lily', 'lily-pad', 'reeds', 'seashell',
  'lamp-post', 'lamp-glass', 'lantern-post', 'lantern-glass',
  'mushroom-red', 'mushroom-brown',
  'mushroom-giant', 'mushroom-pale', 'mushroom-rooted',
  'lantern-pole', 'lantern-arch',
  'hut', 'windmill', 'barn', 'well', 'scarecrow', 'crate', 'push-crate', 'fence',
  'corn-plot', 'sprout-plot',
  'palm', 'fountain',
  'watchtower',
  'shell-bands', 'shell-swirl', 'shell-spots',
  'snail',
];
const props = {};
const propMat = {};
/**
 * A geometry to the material its own file declared, and only for the props that
 * have been converted. `scatter()` looks a part up here, so a prop that has
 * maps is drawn with them without a call site having to say so, and a prop that
 * has none is drawn with the material the call site asked for - which is what
 * makes the migration one prop at a time.
 */
const propMatFor = new Map();
const CONVERTED_SET = new Set(CONVERTED);
let snailTemplate = null;
/** The material a prop is drawn with: its own file's once it has maps, the
 *  call site's otherwise. One answer, so every site in the game agrees. */
function matFor(name, fallback) {
  if (!CONVERTED_SET.has(name)) return fallback;
  return propMatFor.get(props[name]) || propMat[name] || fallback;
}
/**
 * The material one **part** of a prop is drawn in, which is not the same
 * question as `matFor` and cannot be asked through it: `props[name]` is the
 * piece itself, and a piece of three parts has two of them the loader has
 * already registered materials for under its own geometry. A windmill's sails
 * are the case that needs it - they are the only part of any prop in the county
 * that is drawn in a material the game never named.
 */
const partMat = (geo, fallback) => propMatFor.get(geo) || fallback;
/**
 * Pull in the mesh library. Every file is one mesh; the snail is one tree.
 *
 * The material in the file is kept, not thrown away. That is the change that
 * makes maps possible at all: the game used to take the geometry and hand the
 * prop one of its own `mat.*`, so a `map` or a `normalMap` written into a glb
 * had nowhere to survive. The material GLTFLoader hands back already has the
 * right name, the right roughness and `vertexColors` set the way the file asked,
 * and the name matters: `makeSnail()` buckets a racer's meshes by
 * `o.material.name` and repaints four of them, leaving `eye` alone.
 *
 * The glb carries no images, so the maps come from `meshes/tex/` by name, out
 * of the one manifest in `meshes/maps.js`. A prop whose maps have not been
 * written yet simply has none, and draws as it always did.
 */
async function loadMeshes() {
  const { GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const tex = await loadMapTextures();
  const live = CONVERTED_SET;
  const loaded = await Promise.all(MESH_FILES.map(async (name) => {
    $('boot').textContent = 'loading the meshes…';
    return [name, await loader.loadAsync('meshes/' + name + '.glb')];
  }));
  for (const [name, gltf] of loaded) {
    const root = gltf.scene.getObjectByName(name) || gltf.scene.children[0];
    if (name === 'snail') { snailTemplate = root; continue; }
    // Most of these are one mesh. A lantern is two, because its paper is the
    // part that lights up and the frame it hangs on is not: so everything the
    // file holds is kept, keyed by the part each mesh is named after, and the
    // first is the piece itself. The part name follows the file name with a
    // dash - a dot would not survive the trip through the glb, and then a
    // lantern would quietly draw as its frame and nothing else.
    const parts = {}, mats = {};
    let strays = 0;
    // the whole scene, not the node the name matched: a piece made of parts has
    // a node for each of them and none of them carries the bare name
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // one geometry for every racer and every track that draws it, so it is
      // marked shared and survives a course being torn down
      o.geometry.userData.shared = true;
      const key = o.name.startsWith(name + '-') ? o.name.slice(name.length + 1) : '';
      if (key) { if (!parts[key]) { parts[key] = o.geometry; mats[key] = o.material; } return; }
      if (parts['']) { strays++; return; }
      parts[''] = o.geometry; mats[''] = o.material;
    });
    const keys = Object.keys(parts);
    if (!keys.length) throw new Error('no mesh in meshes/' + name + '.glb');
    // a piece with parts and a mesh that is not one of them would draw as half
    // of itself, which is worse than not drawing at all
    if (strays) throw new Error(`meshes/${name}.glb: ${strays} mesh(es) not named "${name}-part"`);
    // every part of a piece draws in the first part's material unless its own
    // says otherwise, so a file with one material is one material and a file
    // with two gets two. The maps are named in the manifest, not embedded, and
    // a prop split into parts is named per part, because the moss on a stone
    // is not granite.
    const fileMat = mats[keys[0]];
    for (const key of keys) {
      const m = mats[key] || fileMat;
      applyMaps(m, mapsFor(name, key), tex);
      if (live.has(name)) propMatFor.set(parts[key], m);
    }
    props[name] = parts[keys[0]];
    propMat[name] = fileMat;
    if (keys.length > 1) { props[name + '.parts'] = parts; propMat[name + '.parts'] = mats; }
    // How much ground the piece stands on, in metres: the furthest it reaches
    // from the axis of its own origin in the horizontal plane. A bounding
    // sphere is no use here - a mushroom is as tall as it is wide and a
    // windmill is twice as tall as it is wide, and a sphere would have the
    // windmill reserving twice the clearing it needs. This is the number the
    // arrangement below uses to keep two big things off each other, so it is
    // the piece's own geometry answering and not a figure in a table.
    for (const key of keys) {
      const p = parts[key].attributes.position;
      let foot = 0;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i), p.getZ(i));
        if (d > foot) foot = d;
      }
      parts[key].userData.foot = foot;
    }
    // And the **whole** piece's figure onto the first part, because the first
    // part is what `props[name]` is and it is the geometry a caller who did not
    // ask for the parts passes to `scatter()`, and `crowdOf()` reads that one.
    // A prop that has been split into parts is split by **surface** - a cap from
    // its stalk, a sail from its tower - and the surface is not the piece: the
    // pale mushroom's stem reaches a metre and a half and its cap reaches four,
    // and taking the stem's figure would let two of them stand with their caps
    // inside each other, which is the one thing `crowdOf()` exists to stop. The
    // largest of them is the piece's, so the largest is what the piece reserves.
    if (keys.length > 1) {
      parts[keys[0]].userData.foot = Math.max(...keys.map((k) => parts[k].userData.foot));
    }
  }
  // the maps a prop declares but has no file for are a hole in the migration,
  // and a hole nobody can see is how a library ends up half converted
  for (const name of Object.keys(MAPS)) {
    for (const part of allParts(name)) {
      const gone = mapsFor(name, part).filter((m) => !tex.has(m));
      if (gone.length) console.warn(`meshes/${name}.glb${part ? '-' + part : ''} declares ${gone.join(', ')} but meshes/tex/ has none`);
    }
  }
  return tex;
}
/** The one map table the whole load shares, so the course surface can reach it. */
let MAPS_TEX = null;

/**
 * Every map in the manifest, as a texture, skipping the ones with no file
 * beside them. One fetch for the whole library rather than one per prop, and a
 * missing PNG is a warning and not a boot failure: the library is converted a
 * prop at a time and the game runs the whole way through.
 */
async function loadMapTextures() {
  const loader = new THREE.TextureLoader();
  const want = allMaps();
  const got = new Map();
  await Promise.all(want.map((name) => new Promise((res) => {
    loader.load('meshes/tex/' + name + '.png', (t) => {
      // a colour map is read as sRGB; a normal, a roughness or an occlusion is
      // data and reading it as colour is what makes a normal map come out flat
      t.colorSpace = slotIsColour(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      got.set(name, t);
      res();
    }, undefined, () => res());
  })));
  return got;
}
/** A map whose suffix names a colour channel is read as sRGB; the rest are data. */
function slotIsColour(name) {
  const slot = slotFor(name);
  return !slot || slot === 'map' || slot === 'emissiveMap';
}
/** Hand a material the maps the manifest names for its prop. */
function applyMaps(m, list, tex) {
  for (const name of list) {
    // `mapSlots()` and not `slotFor()`: a `-rgh` is the glTF packing and fills
    // **two** fields, because three reads roughness out of `roughnessMap.g` and
    // metalness out of `metalnessMap.b`. That is what makes the crate's iron an
    // iron.
    for (const slot of mapSlots(name)) {
      if (tex.has(name)) m[slot] = tex.get(name);
    }
  }
  // nothing to do if the file is not there: an absent map is a prop that has
  // not been converted yet, and the loader takes both
}
try {
  MAPS_TEX = await loadMeshes();
} catch (err) {
  $('boot').textContent = `Could not load the meshes from meshes/ (${MESH_FILES.length} files) — is the folder being served with the page?`;
  throw err;
}

/* ================================================================== *
 * Tuning
 * ================================================================== */
const RUN = 0, CLIMB = 1, SWIM = 2, FLY = 3, WALK = 4, PUSH = 5;
/* What a snail covers a second at its best, by what it is doing. Every speed in
 * the sim is one of these times a factor for the trait that suits the ground and
 * one for how well the snail races. Footpath is the reference: everything else
 * is a fraction of a snail going along a flat path, and the gaps between them
 * are the whole argument for building a snail. */
const BASE_RUN = 4.5;                       // footpath
const BASE_CLIMB = 3.1;                     // a wall
const BASE_FLY = 2.8;                       // the air over a gap
const BASE_SWIM = 2.9;                      // water
const BASE_WALK = BASE_RUN * 0.9;          // the floor of a chasm: on its feet, on broken ground
const BASE_PUSH = BASE_RUN * 0.42;         // a crate: on its feet again, and a snail against a box
const CLIMB_GRADE = 0.5;                    // how hard a wall's steepness bites on the speed of a climb
/** The lane everywhere else: half of five and a half metres, and eight abreast. */
const LANE_HW = 2.8;
/**
 * The crate, and it is seven numbers and one shape.
 *
 * **A crate is a cube**, and that is the whole of its silhouette: a long low box
 * reads as a plank with sides on, and the thing a snail pushes across a road is a
 * box with boards on it. So all three of its edges are `CRATE_S`, and the model
 * is built to that number rather than fitted to anything.
 *
 * **And `CRATE_S` is set by the lane and not by taste.** The lane is five and a
 * half metres wide and eight racers abreast, which is 660 mm of pitch, and a
 * crate for every racer has to sit in its own 660 mm with air either side of it:
 * 620 mm leaves forty. That is a crate about the size of the snail pushing it,
 * which is what a fruit crate is, and it is also the only cube the county has
 * room for - a metre and a half cube would overlap its neighbour by nine hundred
 * millimetres.
 *
 * **The dish is the crate's own size, and its ends are cut rather than eased.**
 * `CRATE_X` is its length in the planner's `x`, and the whole of the drop is
 * taken in the **first sample** of it and the whole of the rise in the last -
 * which is what a `leap` does with its chasm and the reason a leap reads as a
 * hole. Eased over a quarter at each end it came out as a trough: `CRATE_X` was
 * 2.8 m of `x`, the dish 3.4 m of road and 0.45 deep, and a bowl you could put a
 * cart in. **A crate is 620 tall, so a hole it bridges cannot be a `leapClimb`'s
 * cliff and it is not pretending to be one** - the 2.6 m of water under a
 * `leapClimb`'s lip is what makes that face stand at seventy degrees, and a
 * notch a snail is meant to walk a box across is half a metre of the same
 * bargain. What the notch can be is a **crease**: a hard lip taken in one sample,
 * a bare stone floor, and a length of about the box's own, so the crate fills it
 * and overhangs it and the road is broken where the crate stands.
 *
 * **And the crate's lid is the road.** The depth is a little under `CRATE_S`, so
 * the box stands ninety millimetres proud of the clay at each end of a bridge
 * that is otherwise level, and the whole of the obstacle is a nine-centimetre
 * step on and off a hole. The snail is on the lid from the near lip to the far
 * one and never in the notch, so a notch the crate does not cover is not a hole
 * a snail has to climb out of.
 *
 * `CRATE_BACK` is how far back the crate starts, and `CRATE_GAP` is the snail's
 * own `s` to the crate's centre: it begins shoving the moment the crate is that
 * far ahead of it, so the shove run is the two of them together and `CRATE_LANE`
 * is the clear road a course has to give it, in the planner's `x` - which is the
 * shorter of the two distances here, so a floor in `x` is a longer run in `s` than
 * the number looks.
 *
 * **And the apron a crate is shoved down is a wider lane and not a wider crate.**
 * Eight abreast at `LANE_HW` is 657 mm of pitch and a cube of 620 leaves 37
 * between neighbours - and the field does not hold the slot it was given, it
 * drifts a snail 120 either side of it, so two of them met with 200 mm of
 * overlap and a row of boxes that walked sideways down the road as it went. So the
 * road opens out to `CRATE_HW` for the whole shove, which is 857 of pitch and 240
 * of air, **and the field's lane is a share of the half-width rather than a
 * distance off the centre line**: a road that opens for a crate is a road the
 * eight of them spread into, and a crate row stepped wider on its own would be
 * eight boxes standing in the verge with a snail walking between two of them.
 *
 * The apron opens over `CRATE_FLARE` and not at a row, because a row is 0.75 m
 * apart and the edge would step a third of a metre sideways between two of them,
 * which is a crease and not a shoulder. **And it is the drift that goes and not
 * the width alone**, read off the same `fr.w` the slot comes off, so the wander
 * reaches nothing exactly where the road is widest and a snail with its hands on a
 * box walks it straight.
 *
 * **And the notch is packed, which is the whole of what makes it a hole.**
 * A hole cut in a lane is only the shape its samples carry: the lane carries one
 * row every `STEP`, so a notch cut across it has two walls a whole row apart and a
 * floor of no length at all - a crease, and a crease reads as rounded however deep
 * it is. So `roadRows()` lays four rows of its own either side of the two lips,
 * `CRATE_WALL` apart on each side, which puts the drop into eight centimetres of
 * arc and leaves a floor the width of the crate between them: eighty-four degrees
 * of wall, a floor of six hundred and seventy, and a box that fills it. **All three
 * of those meshes take the packed rows and not the samples** - ribbon, flank and
 * ground - because the ground's surface is a straight line between two samples it
 * was given, and a ground that eases down the notch over three quarters of a metre
 * puts a hillside over the bottom two thirds of the hole.
 */
const CRATE_S = 0.62;                       // a cube crate: side, and height, and width
const CRATE_X = 0.95;                       // the dish's length in design x: about the crate's own
const CRATE_BACK = 2.6;                     // the crate's start centre, back from the near lip
const CRATE_GAP = CRATE_S / 2 + 0.25;       // the snail's `s` to its own crate's centre
const CRATE_LANE = 3.0;                     // clear road a crate needs in front of its dish
const CRATE_HW = 3.5;                       // the half-width of the apron, and not the half-width of the county
const CRATE_FLARE = 1.2;                    // metres either side of the shove over which the lane opens
const CRATE_WALL = 0.04;                    // metres of arc either side of a lip: the wall is twice this


const HOURS_PER_SECOND = 1 / 60;            // a minute of racing is an hour of the day: the clock a course is raced on
const LEVEL_Y = 0;                          // the height a course runs at when it asks to run level
const POOL_BANK = 5.2;                      // how far a pool's water reaches past the lane's own edge
const POOL_SPREAD = 0.28;                   // and how much wider it gets for every metre of gap
const POOL_BERM = 1.4;                      // and how far the sand keeps on past the water's edge
const COND = [
  { key: 'run',   name: 'footpath', attr: 'running',  base: BASE_RUN,   cls: 'run' },
  { key: 'climb', name: 'wall',      attr: 'power',    base: BASE_CLIMB, cls: 'climb' },
  { key: 'swim',  name: 'water',     attr: 'swimming', base: BASE_SWIM,  cls: 'swim' },
  // A gap is only a gap while you are in the air over it. The bottom of one is
  // ground like any other, and it is a separate state so a snail that missed
  // the jump is walking on the floor of the chasm at walking pace - on its
  // feet and on its running, not flying along it.
  { key: 'fly',   name: 'gap',       attr: 'flying',   base: BASE_FLY,   cls: 'fly' },
  { key: 'walk',  name: 'walking',   attr: 'running',  base: BASE_WALK,  cls: 'walk' },
  // A crate is a wall you push through rather than over, and it is **appended**
  // and not inserted: the index of every condition is load-bearing for the
  // progress rail, the card's stroke list and the readout, and a sixth in the
  // middle of this array moves all three without one of them saying so.
  { key: 'push',  name: 'crate',     attr: 'power',    base: BASE_PUSH,  cls: 'push' },
];
const ATTRS = [
  { key: 'running', name: 'running' },
  // **Power, and not climbing.** It is the stat that gets a snail up a wall, and
  // it is also the stat that shoves a crate across a hole - and a name that said
  // `climbing` was a name that read as a description of the first of those two
  // jobs and said nothing about the second. `EFFor` reads every key in this list
  // out of a save without asking, so the rename is a save **version** and not a
  // migration: see `load()`.
  { key: 'power',    name: 'power' },
  { key: 'swimming', name: 'swimming' },
  { key: 'flying',   name: 'flying' },
  { key: 'stamina',  name: 'stamina' },
];
/**
 * The things a course is made of. A `leap` is a cliff and a gap with nothing
 * in it: the far side is the floor of a chasm a long way down, so a snail
 * that does not make it is down there climbing back out, and it is taken at
 * height. A `water` is a pool - the same hole much smaller, with water in it,
 * a bank low enough to step off and a hop so low there is no flying over it -
 * so it is water you get through rather than a hole you fall into. A course
 * that lists only `leap` has no water on it at all, and one that lists
 * `water` has no chasms; that is what makes a course a swimming course or a
 * flying one. A course says which elements it has in the `pool` list in
 * races.json, and that list can name the same element twice for it to come
 * round more often.
 */
const ELEMENTS = {
  run:   { x: 12.0 },
  climb: { x: 5.2 },
  leap:  { x: 18.0, wet: false, gap: 1.00, lip: 1.00, chasm: [0.9, 1.3], back: 2.2, vy: 0.71, lipW: 0.9 },
  water: { x: 15.0, wet: true, gap: 0.62, deep: 0.42, lip: 0.24, drop: 0.40, bank: 2.3, vy: 0.40, lipW: 0.95 },
  // A flooded chasm, and the hardest thing on any course: a slope to run up,
  // a cliff to launch off it, deep water at the bottom, and a wall on the far
  // side. Fly far enough and you come down on that wall and climb it; come
  // down short and you are swimming, and then you climb out of the water the
  // same way - so the same wall is the prize at either end of the fall.
  leapClimb: {
    x: 20.0, wet: true, wall: true, runUp: 0.55,
    gap: 1.05, deep: 2.2, lip: 3.0, drop: 2.6, back: 2.6, vy: 0.75,
    lipW: 0.94,
  },
  // A **dish cut in the road for a crate to stand in**, and the only way over it
  // is to shove the crate into the middle of it. It is a `leap` with two things
  // turned off, and each of them is a thing a `leap` does for a different reason:
  //
  // - `noLip`: there is no launch, because nothing jumps a crate. The *ramp* is
  //   skipped and the flat top is not - see the branch - and `lipX` ends up on
  //   the road, which is the only height a crate can be shoved along.
  // - `crate`: the span is `PUSH` rather than `WALK`, so the progress rail and
  //   the card have a colour for it and a snail that ends up on the floor of one
  //   moves at crate pace rather than walking pace.
  //
  // **And the dish's ends are cut and not eased**, which is the load-bearing half
  // of it and is in the samples rather than in this declaration. The road on a
  // course is sampled every 750 mm, so the shape of a notch is only the shape its
  // samples carry, and a notch the planner eases over the first quarter of its
  // length in each direction comes out as a trough: a cart could have stood in
  // this one. **The whole of the drop is in the first sample of the dish and the
  // whole of the rise in the last**, which is what a `leap` does with its chasm,
  // and what comes out is a lip. It is not a `leapClimb`'s cliff and does not
  // pretend to be: 2.6 m of water under that lip is what stands a face at seventy
  // degrees, and a notch a snail is meant to walk a box across is half a metre of
  // the same bargain. It is a crease and not a bowl, and the crate is its own
  // size, so the box fills it and overhangs it rather than standing in a hollow
  // with a trench round it.
  pushCrate: {
    x: 5.0, wet: false, crate: true, noLip: true, farRise: 0.15,
    chasm: [0.50, 0.56],
  },
};
// Each element needs the numbers it is built out of, and a leap needs no
// depth and no water: it is a hole, not a pond. Say so at boot rather than
// half way round the first lap.
const NEEDS = {
  run: [], climb: ['climb', 'climbRun'], leap: ['gap', 'lip'], water: ['gap', 'lip', 'deep'],
  leapClimb: ['gap', 'lip', 'deep'],
  // nothing: the gap is the element's own and the crate is put there by hand
  pushCrate: [],
};
for (const c of CATS) {
  const unknown = (c.pool || []).filter((k) => !ELEMENTS[k]);
  const missing = (c.pool || []).filter((k) => (NEEDS[k] || []).some((f) => !Array.isArray(c[f])));
  // every element a course names is dealt into the course at least once, so
  // it needs room for all of them
  const tooMany = Array.isArray(c.pool) && new Set(c.pool).size > c.feats;
  if (!Array.isArray(c.pool) || !c.pool.length || unknown.length || missing.length || tooMany) {
    document.getElementById('boot').textContent =
      `races.json: "${c.id || '?'}" needs a pool of known elements` +
      (unknown.length ? ` (unknown: ${[...new Set(unknown)].join(', ')})` : '') +
      (missing.length ? `, and for the rest: ${[...new Set(missing)].map((k) => NEEDS[k].join('/')).join(', ')}` : '') +
      (tooMany ? `, and at least ${new Set(c.pool).size} feats for the ${new Set(c.pool).size} different elements it names` : '') + '.';
    throw new Error('bad course ' + c.id);
  }
}
const STAT_MAX = 24;
const STAT_MIN = 1;
const GOLD_PER_FRUIT = 10;
const START_GOLD = 50;
const START_TRAIT = 5;                        // every trait a new snail begins on
const freshSnail = () => ({ running: START_TRAIT, power: START_TRAIT, swimming: START_TRAIT, flying: START_TRAIT, stamina: START_TRAIT });
const POINTS = [25, 20, 15, 10, 5, 3, 2, 1];              // 1st through 8th, and the gold they pay
const FIELD = 8;                            // the player plus seven rivals
const POOL_SIZE = 64;                       // the rivals are drawn from here
const CLUB_SNAILS = 9;                      // ...and the bottom rung of it is this many club snails
const CLUB_ATTR = 3;                        // three of everything, every one of them
const ATTR_MAX = 16;                        // a rival's attributes run 1 to 32
const RATING_PER_ATTR = 10;                  // so a total of 160 is a rating of 1280
const START_RATING = 10;                    // where the player starts on the ladder
const RATING_EASE = 0.25;                   // how much of the way to its target one race moves a rating
const RATING_STEP = 15;                    // and the most it can move in a single race, either way
const RATING_PER_WIN = 2;                  // and what a race's points are worth, which sets the top of the ladder
const SURGE_MULT = 1.18;
const SURGE_DRAIN = 11;
const PASSIVE_DRAIN = 0.90;
const TIRED_MULT = 0.25;                    // quarter speed on an empty bar
const SWIM_Y = 0.18;                         // how deep a swimmer sits
const REGEN = 6.0;
const STEP = 0.75;                          // track sample spacing
const START_S = 11.0;                      // the start line, measured in from the end

// Everything that counts the season reads the roster out of seasons.json, so
// a season can gain or lose a course without leaving a stale number behind.
const seasonWord = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);

/* ================================================================== *
 * The seasons, read out of seasons.json. The bands are allowed to overlap,
 * so a snail can be good enough for two seasons at once and pick either -
 * the ladder is a choice, not a queue. Everything about a season comes out
 * of its own entry, so a season can gain or lose a course, or move up the
 * ladder, without touching any code.
 * ================================================================== */
const TIERS = SEASONS.map((s) => Object.assign({}, s, { hi: s.hi == null ? Infinity : s.hi }))
  .sort((a, b) => a.lo - b.lo);
const seenSeasonIds = new Set();
for (const s of TIERS) {
  const roster = s.races || [];
  const bad = roster.concat(s.finale ? [s.finale] : []).filter((id) => !CAT_BY_ID[id]);
  const badScale = s.scale != null && (typeof s.scale !== 'number' || !(s.scale > 0));
  if (bad.length || !roster.length || badScale || typeof s.lo !== 'number' || !(s.hi > s.lo)) {
    document.getElementById('boot').textContent = `seasons.json: "${s.id || '?'}" needs a rating band, a positive scale, and races that exist in races.json${bad.length ? ` (unknown: ${bad.join(', ')})` : ''}.`;
    throw new Error('bad season ' + s.id);
  }
  // two seasons with the same id would leave one of them unreachable: the
  // picker draws a season's seven by its id, and the last one would win
  if (seenSeasonIds.has(s.id)) {
    document.getElementById('boot').textContent = `seasons.json: two seasons are called "${s.id}". Give them each their own id.`;
    throw new Error('duplicate season id ' + s.id);
  }
  seenSeasonIds.add(s.id);
}
const TIER_BY_ID = Object.fromEntries(TIERS.map((s) => [s.id, s]));
/** The seasons a rating is good enough for. Overlaps mean more than one. */
function eligibleSeasons(rating) {
  return TIERS.filter((t) => rating >= t.lo && rating < t.hi);
}
/** Can this snail go in? The bottom rung is always open, so nobody is stuck. */
function canEnter(id, rating) {
  const t = seasonDef(id);
  return rating >= t.lo && rating < t.hi;
}
/** The best season a rating earns, for a save or a new game that picks for you. */
function seasonFor(rating) {
  const ok = eligibleSeasons(rating);
  return ok.length ? ok[ok.length - 1] : TIERS[0];
}
/** The season you are racing. */
function seasonDef(id) { return TIER_BY_ID[id] || TIERS[0]; }
/** How long this season's courses are, as a multiple of races.json's own. */
function seasonScale(id) {
  const s = seasonDef(id);
  return typeof s.scale === 'number' && s.scale > 0 ? s.scale : 1;
}
/** The courses you get to pick the order of. */
function seasonPicks(id) { return seasonDef(id).races.slice(); }
/** The one that closes the season, whatever order you pick. */
function seasonFinaleId(id) { return seasonDef(id).finale || null; }
/** Every course in the season, in running order. */
function seasonRoster(id) {
  const f = seasonFinaleId(id);
  return f ? seasonPicks(id).concat([f]) : seasonPicks(id);
}
const seasonLength = (id) => seasonRoster(id === undefined ? state.tier : id).length;
/**
 * Both scales read off the same curve. A player's traits run 1 to STAT_MAX and
 * a rival's attributes 1 to ATTR_MAX, but the ends of each range are the same
 * snail, so a maxed player is exactly as quick as a maxed rival and there is
 * no reading of the sim that quietly favours one over the other.
 */
function effFor(v, lo, hi) { return 1 + ((v - lo) * (STAT_MAX - 1)) / (hi - 1); }
function effTraits(sn) {
  const lo = sn.player ? STAT_MIN : 1, hi = sn.player ? STAT_MAX : ATTR_MAX;
  const src = sn.player ? sn.stats : sn.attrs;
  const out = {};
  for (const a of ATTRS) out[a.key] = effFor(src[a.key], lo, hi);
  return out;
}

/* ================================================================== *
 * Random + noise. Everything is seeded, so a track looks the same
 * every time it is rebuilt and the season card can promise a course
 * before the player ever sees it.
 * ================================================================== */
function makeRng(seed) {
  let s = (seed | 0) || 1;
  return function () {
    s ^= s << 13; s |= 0; s ^= s >>> 17; s ^= s << 5; s |= 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}
const rand = makeRng(20260926);
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, oct = 3) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); norm += a; a *= 0.5; f *= 2.05; }
  return s / norm;
}
// the rolling countryside the lane is cut through
function hills(x, z) {
  // the two coarse octaves carry the shape; the fine one is kept small, or
  // the ground beside the lane breaks into hard little facets
  let h = 6.2 * (fbm(x * 0.0085, z * 0.0085, 3) - 0.5);
  h += 2.2 * (fbm(x * 0.026, z * 0.026, 2) - 0.5);
  h += 0.32 * (fbm(x * 0.105, z * 0.105, 2) - 0.5);
  h += Math.max(0, Math.abs(z) - 26) * 0.034;
  return h;
}

/* ================================================================== *
 * Geometry helpers, borrowed from the horse
 * ================================================================== */
/** Bake primitives into one vertex-coloured geometry (one draw call). */
function bake(parts) {
  let vc = 0, ic = 0;
  for (const p of parts) {
    vc += p.g.attributes.position.count;
    ic += p.g.index ? p.g.index.count : p.g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
  const idx = new Uint16Array(ic);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.g, n = g.attributes.position.count;
    nm.getNormalMatrix(p.m);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(p.m);
      pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize();
      nor.set([v.x, v.y, v.z], (vo + i) * 3);
      col.set(p.c, (vo + i) * 3);
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
function colored(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setRGB(1, 1, 1);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/* ================================================================== *
 * Track planning. A course is a list of sections laid end to end; the
 * section list is turned into control points, the control points into a
 * spline, and the spline is resampled by arc length so distance along
 * the course is simply a number the racers carry.
 * ================================================================== */

/**
 * The half-way sweep, and the two numbers it is made of.
 *
 * Every course carries a tower at its half-way mark and the lane goes round it,
 * so that the tower is something you race **past** rather than something that
 * happens to be beside the road for a quarter of a second. `MID_SPAN` is how
 * far along the course the sweep runs either side of the tower, and
 * `MID_CROWN` is how far round it the lane is at its nearest - the crown's
 * radius of curvature, which is the same number seen from the other end.
 *
 * They are one relationship and not two choices. The bump is `(1-t^2)^3`, whose
 * curvature at the crown is `6A / MID_SPAN^2` for a sweep `A` deep, and the
 * centre of that curvature - the point the road is genuinely circling, and the
 * only place a tower can stand and be circled - sits `MID_SPAN^2 / 6A` back
 * from the lane. So asking for a fifteen-metre crown asks for a sweep of
 * `MID_SPAN^2 / (6 * 15)`, and the two numbers cannot disagree about it.
 *
 * Fifteen is the distance because of the two things it has to be. It is the
 * crown's radius, and a course that already runs a hundred metres of bend from
 * `corners` and `wiggle` is spending its curvature budget before the sweep
 * arrives; fifteen puts the tightest part of it at `k = 0.067`, which is past
 * the point where the sim stops slowing anybody down, so the landmark costs
 * the race nothing. And it is the clearance: the tower's buttresses stand four
 * and a half metres out, so the lane is ten and a half metres from the nearest
 * stone at its closest, and the ground the tower stands on is ground the sweep
 * has already had built.
 *
 * **And fifteen is the crown on a course that runs on the level, which a
 * climbing course cannot afford.** Swinging the lane eleven metres to the side
 * swings its *verge* eleven metres too, because the verge is built off the
 * lane: `groundYAt()`'s wall profile lays a shelf at the lane's own level and
 * then a **plane** for a face a third of the drop wide, so a lane three metres
 * above the country has a three-metre step along its whole length, and moving
 * it eleven metres moves that step eleven metres through the hillside. On Crag
 * Ascent, whose lane has climbed five walls and stands about three metres above
 * the meadow by its half-way, the far end of the sweep left a shelf of turf
 * hanging out over the drop with its underside on show - the overhang, and it is
 * the sweep's, because the same sweep on Hedgerow Dash, whose lane is six
 * centimetres above the country, is invisible.
 *
 * So the crown **gives way to the climbing**. What decides it is the course's
 * own climb budget - the mean height of its walls times the number it deals -
 * and that is the one number that says whether a lane will be standing off the
 * country, because the lift a course accumulates *is* its walls. It is also the
 * right shape of answer: it is known before the course is laid out, it is the
 * same for every point on it, and so the sweep's depth cannot step along the
 * course. (An earlier version read the drop per point off the lane's own level,
 * and that level **steps by the height of every wall**, so a depth that stepped
 * made a sweep that stepped and a lane that stepped is a kink - it put a
 * one-metre radius into the Grand Prix course where the sweep crossed a wall.)
 *
 * A deeper crown is a wider arc and not a weaker one: the lane still circles the
 * tower at `C` metres, the tower just stands further off for it, which is also
 * the better building site - the ground under a lane that is perched on a drop
 * is the bottom of a face, and a tower on the bottom of a face is a tower in a
 * ditch. A meadow course gets exactly the fifteen metres it always had.
 */
const MID_SPAN = 32;
const MID_CROWN = 15;
/** **The length below which a course is not bent at all.** The sweep is
 *  `2 * MID_SPAN` of bend, and a course has to be long enough to hold it without
 *  the bend being most of the course: Crag Ascent lays out about eighty-five
 *  metres, so sixty-four of bend is three-quarters of the race, and the lane is
 *  not a road with a landmark beside it any more - it is one long arc with a
 *  tower somewhere on it and no straight anywhere to race down. It is also the
 *  reason the ground could not be laid out flat there, because a ribbon that
 *  wide cannot follow a curve that tight without its inside rows crossing.
 *
 *  So below this a course is **not swept**. Not bent a little: the sweep is a
 *  thing that is either there or not, and a third of one is just a wobble in
 *  the middle of the course. `midCrown()` falls back to the plain fifteen and
 *  the tower stands its own distance off the road, which is all it needs - the
 *  sweep is a bonus, and a course too short to afford it is better off without.
 *  Marathon is long enough to keep it; the four short ones are not.
 */
const MID_MIN = 130;
/** How much of the footpath in front of a wall is left, the rest of it being
 *  moved to the run-out - so the walls come closer together and the course
 *  still comes out the length its category promises. */
const CLIMB_PACK = 0.45;
/** How much of the course either side of its exact middle is kept clear of
 *  features, and the floor on the run-in that pays for it.
 *
 *  A **fraction** of the course and not a number, and it is a fraction because
 *  thirty-two metres is a third of Crag Ascent. A fixed band that generous on
 *  the Grand Prix course is absurd and on an eighty-metre climbing course it
 *  eats everything there is to eat: the last two walls ended up past the
 *  finish line, with the lane stopping dead at the gate and the country
 *  running on behind it. One tenth, floored at ten metres and capped at
 *  twenty-four, is a fifth to a quarter of any course - enough that the
 *  checkpoint's line, the gate either side of it and the tower's own ground can
 *  all see each other over nothing, and short enough that there is still a
 *  course. */
const MID_BAND = 0.15;
const BAND_MIN = 13;
const BAND_MAX = 28;
/** And the share of it the **finish** gets rather than the middle. The middle
 *  is the landmark and the thing a course is built around; the finish is a line
 *  and a run-out. Lily Deep is where the difference shows: four pools at fifteen
 *  metres each are two thirds of a Sunday Cup course, so the flat ground the
 *  checkpoint is put on has to be bought from the run-out rather than found.
 *  The two bands cost the same together either way, so this is who gets it. */
const BAND_FINISH = 0.45;
const RUN_IN_MIN = 12;
const RUN_OUT_MIN = 18;
/** The drop at which the sweep has given all the ground it gives, and what it
 *  buys with it: metres of crown per metre of height difference. */
const MID_DROP_MAX = 4;
const MID_CROWN_YIELD = 1.6;
const midCrown = (drop) => MID_CROWN + MID_CROWN_YIELD * clamp(drop, 0, MID_DROP_MAX);
/** The sweep itself, and the crown it is cutting - which is a number, not a
 *  lookup, so the bend and the tower's distance from the road cannot come out
 *  of step. Outside the span the sweep is nothing at all, and in the middle it
 *  is flat to the second derivative in `t`, which is what keeps the curvature -
 *  and so the tower's own distance from the road - even across the middle of the
 *  sweep instead of peaking at the tower itself.
 *
 *  A crown of zero is a course too short to sweep at all, and the bump divides
 *  by it, so the zero is caught here rather than a third of a wobble being
 *  drawn down the middle of a race. */
const midSweep = (x, at, crown) => {
  if (crown <= 0) return 0;
  const t = (x - at) / MID_SPAN;
  return t <= -1 || t >= 1 ? 0 : (1 - t * t) ** 3 * MID_SPAN * MID_SPAN / (6 * crown);
};

function planTrack(catId, seed, lenScale) {
  const cat = CAT_BY_ID[catId];
  // A season can ask for a longer or shorter course than the one in
  // races.json. The features keep the size they are drawn at - a wall is as
  // high and a gap as wide whatever season you are racing - and the footpath
  // between them stretches or shrinks, so a Grand Prix course is the same
  // walls and chasms with a great deal more country in between.
  const len = cat.len * (lenScale > 0 ? lenScale : 1);
  const W = LANE_HW;               // half-width of the lane: eight abreast
  const R = makeRng(seed);
  const p1 = R() * TAU, p2 = R() * TAU;
  const lateral = (x) =>
    cat.wiggle[0] * Math.sin(x * cat.wiggle[1] + p1) +
    cat.wiggle[2] * Math.sin(x * cat.wiggle[3] + p2);

  // corners: eased sideways shifts, held once made, so the lane snaps
  // round a bend and then runs straight again
  const corners = [];
  let drift = 0;
  for (let x0 = 16; x0 < len + 24; ) {
    const len = cat.corners[0] + R() * (cat.corners[1] - cat.corners[0]);
    let amp = (R() < 0.5 ? -1 : 1) * (2.0 + R() * 3.0);
    if (Math.abs(drift + amp) > 9) amp = -Math.sign(drift) * (1.6 + R() * 2.2);
    drift += amp;
    corners.push([x0, x0 + len, amp]);
    x0 += len + 10 + R() * 26;
  }
  const shift = (x) => {
    let s = 0;
    for (const c of corners) if (x > c[0]) s += c[2] * smoothstep(c[0], c[1], x);
    return s;
  };
  // ...and the half-way sweep, which is the same trick run once and hard.
  //
  // The tower stands at the half-way mark in the middle of the course, and a
  // landmark nobody can see is a landmark that is not there, so the lane is
  // made to go **round** it. A lateral offset is all a course can do about its
  // own shape - `cross(x)` is one value for each `x` along it, so this cannot
  // be a loop and is a sweep: the road swings out to one side, comes back past
  // the front of the tower, and swings out again on the far side, which puts
  // about a hundred and twenty degrees of turning through it and keeps a
  // seventeen-metre tower in frame for a good part of a lap instead of the
  // quarter of a second a straight road gives you.
  //
  // The three numbers are one relationship and not three choices. The bump is
  // `(1 - t^2)^3`, which is **flat at both ends to the second derivative**, so
  // the sweep fades into the course's own line without a crease in it - and
  // flat at the *crown* as well, which is the half of that matters most: a
  // bell that peaked sharply would put its highest curvature exactly where the
  // tower is, and the tower is the one piece of ground the sweep has to be
  // flat at. A bump's curvature at its crown is `6A / span^2`, and the crown's
  // **centre of curvature** - the point the road is genuinely going round, and
  // so the one place the tower can stand and be circled - is `span^2 / 6A`
  // back from the lane along the crown's own normal. So `MID_CROWN` is not a
  // free number: it is that distance, and the sweep's depth is whatever it
  // takes to produce it.
  //
  // The crown is this course's own at each point, scaled by how far the lane is
  // standing off the country there, and smoothed over the width of the sweep so
  // that it cannot step. It is settled below, once the section list is whole.
  const cross = (x) => lateral(x) + shift(x) + midSweep(x, len * 0.5, crown(x));
  // The height the lane runs at, before any wall has lifted it. By default it
  // rolls gently along the course. A course can ask for it level instead -
  // `level: true` in races.json, or `level: 1.4` to run at a set height - which
  // is what a swimming course wants: the water in every pool is then at the
  // same level and reads as level, instead of each pond sitting a metre lower
  // than the last down a slope. The country beside the lane still rolls, since
  // that is the hills rather than the lane, so a level course is a track cut
  // level through the meadow and not a flat world.
  const baseY = cat.level == null
    ? (x) => 2.6 * Math.sin(x * 0.0122 + p1 * 0.6) + 1.0 * Math.sin(x * 0.0285 + p2)
    : () => (typeof cat.level === 'number' ? cat.level : LEVEL_Y);

  // The section list: a run-in, then feature after feature, each one
  // reached along a stretch of footpath. The water features are the only
  // way past whatever they are - a leap is crossed in the air, a pool is
  // swum - so it is still the flying and swimming traits that decide them.
  // A long run-in and a long run-out. The grid sits far enough in for the
  // camera to have a start line to stand behind, and the finish far enough
  // out for the camera to get past it and watch the race come in, so neither
  // end of the course is ever looking off into nothing.
  const secs = [{ c: 'run', len: 17 + R() * 4 }];
  const tally = { walls: 0, leaps: 0, pools: 0, floods: 0, crates: 0, straights: 0 };
  // Every element the course names is dealt in at least once, and the rest of
  // the features are picked at random. Picking all of them at random meant a
  // course could come out with none of the thing it is named after - Lily
  // Deep drawing four leaps and no water at all - and because the seed is
  // fixed per course, the same course came out the same empty season after
  // season. This is the course's promise, so it is dealt, not gambled on.
  const kinds = [...new Set(cat.pool)].slice(0, cat.feats);
  while (kinds.length < cat.feats) kinds.push(cat.pool[(R() * cat.pool.length) | 0]);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = (R() * (i + 1)) | 0;
    const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t;
  }
  for (const k of kinds) {
    if (k === 'climb') tally.walls++;
    else if (k === 'leap') tally.leaps++;
    else if (k === 'water') tally.pools++;
    else if (k === 'leapClimb') tally.floods++;
    else if (k === 'pushCrate') tally.crates++;
    else tally.straights++;
  }
  // the clear stretches of the course, and they are paid for out of the length
  // the course would otherwise have - see the note at the band below
  const band = clamp(len * MID_BAND, BAND_MIN, BAND_MAX);
  // **and the flat run home, which is the smaller of the two** - see `BAND_FINISH`
  const home = Math.max(6, band * BAND_FINISH);
  const clear = band + home;
  // the footpaths between features are sized so the course comes out near
  // the length its category promises
  // a wall is short and steep, so it eats far less of the course than it used
  // to; a climbing course has to stack more of them to still be about climbing
  const featX = kinds.reduce((a, k) => a + (ELEMENTS[k] || ELEMENTS.run).x, 0);
  // **and the band's width comes out of the footpaths**, spread across all of
  // them, so that the course still comes out the length its category promises
  // with the clear middle in it. The two ends give a little of it as well -
  // the run-in can spare a few metres and so can the run-out - but they cannot
  // spare the lot, and pretending otherwise is what made every course on the
  // calendar a third longer the moment the band went in: Lilypool went from a
  // hundred and forty-five metres to two hundred and nineteen.
  const conn = Math.max(2.6, (len - 24 - featX - clear * 0.72 - 0.8) / cat.feats);
  // **Walls closer together.** A climbing course's problem is not how much it
  // climbs, it is how long it spends *between* the climbs - and every metre of
  // footpath between two walls is a metre of lane lying along the country at a
  // height the country is not at, which is a mile of verge drawn in a lift. So
  // the footpath in front of a wall is cut to a fraction of the others, and the
  // length that comes off is given back in the run-out at the end, which is
  // flat road at the foot of the course where the lift is not a thing. The
  // course comes out the same length either way; it is just all in one place
  // instead of spread down the whole valley.
  // **The middle of the course is kept clear of features**, and it is the run-in
  // and the run-out that pay for it. On Crag Ascent the walls run from
  // twenty-four metres to sixty-one, which is most of the race in one climb, and
  // the half-way mark - the exact middle, fifty metres in - fell **nine hundred
  // millimetres** from the top of a wall. So the tower stood in the middle of a
  // climb with a wall on each side of it, which is the one place on a course
  // where the ground is a face and there is nothing flat to stand a building on,
  // and it did not read as the middle of anything.
  //
  // The band goes **between two features rather than through one**, and that is
  // the whole of how it is done: the deal is split where the middle of the course
  // falls, the stretch of plain lane is put between the two halves, and the
  // length of it comes out of the two ends. Moving a feature out of the middle
  // instead - which is the obvious way - shoves every feature after it along
  // with it, and on a short course they do not all fit: Crag Ascent's five walls
  // are already stacked three metres apart, and a band pushed in front of them
  // runs the last one off the end of the course and leaves the half-way mark
  // sitting in a climb again, which is the thing it was for.
  //
  // The run-in and the run-out are the only stretches that can afford it: the
  // grid sits far enough in and the finish far enough out for the camera to see
  // past either, and neither is a thing the race is about.
  // **Where the middle is, by counting the obstacles and not by measuring the
  // course.** The band goes after the first half of the deal: four pools and it
  // goes between the second and the third, five walls between the second and the
  // third, and that is the whole rule.
  //
  // It used to be worked out by walking the deal until the plan's `x` passed its
  // own middle, which is a length and not a count, and on a course whose pools
  // are long and whose footpaths are short the two disagree badly: Lilypool's
  // band landed after the **first** pool, because the run-in and the first pool
  // together are more than half the plan's length before the course has had a
  // chance to even out. The tower then stood beside the first water, and the
  // gap between the second and third - which is the middle of the course and
  // about twenty metres of nothing - went to waste. Counting cannot drift like
  // that: the middle of four things is between the second and the third whatever
  // their sizes are, and a wall is a wall and a pool is a pool.
  const cut = Math.floor(kinds.length / 2);
  let packed = 0;
  // **One feature each, once.** The two halves are slices of the same deal and
  // the second starts where the first stopped - laying the whole list and then
  // laying the tail of it again puts every feature after the band on the course
  // twice, which is not a subtle mistake: it made Lilypool a hundred and
  // ninety-six metres long when it is a hundred and forty-five.
  let atX = secs[0].len;
  const lay = (list) => {
    for (const k of list) {
      const footpath = (conn * 0.8) + R() * 0.7;
      // **A crate's footpath is floored, and a wall's is cut.** Both are the
      // same bargain: a `climb` is packed to a fraction of the others because a
      // climbing course's problem is how much lane it spends *between* the
      // climbs, and a `pushCrate` is floored at `CRATE_LANE` because the crate
      // is three and a half metres long and starts a metre and a half back from
      // the lip - on a course where walls stand three metres apart the footpaths
      // are already at their own 2.6 m floor, and a crate that is not given the
      // room is shoved off the end of its footpath into the wall behind it.
      // Either way the length that comes off is the run-out's to pay, and the
      // course comes out the length its category promises.
      const run = k === 'climb' ? footpath * CLIMB_PACK
        : k === 'pushCrate' ? Math.max(CRATE_LANE, footpath)
          : footpath;
      packed += footpath - run;
      // on the dash course the "features" are the straights themselves
      const feat = k === 'run' ? 10 + R() * 6 : 0;
      secs.push({ c: 'run', len: run });
      secs.push({ c: k, len: feat });
      atX += run + (k === 'run' ? feat : (ELEMENTS[k] || ELEMENTS.run).x);
    }
  };
  lay(kinds.slice(0, cut));
  // and the plain middle itself, which is the one stretch of a course with
  // nothing in it on purpose
  // **and where it is, which the checkpoint is then told.** The band and the
  // half-way mark used to be two independent middles - this one in the plan's
  // `x`, that one at the middle of the raced distance - and they are not the
  // same place, because a plan's `x` is not its arc length. On Lily Deep they
  // were four pools apart: the clear lane went into the wide gap between the
  // first and second pool and the tower stood in the next gap along, on ground
  // the band had already been spent protecting elsewhere. Nothing in a course
  // should have to know two different middles, so the band says where it is and
  // the checkpoint asks.
  //
  // **And centred in the gap, not pushed up against the obstacle before it.**
  // The footpath that separates one feature from the next belongs *between*
  // them, so half of it is laid in front of the band and half behind. Without
  // that the band began the instant the previous pool ended and all the
  // remaining road was after it, which put the checkpoint against the water it
  // was supposed to be standing between - the tower and the line on the same
  // stretch of course, both of them hard up against the near pool and twenty
  // metres of clear road on the far side of it. The band is the middle of the
  // course, so it is put in the middle of the gap.
  const half = conn * 0.4;
  secs.push({ c: 'run', len: half });
  atX += half;
  const midX = atX + band * 0.5;
  secs.push({ c: 'run', len: band });
  atX += band;
  secs.push({ c: 'run', len: half });
  lay(kinds.slice(cut));
  // **and the flat run home**, after the last feature rather than before it, so
  // the last wall on the course is behind the racer and not under them
  secs.push({ c: 'run', len: home });
  // the two ends give up what the clear stretches took, the run-in never below
  // what the grid and the camera behind it need, and the run-out never below the
  // finish camera needs to see the race come in
  const inCost = Math.min(Math.max(0, secs[0].len - RUN_IN_MIN), clear * 0.14);
  secs[0].len -= inCost;
  secs.push({ c: 'run', len: Math.max(RUN_OUT_MIN, 22 + R() * 5 + packed - (clear - inCost)) });

  // **How far the lane is standing off the country, along the course** - the
  // height difference the sweep is scaled by. It is built here, off the section
  // list, because the section list is the last thing that is finished before a
  // single point is laid down and `cross()` needs the number from the first one.
  //
  // The lift is the running total of the walls already climbed, and it is taken
  // at each section's **mean** height rather than the height it was actually
  // drawn at: the drawn heights come out of the random stream as the loop walks,
  // and asking the stream twice gives two different courses. The mean is the
  // right answer anyway, because what the sweep is answering is "how mountainous
  // is this course", and a course is mountainous whichever way its walls fell.
  //
  // The result is then **smoothed over the width of the sweep**, and that is not
  // a nicety. Read raw, the drop steps by the height of every wall, and a sweep
  // whose depth steps is a lane whose lateral offset steps, which is a kink - it
  // put a one-metre radius into the Grand Prix course at every wall. Averaged
  // across the span the bump is cut in, the number it is scaled by moves slowly
  // enough that the bump still reads as a bump, and no wall can put a corner in
  // the road.
  const lift = (() => {
    const at = [];
    let acc = 0, sx = 0;
    for (const sec of secs) {
      const h = sec.c === 'climb' ? (cat.climb[0] + cat.climb[1]) / 2 : 0;
      const w = sec.c === 'climb' ? (cat.climbRun[0] + cat.climbRun[1]) / 2 : sec.len;
      at.push([sx, sx + w, acc, acc + h]);
      acc += h;
      sx += w;
    }
    return (x) => {
      let lo = 0, hi = at.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (at[m][1] < x) lo = m + 1; else hi = m; }
      const s = at[lo];
      return lerp(s[2], s[3], clamp((x - s[0]) / Math.max(0.1, s[1] - s[0]), 0, 1));
    };
  })();
  const rawDrop = (x) => Math.abs(baseY(x) + lift(x) - hills(x, lateral(x) + shift(x)));
  // the smoothing window, sampled as a straight mean over the span either side
  const dropAt = (() => {
    const STEPS = 24;
    return (x) => {
      let sum = 0;
      for (let i = 0; i <= STEPS; i++) sum += rawDrop(x - MID_SPAN + (2 * MID_SPAN * i) / STEPS);
      return sum / (STEPS + 1);
    };
  })();
  const crownAt = (x) => midCrown(dropAt(x));
  // and the crown the sweep is cut to at each point, which is only a name for
  // it once the profile above exists - and **zero** on a course too short to
  // sweep, which is what stops the bend being drawn at all
  const crown = (x) => (len < MID_MIN ? 0 : crownAt(x));

  const pts = [], meta = [], leaps = [];
  // how far the course has been lifted by the walls it has already climbed
  let x = 0, y = 0, carry = 0;
  const push = (px, py, cond, ground, w, opt) => {
    // A junction between two elements is **one** point, not two. Each element
    // lays down its own curve and runs to its own end, and the sample the last
    // of them finishes on is the sample the next one starts on - so without
    // this the plan carries two samples at the same x, which is a zero-length
    // segment in the polygon, which a Catmull-Rom renders as a cusp.
    //
    // And a cusp is not a small thing. It measured a **0.1 m** radius - the
    // lane is five and a half metres wide - and there is one at the top and the
    // foot of every wall on every course, which is where the zigzag along the
    // edge of the country was coming from. The curve is supposed to be smooth
    // and it was being asked to pass through a point that doubled back on
    // itself; no amount of smoothing downstream can fix a doubled-back point,
    // because the thing to smooth is not smooth anywhere.
    const last = pts[pts.length - 1];
    if (last !== undefined && Math.abs(last.x - px) < 0.02) return;
    pts.push(new THREE.Vector3(px, py, cross(px)));
    // and the crown travels with the point, because the tower has to stand on
    // the centre of curvature of the sweep that was actually cut here - read it
    // back off the track rather than worked out again from a number that has
    // moved since
    meta.push(Object.assign({ cond, ground, w, water: null, floor: py, basin: 0, crown: crown(px) || MID_CROWN }, opt || {}));
  };
  // A steep ramp lofted off the hillside: `ground` stays down at the terrain
  // level, so the ramp reads as a solid wall rather than a hillside.
  // A ramp with two faces. A terrace holds its ground down at the foot, so
  // what stands beside the lane is a sheer face and the lane goes up it; a
  // slope carries its ground up with it, so it is a hill to run at.
  //
  // And it **tapers** if it is asked to, because a ramp that changes the width
  // of the lane in one sample is a pair of steps in the middle of a road. The
  // ramp up to the lip of a leap is the steepest thing on a course and the last
  // stretch of road before it, and a snail taking off from a lane that pinched
  // from five and a half metres to four and a half a metre earlier is leaving a
  // gate rather than a road, and the pinch reads on screen as a choke point
  // where there is no reason for one. So `wEnd` walks the width down over the
  // ramp's own length and a narrow lip is something the lane arrives at rather
  // than something it trips over.
  const ramp = (x0, y0, rise, run, cond = CLIMB, terrace = true, w = W * 0.78, wEnd = w) => {
    const steps = Math.max(3, Math.round(run / 0.4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const py = y0 + rise * (0.5 - 0.5 * Math.cos(Math.PI * Math.pow(t, 0.86)));
      // eased like the height is, so the shoulders come in as a curve and not
      // as a pair of chamfers either side of a straight
      push(x0 + run * t, py, cond, terrace ? y0 : py, lerp(w, wEnd, smoothstep(0, 1, t)));
    }
    return x0 + run;
  };
  for (const sec of secs) {
    if (sec.c === 'run') {
      const steps = Math.max(1, Math.round(sec.len / 1.1));
      for (let i = 0; i < steps; i++) {
        const px = x + (sec.len * i) / steps;
        // a footpath runs on at the level it was left at: a wall lifts the
        // whole course and nothing quietly relaxes it back down again
        y = baseY(px) + carry;
        push(px, y, RUN, y, W);
      }
      x += sec.len;
    } else if (sec.c === 'climb') {
      // A wall is a step, not a hill. The terrace beside the lane stands the
      // full height of the wall the moment it starts, so what the snail sees
      // ahead is a sheer face, and the lane goes straight up it in one short
      // steep push. There is no way back down: the course just gets higher.
      const h = cat.climb[0] + R() * (cat.climb[1] - cat.climb[0]);
      const y0 = y, x0 = x;
      const run = cat.climbRun[0] + R() * (cat.climbRun[1] - cat.climbRun[0]);
      const steps = Math.max(3, Math.round(run / 0.25));
      for (let i = 1; i <= steps; i++) {
        // the ground stays down at the foot, so the flank of the lane is the
        // face the snail climbs, and the lane itself stays as wide as the path
        push(x0 + (run * i) / steps, y0 + (h * i) / steps, CLIMB, y0, W);
      }
      x = x0 + run; y = y0 + h; carry += h;
    } else {
      // ---- a hole in the course, and the only way past it is off the bank.
      // A leap is a cliff over a dry chasm: the ground stands up at the lip's
      // height, the lane drops the full height to the floor, and the far side
      // is a wall back up to the lane's own level - so a snail that misses
      // lands down there and has to climb out, and the water that used to be
      // at the bottom of it is gone. A pool is the same hole at a fraction of
      // the size, with water in it and a bank you step off rather than launch
      // from, which is what the launch height in ELEMENTS is for.
      const E = ELEMENTS[sec.c] || ELEMENTS.leap;
      const wet = !!E.wet;
      // **A crate's far lip is drawn first and its groove is what is left of
      // `CRATE_X`.** The groove is cut narrow on purpose - narrower in the
      // design's `x` than the crate is wide - so that the crate overhangs it at
      // both ends wherever the course happens to be, and there is nothing to fall
      // through. See the element for why `x` and not `s` is the only width that
      // can be promised.
      const farRun = E.farRise != null ? E.farRise + R() * E.farRise : null;
      const gapLen = farRun != null ? CRATE_X - farRun
        : (cat.gap[0] + R() * (cat.gap[1] - cat.gap[0])) * E.gap;
      const y0 = y;
      // A run-up is a hill to run at, not a wall: the ground comes up with
      // the lane, so a snail can take it at pace and arrive at the cliff with
      // the speed to matter.
      if (E.runUp) {
        const up = E.runUp * (0.75 + R() * 0.5);
        x = ramp(x, y, up, 3.4 + R() * 1.6, RUN, false, W);
        y += up;
      }
      // The lip, and the width of it. This is the narrowest the lane ever gets,
      // and it is a **destination**, not a step: the run-up and the lip ramp
      // taper down to it over their own length, so the road walks in to a
      // launch edge rather than stopping dead at one. A snail taking a pool
      // from a lane that pinched in a single sample was leaving a gate, and the
      // pinch read on screen as a choke point a metre before a hazard.
      // A pool's lip is narrower than a leap's, because a pool is a bank you
      // step off and a leap is a cliff you launch from - and `lipW` is the
      // declared fraction of the lane's width either one comes to.
      const lipW = W * (E.lipW == null ? 0.88 : E.lipW);
      if (E.noLip) {
        // **A crate has a lip and not a launch.** The ramp is skipped - nothing
        // leaves the ground here, and a metre of climbing to a step you walk off
        // is a metre of climbing for nothing - but the **flat top is not**, and
        // that is the load-bearing half of this branch. `lipX` is the end of the
        // flat top and `sAtX(lipX)` is where the groove is measured to start, so a
        // crate with only a ramp has `s0` in the middle of the *drop*: the last
        // sample at the road's own level is a metre and a half *before* the first
        // of the groove's, `s0` lands between them, and the crate is standing in
        // the side of a step rather than in a groove. A leap cannot see this
        // because its own flat top is the same metre and a half, so its `s0`
        // lands on it.
        push(x + 0.45, y, RUN, y, W);
        push(x + 1.10, y, RUN, y, W);
        x += 1.10;
      } else {
        const lipH = (cat.lip[0] + R() * (cat.lip[1] - cat.lip[0])) * E.lip;
        x = ramp(x, y, lipH, 1.7 + R() * 0.8, CLIMB, true, W, lipW);
        y = y + lipH;
        push(x + 0.45, y, CLIMB, y, lipW);                 // the lip
        push(x + 1.10, y, CLIMB, y, lipW);                 // a short flat top
        x += 1.10;
      }
      const lipX = x;
      // and the height of the lip itself, which is where a flight starts. It
      // has to be read off the lane as it stands here and not off where the
      // lane was before the run-up: a snail launched from below the top of
      // its own cliff is already in the water before it leaves the ground.
      const lipY = y;
      // how far below the lane the far side of the hole is
      const drop = wet ? (1.0 + R() * 0.8) * E.drop : E.chasm[0] + R() * (E.chasm[1] - E.chasm[0]);
      const waterY = wet ? y0 - drop : null;
      const floorY = wet
        ? waterY - (cat.deep[0] + R() * (cat.deep[1] - cat.deep[0])) * E.deep
        : y0 - drop;
      // A pool is a pool, not a lake. The water reaches a little past the edge
      // of the lane and a bit further for every metre of gap, but it does not
      // grow with the gap without limit: a course with wide water would
      // otherwise drown its own track in one sheet, with no bank and no shore
      // to tell you where the swimming starts.
      // A pool's water spreads for every metre of gap; a flooded chasm is a
      // gorge, and its water is kept in the cut it filled.
      const basin = wet
        ? W + POOL_BANK + gapLen * (E.wall ? 0.22 : POOL_SPREAD)
        : 0;
      const gSteps = Math.max(6, Math.round(gapLen / 0.65));
      for (let i = 1; i <= gSteps; i++) {
        const px = lipX + (gapLen * i) / gSteps;
        // across a pool the lane is at the water's level and the flight line
        // above it belongs to whoever is airborne; down a chasm the lane is
        // the floor, and the ground of it is walked, not flown: FLY is for the
        // air over the hole and WALK is for the bottom of it. A crate's span is
        // PUSH, which is the third answer and not a fourth: the crate is the
        // hole, so the rail and the card have to have a colour for it, and a
        // snail that ever does end up down there moves at crate pace.
        //
        // **and a crate's dish is cut at both ends rather than eased into them**,
        // which is a `leap` with its chasm's own numbers and not a trough: the
        // whole of the drop is in the first sample of the dish and the whole of
        // the rise in the last, so the level changes fall in the gaps between
        // samples and the lane carries a lip. Eased over the first quarter and
        // the last, which is what this used to do, it came out as a hollow three
        // and a half metres long that a cart could have stood in, and eight
        // crates standing in the bottom of it read as eight crates on a road.
        const t = i / gSteps;
        const dip = E.crate ? (i === 1 || i >= gSteps - 1 ? 0 : drop) : drop;
        // **The lane crosses the pool at the water's level and the ground under it
        // is the bottom of the water, and those are two different numbers.** The
        // wet branch wrote `waterY` into the floor as well, which threw away the
        // depth `floorY` had just been computed for and left a basin with a
        // surface standing on its own floor: `groundYAt()` lays the middle of a
        // pool out at `fr.floor` and the rim at `fr.ground`, so a floor and a
        // surface at one height is a ground that is level with the water across
        // the whole of it - Lily Deep's four pools came out **0.588 to 0.630 m
        // deep in the plan and none of it in the ground**, and the surface, which
        // dips six centimetres at its own outer edge to lose the join, was under
        // the meadow everywhere except the middle, where the two were coplanar.
        // It read as a sheet of blue laid on the grass with a seam down it.
        //
        // The dry branch is the same number twice over and always was: `floorY` is
        // `y0 - drop` and so is `dip`, so a chasm and its floor were written out
        // of one value by two names.
        const fy = wet ? floorY : y0 - dip;
        // **and the ground beside the lane is the country the hole interrupts, so
        // it is two numbers and not one.** `basinY()` lays the bottom of a basin
        // out at `floor` and climbs to `ground` over the last `BANK_WALK` metres
        // before the shoreline, and everything downstream of that - `POOL_BERM`,
        // the sand band's `dry` weight, the reeds' `clear` - is placed against
        // where the bank puts the waterline. So `ground` is the level the bank
        // climbs **to**, and it was the floor: a pool whose bank rose from its own
        // bottom to its own bottom, which is a step down into a plain at the level
        // of the bottom, and the waterline fell outside the strip that was drawn
        // for it - **17 m out on a 12 m strip on Lily Deep's first pool**, with
        // the five metres between them under the water's own level and no water
        // on them. The sand band was under the water and the drawn edge was a
        // 13 mm sliver lying on a shelf.
        //
        // A **flood** is the other way round and must not come with it: there the
        // ground beside the lane is the bottom of the gorge, because the terrace
        // the snail launches from is `lipY` up and the drop from it to here is the
        // face the gorge stands in. Give a `leapClimb` the country it interrupts
        // and its near wall goes with it, and the one wall on the course that is a
        // face rather than a ramp is a slope.
        const gy = wet && !E.wall ? y0 : fy;
        push(px, wet ? waterY : y0 - dip, wet ? FLY : (E.crate ? PUSH : WALK), gy, W,
          { water: waterY, floor: fy, basin, rock: !wet });
      }
      x = lipX + gapLen;
      // the far side: a bank out of the water, or a wall out of the chasm
      const back = farRun != null ? farRun
        : (wet && !E.wall ? E.bank : E.back + R() * 0.8);
      const yEnd = baseY(x + back) + carry;
      if (wet && !E.wall) {
        for (let i = 0; i <= 3; i++) {
          const t = easeInOut(i / 3);
          push(x + back * (i / 3), lerp(waterY, yEnd, t), RUN, lerp(waterY, yEnd, t), W);
        }
      } else {
        // the ground stays down at the foot of it, so the flank of the lane
        // is the face the snail has to climb back up - out of the water on a
        // flooded chasm, or off the floor of a dry one. It is a long enough
        // ramp that a snail coming down short can still land on it rather
        // than only on the far lip, which would make the gap a coin toss
        // instead of a test.
        //
        // **A crate's dish has already climbed back out by the time it gets
        // here** - the taper is the rise - so it starts from the road's own level
        // and not from the bottom of the dish, or a snail that walked in without
        // shoving a crate would meet a cliff at the far end of a thing it could
        // already have walked out of.
        const footY = E.crate ? y0 : (wet ? waterY : floorY);
        const steps = Math.max(4, Math.round(back / 0.3));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          push(x + back * t, lerp(footY, yEnd, easeInOut(t)), CLIMB, footY, W);
        }
      }
      x += back; y = yEnd;
      // **`farX` is the crest of the far side** and for everything but a crate
      // nothing reads it, because a flight lands on the far road by its own arc
      // rather than at a place. A crate stands in the middle of its dish, so its
      // `s1` is the far end of the dish and `x1` already says so.
      leaps.push({ kind: sec.c, vy: E.vy, wet, x0: lipX, x1: x - back, farX: x, lipY, laneY: yEnd, waterY, floorY, crate: !!E.crate });
    }
  }
  smoothRidges(pts, meta);
  return { cat, pts, meta, leaps, tally, length: x, midX };
}

/**
 * Take the **kinks** out of the lane's height profile, and nothing else.
 *
 * The elements are laid out one at a time and each lays down its own curve - a
 * run is flat, a climb is linear, a lip is a raised cosine, a chasm drops to its
 * floor in a sample or two - and where two of those meet the **slope** is
 * discontinuous even where the height is continuous. A seam that looks like
 * nothing in a table of numbers is fifty degrees of turn in the geometry: the
 * face of a dry chasm arrived at a ramp, the ramp arrived at a lip, and the
 * lip went over the edge in a stride.
 *
 * It matters because of what the lane is. It is a ribbon **five and a half
 * metres wide**, and a ribbon swept along a path that turns tighter than its own
 * half-width folds: the inside of the turn comes back through itself and the
 * ground and the road cross over with a crease between them. That is not a
 * shading artefact, it is a hole in the course - and the tightest turn on a
 * course measured **0.6 m** of radius, which is a fifth of the width of the
 * thing being swept.
 *
 * So this is a bounded Laplacian on the heights: a quarter of the way towards
 * the average of a sample's neighbours, **capped**, and never applied across a
 * sample that is in the air. The cap is the whole of the design. A cliff is
 * supposed to be a cliff, and an uncapped smoothing would round the lip of every
 * leap on every course into a gentle mound and quietly delete the best thing
 * about them. Capped, the worst of the kinks come out - the ones that were
 * turning the ribbon inside out - and a lip is still a lip. It runs before the
 * Catmull-Rom, so the curve inherits a smooth polygon rather than being asked to
 * smooth one it can only follow.
 */
const RIDGE_PASSES = 9, RIDGE_CAP = 0.2;
// **The floor of a hole is as much a break in the lane as the air over it**, and
// the guard has to say so for both. It used to fire on `FLY` alone, which is the
// air over a pool - and a *dry* leap's gap is `WALK`, so the chasm floor was
// treated as ordinary road and got smoothed into the take-off edge beside it.
// A leap's lip is the only thing on the course that tells you where the launch
// is, it is a crease and not a curve, and blending it with the floor a metre and
// a half below it **rounds the whole thing off into a mound**: on Skydrift the
// lip of a leap came out **0.56 to 0.64 m lower than it was planned at** and a
// `leapClimb` on the same course - whose gap is `FLY` and so was always guarded
// - lost nothing. Same planner, same lip ramp, one number deciding whether the
// ledge the snail jumps from exists. It is the same class as the flight line:
// two ends of a jump are not joined up by a road, whether what is between them
// is water or broken ground.
const inHole = (sm) => sm.cond === FLY || sm.cond === WALK || sm.cond === PUSH;
function smoothRidges(pts, meta) {
  const h = pts.map((p) => p.y);
  for (let pass = 0; pass < RIDGE_PASSES; pass++) {
    const out = h.slice();
    for (let i = 1; i < h.length - 1; i++) {
      // in a hole, or next to one: a flight line and the floor under it are both
      // not smoothed, because the two ends of a jump are not joined up by a road
      if (inHole(meta[i]) || inHole(meta[i - 1]) || inHole(meta[i + 1])) continue;
      out[i] = h[i] + clamp(h[i - 1] + h[i + 1] - 2 * h[i], -RIDGE_CAP, RIDGE_CAP) * 0.5;
    }
    for (let i = 0; i < h.length; i++) h[i] = out[i];
  }
  for (let i = 0; i < h.length; i++) pts[i].y = h[i];
}

/** Resample a plan into evenly spaced samples carrying a full frame. */
function buildTrack(catId, seed, lenScale) {
  const plan = planTrack(catId, seed, lenScale);
  const curve = new THREE.CatmullRomCurve3(plan.pts, false, 'centripetal', 0.5);
  const DENSE = Math.max(900, plan.pts.length * 30);
  const dense = [];
  let len = 0, prev = curve.getPoint(0);
  dense.push({ t: 0, p: prev, s: 0 });
  for (let i = 1; i <= DENSE; i++) {
    const t = i / DENSE, p = curve.getPoint(t);
    len += p.distanceTo(prev);
    dense.push({ t, p, s: len });
    prev = p;
  }
  const n = Math.max(16, Math.round(len / STEP));
  const sm = [];
  let j = 0, mi = 0;
  for (let i = 0; i <= n; i++) {
    const target = (len * i) / n;
    while (j < dense.length - 2 && dense[j + 1].s < target) j++;
    const a = dense[j], b = dense[j + 1];
    const u = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0;
    const p = a.p.clone().lerp(b.p, u);
    while (mi < plan.meta.length - 1 && p.x > plan.pts[mi + 1].x) mi++;
    const ma = plan.meta[mi], mb = plan.meta[Math.min(mi + 1, plan.meta.length - 1)];
    // the section fields step at feature boundaries, so the nearer one wins
    const near = target > (b.s + a.s) / 2 ? mb : ma;
    let water = near.water;
    if (water === null) {
      // a body of water laps up against the bank it sits in, so the sample at
      // a feature boundary takes the level from the water beside it - but only
      // if that water is at its own level, or a pool would spill out over a
      // dry gap standing next to it
      const from = ma.water !== null ? ma : (mb.water !== null ? mb : null);
      water = from && Math.abs(from.water - p.y) < 1.6 ? from.water : null;
    }
    sm.push({
      p,
      x: p.x, z: p.z,
      y: p.y,
      // **The sample's own arc length**, and it is here because the track's
      // texture is projected in the *lane's* frame rather than the world's - see
      // `buildRoad()` - and a coordinate that runs with the bend is the arc
      // length and nothing else. Several notes in this file already talk about
      // a sample's `s`; this is the one that makes it so. `target` is the arc
      // distance the sample was placed at, so it is exact and it is monotone.
      s: target,
      ground: near.ground,
      w: near.w,
      water,
      floor: lerp(ma.floor, mb.floor, 0.5),
      basin: lerp(ma.basin, mb.basin, 0.5),
      cond: near.cond,
      crown: near.crown == null ? MID_CROWN : near.crown,   // the sweep's own radius here
      edgeY: 0,          // the outer edge's level, filled in below once the
                         // course's own rise is known
      rock: !!(near.rock || mb.rock),        // the floor of a chasm, bare stone
      fwd: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(),
      k: 0, hill: 0, grade: 0,
    });
  }
  // frames, curvature and the hillside the lane is cut into
  for (let i = 0; i <= n; i++) {
    const a = sm[Math.max(0, i - 1)], b = sm[Math.min(n, i + 1)];
    sm[i].fwd.subVectors(b.p, a.p);
    if (sm[i].fwd.lengthSq() < 1e-9) sm[i].fwd.set(1, 0, 0);
    sm[i].fwd.normalize();
    sm[i].right.crossVectors(sm[i].fwd, sm[i].up).normalize();
    const h1 = Math.atan2(sm[Math.min(n, i + 2)].fwd.z, sm[Math.min(n, i + 2)].fwd.x);
    const h2 = Math.atan2(sm[Math.max(0, i - 2)].fwd.z, sm[Math.max(0, i - 2)].fwd.x);
    let k = Math.abs(h1 - h2);
    if (k > Math.PI) k = TAU - k;
    sm[i].k = k / (4 * STEP);
    sm[i].hill = hills(sm[i].x, sm[i].z);
    // **The true radius of the bend**, signed, and it is a different number from
    // `k` above. `k` divides by `4 * STEP` because the sim wants a corner the
    // snail can feel at race pace; the geometry wants the radius the ground is
    // actually drawn on, and the two disagree wherever the samples bunch up.
    // Signed because which way the ground folds is the whole of it: a positive
    // radius means the centre of the bend is on the `+d` side, and that is the
    // side whose offsets run out of road.
    {
      const a = sm[Math.max(0, i - BEND_BASIS)], b = sm[Math.min(n, i + BEND_BASIS)];
      const run = a.p.distanceTo(b.p);
      let turn = Math.atan2(b.fwd.z, b.fwd.x) - Math.atan2(a.fwd.z, a.fwd.x);
      if (turn > Math.PI) turn -= TAU;
      if (turn < -Math.PI) turn += TAU;
      // and 1e6 rather than Infinity, because this is lerped and a frame's
      // curvature has to be a number like every other one
      sm[i].bend = run < 1e-3 || Math.abs(turn) < 1e-4 ? 1e6 : run / turn;
    }
  }
  // And the one it is actually for is the **tightest** bend within reach, not
  // this sample's own. A ribbon a hundred and twenty metres wide folds wherever
  // the tightest bend in that stretch is, and a single sample's radius says
  // nothing about a hundred and twenty metres of it - so the radius each sample
  // carries is the smallest within `gfxBendReach()` samples either side. That is
  // also why the basis is narrow: measured over four samples it is mostly
  // reading the wiggle, and it reported a five-metre radius on a course whose
  // tightest corner is eighteen, which would have pinched the whole country in.
  //
  // **And a median goes over the local radius first, and that is the whole of
  // how the two of those are not in each other's way.** The basis has to be
  // narrow - a corner shorter than the chord is averaged away by the straight
  // road either side of it, and a cap computed from a corner it cannot see is
  // exactly the cap that lets the fold through. A narrow basis on a spline also
  // reads the spline's own per-sample noise, and the noise is a *tight* radius
  // in the wrong place: Cloudsail Sky's tightest single step is thirty-six
  // metres on a course whose tightest real corner is a hundred. With the reach
  // now a hundred and twenty samples, one of those samples is not a pinprick in
  // the country: it is the **tightest thing in two hundred and forty metres of
  // it**, and the whole of the meadow on both sides is held to thirty-two metres
  // because of it. That is how the ribbon ended up narrower than the scenery
  // standing on it.
  //
  // A five-sample median is the filter for exactly that: a real corner is
  // dozens of samples long and survives being replaced by its neighbours' middle
  // value, and a noise spike one sample wide does not. It is a median and not a
  // mean because a mean of a radius is a radius of a mean, and a corner that is
  // tight for five samples in a hundred is a corner.
  {
    const local = sm.map((q) => q.bend);
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n, i + 2);
      const win = [];
      for (let j = a; j <= b; j++) win.push(Math.abs(local[j]));
      win.sort((x, y) => x - y);
      const med = win[win.length >> 1];
      sm[i].bend = med * (Math.sign(local[i]) || 1);
    }
  }
  {
    const B = gfxBendReach();
    for (let i = 0; i <= n; i++) {
      let best = 1e6, sign = 1;
      for (let j = Math.max(0, i - B); j <= Math.min(n, i + B); j++) {
        const r = Math.abs(sm[j].bend);
        if (r < best) { best = r; sign = Math.sign(sm[j].bend) || 1; }
      }
      sm[i].bend = best * sign;
    }
  }
  // **The outer edge's level**, which is one number for the whole course: a
  // third of the way from the height the lane starts at to the height it ends
  // at. It cannot be worked out per sample - it is a property of the two ends
  // and of nothing between them - and it is the one number that stops the far
  // country of a climbing course from climbing with the road. A course that has
  // gained twenty metres has a far edge twenty metres up if the edge follows
  // the lane, and twenty metres of ground twenty metres in the air is a slab.
  // At a third it is a hill that has stopped rising, which is a hill.
  {
    const edgeY = lerp(sm[0].y, sm[n].y, EDGE_THIRD);
    for (let i = 0; i <= n; i++) sm[i].edgeY = edgeY;
  }
  // How steep the lane is underfoot, as a rise over run. Taken over a couple of
  // metres either side rather than sample to sample, so the number a snail
  // reads is the slope it is actually on and not the facet it happens to be
  // standing on. A wall and a long ramp are both CLIMB; this is what tells the
  // sim which one it is looking at.
  for (let i = 0; i <= n; i++) {
    const a = sm[Math.max(0, i - 2)], b = sm[Math.min(n, i + 2)];
    const run = Math.max(0.5, b.x - a.x);
    sm[i].grade = (b.y - a.y) / run;
  }
  // The hillside the lane is cut into. A wall is a step in the lane, not in
  // the country: smoothing the ground level along the course means the slope
  // eases up to meet the lane over a long way instead of stepping with it, so
  // the only sheer face on a climbing course is the one the snail climbs.
  {
    const R = Math.round(20 / STEP);
    let src = sm.map((s) => s.ground);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= n; i++) {
        let sum = 0, wt = 0;
        for (let k = -R; k <= R; k++) {
          const t = 1 - Math.abs(k) / (R + 1);
          sum += src[clamp(i + k, 0, n)] * t; wt += t;
        }
        sm[i].ground = sum / wt;
      }
      if (pass === 0) src = sm.map((s) => s.ground);
    }
  }
  // the leaps, converted from the design's x into distance along the course
  const sAtX = (tx) => {
    let i = 0;
    while (i < dense.length - 2 && dense[i + 1].p.x < tx) i++;
    const a = dense[i], b = dense[i + 1];
    const u = b.p.x > a.p.x ? clamp((tx - a.p.x) / (b.p.x - a.p.x), 0, 1) : 0;
    return lerp(a.s, b.s, u);
  };
  const leaps = [];
  for (const lp of plan.leaps) {
    // a crate's `s1` is the **far end of its dish** and everything else's is the
    // foot of its far side, because a crate stands in the middle of the dish and
    // a flight lands wherever the road is. See the element for the dish.
    let s0 = sAtX(lp.x0), s1 = Math.max(sAtX(lp.x1), s0 + 0.8);
    const le = { s0, s1, land: s1 + 2.4, kind: lp.kind, vy: lp.vy, wet: lp.wet, waterY: lp.waterY, floorY: lp.floorY, lipY: lp.lipY };
    // **and the crate's own place in it.** The crate is not fitted to the groove
    // and the groove is not fitted to the crate: the crate is a cube of a fixed
    // size that has to be the same size wherever it stands, so what is measured
    // here is only *where* - the middle of the groove and the floor it sits on.
    // A cube of `CRATE_S` stands `CRATE_S` out of a groove of that depth, and
    // the snail's step onto its lid is the difference.
    if (lp.crate) {
      // **The notch is cut here, in the arc, and not in the planner's `x` - and
      // that is the whole of why.** The planner reserves the dish a length in its
      // own `x` and lays its floor over it, and the two only agree on a straight
      // road: on Crag Ascent's bend a metre and a half of design `x` came out
      // **1.68 m of arc** against a crate of 0.62, so the floor was three samples
      // long, the box stood at one end of it, and the snail walked a metre of lid
      // on nothing at all. `x` is a design coordinate and the box is a thing in
      // the world, and no amount of choosing `x` well makes one the other - the
      // same reason the half-way line is placed in `s` and the apron is opened in
      // `s`.
      //
      // **So the notch is one lane sample, and it is the one nearest where the
      // planner put it.** The floor goes on that sample and nowhere else, which
      // makes the hole exactly `STEP` of arc with the whole of the drop in the
      // gap before it and the whole of the rise in the gap after - a lip and a
      // lip, and the nearest a 750 mm lane can come to the cut face of a `leap`'s
      // chasm. Its two lips are the *midpoints* of the two gaps, because a hole
      // that stops at the sample either side of its floor is a hole half a metre
      // narrower than the gap it was cut in.
      const fc = clamp(((s0 + s1) / 2) / STEP, 0, sm.length - 1);
      const fi = Math.round(fc);
      // **The road's own level across the notch is the line between the two
      // samples that are *outside* it**, and this is the second half of what makes
      // the cut a cut. The planner lays its dish over the whole gap with the drop
      // in the middle and the rise at each end, so the samples either side of the
      // one the floor goes on are that dish's own shoulders - a fifth of a metre
      // under the road on Crag Ascent - and the old line, the average of the two
      // samples that bound the floor, averaged a dimple into the notch's depth and
      // left the dimple standing beside it. So the shoulders are found by walking
      // out to the first sample of plain road either side, and the road across the
      // notch is the straight line between those two.
      // **The two samples the lips stand on are the two the floor is between**,
      // and that is a different pair from the two the road's line is read off. The
      // lips are the boundary of the hole and the hole is one sample deep: reach
      // out to the far shoulder to measure the road and the notch on Grand
      // Marathon came out 1.12 m of arc with a metre of flat floor, twice the
      // crate it is cut for and forty centimetres of open slot showing either
      // side of the box. So the road is measured from outside and the lips are
      // cut at the samples the floor is actually between, and the two are named
      // apart so neither can be mistaken for the other.
      const a0 = Math.max(0, fi - 1), a1 = Math.min(n, fi + 1);
      let g0 = fi - 1;
      while (g0 > 0 && sm[g0].cond === PUSH) g0--;
      let g1 = fi + 1;
      while (g1 < n && sm[g1].cond === PUSH) g1++;
      const roadRun = Math.max(0.5, sm[g1].s - sm[g0].s);
      const roadAt = (s) => lerp(sm[g0].y, sm[g1].y, clamp((s - sm[g0].s) / roadRun, 0, 1));
      sm[fi].y = roadAt(sm[fi].s) - (lp.lipY - lp.floorY);
      // **and every other sample of the dish is put back on the road**, which is
      // what leaves a hole with a lip at each end instead of a hole with a trough
      // running off it. The comment above this block says the dish is cut at both
      // ends rather than eased into them, and for two samples it was not: the drop
      // was in the gap before the floor and the rise was spread over everything
      // after it, so the rise was still being drawn a fifth of a metre past the
      // far lip. A snail that misses the crate walks a step in one sample, which
      // is a lip, and the road either side of it is the road.
      for (let k = g0 + 1; k < g1; k++) {
        if (k !== fi) sm[k].y = roadAt(sm[k].s);
      }
      // and the grade of the samples it moved, because `grade` is read over
      // four samples either side and a stale one on a lip is a snail that thinks
      // the near side of a hole is a wall
      for (let k = g0; k <= g1; k++) {
        const a = sm[Math.max(0, k - 2)], b = sm[Math.min(n, k + 2)];
        sm[k].grade = (b.y - a.y) / Math.max(0.5, b.s - a.s);
      }
      le.crate = {
        s0: (sm[a0].s + sm[fi].s) / 2,
        s1: (sm[fi].s + sm[a1].s) / 2,
        restS: sm[fi].s,
        startS: (sm[a0].s + sm[fi].s) / 2 - CRATE_BACK,
        floor: sm[fi].y,
        // **and the road level at each of the two lips**, which is a thing the
        // surfaces need and cannot get for themselves: `trackAt()` between them
        // runs through the notch, so the only way to know where the road stood
        // where the walls stand is to be told, and on a course that is climbing
        // through the notch the two lips are a tenth of a metre apart and the
        // difference is the whole of whether the far lip is a step up or a
        // shelf.
        topA: roadAt((sm[a0].s + sm[fi].s) / 2),
        topB: roadAt((sm[fi].s + sm[a1].s) / 2),
      };
      s0 = le.crate.s0;
      s1 = le.crate.s1;
      le.s0 = s0; le.s1 = s1; le.land = s1 + 2.4;
    }
    leaps.push(le);
  }
  // **The apron a crate is shoved down, opened here and not in the planner**, and
  // the reason is the one the half-way line's rows are for: a row is 0.75 m apart,
  // so a width that changed at a row's own `x` is the road edge stepping a third
  // of a metre sideways between two rows 750 mm apart, which is a crease and not a
  // shoulder. Opened over `CRATE_FLARE` of the arc instead, it is a shoulder the
  // row spacing can carry - and it is read off `sm[i].w`, which is the same number
  // the verge and the scatter are already reading, so the ground opens with the
  // road and the eight boxes open with the ground.
  //
  // **And it is the whole shove that stands at the full width and not the dish**,
  // because that is where the crate is: it waits at `startS` until a snail reaches
  // it and is driven from there to `restS`, so a road that opened only across the
  // groove is a road eight boxes have already walked out of.
  for (const le of leaps) {
    if (!le.crate) continue;
    const c = le.crate;
    for (let i = 0; i <= n; i++) {
      const d = sm[i].s < c.startS ? c.startS - sm[i].s
        : sm[i].s > c.s1 ? sm[i].s - c.s1 : 0;
      if (d >= CRATE_FLARE) continue;
      sm[i].w = Math.max(sm[i].w, lerp(LANE_HW, CRATE_HW, 1 - smoothstep(0, CRATE_FLARE, d)));
    }
  }
  return {
    catId, plan, sm, n, length: len, leaps, finish: len - 20.0,
    drain: plan.cat.drain || 1,
  };
}

/** Sample the lane at a distance, interpolating position and frame. */
function trackAt(tr, s, out) {
  const t = clamp(s / STEP, 0, tr.n);
  const i = Math.floor(t), f = t - i, j = Math.min(i + 1, tr.n);
  const a = tr.sm[i], b = tr.sm[j];
  out.p.copy(a.p).lerp(b.p, f);
  out.fwd.copy(a.fwd).lerp(b.fwd, f).normalize();
  out.right.crossVectors(out.fwd, out.up).normalize();
  out.y = lerp(a.y, b.y, f);
  out.ground = lerp(a.ground, b.ground, f);
  out.w = lerp(a.w, b.w, f);
  out.water = f < 0.5 ? a.water : b.water;
  out.floor = lerp(a.floor, b.floor, f);
  out.basin = lerp(a.basin, b.basin, f);
  out.cond = f < 0.5 ? a.cond : b.cond;
  out.k = lerp(a.k, b.k, f);
  out.hill = lerp(a.hill, b.hill, f);
  out.grade = lerp(a.grade, b.grade, f);
  // `rock` is a yes or a no about a sample - a chasm floor, a wall, a crate's own
  // span - and it is carried on the frame rather than left behind for the caller
  // to look up, because the frames `roadRows()` hands out are interpolated and a
  // caller that read it off `tr.sm[]` would be reading a different sample from the
  // one it is drawing. `cond` takes the nearer of the two and so does this.
  out.rock = f < 0.5 ? a.rock : b.rock;
  out.crown = lerp(a.crown, b.crown, f);
  // the outer edge's own level, flat along the course, so it is carried as the
  // same number everywhere rather than re-read from two samples that are both
  // the same number
  out.edgeY = a.edgeY;
  // and the bend, for the same reason and with the same care: two samples a
  // long way apart in curvature average to something neither of them is, and
  // the ground reads this one to decide how far it may reach
  out.bend = a.bend === b.bend ? a.bend : (Math.abs(a.bend) > 1e5 || Math.abs(b.bend) > 1e5 ? (Math.abs(a.bend) > 1e5 ? a.bend : b.bend) : lerp(a.bend, b.bend, f));
  out.x = a.x; out.z = a.z;
  return out;
}
function newFrame() {
  return {
    p: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), y: 0, ground: 0, w: 1.75, water: null,
    floor: 0, basin: 0, cond: RUN, k: 0, hill: 0, grade: 0, x: 0, z: 0, crown: MID_CROWN, bend: 1e6, edgeY: 0,
    rock: false,
  };
}
/** The shoreline radius: it wanders, so a pond is not a rectangle. */
function bankRadius(fr) {
  if (fr.basin <= 0.05) return 0;
  return fr.basin * (0.78 + 0.32 * vnoise(fr.x * 0.17 + 11, fr.z * 0.17 - 4));
}
/**
 * How far out from the lane the ground reaches the hillside. The verge widens
 * where the lane sits well above or below it, so a cutting or a ledge eases
 * up out of the meadow instead of standing as a cliff at the edge of the path.
 */
function vergeBand(fr) {
  // A **wall** gets the three-piece profile of `groundYAt()` below, and this is
  // its outer edge: a shelf, then a face whose width is a fraction of the drop,
  // so the rows `groundColumns()` packs into the verge land on the two turns of
  // that profile rather than somewhere out in the middle of it. A gentle height
  // is not a wall and keeps the old easing band.
  //
  // **It is read off `wallProfile()` and not written out again**, because the two
  // widths it adds together are the two widths `groundYAt()` lays the ground out
  // on, and the ground's reach and the ground's shape cannot be two numbers that
  // were written down apart. They were, once, and the rows past the toe of a face
  // landed in the middle of the face.
  const wall = wallProfile(fr);
  if (wall) return wall.shelf + wall.face;
  return fr.w + 0.6 + Math.min(9, Math.abs(fr.y - fr.ground) * 1.2);
}
/** The two widths the three-piece wall profile is built out of, shared so that
 *  `groundYAt()` and `vergeBand()` cannot fall out of step about where the turns are
 *  - the same reason `SAND()` exists on the texture side. */
const wallProfile = (fr) => {
  // **A crate's notch is a hole and not a terrace, and it is asked about before the
  // drop is.** It is first because neither of its two numbers is a function of how
  // far the lane stands above the hillside, and a guard in front of it would quietly
  // take the narrow profile away on exactly the stretch where the two levels are
  // nearest: the lane cut through a hillside at the level of the ground beside it
  // has no drop to measure, so it came out with the wide turns and the dish was back.
  //
  // The shelf exists so there is room to stand at the top of a wall, and a wall is
  // something a course climbs; the notch is six hundred and seventy long and forty
  // centimetres from this row's lane to the crest of its own rim, and a shelf and a
  // half of it laid at the floor's own level made the hole a bowl nine metres across
  // with a slot in the middle of it — the one hole on the course reading as a dish,
  // which is the thing a hole has to stop doing.
  //
  // So the ground at the floor of a notch is the lane's own width and a hand's
  // breadth, and the rim is a third of a metre further out. Both numbers are
  // about the hole rather than about the drop, which is the whole of the
  // difference: a hole is the width of what fell in it, not the height of what
  // it fell out of.
  if (fr.cond === PUSH) return { shelf: fr.w + 0.12, face: 0.3 };
  const drop = Math.abs(fr.y - fr.ground);
  if (drop <= 0.35) return null;
  return { shelf: fr.w + 1.2 + Math.min(4.5, drop * 0.35), face: Math.min(7, Math.max(0.7, drop * 0.34)) };
};
/**
 * Ground height at a lateral offset from the lane. Inside a stretch of water
 * the ground is the basin floor, rising to the shoreline at the water's edge
 * and out to the hills beyond it. Close in, the lane is cut into the
 * hillside, so the ground stays near the lane's own level.
 */
function groundYAt(fr, d) {
  const ad = Math.abs(d), w = fr.w;
  const raw = hills(fr.x, fr.z + d) - hills(fr.x, fr.z);
  const br = bankRadius(fr);
  if (br > 0.05) {
    const b0 = Math.min(br, Math.max(w + 0.2, br - 2.7));
    // the basin itself, as it stands where there is no lane above it
    const basinY = (dd) => (dd <= br
      ? lerp(fr.floor, fr.ground, easeInOut(clamp((dd - b0) / Math.max(0.25, br - b0), 0, 1)))
      : lerp(fr.ground, fr.ground + raw, smoothstep(br + POOL_BERM, br + POOL_BERM + 7, dd)));
    // The lane stands **on** the bank; it does not stand in the water. Where the
    // lane is above the waterline - the lip you launch off, the wall you climb
    // out on - the ground under it is the lane's own ground, and past the edge
    // of the lane it **eases down to the bank** rather than stopping dead.
    //
    // Both halves of that are the whole of this function's business in a gorge.
    // Returning the floor for every sample inside the basin put three metres of
    // air under the lip, and the road at the top of a leapClimb was a plate
    // with daylight under the middle of it. Stopping the lane's ground *at* the
    // edge of the lane was half a fix and it is worse than it sounds: it made
    // the whole of the wall out of the chasm a two-and-a-bit metre wide shelf
    // with a vertical face on either side, so a steep climb reads as a flight
    // of flat plates stacked against a cliff - a step and a slab, a step and a
    // slab - which is what the far bank of a leapClimb looked like until the
    // ease was here. The ease is what makes the road a cutting **in** a bank
    // rather than a ledge stuck on the side of one.
    //
    // The shoulder is a multiple of the drop and not a fixed distance, so a
    // half-metre step out of the water gets a gentle metre of bank and a
    // three-metre one gets a face at about fifty degrees - still a cliff, and no
    // longer a wall.
    //
    // It is a guard on the water and not on the floor, and that is deliberate. A
    // **pool** you swim across has its lane at the water's own level, so the
    // clause does not fire and the ground under it is the floor and the water
    // has a depth.
    if (fr.water != null && fr.y > fr.water + 0.04) {
      const drop = Math.max(0, fr.y - basinY(w));
      const sh = w + Math.min(3.4, Math.max(0.9, drop * 0.8));
      return lerp(fr.y - 0.06, basinY(Math.max(ad, sh)), smoothstep(w, sh, ad));
    }
    return basinY(ad);
  }
  if (ad <= w) return fr.y - 0.06;
  // **A wall is a step, and the old shape drew it as a ramp.** The ground used to
  // ease from the lane's own level to the terrain across one band, and that band
  // was a straight line - so a four-metre wall came out as five metres of
  // thirty-six-degree hillside with the road lying on top of it. A climbing course
  // is made of walls, and this made the one thing the course is *about* stop
  // looking like a wall at exactly the point where the snail is asked to climb it:
  // the road ran out into a rounded slope, and a slope is a thing you walk up, not
  // a thing you climb.
  //
  // So it is three pieces and the middle one is short and **straight**:
  //
  //   - a **shelf** at the lane's own level, a terrace wide enough to stand on and
  //     scaling with the height of the wall, because the top of a tall wall has a
  //     wider top on it;
  //   - a **face** whose width is a third of the drop, so it stands at fifty to
  //     seventy degrees however tall the wall is - and it is a **plane**, not a
  //     smoothstep, because a smoothstep rounds both ends of it and a rounded end
  //     is the whole of what went wrong. The lip at the top and the toe at the
  //     bottom are creases, and a crease is what makes a face read as a face under
  //     a nine-degree sun;
  //   - and then the country, easing out of the foot of it exactly as it did.
  //
  // The same profile is a **cutting** when the lane is below the terrain, and that
  // is the point: the sign of the drop is not consulted, so a road cut into a
  // hillside gets a bank and a road perched on one gets a face, and neither of
  // them is a lump. A gentle height is not a wall at all and keeps the old band.
  const wall = wallProfile(fr);
  if (wall) {
    if (ad <= wall.shelf) return fr.y - 0.06;
    const foot = wall.shelf + wall.face;
    if (ad <= foot) return lerp(fr.y - 0.06, fr.ground, (ad - wall.shelf) / wall.face);
    return farCountry(fr, d, lerp(fr.ground, fr.ground + lerp(clamp(raw, -2.6, 2.2), raw, smoothstep(foot, foot + 6, ad)), smoothstep(foot, foot + 11, ad)));
  }
  const band = vergeBand(fr);
  if (ad <= band) return lerp(fr.y - 0.06, fr.ground, (ad - w) / (band - w));
  return farCountry(fr, d, lerp(fr.ground, fr.ground + lerp(clamp(raw, -2.6, 2.2), raw, smoothstep(band, band + 6, ad)), smoothstep(band, band + 11, ad)));
}
/**
 * How far out the ground is drawn, and it is **one number for the whole
 * ribbon**, not one per side.
 *
 * It is *asked of the frame rather than written down*, because the row list and
 * the height have to finish in the same place. The last row of a side is the
 * outermost thing there is, and the ease down to the terrain has to be *complete
 * there*: left short, the ground's edge stands wherever the ribbon happened to
 * be, which on a climbing course is a foot in the air. One number, two callers,
 * and the one thing that is not allowed is for them to be written down twice -
 * they were, and the two drifted to a hundred and twenty and two hundred and
 * sixty at the same time.
 *
 * **The cap is on both sides, and it is the sign that put it on the wrong one.**
 * A ground row is an offset of the lane, and an offset run out past the radius
 * of the bend it was taken from comes back on itself: the row on the inside of
 * a corner wraps through its own centre and the ground behind it folds over the
 * ground in front of it. On Hedgerow Dash that was the notch in the middle of
 * the meadow's outline - and it was the *uncapped* side that did it, because
 * which side a bend folds is carried by the sign of `sm.bend`, and a positive
 * one does not mean what the note on the field said it meant. The trim went one
 * way and the fold went the other, and from a hundred metres up a ribbon whose
 * left edge doubles back through a hundred and seventy-nine degrees is a bite
 * out of the country.
 *
 * So the cap does not ask which way the bend goes. It asks how tight the
 * **tightest** bend in reach is, and it holds **both** sides inside that, which
 * is one number instead of two and is the only version in which neither side
 * can fold. It costs the outside of a corner the country it could have had: a
 * hundred and twenty is a hundred and twenty on both sides of a corner whose
 * radius is seventy, where the outside would have gone to a hundred and
 * twenty-six. It is a meadow, not a survey.
 */
function groundEdge(fr) {
  // the lesser of the two ceilings, and the edge is not optional: a bend of
  // nine hundred metres is a straight line with a name on it, and a cap that is
  // only the radius puts the edge at eight hundred and fifty
  return Math.min(gfxEdge(), Math.max(gfxGroundFloor(), Math.abs(fr.bend) * NEST_FRACTION));
}
/**
 * Out past the verge the ground is the lane's own level carrying the country's
 * relief, and that is right near the road - but the lane's level is **not the
 * country's**, and the two come apart the further the course climbs.
 *
 * `fr.ground` is the lane's ground, smoothed along the course, and the plan
 * hands a running section the lane's own height: the country beside a climbing
 * course is meant to climb with the road rather than fall away from it under a
 * viaduct. So a course that has gained twenty metres carries its whole ribbon
 * twenty metres with it - and the ribbon runs out a hundred and fifty metres
 * either side, so the whole of it hangs in the air with the weather underneath
 * it. On Crag Ascent, whose half-way is twenty metres above the meadow, that
 * was a green slab the length of the course suspended over the valley, which is
 * the overhang, and it was never the sweep's fault: the sweep only ever moved
 * where the slab was, not how high it hung.
 *
 * So the far country is given back to the terrain. `far` is the ground as it
 * was - the lane's level plus the relief - and the last stretch of it eases
 * down to `hills()` at the same point, which is where the ribbon's outer
 * columns are (`gfxEdge()`, and the two numbers have to be the same number:
 * ease that finishes short of the edge and the last strip of ground hangs a
 * metre above the country, and a ribbon in the air has a skyline). On a
 * meadow course the two are within a couple of metres and the ease is
 * invisible; on a climbing course it is the hillside falling away, which is
 * what a course that has climbed twenty metres should look like from above.
 */
const farCountry = (fr, d, far) => {
  const ad = Math.abs(d);
  // The far country settles to the lesser of the real terrain and the level a
  // third of the way between the heights the course starts and finishes at. The
  // terrain is the one that matters - it is the ground that is actually there -
  // and the ramp is the cap: on a course that has climbed twenty metres, the
  // ground at the far edge rises at a third of the rate the road did, so the
  // countryside falls away behind it instead of climbing up to meet the road and
  // folding back over the course. It is `min` and not a blend, because a blend
  // would put the ground *above* the terrain wherever the ramp is higher, and a
  // ribbon above the terrain is a slab in the air - which is the thing this
  // whole piece of work is about not having.
  return lerp(far, Math.min(hills(fr.x, fr.z + d), fr.edgeY), smoothstep(49, groundEdge(fr), ad));
};
function lanePoint(tr, s, d, out) {
  trackAt(tr, s, out);
  out.p.addScaledVector(out.right, d);
  return out;
}
/* ================================================================== *
 * Renderer and sky. A dome rather than a flat clear colour, anchored to
 * the world so the colour at the horizon is the same from every angle and
 * the fog can be set to exactly that colour.
 *
 * **`antialias: false`, and that is the whole of the anti-aliasing story being
 * one mechanism.** A context's multisampled default framebuffer is free, which is
 * why it was on, and it is the reason the two paths did not agree: it is a
 * context-creation parameter, so it cannot be changed, it is a boolean and not a
 * sample count, and `EffectComposer` builds its own targets at `samples: 0`, so a
 * composer frame had no anti-aliasing at all while the same picture without one
 * had four samples. Two mechanisms that cannot be reconciled, and the menu had no
 * way to say anything about either. Everything now goes through the composer's
 * target and the `msaa` row, which is why `antialias: true` would be a bug.
 * ================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: false });
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
document.body.appendChild(renderer.domElement);

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
function domeToneFix(c) {
  if (!composerUp) return c;
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
function paintSky(colours) {
  const pos = skyGeo.attributes.position, col = skyGeo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    skyAt(colours, (1 - pos.getY(i) / SKY_R) / 2, _c2);
    domeToneFix(_c2);
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
function refreshEnvironment(colours) {
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
  for (const e of [env, stageEnv]) if (e) e.scene.environment = envTarget.texture;
}

function makeEnv(fogNear, fogFar) {
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
  // the lamps, which are dark until the hour asks for them
  const lamps = [];
  for (let i = 0; i < LAMP_LIGHTS; i++) {
    const l = new THREE.PointLight(0xffd9a0, 0, 13, 1.6);
    l.visible = false;
    scene.add(l);
    lamps.push(l);
  }
  // how high and how far round the sun sits, and how much of it there is: the
  // hour of the day writes these, the frame loop follows the snail with them
  return { scene, sky, key, rim, fill, hemi, lamps, sunHeight: 1, sunSide: 1, sunI: 1 };
}

/* ================================================================== *
 * Applying the graphics settings
 *
 * One entry point, `applyGraphics()`, and the order inside it is the whole of
 * what makes a change cheap:
 *
 *   1. the renderer-level knobs - render scale, fog, shadow map, the dome
 *   2. `syncComposer()`, which only does anything on a boundary crossing
 *   3. `syncPasses()`, which only does anything when the *set* of passes changes
 *   4. overlay, glow, materials
 *   5. a debounced stage rebuild, if the change needs one
 *
 * Nothing is torn down and rebuilt between crossings, so a settings change that
 * does not alter which passes exist costs a handful of assignments.
 * ================================================================== */

/**
 * three's post-processing passes, **fetched only if a tier asks for one.**
 *
 * They are mapped in the same import map at the same 0.160 pin as the library
 * itself - one version, one import map, no skew - but they are not part of the
 * boot. A `GTAOPass` is a big module and a `WebGLRenderTarget` factory's worth of
 * code that a machine on the bottom tier will never execute, and the bottom tier
 * is the one whose boot time matters.
 */
let GFX_ADDONS = null;
let addonsPromise = null;
function loadAddons() {
  if (!addonsPromise) {
    addonsPromise = Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/GTAOPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      // **The base class and the quad, and nothing else from it.** `GtaoGiPass` is
      // the county's own pass rather than a three one, and it is a `Pass` in
      // everything `EffectComposer` asks of one - `enabled`, `needsSwap`,
      // `renderToScreen`, `setSize`, `dispose` - so it is built on three's and
      // writes its own `render()`.
      import('three/addons/postprocessing/Pass.js'),
    ]).then(([ec, rp, gtao, bloom, out, ps]) => {
      GFX_ADDONS = {
        EffectComposer: ec.EffectComposer, RenderPass: rp.RenderPass,
        GTAOPass: gtao.GTAOPass, UnrealBloomPass: bloom.UnrealBloomPass,
        OutputPass: out.OutputPass, Pass: ps.Pass, FullScreenQuad: ps.FullScreenQuad,
      };
      return GFX_ADDONS;
    });
  }
  return addonsPromise;
}

let composer = null, composerUp = false;
let renderPass = null, presentPass = null, gtaoPass = null, gtaoGiPass = null, bloomPass = null;
/** The set of passes currently in the chain, so `syncPasses()` is a no-op when
 *  nothing crossed. `a` is ambient occlusion, `b` is bloom. **`h` is the
 *  resolution the G-buffer is standing at and `g` is the bounce**, and all four
 *  are in the key because all four change what is on the chain without changing
 *  *which* passes are: a step that turns the G-buffer from half-res to full is
 *  the same one pass resized, and a key that only knew about occlusion would
 *  return early and leave it at half. */
let passKey = '';
/** The sample count the chain's own targets were built at, and -1 for no chain.
 *  **Kept beside `composerUp` and not folded into it**, because the two cross
 *  independently: a sample count can change while the chain stays wanted, and a
 *  sample count is baked into a `WebGLRenderTarget`'s framebuffer at the moment
 *  that framebuffer is created and never afterwards. */
let msaaKey = -1;
/** The size the chain's buffers were last at, as `[width, height]`, for the same
 *  reason and with the same shape as `msaaKey`: a render scale change resizes them
 *  rather than rebuilding them, and a resize that forgot to say so would leave a
 *  0.5x frame standing at 1x. Zero is not a size either of them can be. */
let sceneKey = [0, 0];

/** The county's own resolution in device pixels, which is **not** the canvas's and is
 *  the number every pass in the chain is sized from. */
function scenePixels() {
  return [Math.max(1, Math.round(innerWidth * sceneRatio())),
    Math.max(1, Math.round(innerHeight * sceneRatio()))];
}

/**
 * The one predicate the whole cost story hangs off. **Four things raise it and not
 * two**, and the two that are not passes are the interesting ones: multi-sampling is
 * a multisampled buffer and a resample is a buffer whose size is not the window's,
 * and both are render targets, so a machine that asks for either cannot have a direct
 * path any more. It gets the chain with `RenderPass` and `presentPass` on it and
 * nothing else, which is one scene render and one resolve - so the direct path is
 * still `renderer.render()` and still spends no render targets, but only because the
 * settings say so.
 */
function needsComposer() {
  return gfx.ssao >= 2 || gfx.fxBloom > 0 || gfxMsaa() > 0 || needsResample();
}

/** The scene the frame is about to draw, which is the stable's on the stable and
 *  on a stroll and the county's everywhere else. */
const renderScene = () => (mode === 'stable' || mode === 'stroll' ? stageScene : scene);

/**
 * The buffer the scene is drawn into, at the sample count asked for. Passing it
 * in is the only way to get multi-sampling on this path: `EffectComposer` builds
 * its own pair at `samples: 0` when it is handed no target, and `clone()` copies
 * the count onto the second one, so both halves of the ping-pong are multisampled
 * and whichever one `RenderPass` writes is the one that is.
 *
 * **Sized in CSS pixels, and that is not a detail.** `EffectComposer` reads its
 * width and height off the target it is handed and multiplies them by its own pixel
 * ratio inside `setSize()`, so a target sized in *device* pixels has the ratio
 * applied to it a second time - which is invisible at 1x and quietly renders the
 * county at a quarter of the pixels asked for when a machine boots straight into
 * 0.5x, because then the ratio is not one to begin with.
 *
 * `HalfFloatType` is three's own default for the pair and is written out here
 * because a target that quietly came in as `UnsignedByteType` would band the sky
 * that the dome tone fix spends its bisection correcting.
 */
function composerTarget(samples) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, innerWidth), Math.max(1, innerHeight), {
    type: THREE.HalfFloatType, samples,
  });
  rt.texture.name = 'EffectComposer.rt1';
  return rt;
}

/** The chain's buffers at the county's resolution, and `presentPass`'s idea of it.
 *  **Both halves in one function**, because the pass reads the source size to turn
 *  `vUv` into a texel address, so a resize that moved the buffers and not the
 *  uniform would scale the frame by the ratio between two numbers that are each
 *  right. */
function applyChainSize(force) {
  if (!composer) return;
  const [w, h] = scenePixels();
  // **Both numbers, not the width.** A window dragged along one edge changes the
  // height alone, and a guard that reads one of the two is a guard that misses it.
  if (!force && w === sceneKey[0] && h === sceneKey[1]) return;
  sceneKey = [w, h];
  composer.setPixelRatio(sceneRatio());
  sizeGtao();
  sizeGtaoGi();
  if (presentPass) presentPass.setSource(w, h);
}

/** Everything a chain owns, given back. The dome is repainted because it was
 *  painted to suit whichever path was running and that has just changed. */
function dropComposer() {
  if (composer) {
    if (gtaoPass) { composer.removePass(gtaoPass); gtaoPass.dispose(); gtaoPass = null; }
    if (gtaoGiPass) { composer.removePass(gtaoGiPass); gtaoGiPass.dispose(); gtaoGiPass = null; }
    if (bloomPass) { composer.removePass(bloomPass); bloomPass.dispose(); bloomPass = null; }
    // frees both ping-pong targets and the copy pass
    composer.dispose();
  }
  composer = null; renderPass = null; presentPass = null; passKey = '';
  composerUp = false; msaaKey = -1; sceneKey = 0;
  if (_todSky) paintSky(_todSky);
}

function syncComposer() {
  if (!GFX_ADDONS) return;                 // still downloading; a later apply finishes it
  const want = needsComposer();
  const samples = gfxMsaa();
  // idempotent: nothing wanted, nothing standing, and the buffer it would be
  // standing at is the buffer it is standing at
  if (want === composerUp && samples === msaaKey) return;
  // and the one case that is not idempotent and looks like it should be - the
  // chain is still wanted and only the sample count moved. There is no way to
  // re-sample a framebuffer that already exists, so it is built again.
  dropComposer();
  if (!want) return;
  const { EffectComposer, RenderPass } = GFX_ADDONS;
  composer = new EffectComposer(renderer, composerTarget(samples));
  composerUp = true;
  msaaKey = samples;
  renderPass = new RenderPass(renderScene(), camera);
  presentPass = new (presentPassClass())(gfxScale());
  // `setPixelRatio()` calls `setSize()`, which sizes every pass - so the ratio goes
  // in before any pass exists, and `sizeGtao()` puts the half-resolution G-buffer
  // back afterwards, because `addPass()` would otherwise immediately overwrite it
  // with a full-size one. `setSize()` disposes a target whose size moved, so the
  // framebuffer is rebuilt from `samples` and the count survives the resize.
  applyChainSize(true);
  syncPasses(true);
  // and the dome, which is painted to suit whichever path was running - see
  // `domeToneFix()`
  if (_todSky) { paintSky(_todSky); if (gfxReflOn()) queueProbes(); }
}

function syncPasses(force) {
  if (!composer) return;
  const a = gfxSsao();
  const wantAO = !!a, wantGI = !!(a && a.gi), wantBloom = gfx.fxBloom > 0;
  const key = (wantAO ? 'a' : '') + (a && a.half ? 'h' : '') + (wantGI ? 'g' : '')
    + (wantBloom ? 'b' : '');
  if (key === passKey && !force) return;
  passKey = key;
  const { GTAOPass, UnrealBloomPass } = GFX_ADDONS;
  if (wantAO && !gtaoPass) {
    gtaoPass = new GTAOPass(scene, camera, 1, 1);
    // `OUTPUT.Default` reads readBuffer and blends the denoised occlusion over it,
    // which is the composer-facing mode. The other five output the AO on its own
    // and are for looking at the pass rather than for putting it in the picture.
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    // Whatever cannot occlude is out of the G-buffer - the dome, the backdrop and
    // every additive glow among them. Wrapped here, once, at construction, because
    // `overrideVisibility()` is the hook that runs immediately before the normal
    // render and no other time, and `restoreVisibility()` - which runs immediately
    // after it - is what puts it all back. See `hideFromGBuffer()` for why it is
    // the pass's own scene that gets walked.
    const cache = gtaoPass.overrideVisibility.bind(gtaoPass);
    gtaoPass.overrideVisibility = function () { cache(); hideFromGBuffer(this.scene); };
    // and the wind, which the override material does not have: injected at the
    // pass's own construction, before it has drawn anything, because the bend is
    // a vertex edit and a vertex edit after the first frame is a frame of ghost.
    gtaoWind(gtaoPass.normalMaterial);
  }
  if (!wantAO && gtaoPass) { gtaoPass.dispose(); gtaoPass = null; }
  // The bounce, and it reads the occlusion's own normal-and-depth buffer rather
  // than building one of its own - which is the whole reason this is one extra
  // scene render and not two. Constructed and dropped on the `gi` field alone, so
  // the two G-only steps are byte-for-byte the chain they were.
  if (wantGI && !gtaoGiPass) gtaoGiPass = newGtaoGiPass(gtaoPass, camera);
  if (!wantGI && gtaoGiPass) { gtaoGiPass.dispose(); gtaoGiPass = null; }
  if (wantBloom && !bloomPass) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.55, 1.15);
  }
  if (!wantBloom && bloomPass) { bloomPass.dispose(); bloomPass = null; }
// **Order is the whole of what this chain is.** The scene, then the occlusion
  // multiply, then the bounce, then bloom, then the one pass that tone-maps and
  // encodes. GTAO has to precede the bounce because the bounce is *light arriving at*
  // a surface and the occlusion is how much of the sun's own is getting here;
  // a bounce added before the multiply is a bounce the occlusion then darkens,
  // which is the same as not having one in a crease. It has to precede bloom
  // because bloom multiplies occlusion into the colour buffer and a bloom computed
  // on already-occluded pixels is a glow that brightens the shadows; and
  // OutputPass has to be last because it is what applies ACES and the sRGB
  // transfer to the finished frame.
  //
  // So the array is rebuilt from the wanted list rather than appended to, which is
  // also what makes it correct when a tier *drops*: `addPass()` would put the
  // new pass at the end, after `presentPass`, and the frame would come out
  // untone-mapped with the occlusion applied to nothing.
  composer.passes.length = 0;
  composer.addPass(renderPass);
  if (gtaoPass) composer.addPass(gtaoPass);
  if (gtaoGiPass) composer.addPass(gtaoGiPass);
  if (bloomPass) composer.addPass(bloomPass);
  composer.addPass(presentPass);
  sizeGtao();
  sizeGtaoGi();
  tuneGtao();
  tuneBloom();
}

/**
 * **The Light step is a half-resolution G-buffer**, so its AO pass draws a
 * quarter of the pixels and its denoise reads a quarter of them. The scene render
 * behind the buffer is the whole county - every tuft and every instanced prop - so
 * this is the single largest saving available on the row and the reason level 2 is
 * not just a smaller radius on level 3. It is also, visibly, softer - which is the
 * honest trade and the reason the level is called Light and not Cheap.
 *
 * **The buffer is the county's own now** (`makeGBuffer()`), so this function sizes
 * one target rather than two, and `GTAOPass` is told to read it rather than to
 * render one.
 *
 * **The ladder decides, not the pass.** The two disagree for the length of one
 * `applyGraphics()`, because the pass is dropped in `syncComposer()` at the end of
 * it and the pixel ratio is applied at the start: a change that switches the
 * occlusion off arrives here with the old pass still standing and a null on the
 * row, and `.half` on a null is the crash a player gets for choosing the bottom
 * preset off a composer tier.
 */
function sizeGtao() {
  const a = gfxSsao();
  if (!gtaoPass || !a) return;
  const [w, h] = scenePixels();
  const half = !!a.half;
  gtaoPass.setSize(half ? Math.max(1, Math.round(w / 2)) : w,
    half ? Math.max(1, Math.round(h / 2)) : h);
  // **The shared buffer is sized here and not in a function of its own**, because
  // `a.half` is the one answer to "how many pixels is a G-buffer" and this is now
  // the one G-buffer. The bounce reads it, the occlusion reads it, and both are
  // standing at the size this line wrote; a resize that moved one and not the other
  // is a bounce ray marched against a depth buffer of the wrong size, which is not a
  // crash but a bounce landing on the wrong piece of the county.
  if (gBuffer) gBuffer.setGBufferSize(half ? Math.max(1, Math.round(w / 2)) : w,
    half ? Math.max(1, Math.round(h / 2)) : h);
}

/**
 * **The radius ladder goes down as the quality goes up**, which is the one thing
 * in this block that looks backwards and is not. A wide radius at a low sample
 * count is a soft grey wash over everything within a metre and a half of it -
 * which on this course is the road, the top of every wall, the base of every
 * tree and four thousand tufts of grass, and a multiply on all of them. The
 * county has been burned by a black multiply once already. So the top steps take
 * a third of a metre and sixteen samples, which is a contact shadow rather than a
 * haze, and `blendIntensity` tops out at one rather than being pushed.
 */
function tuneGtao() {
  const a = gfxSsao();
  if (!gtaoPass || !a) return;
  gtaoPass.updateGtaoMaterial({ radius: a.radius, samples: a.samples, scale: 1, distanceExponent: 1, thickness: 1 });
  gtaoPass.blendIntensity = a.blend;
  // **The bounce's strength off the same entry, one line beside the occlusion's.**
  // It is asked for the ladder and not for the pass, for the reason `sizeGtao()`
  // gives: the two disagree for the length of one `applyGraphics()`.
  if (gtaoGiPass) gtaoGiPass.strength = a.gi || 0;
}

/**
 * Bloom thresholds are in **linear light, above white**: the buffer the bloom
 * reads is the scene before ACES, so a threshold under one catches the horizon -
 * `0xdfeaf2` is 0.85 linear in the green - and the sky blooms. What is meant to
 * bloom is over-bright: the lamp glass at up to 2.6 of emissive, the specular
 * off a wet road, the additive glow on each lamp. The upper cell is higher and
 * reaches further down than the lower one, which is the whole of the difference
 * between the two - and it is one switch at two strengths rather than two
 * effects, so nothing here reads a row of its own.
 */
function tuneBloom() {
  if (!bloomPass) return;
  const hi = gfx.fxBloom >= 2;
  bloomPass.strength = hi ? 0.62 : 0.34;
  bloomPass.radius = hi ? 0.72 : 0.5;
  bloomPass.threshold = hi ? 0.98 : 1.15;
}

/**
 * What must not go into an occlusion buffer, hidden for the G-buffer render and
 * put back by `restoreVisibility()` immediately after it.
 *
 * **Only opaque geometry that writes depth belongs in one**, because the buffer
 * is a depth map and nothing else: `GTAOPass` hides Points and Lines for
 * exactly this reason and stops there, so everything else that cannot occlude
 * has to be named here. The dome does not write depth and would be a sky at
 * depth one occluding the hills in front of it; the backdrop's clouds and hills
 * are painted background a hundred metres and more beyond the last thing worth
 * occluding; and an **additive glow sprite is a screen-aligned quad of light**
 * that the override material happily rasterises as a slab of geometry - which is
 * not a soft halo but a dark rectangle punched through the picture, square,
 * camera-facing, and moving with the lamp it belongs to.
 *
 * **Scoped to the scene the pass is about to render**, and the county has two of
 * everything, a race and a stable, each with its own dome and its own hills. Hiding
 * both scenes' worth left whichever one the buffer was *not* being built from
 * switched off for good, and the stable came up with no sky at all.
 */
function hideFromGBuffer(sc, cache) {
  if (!sc) return;
  sc.traverse((o) => {
    // **The record is optional and is what makes this function usable twice.**
    // `GTAOPass` used to walk in here with no map and nothing to put back, keeping
    // its own visibility cache for `restoreVisibility()` to walk; it no longer walks
    // in here at all, because it no longer renders the buffer - see `makeGBuffer()`,
    // which is the one caller now and brings its own map because there is nobody
    // else's to fill.
    if (cache) cache.set(o, o.visible);
    if (!o.visible || o.isPoints || o.isLine) return;
    const m = o.material;
    if (!m) return;
    for (const mm of (Array.isArray(m) ? m : [m])) {
      if (mm.transparent || mm.depthWrite === false || mm.blending !== THREE.NormalBlending
          || mm === mat.cloud || mm === mat.hillNear || mm === mat.hillFar) {
        o.visible = false;
        return;
      }
    }
  });
}

/**
 * The other half, and **the reason it is a function and not a line repeated at the
 * call site**: the county's own map is emptied by the restore that walks it, and a
 * caller that hid a piece of the dome and never put it back would take the sky with
 * it. A sky that came back on the next pass rather than the next frame is the bug
 * this pair was written to stop, and there is now exactly one caller - which is the
 * better reason still, because one caller cannot forget to pair them.
 */
function restoreGBuffer(sc, cache) {
  if (!sc) return;
  sc.traverse((o) => {
    const v = cache.get(o);
    if (v !== undefined) o.visible = v;
  });
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * One G-buffer for both halves of the chain: **the colour a surface has in
 * attachment 0 and the view normal in attachment 1, off a single scene render.**
 *
 * **It is a `WebGLMultipleRenderTargets` and not a `WebGLRenderTarget`, and that
 * is the whole of the saving.** r160 has no MRT on the render target itself - the
 * `count` option arrived in r162 and `WebGLMultipleRenderTargets` was removed in
 * r165 - but r160 *does* have the class, and `WebGLState.drawBuffers()` honours
 * `isWebGLMultipleRenderTargets` by writing one `COLOR_ATTACHMENT0 + i` per entry
 * of `texture`. So the two attachments are two `drawBuffers` in one draw, rather
 * than two draws of the same scene: the bounce's albedo render is **gone**, not
 * cheaper, and what it bought back is a full scene traversal - the tufts, the
 * instanced props, the rock walls, all of it - that used to happen twice.
 *
 * **The alternative was a second material and a second pass, which is what it was
 * before**: `MeshBasicMaterial` for the colour and `MeshNormalMaterial` for the
 * normal, a `GtaoGiPass` between them. One material that writes both is smaller
 * than two materials that write one each, and it cannot disagree with itself about
 * which pieces are in the county - `hideFromGBuffer()` runs once and the two
 * attachments cannot be out of step, which is the whole reason the clear colour
 * below is a single answer rather than two.
 *
 * **Both attachments are half-float**, and the colour one did not used to be: a
 * colour buffer at `UnsignedByteType` puts the bounce in steps of 1/255 and the
 * bounce is a *sum* of eight directions of already-dim colour, so the step shows.
 * GTAO's own buffer has been half-float from the start, and matching it means the
 * two attachments also share one format, which is a requirement of MRT - so this
 * is the format the colour gets whether or not it asked.
 *
 * **The normal is written exactly the way `MeshNormalMaterial` writes it** -
 * `packNormalToRGB` into `location = 1` - because `GTAOPass` reads it back with
 * `unpackRGBToNormal` under `NORMAL_VECTOR_TYPE == 1`, and the bounce reads it
 * the same way. That is a compatibility requirement, not a choice: a differently
 * packed normal is not a slightly wrong normal here, it is a surface leaning
 * somewhere else and a bounce marching off it.
 *
 * **GLSL3 and two locations, because that is the only way to name two outputs.**
 * three's prefix declares `pc_fragColor` at location 0 for a GLSL1-style material
 * and nothing at all for a `GLSL3` one (`WebGLProgram.js:873-874`), so the second
 * output has to be written with an explicit `layout(location = 1)` in the shader
 * itself. The material therefore declares **both**, which is why location 0 is
 * named here as well rather than left to the prefix.
 *
 * **The vertex colours are read straight out of the attributes** rather than
 * through `color_fragment`, because this material has no `diffuseColor` for them
 * to modify: `vColor` is accumulated here exactly as `<color_vertex>` does
 * (`USE_COLOR`, then `USE_INSTANCING_COLOR`), and a mesh carrying neither is white
 * - which is what the `MeshBasicMaterial` this replaces did with `color: 0xffffff`.
 * ------------------------------------------------------------------ */
const GBUFFER_VERT = /* glsl */`
  #include <common>
  varying vec3 vGfxColor;
  varying vec3 vGfxNormal;
  void main() {
    // **The same four includes in the order three's own basic and normal materials
    // use them**, so instancing, instance colour, morph and skin come off the same
    // chunks rather than being re-spelled here.
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    #ifdef USE_COLOR
      vGfxColor = color;
    #else
      vGfxColor = vec3( 1.0 );
    #endif
    #ifdef USE_INSTANCING_COLOR
      vGfxColor *= instanceColor;
    #endif
    // **View space, and not world**: both readers ask for view space - the
    // occlusion unpacks it straight out of the attachment and hands it to the
    // bounce's own frame, and normalMatrix is the matrix that puts it there.
    vGfxNormal = normalize( transformedNormal );
  }
`;

const GBUFFER_FRAG = /* glsl */`
  precision highp float;
  #include <packing>
  layout(location = 0) out highp vec4 gGfxAlbedo;
  layout(location = 1) out highp vec4 gGfxNormal;
  varying vec3 vGfxColor;
  varying vec3 vGfxNormal;
  void main() {
    gGfxAlbedo = vec4( vGfxColor, 1.0 );
    gGfxNormal = vec4( packNormalToRGB( vGfxNormal ), 1.0 );
  }
`;

/**
 * The shared buffer, made once and given back by `dropGBuffer()`.
 *
 * **The depth texture is attached to the MRT and not to a target of its own**,
 * which is the second half of why this is one render: the bounce reads the same
 * depth the occlusion reads, at the same size, with the same `DepthStencilFormat`
 * and the same `UnsignedInt248Type`, so `perspectiveDepthToViewZ()` answers the
 * same in both passes by construction.
 *
 * **`setGBuffer()` is called by `syncPasses()` and not from here**, because r160's
 * `setGBuffer` reads `this.normalRenderTarget.depthTexture` on its way out - a
 * field its *external* branch never creates - so calling it on a pass that was not
 * first constructed without a `depthTexture` throws. See `syncPasses()`.
 */
function makeGBuffer() {
  const { Pass } = GFX_ADDONS;
  const depth = new THREE.DepthTexture(1, 1);
  depth.format = THREE.DepthStencilFormat;
  depth.type = THREE.UnsignedInt248Type;
  const target = new THREE.WebGLMultipleRenderTargets(1, 1, 2, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    depthTexture: depth,
  });
  target.texture[0].name = 'GBuffer.albedo';
  target.texture[1].name = 'GBuffer.normal';
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: GBUFFER_VERT,
    fragmentShader: GBUFFER_FRAG,
    glslVersion: THREE.GLSL3,
    side: THREE.FrontSide,
    fog: false,
  });
  // **The wind, and now there is only one place to put it.** Two G-buffers meant
  // two materials to keep in step; a tree that leaned in the beauty pass and in
  // one buffer and stood still in the other was a ghost of its own canopy hanging
  // under it, 22 cm of the county's own shape doing nothing. One buffer has one
  // material, so the two cannot disagree - which is `gtaoWind()`'s whole argument
  // for being per-material, made unnecessary by there being one.
  gtaoWind(material);
  const vis = new Map();
  const clear = new THREE.Color();

  // **A `Pass`, and `needsSwap` false.** It has nothing to composite and nothing to
  // hand on, so `EffectComposer` must not swap its buffers over it - a pass that
  // swapped would leave the frame in the other one of the two and every later pass
  // would read a target nobody wrote.
  class GBufferPass extends Pass {
    constructor() {
      super();
      this.needsSwap = false;
      // **The scene is a field and not the module's `scene`**, for the reason the
      // frame loop's three lines give: the county has two of everything and which
      // one is up changes with the mode. The loop writes this every frame beside
      // `renderPass.scene` and `gtaoPass.scene`; a buffer built from the county
      // while the occlusion marched the stable's depth is an irradiance estimate
      // of a place nobody is standing, and it reads as a colour cast rather than
      // as an error.
      this.scene = scene;
      this.target = target;
      this.material = material;
      this.vis = vis;
    }
    /**
     * **A no-op, and not an omission.** The one number that decides this buffer's
     * size is `a.half`, and `sizeGtao()` is what reads it - the same `setSize()` the
     * occlusion's own targets are sized by, from the same answer. A `setSize()`
     * here would be a second answer to the same question, and the two would be
     * right on different frames.
     */
    setSize() {}
    setGBufferSize(w, h) { target.setSize(Math.max(1, w), Math.max(1, h)); }
    /**
     * The one scene render both halves read, and it is **not** inside either pass.
     *
     * `GTAOPass` runs before `GtaoGiPass` in the chain, so a buffer filled inside
     * the bounce would hand the occlusion the *previous* frame's normals and depth
     * - an AO a frame behind the camera, which reads as a lag nobody can name. So
     * this is its own `Pass`, ahead of both, and `syncPasses()` owns where it sits.
     *
     * **The signature is `EffectComposer`'s, not this pass's**: it calls
     * `render( renderer, writeBuffer, readBuffer, deltaTime, maskActive )`, so the
     * first argument is the renderer and the second is a *buffer*. Naming the
     * parameters `scene, camera` reads as a private entry point and is a lie that
     * costs the whole frame - the buffer is handed to `renderer.render()` as a
     * camera and every draw is refused. Nothing is passed in: `renderer` is the
     * module's and so is `camera`, exactly as the beauty path calls it.
     */
    render() {
      hideFromGBuffer(this.scene, vis);
      const prevAuto = renderer.autoClear;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      this.scene.overrideMaterial = material;
      renderer.setRenderTarget(target);
      // **One clear for two attachments, and it is GTAO's own sky colour.** That
      // pass cleared its buffer to `0x7777ff`, a mid blue `unpackRGBToNormal`
      // reads as a normal pointing at the camera, and that is the answer its shader
      // sees on a pixel with no geometry - so it is kept byte for byte. The colour
      // attachment takes the same clear and nobody reads it: both passes gate on
      // depth, and a pixel the depth test did not write is a pixel the bounce
      // returns from before it samples anything.
      renderer.setClearColor(0x7777ff, 1.0);
      // **`autoClear` on rather than a `clear()` of our own**, so the depth texture
      // is cleared with the colour in the one call - the bounce and the occlusion
      // both read that depth, and a stale one is an AO over last frame's county.
      renderer.autoClear = true;
      renderer.render(this.scene, camera);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(clear);
      renderer.setClearAlpha(prevAlpha);
      this.scene.overrideMaterial = null;
      restoreGBuffer(this.scene, vis);
    }
    dispose() {
      target.dispose();
      material.dispose();
      vis.clear();
    }
  }
  const pass = new GBufferPass();
  pass.albedo = target.texture[0];
  pass.normal = target.texture[1];
  pass.depth = target.depthTexture;
  return pass;
}

/** Handed back with the rest of the chain's hardware, in `dropComposer()`. */
function dropGBuffer() {
  if (!gBuffer) return;
  gBuffer.dispose();
  gBuffer = null;
}

/* ------------------------------------------------------------------ *
 * The bounce: a diffuse-irradiance estimate off **the same G-buffer the
 * occlusion reads**, off the colour attachment rather than a buffer of
 * its own.
 *
 * **It used to cost a second scene render, and it no longer does.** r160's
 * `GTAOPass` already rendered the county into a half-float view-normal buffer
 * every frame; this pass rendered it *again* through a second override material to
 * get a colour to sample, which was the same traversal of the same six thousand
 * tufts and the same instanced props twice a frame. Both are now one
 * `WebGLMultipleRenderTargets` drawn once - colour in attachment 0, normal in
 * attachment 1 - and `GTAOPass` is told to read it rather than to build one
 * (`setGBuffer()`, in `syncPasses()`). See `makeGBuffer()`.
 *
 * What r160's pass does *not* give us is a place to hang a second effect off: the
 * GTAO compute reads no albedo, its hemisphere sampling and reconstruction live
 * inside a `UniformsUtils` copy of a module-level shader, and `updateGtaoMaterial`
 * is the only JS-side dial. So the estimate is **additive rather than a
 * parameter**, one pass of its own in the chain, rather than a field on a pass
 * that does not have one.
 *
 * **What it estimates, and what it deliberately does not.** A cosine-weighted
 * march out of the surface's own hemisphere, a few steps, and the mean radiance of
 * the pieces of county it found: the colour of the wall a snail is racing beside
 * coming back off that wall onto the road, a pool's bank onto the water's edge, a
 * tuft's own green onto the ground under it. Rays that reach open sky are counted
 * in the denominator and contribute nothing, so the term falls away in the open
 * and is at its strongest in a crease - which is where indirect light actually is,
 * and which is also why it reads as light and not as a second fog.
 *
 * **It is not a bounce of the sun.** There is no light in this pass, only colour:
 * a piece of geometry in full shadow is as dark in the albedo buffer as the shadow
 * makes it, and the sun's own share is `mat.key`'s business and the occlusion
 * pass's. So a green wall lights a road green rather than lighting it.
 *
 * **What the albedo buffer is and is not.** `MeshBasicMaterial` with the vertex
 * colours and nothing else, so a prop wearing a map contributes its flat base
 * colour and a tuft with no vertex colours at all contributes white. That is a
 * real limit of a one-override-material G-buffer and it is the cheap end of it -
 * the alternative is a second material per surface in the county, which is the
 * whole cost this arrangement exists to avoid.
 * ------------------------------------------------------------------ */
const GI_FRAG = /* glsl */`
  precision highp float;

  #include <packing>

  uniform sampler2D tDiffuse;
  uniform sampler2D tAlbedo;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform mat4 cameraProjectionMatrix;
  uniform mat4 cameraProjectionMatrixInverse;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float uGi;
  uniform float uInner;
  uniform float uRadius;
  uniform float uThick;

  varying vec2 vUv;

  /**
   * **Eight directions by ten steps, and the step count is the whole of the
   * ghosting.** Six by four was cheap and wrong in a way that read as a bug: a
   * ladder of four samples spread over 1.7 m strides over anything thinner than
   * half a metre, so a lantern post, a crate or a fence rail was straddled rather
   * than resolved - some rays sampled inside it and came back at its full albedo,
   * the rest missed it entirely, and the difference between those two answers was
   * a hard edge. Every thin object in the county therefore painted a blocky,
   * stair-stepped copy of its own shape into the buffer, which is what the pale
   * slabs hanging beside the arch posts were: not a bounce, but a depth-buffer
   * resolution failure wearing the costume of one.
   *
   * **It is a sampling fault and no gain reaches it.** Turning the bounce down
   * made the copies fainter and left them exactly where they were, which is the
   * tell that distinguishes it from a term that is simply too large; and gating the
   * bounce off the lit luminance hid the bright half of it, which is a lie about
   * what indirect light is for. Ten steps put four samples inside a post of the
   * thickness this county actually builds, so its coverage comes out fractional
   * and the answer moves the way the geometry moves - which is what the smoothstep
   * below was always for, and what four steps never gave it the samples to do.
   */
  const int GI_DIRS = 8;
  const int GI_STEPS = 10;

  /**
   * What the four steps would add if every one of them were covered, and **the
   * divisor the estimate was missing**: the sum runs over directions *and* steps
   * while the denominator was every direction's weight alone, so a hit was counted
   * once per step with nothing taking them back out. One white arch filling one of
   * six directions came back at 1.3 of white, the gain multiplied that into an
   * already lit pixel, and the road under the arch came up veiled and slabbed.
   *
   * **It is the step ladder's own sum and not a fitted constant**, so moving
   * the inner radius, the outer one or the step count cannot put the two out of
   * step - which is the whole bargain the rest of this shader strikes, that a
   * number may be changed in one place and the answer stays bounded.
   */
  float stepWeights() {
    float s = 0.0;
    for ( int i = 0; i < GI_STEPS; i ++ ) {
      float t = mix( uInner, uRadius, ( float( i ) + 0.5 ) / float( GI_STEPS ) );
      s += 1.0 - t / uRadius;
    }
    return s;
  }

  /**
   * An orthonormal frame round a normal with no branch in it.
   *
   * **The usual frame is the abs(n.z) < 0.9 ? up : other one and it has a seam
   * down the middle of the county**, because at that threshold the whole tangent
   * basis swings round and every sample direction in it goes with it: a line
   * across a hillside where a third of the hemisphere was sampled one way round
   * and the rest the other. This one is a select and a divide, both continuous
   * everywhere except straight at the camera, where the frame is the canonical
   * one and nothing is lost by it.
   */
  mat3 frameFor( vec3 n ) {
    float sg = n.z >= 0.0 ? 1.0 : -1.0;
    float a = -1.0 / ( sg + n.z );
    float b = n.x * n.y * a;
    return mat3( vec3( 1.0 + sg * n.x * n.x * a, sg * b, -sg * n.x ),
                 vec3( sg * b, sg + n.y * n.y * a, -n.y ),
                 n );
  }

  void main() {
    vec4 base = texture2D( tDiffuse, vUv );
    
    // **Sky is depth one, and it is the only place this pass does nothing.** The
    // dome is out of the G-buffer by hideFromGBuffer() - it does not write depth -
    // so a clear pixel here is the sky, and the county already lights that with
    // mat.hemi and a dome that is painted out of gamut and tone-mapped once.
    // Adding a second sky term here would double it.
    float depth = texture2D( tDepth, vUv ).x;
    if ( uGi <= 0.0 || depth >= 1.0 ) { gl_FragColor = base; return; }

    vec4 view = cameraProjectionMatrixInverse * vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
    vec3 p = view.xyz / view.w;
    // unpackRGBToNormal is the county's own reading of what GTAOPass wrote, and it
    // is *its* reading, not a second one: the target is half-float and the normal
    // is in view space, unswizzled out of the same rgb.
    vec3 n = normalize( unpackRGBToNormal( texture2D( tNormal, vUv ).rgb ) );
    mat3 fr = frameFor( n );

    vec3 sum = vec3( 0.0 );
    float total = 0.0;
    for ( int r = 0; r < GI_DIRS; r ++ ) {
      float fi = float( r );
      // A spiral over the hemisphere, and **a fixed one**: there is no hash in this
      // shader. The first version hashed the frame per pixel to decorrelate the
      // kernel, and on a rock that is the worst possible thing to do - the answer
      // is a step function of the direction, so a hash on the direction turns a
      // shading term into salt and pepper exactly where the curvature is. The
      // concentric rings came off the same line: a ray's discrete step ladder
      // draws shells on a curved surface, and shuffling the shells per pixel
      // spreads them into speckle instead of leaving them as the rings they were.
      float phi = fi * 2.39996323;
      float rad = sqrt( ( fi + 0.5 ) / float( GI_DIRS ) );
      vec3 dir = normalize( fr * vec3( cos( phi ) * rad, sin( phi ) * rad,
                                       sqrt( max( 0.0, 1.0 - rad * rad ) ) ) );
      float w = max( dot( n, dir ), 0.0 );
      // **The denominator is every direction's weight and not the ones that hit**,
      // which is the difference between a mean and a maximum. A pixel whose
      // hemisphere is half open sky gets half an answer, so the term is bounded by
      // the radiance of the county around it and a white cliff beside a green
      // field cannot lift a pixel past the green.
      total += w;
      for ( int i = 0; i < GI_STEPS; i ++ ) {
        float t = mix( uInner, uRadius, ( float( i ) + 0.5 ) / float( GI_STEPS ) );
        vec3 q = p + dir * t;
        vec4 clip = cameraProjectionMatrix * vec4( q, 1.0 );
        vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
        if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 ) break;
        float sd = texture2D( tDepth, suv ).x;
        // **No break on the first thing found, and a cover that is smooth in the
        // depth of the sample rather than a hit or a miss.** Those two are the same
        // decision written twice: a hard hit test makes the answer a step function
        // of where a surface happens to be, and a step function is a contour line on
        // a curved surface. Every step along the ray is accumulated and the
        // weighting is a smoothstep, so the estimate moves the way the geometry
        // moves.
        if ( sd >= 1.0 ) break;                          // open sky from here on
        // View space looks down -Z, so a surface *nearer* the camera than the ray
        // point is a surface the ray point is behind: the difference is the depth
        // of the ray point inside it, and it is what uThick is measured against.
        float pen = perspectiveDepthToViewZ( sd, cameraNear, cameraFar ) - q.z;
        float cover = smoothstep( 0.0, uThick, pen );
        if ( cover <= 0.0 ) continue;
        sum += texture2D( tAlbedo, suv ).rgb * ( w * cover * ( 1.0 - t / uRadius ) );
        if ( cover > 0.995 ) break;                      // the rest of the ray is inside
      }
    }
    // **Both denominators, and the second one is the one that was missing.**
    vec3 irr = sum / max( total, 1e-4 ) / max( stepWeights(), 1e-4 );
    // **The receiving surface's own colour is the last multiply and not the
    // first**, because it is Lambert: what comes back off a wall is the same
    // radiance whichever way it lands, and a white road beside a hedge is the
    // thing that goes green, not the hedge.
    vec3 bounce = texture2D( tAlbedo, vUv ).rgb * irr * uGi;
    gl_FragColor = vec4( base.rgb + bounce, base.a );
  }
`;

const GI_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/**
 * Built on demand and thrown away with the row, and it is a `Pass` in everything
 * `EffectComposer` asks of one so that it can be dropped into the array beside
 * `GTAOPass` and rebuilt from the wanted list like any other.
 */
function newGtaoGiPass(gtao, cam) {
  const { Pass, FullScreenQuad } = GFX_ADDONS;
  // **No target and no override material of its own any more**, and both are the
  // cost this arrangement exists to remove. It used to own an `RGBA8` colour
  // buffer and draw the whole scene into it a second time through a
  // `MeshBasicMaterial` reading the vertex colours; that colour is attachment 0 of
  // the shared G-buffer now, written by the same draw that wrote the normals, so the
  // two buffers cannot be out of step about which pieces are in the county - and a
  // second scene traversal of six thousand tufts and every instanced prop is gone.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, tAlbedo: { value: null },
      tNormal: { value: null }, tDepth: { value: null },
      cameraProjectionMatrix: { value: new THREE.Matrix4() },
      cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
      cameraNear: { value: 0.1 }, cameraFar: { value: 1000 },
      uGi: { value: 0 }, uInner: { value: GI_INNER },
      uRadius: { value: GI_RADIUS }, uThick: { value: GI_THICK },
    },
    vertexShader: GI_VERT,
    fragmentShader: GI_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });

  class GtaoGiPass extends Pass {
    constructor() {
      super();
      this.needsSwap = true;
      this.camera = cam;
      this.gtao = gtao;
      this.gbuffer = gBuffer;
      this.material = material;
      this.fsQuad = new FullScreenQuad(material);
      this.strength = 0;
    }
    /**
     * The composer's own resize is a no-op here **by design and not by
     * omission**: the county draws this pass's inputs at the *G-buffer's* size and
     * not at the chain's, so the one number that decides it is `a.half` and
     * `sizeGtao()` is what reads it now - it sizes the shared buffer this pass
     * samples. A `setSize()` that resized anything here would be a second answer to
     * the same question, and the two would be right on different frames.
     */
    setSize() {}
    render(renderer, writeBuffer, readBuffer) {
      if (this.strength <= 0 || !this.gtao || !this.gbuffer) {
        // **A pass with nothing to add still has to pass the frame along**, and
        // the cheap way to do that is not to be in the chain at all - which is why
        // `syncPasses()` drops this one on the same breath it finds `gi` at zero.
        // The branch is here for the frame in between, where the row has moved and
        // the old pass is still standing.
        this.fsQuad.material = this.material;
        this.material.uniforms.tDiffuse.value = readBuffer.texture;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        if (this.clear) renderer.clear();
        this.fsQuad.render(renderer);
        return;
      }
      // **Three textures off one buffer, and no render of its own.** The colour is
      // attachment 0, the normal attachment 1, and the depth is the texture attached
      // to that same target - all three written by the one scene draw the occlusion
      // pass reads too. The clear colour, the half-float format and the
      // `packNormalToRGB` encoding are all inherited rather than re-chosen, which is
      // what makes this a read of the occlusion's own buffer rather than a second
      // buffer that happens to agree with it.
      const u = this.material.uniforms;
      u.tDiffuse.value = readBuffer.texture;
      u.tAlbedo.value = this.gbuffer.albedo;
      u.tNormal.value = this.gbuffer.normal;
      u.tDepth.value = this.gbuffer.depth;
      u.uGi.value = this.strength;
      u.cameraNear.value = this.camera.near;
      u.cameraFar.value = this.camera.far;
      u.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
      u.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
      this.fsQuad.material = this.material;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
    dispose() {
      this.material.dispose();
      this.fsQuad.dispose();
    }
  }
  return new GtaoGiPass();
}

/* ------------------------------------------------------------------ *
 * Vignette and grain: one shared fullscreen quad, and deliberately not a
 * `ShaderPass`. It is drawn after whatever the main render was, with
 * `autoClear` off, so a machine that switches either of them on gets both for
 * the price of one fullscreen draw and never touches a render target - which is
 * the entire point of having them at all, because a tier that does not want a
 * composer should not have one. Neither is on by default, and with both off the
 * draw is skipped outright, so the row costs nothing until it is pressed.
 *
 * The same quad serves the composer paths, where it lands after `OutputPass` and
 * therefore works on sRGB-encoded values - which is where a vignette and a grain
 * belong anyway, since neither of them is light.
 *
 * **One draw and two effects** because of one blend equation:
 *
 *     result = src.rgb + dst.rgb * (1 - src.a)
 *
 * which is premultiplied alpha with the colour addend left alone. So the alpha
 * channel carries the vignette, which multiplies the frame down towards black,
 * and the colour channel carries the grain, which is signed noise added to
 * whatever is left. A vignette and a grain want opposite blend modes and this is
 * the mode that does both.
 * ------------------------------------------------------------------ */
/**
 * The pass that puts the frame on the window, and it is `OutputPass` with the line
 * that reads the texture replaced. **It exists because the frame's scale was the
 * browser's and not ours**: the canvas backing store was the county's resolution and
 * the browser stretched it to the window, so there was no scale in the frame for
 * WebGL to have an opinion about and a scaling row had nothing to reach. Now the
 * canvas is native and the county is drawn at a share of it, and the resample
 * happens here.
 *
 * **It extends `OutputPass` rather than replacing it**, so the tone map and the
 * transfer function are three's own and cannot drift from the ones every material in
 * the county was compiled against. A forked ACES fit is a forked ACES fit, and the
 * only difference between this and the pass it inherits is where one `vec4` comes
 * from - so the whole of the kernel lives above the tail and the tail is byte for
 * byte three's.
 *
 * The taps are **explicit and at texel centres**, rather than left to the sampler.
 * That costs four fetches for bilinear where the hardware would do one, and it buys
 * the only thing the row needs: the answer cannot be changed by something else's
 * filter state. `minFilter` is a property of the *texture*, and this chain's
 * texture is the bloom's input and the occlusion's too - so a filter set here would
 * be a filter the bloom also silently inherits.
 */
const PRESENT_HEAD = /* glsl */`
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform vec2 uSrc;

  // **No declaration of toneMappingExposure here**, because the include below brings
  // one with it and GLSL answers a second one by refusing the program rather than
  // by taking the last.
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  varying vec2 vUv;
`;

/** three's `OutputShader` tail, verbatim: tone map, then transfer. Everything above
 *  a shader's call to this is free to be rewritten and this is the part that must
 *  not be. */
const PRESENT_TAIL = /* glsl */`
  #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
  #elif defined( REINHARD_TONE_MAPPING )
    gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
  #elif defined( CINEON_TONE_MAPPING )
    gl_FragColor.rgb = OptimizedCineonToneMapping( gl_FragColor.rgb );
  #elif defined( ACES_FILMIC_TONE_MAPPING )
    gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
  #elif defined( AGX_TONE_MAPPING )
    gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
  #endif

  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF( gl_FragColor );
  #endif
`;

/** One texel, by its centre, so the sampler's own filter has nothing to say. */
const PRESENT_TAP = /* glsl */`
  vec3 srcAt( vec2 texel ) {
    return texture2D( tDiffuse, ( texel + 0.5 ) / uSrc ).rgb;
  }
`;

/** Keys' bicubic at a = -0.5 - the sharper of the two usual choices and the reason
 *  it is here and not a Lanczos window, which rings on exactly the hard silhouette
 *  edge a racing scene is made of and costs the same sixteen fetches.
 *
 *  **The outer segment is a whole polynomial and not the first half of the inner
 *  one.** Written as `0.5 * (-x³ + 5x² - 8x + 4)` it reaches 0 at both ends of its
 *  span and dips to -0.0625 in the middle; written as `-0.5x³ + 2.5x² - 1` - which is
 *  what you get from copying the inner segment and changing the sign of the leading
 *  term - it is 1.0 where it should be 0.0, the four weights come to about 5 between
 *  them, and the frame comes back **2.5 times too bright**, tone mapped, on every
 *  pixel of it. Nothing overflows and nothing clips, so it reads as a blown-out
 *  picture rather than as an error.
 *
 *  **And the four weights are then divided by their sum**, which is the other half.
 *  At half phase this kernel sums to 1.0625, not 1: it has a negative lobe and that
 *  is what a negative lobe is for, but it means a flat region comes back 6% hot, so
 *  a menu cell that reads "smoother edges" would have been quietly reading "brighter
 *  picture" as well. The general form: **a resampling filter's DC gain is one**, or
 *  choosing one changes the exposure rather than the reconstruction. */
const PRESENT_BICUBIC = /* glsl */`
  float cr( float x ) {
    x = abs( x );
    if ( x < 1.0 ) return 1.5 * x * x * x - 2.5 * x * x + 1.0;
    if ( x < 2.0 ) return 0.5 * ( -x * x * x + 5.0 * x * x - 8.0 * x + 4.0 );
    return 0.0;
  }
`;

/** `void main()` opens here and closes after the tail, so **the tail is inside the
 *  function** - which is where three puts it, and the difference is the whole of one
 *  bug this cost: an appended fragment that closes `main()` before the tone map puts
 *  `gl_FragColor = ...` at global scope, where it is not an assignment and the
 *  compiler answers `gl_FragColor : syntax error` rather than anything about the
 *  lines above it. The bracket is here rather than at the end of each body so the
 *  three kernels differ in their middle and nothing else. */
const PRESENT_OPEN = /* glsl */`
  void main() {
`;
const PRESENT_CLOSE = /* glsl */`
  }
`;

const PRESENT_FRAG = [
  // 0 nearest - one fetch, and the four square blocks per texel that makes it the
  // bottom of the row rather than a free win
  PRESENT_HEAD + PRESENT_TAP + PRESENT_OPEN + /* glsl */`
      gl_FragColor = vec4( srcAt( floor( vUv * uSrc ) ), 1.0 );
    ` + PRESENT_TAIL + PRESENT_CLOSE,
  // 1 bilinear - four fetches, written out so it is the same kind of answer as the
  // other two rather than a different mechanism with a hardware filter behind it
  PRESENT_HEAD + PRESENT_TAP + PRESENT_OPEN + /* glsl */`
      vec2 t = vUv * uSrc - 0.5;
      vec2 b = floor( t );
      vec2 f = t - b;
      vec3 a = mix( srcAt( b ), srcAt( b + vec2( 1.0, 0.0 ) ), f.x );
      vec3 c = mix( srcAt( b + vec2( 0.0, 1.0 ) ), srcAt( b + vec2( 1.0 ) ), f.x );
      gl_FragColor = vec4( mix( a, c, f.y ), 1.0 );
    ` + PRESENT_TAIL + PRESENT_CLOSE,
  // 2 bicubic - sixteen fetches, in two separable halves so it is four weighted
  // sums of four rather than sixteen multiplied out
  PRESENT_HEAD + PRESENT_TAP + PRESENT_BICUBIC + PRESENT_OPEN + /* glsl */`
      vec2 t = vUv * uSrc - 0.5;
      vec2 b = floor( t );
      vec2 f = t - b;
      float wx[4];
      float wy[4];
      float sx = 0.0;
      float sy = 0.0;
      for ( int i = 0; i < 4; i ++ ) {
        wx[i] = cr( f.x - 1.0 + float( i ) );
        wy[i] = cr( f.y - 1.0 + float( i ) );
        sx += wx[i];
        sy += wy[i];
      }
      // **The two one-dimensional sums, multiplied - and not the sum of the
      // products**, which is the diagonal and goes to zero at some phases. That one
      // divides by a number near nothing: mean 139.6 against 93.5, and 1.5 million
      // hard steps against six hundred.
      float inv = ( abs( sx * sy ) > 1e-5 ) ? 1.0 / ( sx * sy ) : 1.0;
      vec3 sum = vec3( 0.0 );
      for ( int j = 0; j < 4; j ++ ) {
        vec3 row = srcAt( b + vec2( -1.0, float( j ) - 1.0 ) ) * wx[0]
                 + srcAt( b + vec2(  0.0, float( j ) - 1.0 ) ) * wx[1]
                 + srcAt( b + vec2(  1.0, float( j ) - 1.0 ) ) * wx[2]
                 + srcAt( b + vec2(  2.0, float( j ) - 1.0 ) ) * wx[3];
        sum += row * wy[j];
      }
      gl_FragColor = vec4( sum * inv, 1.0 );
    ` + PRESENT_TAIL + PRESENT_CLOSE,
];

let PresentPass = null;
/** Built on first use, because `OutputPass` only exists once the addons have
 *  downloaded and a machine that never asks for a pass never fetches them. */
function presentPassClass() {
  if (PresentPass) return PresentPass;
  const { OutputPass } = GFX_ADDONS;
  PresentPass = class extends OutputPass {
    constructor(kernel) {
      super();
      this.uniforms.uSrc = { value: new THREE.Vector2(1, 1) };
      this.setKernel(kernel);
    }
    /** The source size is what turns `vUv` into a texel address, so it is restated
     *  whenever the chain is resized rather than once at construction. */
    setSource(w, h) { this.uniforms.uSrc.value.set(w, h); }
    setKernel(k) {
      if (this._kernel === k) return;
      this._kernel = k;
      this.material.fragmentShader = PRESENT_FRAG[k];
      this.material.needsUpdate = true;
    }
  };
  return PresentPass;
}

const overlayScene = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const overlayUniforms = {
  uVig: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 },
};
const overlayQuad = (() => {
  const m = new THREE.ShaderMaterial({
    uniforms: overlayUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float uVig, uGrain, uTime;
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        // dark in the corners, nothing at all across the middle half - a vignette
        // that reaches the centre of the frame is a dimmed picture, not a vignette
        float v = clamp(uVig * (dot(d, d) * 2.6 - 0.18), 0.0, 1.0);
        // one hash, no texture: a grain map would need a fetch per fragment to
        // get a number this cheap, and it would be the same fetch every frame
        float h = fract(sin(dot(vUv * 1024.0 + uTime * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
        gl_FragColor = vec4(vec3((h - 0.5) * uGrain), v);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  overlayScene.add(mesh);
  return mesh;
})();

function drawOverlay() {
  if (overlayUniforms.uVig.value <= 0 && overlayUniforms.uGrain.value <= 0) return;
  overlayUniforms.uTime.value = clock;
  renderer.autoClear = false;
  renderer.render(overlayScene, overlayCam);
  renderer.autoClear = true;
}

/* ------------------------------------------------------------------ *
 * A readback, for the one question a screenshot cannot answer: whether the
 * bottom tier draws *the same picture* the composer tier draws. Two numbers
 * beat two photographs here, because a photograph of a frame is a photograph
 * of the water's scroll and the mills' angle as well, and the difference that
 * matters is the one left over after those.
 *
 * `readPixels` off the default framebuffer is the only read of a frame that
 * does not need `preserveDrawingBuffer` turned on for the whole county, and it
 * only answers if it happens inside the frame that drew - hence the one
 * pending-slot the frame loop drains rather than a function anyone can call
 * whenever they like. Rows come out bottom-up, as GL counts them; the boxes
 * are averaged, so the answer is a picture's worth of colour in a few hundred
 * numbers.
 * ------------------------------------------------------------------ */
let grabWanted = null;
function grabPixels(cols = 96, rows = 60) {
  return new Promise((res) => { grabWanted = { cols, rows, res }; });
}
function doGrab(g) {
  const gl = renderer.getContext();
  const dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
  const buf = new Uint8Array(dw * dh * 4);
  gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const out = new Array(g.cols * g.rows * 3);
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const x0 = Math.floor(x * dw / g.cols), x1 = Math.max(x0 + 1, Math.floor((x + 1) * dw / g.cols));
      const y0 = Math.floor(y * dh / g.rows), y1 = Math.max(y0 + 1, Math.floor((y + 1) * dh / g.rows));
      let r = 0, gg = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          const i = (yy * dw + xx) * 4;
          r += buf[i]; gg += buf[i + 1]; b += buf[i + 2]; n++;
        }
      }
      const o = (y * g.cols + x) * 3;
      out[o] = r / n; out[o + 1] = gg / n; out[o + 2] = b / n;
    }
  }
  g.res(out);
}

/* ------------------------------------------------------------------ *
 * Lamp glow: one additive sprite on each of the sixteen lamp lights and one on
 * the sun. No render target and no new colour-management path, because additive
 * blending is already correct in linear light under the pipeline the county has -
 * which is why this is a switch of its own and the one the lowest preset leaves
 * on.
 *
 * **Every glow tests depth, including the sixteen lamp ones**, and the lamp
 * sprites are pushed a third of a metre toward the eye to pay for it. Both halves
 * of that are load-bearing.
 *
 * A lamp glow that does not test depth is a light that shines through the county:
 * a lantern on the far side of the half-way tower painted its halo over the
 * tower's trunk, and one behind a rock wall on Crag Ascent painted its halo over
 * the face. Both are the same mistake and both are the picture telling you the
 * sprite is in the wrong place - the halo is a hole in the scenery, and a hole
 * reads as a bug however plausible the light in it.
 *
 * Testing depth alone is not enough either, and this is the half that is easy to
 * get wrong: a sprite sits at **one depth**, the depth of its own centre, because
 * it is a camera-facing quad. Its centre is the lamp's glass, so the quad and the
 * glass are at the same depth and the lamp hides behind its own light - the halo
 * goes in and out as you walk past it. Hence `GLOW_CLEAR`: the glow is pushed
 * along the view axis, toward the eye, by more than the glass is deep and by far
 * less than anything a lamp might be standing behind. Because a camera-facing
 * quad moved along the view axis does not move **on screen**, only in depth, the
 * push is free - there is no halo visibly detaching from its lamp.
 *
 * The sun's needs none of that: it is already placed 320 m out along the key
 * light's own direction, so nothing in the county is between it and the eye that
 * it is not meant to be behind.
 * ------------------------------------------------------------------ */
function glowTexture() {
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** How far a lamp's glow is pushed toward the eye so its own glass cannot hide
 *  it. Deeper than a lantern is wide, and a hand's breadth from a rock face. */
const GLOW_CLEAR = 0.34;
let glowTex = null;
function makeGlow(size, depthTest) {
  if (!glowTex) glowTex = glowTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: LAMP_COLOUR, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest, transparent: true, fog: false, opacity: 1,
  }));
  s.scale.setScalar(size);
  s.visible = false;
  s.renderOrder = 5;
  return s;
}
/** A glow on each lamp light, and one on the sun. Made once per env and never
 *  torn down, because they are two sprites each and the setting that governs
 *  them only moves `visible` and `scale`. */
function addGlows(e) {
  e.lampGlow = e.lamps.map(() => makeGlow(2.6, true));
  for (let i = 0; i < e.lamps.length; i++) e.lamps[i].add(e.lampGlow[i]);
  e.sunGlow = makeGlow(90, true);
  e.scene.add(e.sunGlow);
}

/**
 * **Scaled and faded from the hour**, every frame, in the same block that moves
 * the lamps - because a glow that is scaled once and left is a glow that is
 * wrong from the moment the light changes. The lamps want the sun out and the
 * sun's own glow wants its brightness; the sun's wants the haze, because a sun
 * seen through more air is a bigger, duller disc.
 *
 * The lamp glows are also **pushed toward the eye** here, in the same block and
 * for the same reason: the push is a function of where the camera is, so it is
 * a per-frame thing like the scale, and leaving it to `makeGlow()` would mean a
 * glow that is correct from one side of a lamp and buried in its own glass from
 * the other.
 *
 * **And each takes its light's colour**, which is the whole of what a coloured
 * lamp is: `opts.lamps` hands back whatever colour a piece is painted in and
 * the paper is emissive in that colour, so a green lantern gives out green light
 * and a red one red - and the halo was `LAMP_COLOUR` for all sixteen of them,
 * which is a warm cream painted over a green lamp and read as a second, wrong
 * light sitting inside the first. The glow is the light, so it is read off the
 * light rather than set beside it, and it is read **every frame** because the
 * sixteen lights are re-chosen every frame as the nearest ones and a glow that
 * kept the colour of the lamp it was on a moment ago is a glow on the wrong lamp.
 */
function syncGlow(e) {
  const on = gfx.fxGlow > 0;
  for (let i = 0; i < e.lampGlow.length; i++) {
    const s = e.lampGlow[i];
    s.visible = on && TOD.lamps > 0.02;
    if (!s.visible) continue;
    s.scale.setScalar(1.5 + 2.6 * TOD.lamps);
    s.material.color.copy(e.lamps[i].color);
    // toward the eye, on the sprite's own parent - the lamps carry no rotation,
    // so a local offset is a world one and there is nothing to transform
    s.getWorldPosition(_v1);
    _v1.subVectors(camera.position, _v1);
    const d = _v1.length();
    if (d > 1e-4) s.position.copy(_v1.multiplyScalar(GLOW_CLEAR / d));
    else s.position.set(0, 0, 0);
  }
  if (e.sunGlow) {
    e.sunGlow.visible = on;
    if (on) {
      e.sunGlow.scale.setScalar(70 + 90 * TOD.haze);
      e.sunGlow.material.opacity = 0.35 + 0.4 * clamp(TOD.sunI / 1.55, 0, 1);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Cloud shadows and wind
 *
 * Both are **uniform-driven injections**, not shader variants: a value is
 * written onto a shared uniform object and every surface wearing it follows.
 * The alternative - recompiling a program per tier - is what makes a settings
 * menu feel like a stutter, and neither effect is worth a recompile when a
 * multiply of zero is an honest off.
 *
 * `gfxSurface()` chains behind whatever `onBeforeCompile` is already on the
 * material. Four of the county's materials are given theirs by
 * `triplanarDetail()`/`triplanarSets()`, and replacing one rather than adding to
 * it would silently take the surface's own detail map off it.
 * ------------------------------------------------------------------ */
const gfxU = {
  uCloudAmt: { value: 0 }, uCloudTime: { value: 0 },
  uWindAmp: { value: 0 }, uWindTime: { value: 0 },
};
const GLSL_NOISE = `
  float gfxHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float gfxNoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( gfxHash( i ), gfxHash( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( gfxHash( i + vec2( 0.0, 1.0 ) ), gfxHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }`;

/** The wind's three lines, and they are held here **once**, because there are
 * now two programs that have to agree on them exactly: the surface's own, and
 * the occlusion buffer's - see `gtaoWind()`. A second copy would be a second
 * set of numbers, and the two are not allowed to differ: one number in the
 * colour and another in the AO is a tree wearing a shadow of itself. */
const GLSL_WIND = `
        // A gust and a slower sway, both keyed off world position so the
        // field travels across the county instead of pulsing in place
        float bend = max( transformed.y, 0.0 );
        transformed.x += ( sin( uWindTime * 1.7 + vGfxW.x * 0.55 + vGfxW.z * 0.31 )
                         + 0.45 * sin( uWindTime * 4.3 - vGfxW.z * 0.9 ) ) * uWindAmp * bend;
        transformed.z += ( cos( uWindTime * 1.3 + vGfxW.z * 0.47 - vGfxW.x * 0.22 ) ) * uWindAmp * 0.55 * bend;`;

/** The materials the wind is actually on, so a piece can be asked whether it
 * sways rather than the shader deciding it - see `windMark()`. */
const WIND_MATS = new Set();

function afterCompile(m, fn) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (sh, renderer2) {
    if (prev) prev.call(this, sh, renderer2);
    fn(sh, renderer2);
  };
  return m;
}

/**
 * Wind, and the cloud shadows, on one surface, and **only the wind is optional**.
 *
 * **Wind is gated by the vertex's own height**, `max(transformed.y, 0)`, so a
 * tuft bends and its root does not. Gating it on the instance matrix instead -
 * moving the whole tuft - is the same trick as animating a shadow without the
 * caster, and it reads as the lawn sliding rather than as grass.
 *
 * That gate is the whole of why the wind cannot go on the ground. It is the
 * vertex's height in **world** space, because `transformed` is, and there is no
 * per-object origin to subtract on a surface a hundred metres across:
 * `mat.course`, `mat.road` and `mat.ledge` are one mesh each, and the top of
 * Crag Ascent's lane stands **35.9 m** over the meadow at its foot. Every vertex
 * up there carries a bend of 35.9, and at an amplitude of `0.055` that is
 * **1.98 m of displacement on the terrain itself** - the county waving, the
 * clay ribbon shearing out of its own flank, and the flank left standing where
 * the ground used to be. It looked like a wave crossing the whole stage because
 * that is what it was: one sine keyed off world position, applied to a hillside
 * by its altitude, and the further up the hill you went the more it moved.
 *
 * So the ground, the road and the flank take the **cloud** and not the wind, and
 * the tufts and the foliage take both. Nothing here loses the cloud shade, and
 * the thing that bends is now only the thing that is standing up.
 *
 * The hook is `project_vertex` and not `begin_vertex` because `begin_vertex` is
 * the line the county's own triplanar injection has already replaced; going in
 * after it means this works whether or not the material had one, and it is still
 * before the model-view matrix is built.
 */
function gfxSurface(m, wind) {
  // **Registered here and not in the injection below.** `onBeforeCompile` runs at
  // the material's first render, and a piece planted before that - which is every
  // piece in the first county built - would ask an empty set and go unmarked,
  // which is a wind that comes and goes with the density row.
  if (wind) WIND_MATS.add(m);
  return afterCompile(m, (sh) => {
    sh.uniforms.uCloudAmt = gfxU.uCloudAmt;
    sh.uniforms.uCloudTime = gfxU.uCloudTime;
    sh.uniforms.uWindAmp = gfxU.uWindAmp;
    sh.uniforms.uWindTime = gfxU.uWindTime;
    // the wind's own three lines are rewritten only for a surface that has it,
    // so a ground material's program is not carrying a dead branch that reads a
    // uniform and multiplies by zero on every vertex of a hundred-metre mesh
    const bend = wind ? GLSL_WIND : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGfxW;
        uniform float uCloudAmt, uCloudTime, uWindAmp, uWindTime;`)
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vGfxW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vGfxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif${bend}
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGfxW;
        uniform float uCloudAmt, uCloudTime;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if ( uCloudAmt > 0.0 ) {
          vec2 cp = vGfxW.xz * 0.014 + vec2( uCloudTime * 0.008, uCloudTime * 0.004 );
          float c = gfxNoise( cp ) * 0.62 + gfxNoise( cp * 2.7 ) * 0.28 + gfxNoise( cp * 6.1 ) * 0.10;
          // a threshold rather than a smooth ramp, because a cloud edge is an
          // edge: a soft multiply over the whole ground is a dirty lens
          diffuseColor.rgb *= mix( 1.0, 0.52, uCloudAmt * smoothstep( 0.46, 0.72, c ) );
        }`);
  });
}

/**
 * The surfaces the cloud shades and the wind are injected into, and the one
 * place they are injected. The county's ground is `mat.course` (turf, cliff and
 * shore), its road and ramp are `mat.road` and `mat.ledge`, the tufts are
 * `mat.grass` and everything that grows is `mat.foliage`. That is five
 * materials, all of them long-lived, all of them already carrying an
 * `onBeforeCompile` of their own from `triplanarDetail()`/`triplanarSets()` in
 * three cases out of five - so this is `afterCompile()`, chained, never
 * replacing.
 *
 * **The wind goes on the last two and not on the first three**, and see
 * `gfxSurface()` for the measurement of what it does when it goes on all five.
 *
 * Called once at material setup and never again: the uniforms are shared, so
 * nothing about the program changes when a tier moves.
 */
let gfxSurfacesDone = false;
function gfxSurfaceTargets() {
  if (gfxSurfacesDone) return;
  gfxSurfacesDone = true;
  // the three surfaces of the ground, and the two that grow
  for (const m of [mat.course, mat.road, mat.ledge]) gfxSurface(m, false);
  for (const m of [mat.grass, mat.foliage]) gfxSurface(m, true);
}

/**
 * The wind, and only the wind, on **the material the occlusion buffer is built
 * out of**, which is a material the county never wrote: `GTAOPass` renders its
 * normal-and-depth pass by setting `scene.overrideMaterial` to three's own
 * `MeshNormalMaterial` and drawing the whole scene through it. So a tree sways in
 * the colour pass and stands perfectly still in the AO - a ghost of its own
 * canopy hanging under it, which reads as a shadow and is the one thing in the
 * frame that is not in the frame. At an amplitude of `0.055` and a canopy four
 * metres up that ghost is **22 cm** of the county's own shape doing nothing.
 *
 * The bend is the same `GLSL_WIND` the surfaces wear, off the same two shared
 * uniforms, so the two programs cannot disagree about where the field is.
 *
 * **What cannot be shared is which pieces bend**, because the override material
 * is on the entire scene: a stone is instanced too, and a stone that sways in
 * the occlusion buffer and not in the colour is the same ghost a hand smaller.
 * So `uWindObj` is a per-object uniform, and `onBeforeRender` is the only hook a
 * vertex shader has for one - hence `windMark()`, which marks the pieces from
 * the same answer the beauty pass is given: the material they were planted in is
 * one the wind was injected into.
 */
const gtaoWindU = { value: 0 };
function gtaoWind(m) {
  return afterCompile(m, (sh) => {
    sh.uniforms.uWindAmp = gfxU.uWindAmp;
    sh.uniforms.uWindTime = gfxU.uWindTime;
    sh.uniforms.uWindObj = gtaoWindU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGfxW;
        uniform float uWindObj, uWindAmp, uWindTime;`)
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vGfxW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vGfxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif
        if ( uWindObj > 0.5 ) {${GLSL_WIND} }
        #include <project_vertex>`);
  });
}
/** Set round the piece rather than on the program, so the uniform is read after
 *  `afterCompile` has run - the very first frame of a pass's life draws its G-buffer
 *  before the shader exists, and a hook that wrote a uniform it had not got would
 *  drop the wind for that frame and for no other. */
function gtaoWindOn() { gtaoWindU.value = 1; }
function gtaoWindOff() { gtaoWindU.value = 0; }
/** The mark itself, put on at the two places a piece is planted - `scatter()`
 *  for a course and `planted()` for the stable - beside the shadows row's flag
 *  and for the same reason: a flag applied by walking has to be reapplied every
 *  time the county is rebuilt, and a flag applied at the build is simply there. */
function windMark(im) {
  if (!WIND_MATS.has(im.material)) return im;
  im.onBeforeRender = gtaoWindOn;
  im.onAfterRender = gtaoWindOff;
  return im;
}
/** Once per material, and a material is longer-lived than a probe. The
 *  reflection row makes a probe and takes it away again, and this injection has
 *  to survive that: `onBeforeCompile` chains, so a second call would put a
 *  second `uniform float uWaterFresnel;` in the same shader and the water would
 *  stop compiling - a redefinition, not a warning, and the surface that lost its
 *  program is whichever pool happened to be built last. The uniform is the
 *  material's, not the probe's, and that is what makes the row free to change. */
function waterFresnel(m) {
  if (m.userData.fresnelU) return m.userData.fresnelU;
  m.userData.fresnelU = { value: -1 };
  return afterCompile(m, (sh) => {
    sh.uniforms.uWaterFresnel = m.userData.fresnelU;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if ( uWaterFresnel >= 0.0 ) {
          float facing = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
          roughnessFactor = mix( uWaterFresnel, roughnessFactor, pow( 1.0 - facing, 3.0 ) );
        }`)
      .replace('#include <common>', '#include <common>\nuniform float uWaterFresnel;');
  });
}

/* ------------------------------------------------------------------ *
 * Reflection probes
 *
 * A `CubeCamera` per pool, above the water and looking out at the bank, the
 * wall and the sixteen lamps - which is what the finale is lit by, and a shared
 * sky probe cannot show any of it.
 *
 * **Not screen-space, and that was a decision on evidence rather than taste.**
 * `mat.water` is `transparent` with `depthWrite: false`, so it is not in the
 * depth buffer a ray march would march against and the march would pass through
 * the surface and reflect the pool floor; the pools are row-by-row rippled
 * meshes rather than the flat plane `Reflector` needs; and `scene.environment`
 * is already a PMREM probe on both scenes, which is what level 1 leaves the
 * water on.
 *
 * **Not per frame.** A probe is six scene renders and a course with four pools is
 * twenty-four of them, so they are refreshed when the hour has moved far enough
 * to want it and then **one at a time**, spread out by the pump below. A race
 * crosses several hours, so a handful of refreshes per race, and never a stall.
 * ------------------------------------------------------------------ */
const courseProbes = [];
/** Every water material a course has built, whether or not a probe is on it.
 *  `dropCourse()` frees these; nothing else in the county owns them. */
const courseWaterMats = [];
/** Probes that want a refresh, and how many are left. */
const probeQueue = [];
let probeLast = -1e9;
/** How often at most one probe is refreshed, in milliseconds. */
const PROBE_GAP = 260;

/** One place that answers "what water is on the course and on the stage", so
 *  the probes and the row that governs them cannot be told about half of it. */
function eachWaterSurface(out) {
  for (const m of waterMeshes) out.push(m);
  if (stage && stage.pool && stage.pool.water) out.push(stage.pool.water);
  return out;
}

/**
 * A `CubeCamera` per pool, above the water and looking out at the bank, the
 * wall and the sixteen lamps - which is what the finale is lit by, and a shared
 * sky probe cannot show any of it.
 *
 * **Not screen-space, and that was a decision on evidence rather than taste.**
 * Water is `transparent` with `depthWrite: false`, so it is not in the depth
 * buffer a ray march would march against and the march would pass through the
 * surface and reflect the pool floor; the pools are row-by-row rippled meshes
 * rather than the flat plane `Reflector` needs; and `scene.environment` is
 * already a PMREM probe on both scenes, which is what level 1 leaves the water
 * on.
 *
 * **Not per frame.** A probe is six scene renders and a course with four pools
 * is twenty-four of them, so they are refreshed when the hour has moved far
 * enough to want it and then **one at a time**, spread out by the pump below. A
 * race crosses several hours, so a handful of refreshes per race, and never a
 * stall.
 */
function makeProbe(at, material) {
  const size = gfxReflSize();
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  rt.texture.name = 'snail-pool-probe';
  // The far plane is past the dome on purpose: a probe that clips the sky has
  // black corners in every reflection, and the sky is most of what a pool at a
  // low sun is reflecting.
  const cam = new THREE.CubeCamera(0.35, 900, rt);
  cam.position.copy(at);
  const p = { rt, cam, at: at.clone(), material, pm: null };
  material.userData.probe = p;
  waterFresnel(material);
  applyFresnel(material);
  courseProbes.push(p);
  return p;
}
function dropProbe(p) {
  if (p.pm) { p.pm.dispose(); p.pm = null; }
  p.rt.dispose();
  const m = p.material;
  if (m) { m.envMap = null; delete m.userData.probe; }
  const i = courseProbes.indexOf(p);
  if (i >= 0) courseProbes.splice(i, 1);
}
function dropReflections() {
  for (const p of courseProbes.slice()) dropProbe(p);
  for (const m of courseWaterMats.splice(0)) m.dispose();
}

/**
 * Six faces, then a pre-filter. The pre-filter is not optional: from r155 a
 * `MeshStandardMaterial` reads a **cube-UV** environment only, and a bare
 * `WebGLCubeRenderTarget` texture put straight into `envMap` contributes nothing
 * at all - not a wrong reflection, none. `scene.environment` is a PMREM probe for
 * exactly the same reason.
 */
function refreshProbe(p) {
  p.cam.update(renderer, renderScene());
  const next = envPmrem.fromCubemap(p.rt.texture);
  if (p.pm) p.pm.dispose();
  p.pm = next;
  const m = p.material;
  if (!m) return;
  m.envMap = next.texture;
  // The pre-filter's mip height is baked into the program as the texel size of
  // the environment, so a change of probe resolution is the one refresh that has
  // to recompile. Every other refresh is a rebind.
  if (p.pm.height !== m.userData.probeH) {
    m.userData.probeH = p.pm.height;
    m.needsUpdate = true;
  }
}
function applyFresnel(m) {
  if (!m.userData.fresnelU) return;
  m.userData.fresnelU.value =
    gfxReflOn() && REFL_FRESNEL[gfx.refl - 1] ? 0.045 : -1;
}
function queueProbes() {
  probeQueue.length = 0;
  for (const p of courseProbes.slice()) if (p.material) probeQueue.push(p);
  probeLast = -1e9;
}
/** One probe a quarter of a second, from the frame loop, so a burst of hour
 *  changes is paid for gradually rather than in one stall. */
function pumpProbes(now) {
  if (!probeQueue.length || now - probeLast < PROBE_GAP) return;
  const p = probeQueue.shift();
  if (!p.material || !gfxReflOn()) return;    // turned off underneath the queue
  refreshProbe(p);
  probeLast = now;
}
/** Turn the row on and off for every water surface there is: level 1 puts the
 *  water back on the shared environment and spends nothing at all. */
function syncProbes() {
  const size = gfxReflSize();
  const on = size > 0;
  for (const m of eachWaterSurface([])) {
    if (!on) {
      if (m.material.userData.probe) dropProbe(m.material.userData.probe);
      m.material.envMap = null;
      applyFresnel(m.material);
      continue;
    }
    let p = m.material.userData.probe;
    if (!p) {
      p = makeProbe(m.userData.probeAt || m.getWorldPosition(new THREE.Vector3()), m.material);
    } else if (p.rt.width !== size) {
      p.rt.setSize(size, size);
      // A tier change in the reflection row is a *change of resolution*, and the
      // old pre-filter is a render target the same as any other. Dropping the
      // reference without disposing it leaks one target per tier per pool, and the
      // material is about to be given a fresh one by `refreshProbe()` anyway.
      if (p.pm) { p.pm.dispose(); p.pm = null; }
    }
    applyFresnel(m.material);
  }
  queueProbes();
}

/* ------------------------------------------------------------------ *
 * The one entry point
 * ------------------------------------------------------------------ */
/** Bumped by every apply, so a stale one finishing late cannot undo a newer. */
let applySeq = 0;
async function applyGraphics() {
  const seq = ++applySeq;
  /* 1 - the renderer-level knobs, all synchronous so the frame after a click is
         already at the new size whatever happens to the passes below */
  applyRenderScale();
  applyScaling();
  applyDrawDistance();
  applyShadows();
  applySky();
  /* 4 - overlay, glow and the material flags, which need nothing fetched */
  applyEffects();
  /* 5 - the stage rebuild, which reads the density rows while it builds */
  if (gfxStageDirty) requestRestage();
  /* 2 and 3 - the post chain. The passes are fetched on demand and the fetch is
     awaited, so a tier that needs one is drawn on the *direct* path for the
     frame or two the module takes to arrive rather than with a half-built chain */
  if (needsComposer()) {
    await loadAddons();
    if (seq !== applySeq) return;      // a newer apply is already in flight
  }
  syncComposer();
  syncPasses(false);
  if (seq !== applySeq) return;
  syncProbes();
}

/** Rows that cannot be seen on the stable without standing it up again. The
 *  prop and grass rows are read *while* `planted()` builds, the casting row is
 *  stamped at build, and the reflections row hangs a probe off the pool's own
 *  material - so those three and only those three put the stage on the rebuild
 *  list. Everything else is a uniform or a renderer knob and applies at once. */
const STAGE_ROWS = ['props', 'grass', 'shadow', 'refl'];
function markStageDirty(key) {
  if (STAGE_ROWS.includes(key)) gfxStageDirty = true;
}

/**
 * **Two ratios, and the guard is both of them.** The canvas is native whatever the
 * render row says - it is the window, and the window is however many device pixels
 * the display has - and the county is drawn at a share of it. So this touches the
 * canvas only when the *display* changed (a resize, or a window dragged to a monitor
 * with a different ratio), and hands the county's own resolution to the chain on
 * every step of the row.
 *
 * The early return on the canvas is the whole reason the chain is not resized when
 * the row moves: `applyGraphics()` puts this first and `syncComposer()` last, so a
 * 0.5x step arrives with a chain still standing from the old scale.
 */
function applyRenderScale() {
  const canvas = canvasRatio();
  if (Math.abs(renderer.getPixelRatio() - canvas) > 1e-4) {
    renderer.setPixelRatio(canvas);
    renderer.setSize(innerWidth, innerHeight);
  }
  applyChainSize(false);
}

/** The scaling row, which is a shader on the last pass and nothing else: no target,
 *  no resize, no rebuild. So it can land after `syncComposer()` and after the stage
 *  request rather than needing a place in the order. */
function applyScaling() {
  if (presentPass) presentPass.setKernel(gfxScale());
}

function applyDrawDistance() {
  const [near, far] = FOG_LADDER[gfx.distance - 1];
  env.scene.fog.near = near;
  env.scene.fog.far = far;
  // The stable's air is the same air at a stage's width. Both bounds are scaled
  // by their own middle-step ratio rather than by one figure, so the middle step
  // is *exactly* the 34/150 `makeEnv` was given - a single scale factor cannot
  // do that, because 34/78 and 150/300 are not the same number.
  stageEnv.scene.fog.near = near * (34 / 78);
  stageEnv.scene.fog.far = far * (150 / 300);
}

/**
 * **The old shadow map is disposed and the reference nulled**, not just left.
 * `shadow.mapSize.set()` only tells the renderer what size to allocate *next*
 * time; the map that is already there is a texture and it is still bound, so a
 * resize that does not dispose it leaves the course rendering into a 2048 map
 * while the material believes it has a 4096 one.
 */
let gfxCastApplied = null;
function applyShadows() {
  const map = SHADOW_MAP[gfx.shadow - 1];
  const radius = SHADOW_RADIUS[gfx.shadow - 1];
  const cast = SHADOW_CAST[gfx.shadow - 1];
  for (const e of [env, stageEnv]) {
    const sh = e.key.shadow;
    if (sh.mapSize.x !== map) {
      sh.mapSize.set(map, map);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    sh.radius = radius;
  }
  if (cast === gfxCastApplied) return;
  gfxCastApplied = cast;
  for (const root of [race.group, stage.group]) {
    if (!root) continue;
    root.traverse((o) => {
      // **Only what was stamped.** A mesh with no flag is not a prop - it is a
      // gate, a plinth, a basin - and the row is about props.
      if (o.userData.gfxCast) o.castShadow = cast;
    });
  }
  for (const r of race.racers) r.model.group.traverse((o) => {
    if (o.userData.gfxCast) o.castShadow = cast;
  });
}

/** A new dome, a disposed old one, and a repaint - in that order, and the
 *  repaint last so the fresh geometry is the one that gets the hour's stops. */
let skySegs = [SKY_LADDER[2][0], SKY_LADDER[2][1]];
function applySky() {
  const [w, h] = SKY_LADDER[gfx.sky - 1];
  if (w === skySegs[0] && h === skySegs[1]) return;
  skySegs = [w, h];
  const old = skyGeo;
  skyGeo = buildSkyGeo(w, h);
  for (const e of [env, stageEnv]) if (e) e.sky.geometry = skyGeo;
  old.dispose();
  if (_todSky) paintSky(_todSky);
}

function applyEffects() {
  overlayUniforms.uVig.value = gfx.fxVig > 0 ? 0.48 : 0;
  overlayUniforms.uGrain.value = gfx.fxGrain > 0 ? 0.055 : 0;
  gfxU.uCloudAmt.value = gfx.fxCloud > 0 ? 1 : 0;
  gfxU.uWindAmp.value = gfx.fxWind > 0 ? 0.055 : 0;
}

/* ------------------------------------------------------------------ *
 * Reading and writing the settings from the modal
 * ------------------------------------------------------------------ */
function gfxCaption(key, n) {
  switch (key) {
    case 'preset': return gfx.preset ? PRESET_NAMES[gfx.preset - 1] : 'mixed';
    case 'render': {
      // **The cell is a share of native and the caption is the device pixels it
      // lands on**, because the two are different numbers on different screens: the
      // ladder is the same six cells on a 1× monitor and on a retina panel, and only
      // this one knows which of the two the player is looking at.
      const p = clamp(nativePixelRatio() * RENDER_SCALE[n - 1], 0.25, RENDER_SCALE_CAP);
      return n === 3 ? `${p.toFixed(2)}× · native` : `${p.toFixed(2)}× device`;
    }
    // **What a step costs and not what it is**: the cells already say off, x2 and
    // x4, and the number that matters on the row is the one nobody can see from
    // the button - a multisampled buffer stores a whole frame per sample.
    case 'msaa': {
      const s = MSAA_LADDER[n - 1];
      return s ? `${s} frames a pixel · ${s}× the buffer` : 'none · one frame a pixel';
    }
    // **The tap count, because it is the only number on this row that costs
    // anything.** Nearest and bilinear are what a machine can afford and bicubic is
    // sixteen fetches a pixel; the caption is where a player finds that out, which
    // is the same job the render row's caption does with device pixels.
    case 'scale': {
      const t = SCALE_TAPS[n - 1];
      // **And it says when the row is doing nothing**, which is the honest half:
      // at render scale 1x the county's resolution *is* the window's, there is no
      // resample in the frame, and all three kernels are the identity.
      return needsResample() ? `${t} fetches a pixel` : `${t} fetches · idle at 1×`;
    }
    case 'distance': return `${FOG_LADDER[n - 1][1]} m fog · ${EDGE_LADDER[n - 1]} m ground`;
    case 'shadow': return `${SHADOW_MAP[n - 1]} map · ${SHADOW_CAST[n - 1] ? 'props cast' : 'props lit only'}`;
    case 'props': return `${Math.round(PROP_DENSITY[n - 1] * 100)}% of a course's props`;
    case 'grass': return `${Math.round(GRASS_DENSITY[n - 1] * 100)}% · ${grassCount()} tufts`;
    case 'sky': return `${SKY_LADDER[n - 1][0]}×${SKY_LADDER[n - 1][1]} dome`;
    case 'ssao': {
      const a = AO_LADDER[n - 1];
      // **The bounce is named on the occlusion row's caption and not given a row
      // of its own**, because it is a half of the same decision - the row is a 2x2
      // of resolution against indirect light, and a caption that said "16 spp" on
      // a step that also ray-marches four bounces is a caption describing a
      // different machine than the one the player is on.
      return a ? `${a.half ? 'half-res' : 'full-res'} · ${a.samples} spp · ${a.radius} m${a.gi ? ' · gi' : ''}` : 'off';
    }
    case 'refl': {
      const s = REFL_LADDER[n - 1];
      return s ? `${s}² cube probe${REFL_FRESNEL[n - 1] ? ' + fresnel' : ''}` : 'off';
    }
    default: return '';
  }
}

const optRowEls = [];
function renderOptions() {
  const wrap = $('optRows');
  wrap.innerHTML = '';
  optRowEls.length = 0;
  for (const row of GFX_ROWS) {
    // a ladder row's cells are its own if it says so and the six numbers if it
    // does not - which is why the anti-aliasing row is three wide and everything
    // else is six, off one `cells` field rather than off a special case
    const cells = row.cells || (row.preset ? PRESET_NAMES : GFX_STEPS);
    const el = optRow(row, row.name, '', cells, 1, (n) => {
      if (row.preset) setPreset(n); else setRow(row.key, n);
    });
    el.classList.add('preset');
    wrap.appendChild(el);
  }
  // The six switches get a heading of their own, because a row of two wide cells
  // under a heading is a different kind of control from a row of six and the grid
  // is the only thing saying so. The heading says what the two kinds are: the
  // nine above are a ladder and these are not.
  const head = document.createElement('div');
  head.className = 'optgroup';
  head.textContent = 'effects · one switch each';
  wrap.appendChild(head);
  for (const row of FX_TOGGLES) {
    wrap.appendChild(optRow(row, row.name, row.cost, row.cells, 0, (n) => setToggle(row.key, n)));
  }
  syncOptions();
}
/** One row of the modal, for both kinds. `base` is the value the row's first cell
 *  stands for - 1 on a ladder, 0 on a switch - and it is what `syncOptions()` tests
 *  the lit cell against, so the two kinds differ in exactly one number. */
function optRow(row, name, cap, cells, base, onPick) {
  const el = document.createElement('div');
  el.className = 'optrow';
  const hd = document.createElement('div');
  hd.className = 'head';
  const nm = document.createElement('span');
  nm.className = 'nm'; nm.textContent = name;
  const cp = document.createElement('span');
  cp.className = 'cap';
  hd.append(nm, cp);
  const btns = document.createElement('div');
  btns.className = 'optbtns';
  btns.style.setProperty('--nc', String(cells.length));
  const made = [];
  cells.forEach((label, i) => {
    const b = document.createElement('button');
    b.className = 'optbtn';
    b.textContent = label;
    b.title = row.preset ? '' : (row.cost ? `${name}: ${label} · ${row.cost}` : gfxCaption(row.key, base + i));
    b.onclick = () => {
      onPick(base + i);
      gfxSave();
      if (row.preset) for (const k of STAGE_ROWS) markStageDirty(k);
      else markStageDirty(row.key);
      renderOptions();
      applyGraphics();
    };
    btns.appendChild(b);
    made.push(b);
  });
  el.append(hd, btns);
  optRowEls.push({ row, cap: cp, cells: made, base });
  return el;
}
function syncOptions() {
  for (const r of optRowEls) {
    const n = gfx[r.row.key];
    // A ladder's caption is what the level *is* and it moves with the cell; a
    // switch's is what the effect *costs*, which is a property of the row and not
    // of where it is set, so the two read the same field with different sources.
    r.cap.textContent = r.row.preset ? '' : (r.row.cost || gfxCaption(r.row.key, n));
    r.cells.forEach((b, i) => b.classList.toggle('on', i + r.base === n));
  }
}
let optionsOpen = false;
function openOptions() {
  renderOptions();
  optionsOpen = true;
  $('options').classList.add('on');
}
function closeOptions() {
  optionsOpen = false;
  $('options').classList.remove('on');
}

/* ================================================================== *
 * Materials
 *
 * Smooth everywhere. Nothing is flat shaded any more, so a face reads as a
 * face because the geometry says so and not because the shader is averaging
 * away the corner - which means the geometry has to hold up on its own. The
 * course surface keeps its vertex colour as the low-frequency driver and gains
 * a triplanar detail normal on top of it; the water gains two of those, one
 * going each way, because a pool with one direction of ripple in it reads as
 * wallpaper.
 * ================================================================== */
/**
 * A detail normal, and optionally a detail colour, projected from the world
 * position on all three planes and blended by the world normal. The ground and
 * the bed are built along a spline and have no UVs at all - their colour is
 * sampled in world XZ at four frequencies - so this is the same answer they
 * already had, with a normal map under it.
 *
 * It needs no uv on the geometry, which is what lets the same detail go on a
 * flat green disc and on six thousand instanced tufts: neither has anywhere to
 * put a uv, and a scattered prop cannot have one put there per instance.
 *
 * The colour is the second half of the same answer, and it is the only other
 * slot a surface without a uv can honestly fill. A `map` is read by uv and a
 * missing attribute is (0,0), so a map hung on one of these materials gives it
 * a single texel - which is why the ground and the bed carry no roughness map
 * either. But the *detail* in a colour, multiplied into a colour the surface
 * already has, is worth having: a vertex every two metres holds a course
 * verge's colour perfectly well and a forty-segment fan with one vertex in the
 * middle of it holds nothing at all finer than the eight metres across it, and
 * a lawn seen from a metre away is all finer than that. The maps are built
 * about white for exactly this reason - the surface keeps its own hue and the
 * map only supplies the grain - and `colourAmount` is how much of it to lay on.
 *
 * The instance matrix is the part that is easy to miss. `modelMatrix` is the
 * mesh's, and for an `InstancedMesh` every one of the six thousand is placed by
 * a matrix in the geometry's own attribute buffer - so projecting from
 * `modelMatrix` alone would give every tuft the identical patch of the map,
 * rotated and scaled into place, which reads as one grass blade stamped
 * six thousand times. So the projection is taken from the transformed vertex,
 * the way `worldpos_vertex` takes it, and the plane comes from the instance
 * matrix's own axes.
 */
function triplanarDetail(m, map, scale, strength, colour, colourScale, colourAmount, colourGain, splitOk) {
  if (!map) return m;
  // The two halves of a pair have to be on the **same tile**, and this is where
  // that gets enforced rather than remembered. `scale` and `colourScale` are both
  // tiles per metre, so a colour asked for at a different number is projected
  // through a different world size: its pale plate is not the plate the normal
  // has raised, and the surface is two textures laid over each other rather than
  // one rock. It is an easy slip - one number in a long list of numbers, and
  // nothing about it looks wrong until you are looking for it. The cliff's colour
  // sat at 0.7 against a normal at 0.55 for a long while, under a comment that
  // said the two were in agreement about scale.
  //
  // So the colour takes the normal's scale unless it is told otherwise, and a
  // caller that tells it otherwise says so out loud. There is exactly one place
  // in the county that wants two scales - the stable's lawn, which takes the
  // coarser grain in its normal and the finer in its colour - and it passes
  // `splitOk` so this is a decision on the record rather than a warning that
  // fires on every boot and is then learned to ignore.
  if (colour && !splitOk && colourScale !== undefined && colourScale !== scale) {
    console.warn(`triplanarDetail: colour scale ${colourScale} is not the normal's ${scale}`
      + ' on the same material - the two halves of a pair have to be on one tile');
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailN = { value: map };
    sh.uniforms.detailScale = { value: scale };
    sh.uniforms.detailStrength = { value: strength };
    sh.uniforms.detailC = { value: colour || null };
    // the normal's own scale unless one is named, and not `colourScale || scale`:
    // a scale of zero is a legal tile (one the size of the county) and `||` would
    // have quietly thrown it away
    sh.uniforms.detailCScale = { value: colour && colourScale !== undefined ? colourScale : scale };
    sh.uniforms.detailCAmount = { value: colourAmount === undefined ? 1 : colourAmount };
    sh.uniforms.detailCGain = { value: colourGain === undefined ? 1 : colourGain };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriW;\nvarying vec3 vTriWN;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        #ifdef USE_INSTANCING
          vTriWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vTriWN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vTriW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vTriW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${colour ? '#define USE_DETAIL_COLOUR' : ''}
        varying vec3 vTriW;
        varying vec3 vTriWN;
        uniform sampler2D detailN;
        uniform float detailScale;
        uniform float detailStrength;
        uniform sampler2D detailC;
        uniform float detailCScale;
        uniform float detailCAmount;
        uniform float detailCGain;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          // A normal map is a tangent-space direction packed into 0..1 with 0.5
          // meaning "no slope", so the half comes off and the rest is doubled
          // before it is treated as a slope. Handing the packed channels
          // straight to a vector leaves the half in there, which tilts the whole
          // surface a constant amount and keeps only the variation - so the
          // surface looks faintly wrong and the map looks like it is doing
          // almost nothing, and both of those are this line's fault.
          vec2 d = vec2(0.0);
          d += (texture2D(detailN, vTriW.zy * detailScale).xy * 2.0 - 1.0) * an.x;
          d += (texture2D(detailN, vTriW.xz * detailScale).xy * 2.0 - 1.0) * an.y;
          d += (texture2D(detailN, vTriW.xy * detailScale).xy * 2.0 - 1.0) * an.z;
          vec3 wn = normalize(normalize(vTriWN) + vec3(d * detailStrength, 0.0));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      // The same three projections again, for the colour. A surface with no uv
      // can have a colour detail on it and no more: a `map` is read by uv, and a
      // missing attribute is (0,0), so a map hung on one of these materials
      // gives it one texel and no variation. This is the one slot a surface
      // without a uv can honestly fill after the normal, and it is a multiply -
      // the detail is drawn *over* a colour the surface already has, so the
      // piece keeps the hue it was painted with and the map only supplies the
      // grain. It goes in after `<color_fragment>`, so what it multiplies is the
      // vertex colour as well.
      //
      // `detailCGain` is the other half of a multiply map. An eight-bit canvas
      // clamps at one, so a detail built symmetrically about white loses its
      // whole highlight half to the clamp and arrives as a flat average: the map
      // looks blank and the surface looks untextured. So the map is built under
      // one and the mean is put back here, and the value a caller wants is the
      // gain rather than the map.
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_DETAIL_COLOUR
        {
          vec3 ac = abs(normalize(vTriWN));
          ac /= (ac.x + ac.y + ac.z);
          vec3 dc = vec3(0.0);
          dc += texture2D(detailC, vTriW.zy * detailCScale).rgb * ac.x;
          dc += texture2D(detailC, vTriW.xz * detailCScale).rgb * ac.y;
          dc += texture2D(detailC, vTriW.xy * detailCScale).rgb * ac.z;
          diffuseColor.rgb *= mix(vec3(1.0), dc * detailCGain, detailCAmount);
        }
        #endif`);
  };
  return m;
}

/**
 * Two ripple normals on the water, one scrolling out along the pool and one
 * across it, sampled into one perturbation so there is one tangent frame to
 * think about rather than two. The frame itself comes from screen-space
 * derivatives, because nothing in this project writes a `tangent` attribute and
 * three derives one when a normal map is present.
 *
 * **The drift vector is one object, shared by every water surface in the
 * county.** It used to be a single material's own uniform, reached through the
 * shader `onBeforeCompile` handed back, which is only possible while there is
 * one water material - and there is not any more: `poolWaterMat()` gives each
 * pool its own so that a pool can carry its own reflection probe, and a
 * four-pool course is four materials. Four drifts would be four pools whose
 * ripples did not agree with each other, which is the one thing water must not
 * do. So the uniform is shared and the animation is written straight onto it.
 */
const rippleU = { tRipple: { value: new THREE.Vector2() }, uRipple: { value: 0.42 } };
function rippleWater(m, one, two) {
  m.normalMap = one || null;
  if (!one) return m;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.ripple2 = { value: two || one };
    sh.uniforms.tRipple = rippleU.tRipple;
    sh.uniforms.uRipple = rippleU.uRipple;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_pars_fragment>',
        '#include <normal_pars_fragment>\nuniform sampler2D ripple2;\nuniform vec2 tRipple;\nuniform float uRipple;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nA = texture2D(normalMap, vNormalMapUv + tRipple).xyz * 2.0 - 1.0;
          vec3 nB = texture2D(ripple2, vNormalMapUv * 1.63 - tRipple * 0.47).xyz * 2.0 - 1.0;
          vec2 d = (nA.xy + nB.xy * 0.85) * uRipple;
          normal = normalize(tbn * normalize(vec3(d, nA.z)));
        }`);
  };
  return m;
}

/**
 * Two or three detail sets in **one** material, cross-faded per fragment by a
 * per-vertex weight, so two surfaces can meet in a gradient instead of a seam.
 *
 * This is the answer to the one thing `triplanarDetail()` above cannot do. A
 * course surface is a single mesh of shared vertices with an index split into
 * groups, and each group wears its own material — so a turf-to-stone edge is a
 * **material** boundary, and a material boundary is one quad wide however
 * carefully the vertex colour was faded across it. The colour can be blended to
 * the halfway point; the maps cannot, because grass blades on one side of the
 * join and rock joints on the other is a full-strength change in the row of
 * pixels where the index splits, and that row draws a line.
 *
 * So the split goes and the blending comes with it. Each set is a normal, a
 * scale and a strength, and optionally a colour, a scale, an amount and a gain —
 * exactly the arguments `triplanarDetail()` takes, one set's worth each. The
 * geometry carries a `detailW` attribute, a `vec3` of weights that sum to one at
 * every vertex, and the shader sums the sets' slopes and averages the sets'
 * colours by those weights. One set at full weight is exactly the single-set
 * case, which is what makes the guards below safe.
 *
 * The weights are per **vertex**, so the gradient is a linear ramp across
 * whatever a quad is, and a quad out on the open country is two to six metres.
 * That is the band the transition happens in and there is no way to make it
 * narrower without finer geometry — but it is a gradient and not a step, and
 * that is the whole of the difference between a line and a blend.
 *
 * Each set is guarded on its own weight, so open meadow pays for one set of
 * three projections and a terrace pays for two, and the course surface costs
 * about what it did before everywhere except the seams.
 *
 * A set may also be drawn in **the lane's frame** rather than the world's, with
 * `uv: true`, and that is not a variant of the same idea - it is a different
 * projection and it is right for exactly one surface in the county. A triplanar
 * set is sampled three times and blended by the surface's axes, which is the
 * correct answer for something that is metres across and was built out of a
 * height field: there is no direction in the ground to prefer. The track is a
 * strip that bends, and everything about a track is directional - the grain is
 * laid along it, the sweep is along it, the snail runs along it. Projected in
 * world space the map is a pattern fixed to the county, so the same chip of
 * brick is at the same place on every straight and the racing line is the only
 * thing on it that knows which way it is going. The geometry for a uv set
 * carries a `trackUv` attribute instead of relying on the projection:
 * **arc length along the lane in `x`, metres out from the centre line in `y`**,
 * both in metres and both run through the set's own `scale`, so a tile is the
 * same length whichever way it is drawn. `mat.road` and `mat.ledge` are the two
 * meshes that have one; everything else is left triplanar.
 */
function triplanarSets(m, sets) {
  const live = sets.filter((s) => s && s.map);
  if (!live.length) return m;
  const n = live.length;
  for (let i = 0; i < n; i++) {
    const s = live[i];
    // the two halves of a pair have to be on the **same tile**, exactly as they
    // do for the single-set version, and for the same reason: a colour asked for
    // at a different tile is a pale patch raised somewhere else
    if (s.colour && s.colourScale !== undefined && s.colourScale !== s.scale) {
      console.warn(`triplanarSets: set ${i} colour scale ${s.colourScale} is not the normal's ${s.scale}`);
    }
  }
  const K = ['X', 'Y', 'Z'];
  /** Whether a set is projected by the lane's own frame rather than triplanar. */
  const byUv = (s) => !!s.uv;
  const anyUv = live.some(byUv);
  // **GLSL has no int-to-float promotion in a multiply**, so a whole number here
  // has to be written with a decimal on it or the shader will not compile, and
  // the error it gives is about operand types and says nothing about the number
  // that caused it. Every default in `triplanarSets()` is a whole number.
  const g1 = (v, d) => {
    const s = v === undefined ? String(d) : String(v);
    return /[.eE]/.test(s) ? s : s + '.0';
  };
  const slope = (i) => {
    if (i >= n) return '';
    const s = live[i], k = K[i];
    // **A set with a `uv` is sampled once, in the lane's frame.** A triplanar set
    // is sampled three times and blended by the surface's three axes, which is
    // the right thing for a surface that is metres across and was built out of a
    // height field: there is no direction in it to prefer. A track has one. It is
    // a strip that bends, and a track's grain, its sweep and the direction a
    // snail runs all lie along it, so a world-projected map stamps the same
    // pattern at the same place in space whatever the lane is doing there, and
    // on a corner the grain runs across the racing line.
    //
    // So the road and its flank carry `trackUv` - **arc length along the lane in
    // `x` and metres out from the centre line in `y`**, both in metres and both
    // fed through the same `scale` as a projected coordinate, so a set's tile is
    // the same length whichever way it is drawn - and a uv set is one fetch
    // instead of three, taken in a frame that turns with the track.
    if (byUv(s)) return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            d += (texture2D(dN${k}, vTrackUv * dS${k}).xy * 2.0 - 1.0)
               * (vDetailW.${k.toLowerCase()} * dK${k});
          }`;
    return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            vec2 t = vec2(0.0);
            t += (texture2D(dN${k}, vTriW.zy * dS${k}).xy * 2.0 - 1.0) * an.x;
            t += (texture2D(dN${k}, vTriW.xz * dS${k}).xy * 2.0 - 1.0) * an.y;
            t += (texture2D(dN${k}, vTriW.xy * dS${k}).xy * 2.0 - 1.0) * an.z;
            d += t * (vDetailW.${k.toLowerCase()} * dK${k});
          }`;
  };
  const tint = (i) => {
    if (i >= n) return '';
    const s = live[i], k = K[i];
    if (!s.colour) return '';
    if (byUv(s)) return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            float f = vDetailW.${k.toLowerCase()} * ${g1(s.colourAmount, 1)};
            dc += texture2D(dC${k}, vTrackUv * dS${k}).rgb * (f * ${g1(s.colourGain, 1)});
            dsum += f;
          }`;
    return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            vec3 t = vec3(0.0);
            t += texture2D(dC${k}, vTriW.zy * dS${k}).rgb * an.x;
            t += texture2D(dC${k}, vTriW.xz * dS${k}).rgb * an.y;
            t += texture2D(dC${k}, vTriW.xy * dS${k}).rgb * an.z;
            float f = vDetailW.${k.toLowerCase()} * ${g1(s.colourAmount, 1)};
            dc += t * (f * ${g1(s.colourGain, 1)});
            dsum += f;
          }`;
  };
  const decls = live.map((s, i) => {
    const k = K[i];
    const d = [`uniform sampler2D dN${k};`, `uniform float dS${k};`, `uniform float dK${k};`];
    if (s.colour) d.push(`uniform sampler2D dC${k};`);
    return d.join('\n        ');
  }).join('\n        ');
  m.onBeforeCompile = (sh) => {
    live.forEach((s, i) => {
      const k = K[i];
      sh.uniforms['dN' + k] = { value: s.map };
      sh.uniforms['dS' + k] = { value: s.scale };
      sh.uniforms['dK' + k] = { value: s.strength === undefined ? 1 : s.strength };
      if (s.colour) sh.uniforms['dC' + k] = { value: s.colour };
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 detailW;
        ${anyUv ? 'attribute vec2 trackUv;\nvarying vec2 vTrackUv;' : ''}
        varying vec3 vDetailW;
        varying vec3 vTriW;
        varying vec3 vTriWN;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vDetailW = detailW;
        ${anyUv ? 'vTrackUv = trackUv;' : ''}
        #ifdef USE_INSTANCING
          vTriWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vTriWN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vTriW = (modelMatrix * mat3(instanceMatrix) * vec4(transformed, 1.0)).xyz;
        #else
          vTriW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDetailW;
        ${anyUv ? 'varying vec2 vTrackUv;' : ''}
        varying vec3 vTriW;
        varying vec3 vTriWN;
        ${decls}`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          // The same three projections, once per set, and each one weighted by
          // its share of the vertex. Weighting the **slope** rather than the
          // finished normal is what makes this a blend: two sets' slopes sum,
          // and a normal is taken of the sum at the end, so half a vein and half
          // a blade is a surface with half of each in it rather than two surfaces
          // averaged.
          vec2 d = vec2(0.0);${slope(0)}${slope(1)}${slope(2)}
          vec3 wn = normalize(normalize(vTriWN) + vec3(d, 0.0));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          vec3 dc = vec3(0.0);
          float dsum = 0.0;${tint(0)}${tint(1)}${tint(2)}
          // and the same for the colour: a weighted mean of the sets' detail
          // rather than a chain of multiplies, so a surface that is half turf and
          // half stone is half of each map and not one map laid over the other
          if (dsum > 0.002) diffuseColor.rgb *= dc / dsum;
        }`);
  };
  // two different shaders under one material name breaks three's program cache
  // in a way that is very hard to read off a stack trace, so this one is named
  // `triplanarSets` + the set count + **whether any of them is a uv set**. The
  // last of those is the one that was nearly missed: `mat.course` and `mat.ledge`
  // both carry three sets, one is drawn in the world and the other in the lane,
  // and a cache key that named only the count would hand the meadow a shader
  // with a `trackUv` attribute in it - which is not an error, it is a varying
  // reading garbage, and it is a wrong picture rather than a broken one.
  m.customProgramCacheKey = () => 'triplanarSets' + n + (anyUv ? 'Uv' : '');
  return m;
}

const mat = {
  /**
   * The meadow, the road and the flank: **one material each, no index groups.**
   *
   * These three were four materials and three index splits, and the split is what
   * drew the lines. A course surface is a single mesh of shared vertices wearing
   * different materials per group, so a turf-to-stone edge was a material
   * boundary — one quad wide, and one row of pixels where the index changes from
   * grass blades to rock joints. The vertex colour could be faded to the halfway
   * point, and it was, and the line was still there, because the colour is only
   * half of what a material is.
   *
   * So each of these hosts its sets in one material and cross-fades them by a
   * per-vertex weight. `mat.course` carries all three surfaces of the
   * countryside — turf, cliff and shore — and `mat.road` and `mat.ledge` carry
   * two each. The set numbers, the tiles, the strengths and the gains are the
   * ones the old single materials used, unchanged; what changed is that there is
   * no longer a row of pixels where the surface changes.
   *
   * All three need a `detailW` attribute on their geometry and are not hung on
   * anything that has not got one — the stable's lawn and the six thousand tufts
   * are on `triplanarDetail()`'s single-set path and are untouched.
   */
  course: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }),
  road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }),
  ledge: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }),


  /**
   * The rock a snail **climbs**, which is the cliff's grain and none of its
   * weather.
   *
   * `cliff-albedo` is a darkening map and it is darkening on purpose: a face is
   * weathered a long way below the top of it, and that is most of what makes a
   * cut read as a cut. But the ribbon is not a face. `buildRoad()` stops at
   * FACE_SLOPE, so everything drawn in this material is a **ramp** of at most
   * fifty-eight degrees - and a ramp stands up to the light where a face stands
   * across it, and at a low sun the difference is the whole picture. In the one
   * material the climbing road came out as a black wedge on a green hillside at
   * half past four in the afternoon, which is not a road and not a face and not
   * anything in the county.
   *
   * So this is `mat.cliff` with the **weather** left off and the **grain** kept -
   * and the two are not the same map, which is the whole of it. The face takes
   * `cliff-albedo` as it stands, at a gain of 1, and comes out dark. This takes
   * the *same file* with some of the mean put back, which is what `detailCGain`
   * is for and what that map was built under one to allow: the map averages 0.57
   * linear, and a gain of **1.3** lands it around 0.74, so the ramp stands up
   * out of the face as a worn road without going pale beside it. The plates, the
   * cracks and the bedding are still in it because the range is stretched rather
   * than flattened.
   *
   * Not 1.75, which is the map's mean put back exactly, and which was this
   * first. That is arithmetic with no judgement in it and the picture has plenty
   * of judgement in it: at 1.75 the mean lands on one and the *top* of the range
   * goes to 1.45, the pale plates clip, and the climbing road came out as pale
   * limestone lying on top of a dark basalt cliff - which is a different county.
   * The gain is how much of the weathering to take off, and "all of it" is not an
   * answer to that any more than "none of it" is.
   *
   * Left with the normal and no colour at all - which is where this started - the
   * ramp was a black hole in the middle of the course with the cliff's own texture
   * showing at its edges where a grazing light caught the relief. A normal is
   * shape and not value: it can only ever subtract from what a surface already
   * has, and a face turned away from a nine-degree sun has nothing to subtract
   * from. The rock has to be *in* it.
   *
   * All of which is now a **set** rather than a material of its own: this is the
   * road's second set, the cliff's map at a gain of 1.3, and it is a set rather
   * than a material so that the strip of road and the strip of ramp meet in a
   * gradient. The weight that chooses between them is the same `isRock()` the two
   * groups used, carried per vertex and interpolated across the quad.
   */

  water: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.22, metalness: 0.08,
    transparent: true, opacity: 0.80, depthWrite: false, side: THREE.DoubleSide,
  }),
  foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  // the glass in a lamp: dark by day, and the thing that carries the light
  // once the hour asks for it
  // the paper of a lantern: warm, thin, and lit from within once the hour
  // asks for it, which is the whole point of a paper lantern
  paper: new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.9,
    emissive: LAMP_COLOUR, emissiveIntensity: 0,
  }),
  lampGlass: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.35,
    emissive: LAMP_COLOUR, emissiveIntensity: 0, transparent: true, opacity: 0.9,
  }),
  wood: new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.85 }),
  vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  // Iron, and it is the county's only metal and **the fallback and not the answer**
  // for the crate's brackets: `meshes/push-crate.glb` declares its own material
  // with a metalness of one, and this is what a caller gets if that file ever
  // stops declaring one. A metalness of zero here is deliberate - a bracket drawn
  // with it is grey plastic, and that is the picture the setting is here to catch.
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 1.0 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x7c9a4a, roughness: 1.0, side: THREE.DoubleSide }),
  flower: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
  cloud: new THREE.MeshStandardMaterial({
    color: 0xf6f9fc, emissive: 0xdde8f2, emissiveIntensity: 0.6,
    flatShading: true, roughness: 1.0, fog: false,
  }),
  // The backdrop keeps its flat shading, and this is the one place in the
  // project that does. A hill is a nine-by-six sphere: smooth-shaded, the
  // normals bend away from the light over most of it and a hill at a low sun is
  // a black shape against a bright sky, because there is no facet left facing
  // the sun. Flat-shaded, one of them always does. Nothing here is meant to be
  // looked at closely enough for the facets to read as a mistake, and the
  // backdrop is out of scope for the PBR work for exactly that reason.
  hillFar: new THREE.MeshStandardMaterial({ color: 0xb2c8c6, flatShading: true, roughness: 1.0, fog: false }),
  hillNear: new THREE.MeshStandardMaterial({ color: 0x8cae94, flatShading: true, roughness: 1.0, fog: false }),
  shellDark: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }),
};
// The sky, the clouds and the hills are out of scope for the PBR work and stay
// exactly as they were lit, so the environment map is taken off them: they are
// painted by hand to match the hour, and an image-based light on top of a
// hand-painted colour is how a backdrop goes chalky.
for (const m of [mat.cloud, mat.hillFar, mat.hillNear]) m.envMapIntensity = 0;
/** One of the course surface's maps, by slot, or null if it was never drawn. */
const detailOf = (which, slot) => {
  const name = SURFACE[which].find((n) => slotFor(n) === slot);
  return name && MAPS_TEX && MAPS_TEX.has(name) ? MAPS_TEX.get(name) : null;
};
/**
 * Any map in the jar, by name, or null. For the maps a surface projects rather
 * than samples: the marble is declared against the fountain, which has uvs and
 * wears it the ordinary way, and it is wanted on the plinth and the basin as
 * well, which are built here and have no uvs to sample it with.
 */
const mapTex = (name) => (MAPS_TEX && MAPS_TEX.has(name) ? MAPS_TEX.get(name) : null);

/**
 * **One water material per pool**, and the reason is `envMap`: it is a property
 * of the material, so a pool that reflects its own bank - which is the whole of
 * what the reflections row is for - cannot share one with three other pools
 * three hundred metres away. So `mat.water` stays as the county's single
 * reference water, and every surface that needs a probe of its own is a copy of
 * it: same colours, same two ripple normals, and the *same* ripple uniform
 * object, so four pools are still one body of water that happens to be in four
 * places. Four materials of identical code is four materials, and three's
 * program cache makes that four uniform sets rather than four shaders.
 *
 * `mat.water` is untouched, so anything that still asks for it directly - and
 * anything that reads a property off it - still gets exactly the water it has
 * always got.
 */
function poolWaterMat() {
  return rippleWater(mat.water.clone(),
    detailOf('water', 'normalMap'), detailOf('water', 'ripple2'));
}
{
  // one tile of detail is about two metres across on the ground, and the same
  // grain repeated smaller on the track, which is a narrower ribbon
  //
  // And the track now wears a **colour** as well, off the same tile and the same
  // field in the builder, so the dust swept pale down the middle of it is the
  // patch the normal has raised. The gain is **1**: the map is built close to
  // one on purpose - narrow tones, centred high, a hollow or two down at 0.6 -
  // because a track is the colour its vertex colours already say it is and what
  // it was short of was grain. The cliff's colour is a gain of 1 too and sits
  // well under one instead, and that difference is the point of both: a face is
  // weathered a long way below its top and a track is not, so the one map is
  // built to darken and this one is not.
  //
  // And it is worth saying what the map does **not** do, because the track is
  // the one surface in the county that could not have it any other way: it
  // carries no hue at all. The red is `PAL.clay` in the ribbon's vertex colours
  // and this is a multiply about one, so the track is the most saturated colour
  // in the jar without a single texel of the map adding any chroma of its own.
  //
  // The track. Two sets in one material — the track's own grain, and the cliff's
  // at a gain that puts its mean back — so the strip of clay and the strip of
  // ramp on the climbing half of it meet in a **gradient** across a quad rather
  // than in a material boundary. The tile is **0.85 metres** and the map moved to
  // 1024 underneath it, so the grain it carries is the grain the three references
  // this field was drawn from carry: two to six millimetre chips at eight texels
  // each, where the old map at 512 put the same chip in one and a half. See the
  // `mat.ramp` block below for why the ramp is the cliff's map with the weather
  // left off, and the cliff's set here for why the face is not.
  //
  // And the track's set is **`uv: true`** while the cliff's is not, and that is
  // the difference between a map that follows the lane and a map that does not.
  // The ribbon is a strip that bends; its grain, the sweep the broom leaves and
  // the direction a snail runs all lie along it, and a triplanar projection
  // stamps the same pattern at the same place in world space whatever the lane
  // happens to be doing there — so on a corner the clay's grain runs across the
  // racing line and the sweep has no direction at all. The cliff's set stays
  // projected, because a face has no lane to follow: its bedding is level in the
  // world and it should stay that way whichever way the cliff is cutting.
  triplanarSets(mat.road, [
    // The track's gain is **1.41** and it is the map's mean, not a taste: the
    // albedo's weighted field is put under one on purpose (see `trackTone()` in
    // the builder) so its highlight half survives the eight-bit canvas, which
    // costs the whole of it above the clamp, and this puts the mean back. At 1.0
    // the road arrives a third of a stop dark and reads as a brown card.
    { map: detailOf('track', 'normalMap'), scale: 0.85, strength: 0.7, colour: detailOf('track', 'map'), colourGain: 1.41, uv: true },
    { map: detailOf('cliff', 'normalMap'), scale: 0.55, strength: 1.0, colour: detailOf('cliff', 'map'), colourGain: 1.3 },
  ]);

  // The flank hanging off the edge of the ribbon, which is the same two sets
  // again with the cliff at its own gain of **1** rather than the ramp's 1.3: a
  // flank is a face and takes the weather as it stands, and a ramp is not. Same
  // two sets, same two numbers but for the gain, and the reason it is a separate
  // material rather than the road's is that one gain.
  //
  // **And a third, which is the shore's pair.** The flank of a track is not more
  // clay: it is the edge of a built surface, and the county's edge for that is
  // sand - the same sand a pool has round it, at the same tile and the same
  // gain, which is why it is declared here rather than written out. Where the
  // ribbon is a ramp the flank is a face and the cliff's set takes the weight,
  // so the third set's share is `1 - rampShare()` and the two cross-fade on the
  // same numbers the ribbon's do. That is the whole of what it is for: without
  // it the flank was the road's colour at 0.78 and read as a band of wet earth
  // round every course, and a painted line with a trench under it is not a
  // court.
  //
  // The sand and the track's own set are both `uv`, so the flank's grain turns
  // with the lane exactly as the ribbon's does and the corner between the two
  // is a corner between two surfaces rather than a corner between two frames.
  triplanarSets(mat.ledge, [
    { map: detailOf('track', 'normalMap'), scale: 0.85, strength: 0.7, colour: detailOf('track', 'map'), colourGain: 1.41, uv: true },
    { map: detailOf('cliff', 'normalMap'), scale: 0.55, strength: 1.0, colour: detailOf('cliff', 'map'), colourGain: 1.0 },
    { map: detailOf('sand', 'normalMap'), scale: 1.1, strength: 0.9, colour: detailOf('sand', 'map'), colourGain: 1.35, uv: true },
  ]);

  // The meadow, and the whole of the countryside either side of the lane, in one
  // material with **three** sets: turf, cliff and shore. This is the one that
  // removes the seams the ground mesh used to be split into three groups for.
  //
  // The set numbers are the three the three single materials used, unchanged:
  //
  //   - **turf** at 0.2 and 0.3 with a gain of 1.20. Five metres a tile, and that
  //     is the number that answers "this map reads at a hundred paces and then
  //     stops": a course verge is two hundred and forty metres across, so a
  //     two-metre tile went past a hundred times in a single row and the stems
  //     lined up into corduroy visible from the start line. The map was redrawn
  //     for the tile — the lattice that gives a four-centimetre stem is about
  //     125, not the 53 it was built on, so the tile grew and the stems did not.
  //     The strength is 0.3 and the map itself is at 1024 with the relief in
  //     thin lines rather than in lobes, so those two are one change: the old
  //     numbers together gave two and a half degrees of slope across a whole
  //     county of grass, which is nothing, because two degrees of tilt is a
  //     value change and a vertex colour already has one. A detail map's strength
  //     is a function of its tile, and the rule the old 0.6 broke is still true.
  //     The gain is the map's own mean put back, because it is built under one.
  //     The colour is on the **normal's** tile and not on its own, because
  //     `TURF()` is one field feeding both maps: a pale blade in the albedo is
  //     the blade the light is coming off.
  //
  //   - **cliff** at 0.55 and 1.0 with a gain of 1, on one tile for the two
  //     halves. A little under two metres so a slab is about the size of a slab,
  //     and the strength well above the bed's because the point of it is the
  //     **edges** — a fractured face is edges — and at the bed's 0.7 the steps
  //     between plates are a fifth of a degree of light. The gain is 1 and not the
  //     1.5 it first went on with: the map is built under one precisely so the
  //     mean can be put back, and putting back 1.5 means brightening the face by
  //     half, which is how a weathered cliff came out paler than the road above
  //     it. The tile is the normal's 0.55 and not the ground's 0.7 it used to be
  //     on — a comment claimed the two were in agreement about scale and the
  //     numbers said 0.55 and 0.7, so the pale plate in the colour was a quarter
  //     smaller than the plate the normal had raised and the face was two textures
  //     laid over each other.
  //
  //   - **shore** at 1.1 and 0.9 with a gain of 1.35, one tile for the two halves
  //     for the cliff's reason: `SAND()` is one field feeding both maps, so a
  //     crest that is pale in the colour is the crest that is raised in the
  //     normal. Nine tenths of a metre a tile, so a crest is about a hand's
  //     width. The strength is well under the cliff's because this is a
  //     *strength* question on a fine grain, and sand that stands up like a rock
  //     face is not a shore.
  //
  // One material rather than three, and each set guarded on its own weight, so
  // open meadow pays for one set of three projections and a pool's edge pays for
  // two. The turf is the one set that is never absent, because the ground is
  // meadow for nine hundred and ninety-nine parts in a thousand of its width.
  triplanarSets(mat.course, [
    { map: detailOf('grass', 'normalMap'), scale: 0.2, strength: 0.3, colour: detailOf('grass', 'map'), colourGain: 1.20 },
    { map: detailOf('cliff', 'normalMap'), scale: 0.55, strength: 1.0, colour: detailOf('cliff', 'map'), colourGain: 1.0 },
    { map: detailOf('sand', 'normalMap'), scale: 1.1, strength: 0.9, colour: detailOf('sand', 'map'), colourGain: 1.35 },
  ]);
  rippleWater(mat.water, detailOf('water', 'normalMap'), detailOf('water', 'ripple2'));

  // The roughness halves of those pairs are drawn and shipped but are not hung
  // on anything here, and that is deliberate rather than an oversight. The
  // ground, the bed, the cliff and the shore are all built along the spline and
  // have no uv, and a `roughnessMap` is the one slot that can only ever be read
  // by uv - so putting one on any of them does not give the surface a texture,
  // it gives it a single texel: the shader samples (0,0) for every fragment, the
  // map is uploaded and bound to be read once, and the surface's roughness
  // quietly stops being the 1.0 it was authored at. The maps stay in
  // `meshes/tex/` because they are the roughness half of a pair and the tools can
  // show them, but a surface that wants one has to have a uv first.
  // `grass-rgh` is not drawn at all, and that is the same rule: grass is
  // uniformly rough, so the half of the pair that would have done nothing is
  // better off not existing than in the folder.

  // The grass, which is `mat.grass` and is a flat colour in a material with no
  // vertex colours - and a tuft has no uv either, and there is nowhere to put
  // one on six thousand of them. So the detail is projected the same way the
  // course surface's is, and it is the one surface in the county that needs it
  // more than the ground does, because a tuft is what a race actually sees:
  // the ground between two tufts is three metres off and mostly behind them.
  //
  // And it takes **both halves of the pair**, not just the normal, which is the
  // thing this missed for a long time. There are three green surfaces in the
  // county - the ground, the lawn disc and the tuft - and the first two wore
  // `grass-albedo` while the tufts wore nothing at all, so the piece of grass
  // a snail is racing past was a flat `#7c9a4a` cone with a normal on it. It is
  // a multiply, exactly as it is on the other two, so a stem is a shade greener
  // or a shade yellower than the mat and the mat keeps the colour it was given.
  //
  // The tile is **a metre and a half**, which is not the ground's five and not
  // the old fourteen centimetres, and all three of those numbers are the same
  // number: a tuft is a third of a metre across and a stem in this map is a
  // hundredth of the tile, so the tile that puts a centimetre-and-a-half stem
  // on a tuft is one and a half metres. The old 0.14 was chosen against the old
  // map, whose lattice was 53 and put a two-and-a-half-millimetre stem on the
  // ground; on the new map, whose lattice is 125, that same 0.14 puts a
  // millimetre of stem on a tuft and the map is a fifth of a texel. The
  // resolution and the tile moved together, which is the whole of why they have
  // to.
  //
  // The strength is 0.5 against a map that tilts 22, so about eleven degrees -
  // more than the ground's 0.3 does, and on purpose: a tuft is a third of a metre
  // across and a third of a metre of turf three metres off is four pixels.
  triplanarDetail(mat.grass, detailOf('grass', 'normalMap'), 0.7, 0.5,
    detailOf('grass', 'map'), 0.7, 1, 1.20);

  // The two things that give out light. They are the one pair in the project
  // that cannot be drawn in the material out of their own file, because the hour
  // drives their emissive by material name - and a material the hour does not
  // know about stays dark at midnight. So the maps are handed to `mat.paper` and
  // `mat.lampGlass` here, where the hour can see them, and `GAME_MATERIAL` in
  // the manifest keeps `scatter()` from swapping them back out.
  //
  // An emissive map is read as a colour and multiplied into the emissive, so it
  // is not a mask: it is what the lit thing looks like. The paper's is warm and
  // ribbed, and the ribs being *brighter* than the paper either side of them is
  // the whole trick - a rib is paper seen edge-on, so it is thinner, so it gives
  // out more. Without it a paper lantern is a glowing ball.
  for (const [m, prop, part] of [[mat.paper, 'lantern-pole', 'paper'], [mat.lampGlass, 'lamp-glass', '']]) {
    for (const name of mapsFor(prop, part)) {
      if (!MAPS_TEX || !MAPS_TEX.has(name)) continue;
      for (const slot of mapSlots(name)) m[slot] = MAPS_TEX.get(name);
    }
  }
}

/**
 * The colours, out of the jar the builders and the texture builder share. The
 * jar holds linear triples, which is what a vertex colour is written in, so
 * these are the same numbers with the same values as before - nothing here
 * repaints the county, it only stops it being written down four times.
 */
const colour = (name) => new THREE.Color().setRGB(name[0], name[1], name[2], THREE.LinearSRGBColorSpace);
const PAL = {
  dirtA: colour(C.dirtA), dirtB: colour(C.dirtB), dirtEdge: colour(C.dirtEdge), dirtLight: colour(C.dirtLight),
  stoneA: colour(C.stoneA), stoneB: colour(C.stoneB),
  grassA: colour(C.grassA), grassB: colour(C.grassB), deep: colour(C.deep),
  dry: colour(C.dry), earth: colour(C.earth), earthDeep: colour(C.earthDeep),
  sand: colour(C.sand), waterA: colour(C.waterA), waterB: colour(C.waterB),
  // The track, and it is the only group here that is not a soil or a stone: see
  // the note on them in the jar.
  clay: colour(C.clay), clayDeep: colour(C.clayDeep), clayDust: colour(C.clayDust),
  trackLine: colour(C.trackLine), trackLineWorn: colour(C.trackLineWorn),
};
const GREEN = GREEN_T.map(colour);
const BARK = colour(C.bark);
const STONE = STONE_T.map(colour);
// No pure white in the flowers: at ten centimetres across a white speck in the
// grass reads as a stone, and there are enough of them to notice.
const FLOWER_COLORS = FLOWER_HEX;
const MUSHROOM_RED = colour(C.mushroomRed);
const MUSHROOM_BROWN = colour(C.mushroomBrown);
const MUSHROOM_COUNT = 64;                 // each kind, in total, along the course
/** Tufts on a course, which is most of what is out there. Read through the grass
 *  row rather than as a constant, so a density step is one number. */
const grassCount = () => Math.max(64, Math.round(4800 * gfxGrassDensity()));
const ROCK_SCALE = 0.30;                   // stones are for looking at, not climbing over

/* ================================================================== *
 * Track geometry. Everything is built in lane space: a sample's own
 * frame gives a position, a right vector and a width, and the ground
 * function says how far the hillside falls away to either side.
 * ================================================================== */
const _fr = newFrame();
const _c = new THREE.Color();
/** The second scratch, for laying one colour over another without losing it. */
const _s = new THREE.Color();

function laneVertex(sm, d, out) {
  out.set(sm.p.x + sm.right.x * d, 0, sm.p.z + sm.right.z * d);
  return out;
}

/**
 * The rows the track ribbon is built on, as fractions of the lane's half-width,
 * and the last two of them on each side are the **line**.
 *
 * This was four rows a third of the way out. It is ten, and four of those are
 * the pair of columns a painted stripe needs and did not have: a line is a
 * ten-centimetre band and a vertex colour cannot draw a ten-centimetre band on
 * a row a metre apart — it draws a metre of gradient, which is a worn edge and
 * not a stripe. So the outer two columns on each side are packed together at
 * three, five and ten centimetres, and the stripe is a **pair of quads** rather
 * than a soft shoulder. The price is the honest one: the inner edge of the
 * line is one quad of ramp, and there is no way to make it narrower without
 * finer geometry, which is the same bargain `buildGround()` strikes at the edge
 * of the meadow and the same reason it is a blend and not a seam.
 *
 * `0.60` is the last row that is just track. The stripe is white from `0.95` out
 * to the edge and the ramp into it is the `0.92` to `0.95` quad — see
 * `trackLineAt()`.
 */
const TRACKC = [-1, -0.99, -0.95, -0.92, -0.60, 0.60, 0.92, 0.95, 0.99, 1];
/**
 * How much of the painted line a given row of the ribbon is carrying, 0 to 1.
 *
 * It is a `smoothstep` over a span of three hundredths of the half-width —
 * about eight centimetres — and it is the **only** thing in the county that
 * draws a line with a vertex colour, so it is worth saying why that is allowed
 * here and is not a rule: a stripe is not a surface, it is a marking on one, and
 * it is the one feature in this project where being eight centimetres of ramp
 * is invisible and being a metre of ramp is a smear across a fifth of the track.
 *
 * A rock stretch carries no line at all, whatever its neighbours say. There is
 * no paint on a climbing ramp, and a stripe that ran up a wall and stopped at
 * the top of it would be the tell that it was drawn by a function.
 */
const trackLineAt = (sm, edge) => (isRock(sm) ? 0 : smoothstep(0.92, 0.95, edge));

/**
 * The two lines **across** the lane, in metres along it: the start and the
 * half-way, and no more, because a line is a marking and the course is not full
 * of them.
 *
 * These were a chequered band of geometry laid on the road at each mark, ten
 * boxes a lane wide, and the band indexed vertex **43 of a 40-vertex buffer** -
 * the last column's quad reaches an index that was never written. An index past
 * the end of a vertex buffer is not a hole in the picture, it is whatever the
 * driver had lying there, and with a bloom pass standing over the frame that is
 * a black box the width of the course at the start line and another at the
 * half-way, and a third wherever the racers carried the camera across one. The
 * same camera measured **40.7 of 255 mean and 49.9 per cent of the frame black**
 * with the two bands in and **98.9 and nought** with them out.
 *
 * So there is no floor decoration any more and the line is painted into the
 * ribbon's own vertex colour, which is where the line down each edge has always
 * been painted. The amber that told you which half of a course you were in has
 * gone off the ground with it: a seventeen-metre tower with amber caps on its
 * posts says that from a hundred metres, and a stripe never did.
 */
const lineMarks = (tr) => [START_S, midwayOf(tr)];
/** The half-width of a painted cross line, and the two centimetres it ramps over. */
const LINE_CORE = 0.07, LINE_RAMP = 0.02, LINE_GAP = 0.005;

/**
 * The rows the ribbon is built on: one per sample, and **four more at each
 * mark**, packed the way `TRACKC` packs the columns of the edge stripe.
 *
 * A vertex colour cannot draw a seven-centimetre line on a row three quarters of
 * a metre apart — it draws three quarters of a metre of gradient, which is a
 * worn edge and not a stripe — so the rows either side of the mark are put in at
 * seven and five centimetres and the paint is a hard share across the two
 * inside them. This is the same bargain `TRACKC` strikes and for the same
 * reason, and the price is the same one: the line's own edge is a quad of ramp.
 *
 * **The paint is a share of the row's own distance to the mark**, not a flag on
 * the four packed rows, and that is the whole of why a sample which happens to
 * fall inside the line is drawn painted rather than bare. A flag says these four
 * rows are the line, and a sample row that lands four centimetres from the mark
 * is not one of the four, so the line comes out with a bare stripe up its
 * middle — on a course whose samples are 0.75 m apart and whose marks are at
 * 11 m and at whatever the half-way scan found, a five-centimetre hole in the
 * start line is a coin toss, and it was on Hedgerow Dash at 11.07 m.
 *
 * **Four more at each of a crate's lips as well, and these four bring a height.**
 * Same reason, same bargain, and the row's `y` is the notch's own answer to the
 * one thing a row on the lane's own field could never say — see the note at the
 * packing. So `row.y` is a thing a row may carry and a number the three surfaces
 * read instead of `trackAt()`'s, and `row.cond` goes with it: a wall that says
 * `PUSH` is stone, and the field it sits in calls the same place road.
 */
function roadRows(tr) {
  const marks = lineMarks(tr);
  const near = (s) => {
    let d = Infinity;
    for (const m of marks) d = Math.min(d, Math.abs(s - m));
    return d;
  };
  const rows = [];
  for (let i = 0; i <= tr.n; i++) rows.push({ s: tr.sm[i].s });
  for (const m of marks) {
    for (const d of [-LINE_CORE - LINE_RAMP, -LINE_CORE, LINE_CORE, LINE_CORE + LINE_RAMP]) {
      const s = m + d;
      if (s > 0 && s < tr.length) rows.push({ s });
    }
  }
  // **A crate's two lips get four rows of their own, and each one brings its own
  // height.** The lines get four rows because a seven-centimetre stripe cannot be
  // drawn on a row three quarters of a metre apart; a notch gets four because the
  // same row spacing draws its walls at forty-one degrees and a hole with no floor
  // in it is a crease, which reads as rounded however deep it is.
  //
  // **A row's height is a thing a row may carry, and the row beside it is not
  // asked.** Rows on the lane's own field would buy nothing at all: `trackAt()`
  // interpolates, and the field between two samples is a straight line, so four
  // more points on that line are four more points on the same forty-one degrees.
  // A wall has to come off the line. So the four rows are laid at the *levels* the
  // notch has - the road's own on the lip side, the floor's on the other - and
  // `row.y` is the number the three surfaces take instead of the interpolated one.
  // It is the same bargain as `row.paint`: a row may carry something the sample
  // spacing cannot say, and the surfaces that are built off the row list read it.
  //
  // **Either side of the lip and not on it**, because `s0` is the midpoint of the
  // gap between two samples and the height at the midpoint of a drop is half the
  // drop: a row laid *on* the lip would stand halfway down the hole.
  //
  // **And the two levels are read off the track rather than off the plan**, from
  // the sample on either side of `restS`, which is the sample the notch was cut
  // into and the only place the two numbers are the same numbers the notch was
  // cut from.
  const fr = newFrame();
  for (const lp of tr.leaps) {
    if (!lp.crate) continue;
    const c = lp.crate;
    // **The two lips are the road's own level where each of them stands**, which
    // `trackAt()` cannot be asked for - the field between them runs through the
    // notch - and both are on the crate because the cut is what put them there.
    const topA = c.topA != null ? c.topA : trackAt(tr, c.restS - STEP, fr).y;
    const topB = c.topB != null ? c.topB : topA;
    const bot = trackAt(tr, c.restS, fr).y;
    for (const [s, y] of [[c.s0 - CRATE_WALL, topA], [c.s0 + CRATE_WALL, bot],
      [c.s1 - CRATE_WALL, bot], [c.s1 + CRATE_WALL, topB]]) {
      if (s > 0 && s < tr.length) rows.push({ s, y });
    }
  }
  rows.sort((a, b) => a.s - b.s);
  const out = [];
  for (const r of rows) {
    // a packed row within `LINE_GAP` of one already there is a quad five
    // millimetres wide, which is a hairline of a sliver and a shimmer under the
    // camera; the row that is already there keeps the place, because the two are
    // the same place to within a distance no vertex colour can tell apart
    if (out.length && r.s - out[out.length - 1].s < LINE_GAP) continue;
    r.paint = 1 - smoothstep(LINE_CORE, LINE_CORE + LINE_RAMP, near(r.s));
    out.push(r);
  }
  // each row's own condition and face, read off the interpolated frame rather
  // than guessed: the gap loop below skips on them, and a packed row laid beside
  // a leap has to be skipped along with it
  for (const r of out) {
    trackAt(tr, r.s, fr);
    // **and a row that brings its own height says what it is as well.** The two
    // rows that stand on a notch's walls are on the lane's own field, so the
    // field calls them road: a notch whose walls are clay at the top and stone
    // two centimetres lower is a notch with a painted rim, and the crate is meant
    // to stand in broken ground.
    r.cond = r.y != null ? PUSH : fr.cond;
    r.face = isFace(fr);
  }
  return out;
}

/**
 * `rampShare()` sampled between samples rather than at one, because the packed
 * rows are not samples. The array is a smoothed weight over three samples
 * either side, so it has no kink inside a step and a linear read across one is
 * the same curve the array is drawing.
 */
const rampShareAt = (share, s) => {
  const t = clamp(s / STEP, 0, share.length - 1);
  const i = Math.floor(t), j = Math.min(i + 1, share.length - 1);
  return lerp(share[i], share[j], t - i);
};

/**
 * The frame a **row** is drawn in, which is the interpolated frame with the row's
 * own height in it where it has one.
 *
 * It is a function rather than a line repeated in the three surfaces because a row
 * that brought a height to one of them and not to the other two is a hole with a
 * cliff in the ribbon and a hillside in the ground: the ground's height is a
 * *function* of the frame it is handed - `groundYAt()` reads `fr.y` for the lane's
 * own level, for the drop it measures a wall from and for the shelf it lays beside
 * it - so the one place a row's height has to arrive is the frame, and a surface
 * that read `row.y` for its own vertices and passed the untouched frame to the
 * ground would put a metre of terrain over its own hole.
 */
const rowFrame = (tr, row, fr) => {
  trackAt(tr, row.s, fr);
  if (row.y != null) {
    fr.y = row.y;
    // **And it says what it is, because the field it stands in does not.** The two
    // rows at the top of a notch's walls are nearer a sample of plain road, so the
    // interpolation calls them road: `isRock()` gives them clay and the line, the
    // ground's own band leaves them meadow, and `wallProfile()` lays the wide
    // terrace under them and the notch is a bowl again. A row that brings a height
    // brings the answer with it, and the answer is what `roadRows()` recorded when
    // it decided the row was a wall.
    fr.cond = row.cond;
    fr.rock = true;
  }
  return fr;
};

/**
 * Past this slope a stretch of the lane is a **face** and not a lane, and
 * nothing walks a road up it and nothing draws one on it either.
 *
 * The number is a rise over a run, and 1.6 is about fifty-eight degrees. It is
 * set from the two slopes it has to tell apart rather than by taste: the wall a
 * snail climbs out of a flooded chasm measures 0.9 to 1.2 and keeps its road,
 * and the front of the lip of one measures two and a half to six and loses it.
 * Between those two there is nothing in the county to get wrong.
 *
 * It matters because the bed is a ribbon of **fixed width** - a little under
 * three metres, lane width, however steep the ground is. Laid down a near
 * vertical face it does not lie down: it stands on its end, and the front of a
 * leapClimb became a flat slab of pale stone propped against a sand bank with
 * a shadow under its top edge, which is a plate stuck on a cliff and not a
 * cliff. The ground carries a face, and it carries it as rock.
 *
 * **Only inside a hole.** A climbing course is mostly faces - a sheer wall is
 * what a `climb` is, and the road up it is the road - and a threshold on its own
 * took the bed off thirty-four samples of Crag Ascent's hundred and twenty-two
 * and would have taken the road off a third of the course. What separates the
 * two is not how steep the ground is, it is what the ground is: a face with
 * open country behind it is a wall somebody climbs, and a face with a basin
 * behind it is the inside of a hole that the road is falling off the front of.
 * A dry leap has no basin, so a dry leap keeps its road everywhere and only a
 * flooded one loses the lip.
 */
const FACE_SLOPE = 1.6;
const isFace = (sm) => sm.basin > 0.05 && Math.abs(sm.grade) > FACE_SLOPE;

/**
 * Whether a stretch of the lane is **rock** rather than road, which is what
 * decides the material half a strip of it is drawn in.
 *
 * It is the same condition the colours have always used, and it is the one the
 * two conditions between them cover everything with: a `CLIMB` is a wall and a
 * `WALK` is the floor of a chasm, and everything else in the county is dirt
 * with grass creeping back into it. So `buildRoad()`, `buildSkirt()` and
 * `buildGround()` can all ask the same question of a sample and get one answer,
 * and a vertex that is coloured stone is never drawn in a material that says
 * it is not.
 *
 * **`PUSH` is in it for the same reason `WALK` is.** A crate's span is a hole
 * and the crate is *not* the ground, so a sample the snail is asked to cross on
 * foot answers `PUSH` and the span is not meadow: leave it out and the hole is
 * turf, `trackLineAt()` paints its two edge lines down a chasm, and
 * `rampShare()` weights it as meadow, and the one feature on the course that is a
 * hole reads as a field that happens to be a stripe.
 *
 * It answers a yes or a no, and a yes or a no is a **line** the moment it picks
 * a material. So the ribbon and the flank do not use this to choose a material
 * between two; they use `rampShare()` below, which is this smoothed, and the
 * answer it gives is a share.
 */
const isRock = (sm) => sm.cond === CLIMB || sm.cond === WALK || sm.cond === PUSH;

/**
 * How much of a **ramp** each sample of the lane is, 0 to 1, and it is a ramp
 * rather than a step because that is the only way two materials in one material
 * can meet in a gradient.
 *
 * `isRock()` is a yes or a no about a sample and a stretch of it is a few metres
 * long, so a hard boundary at each end of a wall is a line across the road - and
 * on a climbing course, where the road *is* the wall, that line is the join
 * between a snail running and a snail climbing, which is the one place in the
 * county that most wants to look like a change and least wants to look like a
 * seam. So each sample is asked where it sits between the two ends of the
 * nearest rocky stretch and given a share, over a fixed **one and a half metres**
 * either side of each end. That is two samples at this spacing, which is short
 * enough to still read as a change and long enough that the change is a gradient
 * and not a line.
 *
 * `buildRoad()` and `buildSkirt()` both read it and must agree, so it is a
 * function of the track and not of either of them - the same reason `SAND()` and
 * `wallProfile()` exist.
 */
function rampShare(tr) {
  const hard = new Float32Array(tr.n + 1);
  for (let i = 0; i <= tr.n; i++) hard[i] = isRock(tr.sm[i]) ? 1 : 0;
  const out = new Float32Array(tr.n + 1);
  for (let i = 0; i <= tr.n; i++) {
    let sum = 0, wsum = 0;
    for (let k = -2; k <= 2; k++) {
      const j = clamp(i + k, 0, tr.n);
      const w = 1 - Math.abs(k) / 3;
      sum += hard[j] * w; wsum += w;
    }
    out[i] = sum / wsum;
  }
  // and a face never carries road at all, whatever its neighbours say
  for (let i = 0; i <= tr.n; i++) if (isFace(tr.sm[i])) out[i] = 0;
  return out;
}

/** The ribbon the racers run on: crushed brick on the flat, rock on the walls. */
function buildRoad(tr) {
  const C = TRACKC.length;
  // **The rows are `roadRows()` and not the samples**, so the start and the
  // half-way have four rows of their own packed either side of them and the line
  // across the lane is a stripe rather than three quarters of a metre of
  // gradient. Everything below reads the row's own `s` and asks `trackAt()` for
  // its frame, because a packed row is not a sample and has no `sm` of its own.
  const rows = roadRows(tr), R = rows.length;
  const pos = new Float32Array(R * C * 3), col = new Float32Array(R * C * 3);
  // the `detailW` the shader cross-fades on: the track's grain on x, the ramp's
  // on y, and they sum to one because the one that is not wanted is a zero
  // rather than a weight, which is what lets each set's fetch be skipped entirely
  const rockW = new Float32Array(R * C * 3);
  // **The lane's own frame, in metres**: arc length along the lane, and metres
  // out from the centre line. This is the whole of "the grain follows the track"
  // and it is two numbers per vertex rather than a projection - see the note on
  // `uv: true` in `triplanarSets()`. The row's own `s` is its arc distance, so
  // the texture is continuous along the lane and repeats every `1 / 0.85` metres
  // without a seam anywhere, including round a corner, because the coordinate
  // that repeats is the one that runs along the bend.
  const tuv = new Float32Array(R * C * 2);
  const share = rampShare(tr);
  const fr = newFrame();
  const v = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    // the row's own frame, which is what the rest of this reads, and **its own
    // height where it has one**: a crate's walls are off the lane's field and the
    // ribbon is the surface that has to draw them.
    const sm = rowFrame(tr, row, fr);
    const sh = rampShareAt(share, row.s);
    for (let j = 0; j < C; j++) {
      const edge = Math.abs(TRACKC[j]);
      const d = TRACKC[j] * sm.w;
      laneVertex(sm, d, v);
      const o = (i * C + j) * 3, q = o / 3;
      pos[o] = v.x; pos[o + 1] = sm.y; pos[o + 2] = v.z;
      tuv[q * 2] = row.s; tuv[q * 2 + 1] = d;
      if (isRock(sm)) {
        _c.copy(PAL.stoneA).lerp(PAL.stoneB, vnoise(sm.x * 0.5, j * 2.1));
        // horizontal strata, the way a cut rock face beds
        _c.multiplyScalar(0.84 + 0.34 * vnoise(sm.y * 5.4, sm.x * 0.16 + j));
        // and the odd block of a different stone, so a face this big is
        // never one flat slab of colour
        _c.lerp(PAL.stoneB, Math.max(0, vnoise(sm.y * 1.3, sm.x * 0.55 + j * 0.7) - 0.56) * 1.5);
      } else {
        // The clay, and it is **crushed brick**: a red the county has nowhere
        // else, because a track drawn in `dirtA` is a footpath and the red is
        // the whole of what tells a snail it is on a course. The two colours are
        // a course's own light and shade rather than a gradient between two
        // materials - freshly laid at the verges and laid again a season ago,
        // both out of the same bag.
        //
        // The lerp is **biased**, and the bias is the number that decides whether
        // this reads as a clay court or as a plum. A straight `vnoise` is about
        // half deep on average, so the track sat at the midpoint of the two and
        // the midpoint of a hot red and a dark one is a maroon. `pow` at 1.8
        // puts the mean share of `clayDeep` at about a third, so two thirds of
        // the surface is laid brick and the deep patches are patches.
        _c.copy(PAL.clay).lerp(PAL.clayDeep, Math.pow(vnoise(sm.x * 0.35, j * 1.7), 1.8));
        // The sweep: the dust every snail has dragged up out of the middle, and
        // it is `clayDust` and not a paler clay, because brick dust ground fine
        // is a pink and not a tan. It is the thing a spectator reads as *worn*
        // and it is a term in the vertex colour rather than in the map - the map
        // is a multiply about one and carries no hue at all.
        _c.lerp(PAL.clayDust, (1 - edge) * 0.5 * (0.5 + 0.5 * vnoise(sm.x * 0.6, 7.3)));
      }
      _c.multiplyScalar(0.88 + 0.26 * vnoise(sm.x * 1.1, j * 3.3));
      // **The line**, and it is the whole of the third reference: a painted
      // stripe with the turf butted up against it and nothing at all in between.
      // Nothing creeped back in over it and nothing faded out under it - a court
      // is cut to an edge and the grass is cut to the same one - so the outer
      // three rows of this ribbon are paint and the ground's first row is grass,
      // and there is no band of bare earth between them to be a soft place for
      // the join to hide in.
      //
      // It goes on **last**, over the general value break-up and not under it,
      // and that is the other half of why it reads as paint. The
      // `multiplyScalar` above swings a quarter of a stop from row to row and
      // from metre to metre, which is right for clay and is a dashed line on
      // chalk: a stripe is painted by somebody standing still, and its own
      // wear is the `trackLineWorn` below and not a fresh draw of the noise.
      //
      // **And the same paint is the cross line**, so the two are one colour and
      // one wear and the start reads as the same sort of mark as the edge rather
      // than as a second thing laid on top. `row.paint` is already the ramp the
      // packed rows were put in to carry, so it is used as it comes rather than
      // being sharpened here: a second ramp across the same four centimetres is
      // how the line got to be half a metre wide the first time.
      //
      // **No paint on a climbing ramp**, for `trackLineAt()`'s reason and not a
      // new one: there is no paint on a wall, and a line that ran up one and
      // stopped at the top of it is the tell that it was drawn by a function.
      const line = Math.max(trackLineAt(sm, edge), isRock(sm) ? 0 : row.paint);
      if (line > 0) {
        _s.copy(PAL.trackLine).lerp(PAL.trackLineWorn, Math.max(0, vnoise(sm.x * 0.9, j * 5.1) - 0.34) * 1.6);
        _c.lerp(_s, line);
      }
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      rockW[q * 3] = 1 - sh;
      rockW[q * 3 + 1] = sh;
      rockW[q * 3 + 2] = 0;
    }
  }
  // **One material and a weight, where this was two materials and a split.**
  //
  // This ribbon is the **only** surface in the county a snail climbs, and it is
  // the same ribbon that a snail runs down a flat: a wall and a road are one
  // strip of geometry with the same width and a couple of metres apart, so
  // something has to tell them apart. It used to be an index split, and an index
  // split is a row of pixels where the material changes - so the road on a flat
  // and the ramp up a wall met in a hard line, on a climbing course, at the exact
  // place the snail is asked to change from running to climbing. `mat.road` wears
  // both sets and `detailW` says how much of each this vertex is.
  //
  // The weight is a **ramp across the sample, not a step**, and that is the whole
  // of the change. `isRock()` answers true for a stretch a few metres long, and a
  // hard boundary at each end of it is a line; so each vertex is asked where it
  // is *relative* to the two ends of the nearest rocky stretch and given a share,
  // and the strip between a flat and a wall is a couple of metres of track that
  // has begun to look like a ramp. The vertices are shared as they always
  // were, so `computeVertexNormals()` below still gives the whole ribbon one set
  // of normals and there is no seam in the geometry to see either.
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    // **The gap test is on the rows' own conditions**, read off the interpolated
    // frame in `roadRows()`, so a packed row laid beside a leap is skipped with
    // it. Reading `tr.sm[]` here instead would leave a quad bridging the four
    // rows of a line laid across the mouth of a gap.
    if (rows[i].cond === FLY || rows[i + 1].cond === FLY) continue;   // the gap has no floor
    // and a face carries no road. See FACE_SLOPE: the ribbon is a fixed width
    // and on a near-vertical stretch it is standing on its end, and the ground
    // is drawn over the same ground as rock, which is what a face is. Everything
    // that survives the test is a ramp, which is what the road's second set is.
    if (rows[i].face || rows[i + 1].face) continue;
    for (let j = 0; j < C - 1; j++) {
      const v0 = i * C + j, v1 = i * C + j + 1, v2 = (i + 1) * C + j, v3 = (i + 1) * C + j + 1;
      idx.push(v0, v1, v2, v1, v3, v2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(rockW, 3));
  g.setAttribute('trackUv', new THREE.BufferAttribute(tuv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.road);
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

/** The flanks, so the ribbon is a solid slab sitting on the landscape. */
function buildSkirt(tr) {
  // **The rows are `roadRows()` and not the samples**, for the reason the ribbon's
  // are: the flank hangs off the edge of the ribbon, so a flank built on the
  // samples is a half-metre band drawn beside a wall the ribbon is not drawing —
  // and at a crate's notch, where the ribbon's own rows are packed and standing at
  // heights the lane's field does not carry, that band would be a hillside standing
  // in the mouth of the hole.
  const rows = roadRows(tr), R = rows.length;
  const pos = new Float32Array(R * 4 * 3), col = new Float32Array(R * 4 * 3);
  const rockW = new Float32Array(R * 4 * 3);
  // the lane's own frame again, in metres: the same arc length, and the same
  // metres out from the centre line, so the flank's grain turns with the lane
  // exactly as the ribbon's does and the corner between the two meshes is a
  // corner between two surfaces and not a corner between two frames
  const tuv = new Float32Array(R * 4 * 2);
  const share = rampShare(tr);
  const fr = newFrame();
  const v = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    const sm = rowFrame(tr, row, fr);
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const dTop = side * sm.w;
      const dBot = side * (sm.w + 0.55);
      laneVertex(sm, dTop, v);
      const o = (i * 4 + k * 2) * 3, q = o / 3;
      pos[o] = v.x; pos[o + 1] = sm.y; pos[o + 2] = v.z;
      laneVertex(sm, dBot, v);
      // where the lane is cut above the hillside the flank must never hang
      // over the top of the verge
      pos[o + 3] = v.x; pos[o + 4] = Math.min(groundYAt(sm, dBot), sm.y); pos[o + 5] = v.z;
      tuv[q * 2] = row.s; tuv[q * 2 + 1] = dTop;
      tuv[(q + 1) * 2] = row.s; tuv[(q + 1) * 2 + 1] = dBot;
      // and the share is read between the samples for the same reason the ribbon
      // reads it there: the flank of a packed row is the flank of a row that is
      // not a sample, and the array's own nearest index would put a rock flank
      // under a clay one a third of a metre away.
      const sh = rampShareAt(share, row.s);
      const rock = isRock(sm);
      // and the share the shader reads, beside the colour rather than instead of
      // it: `isRock` still picks the two colours below, because the colour is a
      // step in its own right and a colour that cross-faded would be a different
      // argument. The *maps* cross-fade; the vertex colour is still laid with the
      // hard predicate, and the two are within a sample of each other.
      //
      // **And the share is now three numbers**, because the flank is two
      // surfaces and the third of the material is one of them: a face where the
      // ribbon is a ramp, and **sand** everywhere else. The sand takes
      // `1 - share[i]`, so it is the ribbon's own two surfaces mirrored — clay
      // flank under a clay ribbon, stone flank under a stone one, and a
      // gradient between the two at each end of every wall, which is the same
      // width and in the same place as the gradient on the ribbon above it.
      rockW[q * 3] = 0;
      rockW[q * 3 + 1] = sh;
      rockW[q * 3 + 2] = 1 - sh;
      if (rock) {
        // the face a wall is cut into: bedded in strata like the lane above
        // it, and shaded the further it falls from the light
        const h = sm.y - pos[o + 4];
        _c.copy(PAL.stoneA).lerp(PAL.stoneB, 0.3 + 0.5 * vnoise(sm.x * 0.6, k * 3.1));
        _c.multiplyScalar(0.84 + 0.30 * vnoise(sm.y * 5.4, sm.x * 0.16 + k));
        _c.multiplyScalar(1 - 0.26 * smoothstep(0, 1.4, h));
      } else {
        // **Sand, and this is the second half of the change.** The flank used to
        // be `dirtEdge` at 0.78: a hand's width of wet earth round every course
        // in the county, sitting directly under a painted line, which is what
        // made the line read as paint on a kerb in a trench rather than as the
        // edge of a court. `PAL.sand` and the shore's own mottling, so the two
        // are the same material by construction and not two similar colours —
        // the ground's shore band and this are one colour written twice, which
        // is the thing the jar exists to stop being a different thing.
        _c.copy(PAL.sand).lerp(PAL.dirtLight, 0.12 + 0.34 * fbm(sm.x * 0.19, (sm.z + dTop) * 0.19, 2));
        _c.multiplyScalar(0.9 + 0.2 * vnoise(sm.x * 0.8, k * 2.7));
        // and grit in the cracks, which is the one thing the shore has and a
        // six-centimetre kerb mostly will not
        _c.lerp(PAL.earthDeep, Math.max(0, 0.42 - fbm((sm.x + dTop) * 0.36, (sm.z + dTop) * 0.36, 2)) * 0.5);
      }
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      _c.multiplyScalar(rock ? 0.9 : 1);
      col[o + 3] = _c.r; col[o + 4] = _c.g; col[o + 5] = _c.b;
    }
  }
  // The flank is the half-metre wall hanging off the edge of the ribbon, and it
  // carries **the same share** the ribbon it hangs off does — `rampShare()`, the
  // same array, because a flank of dirt under a ramp is a seam exactly as hard
  // as a ribbon of dirt under a ramp, and one is visible for every metre of the
  // other. So sand where the road is clay, rock where the road is a wall, and
  // half of each where the road is one thing becoming the other.
  //
  // A face has no flank at all - see below - and unlike the ribbon this **is** a
  // face, standing straight up out of the edge of the lane, so it takes the
  // cliff's weather as it stands, at a gain of 1 where the ramp's is 1.3. That
  // is the whole of why `mat.ledge` and `mat.road` are two materials and not one:
  // the same sets at two gains, and the flank's has a third the ramp's has not.
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    if (rows[i].cond === FLY || rows[i + 1].cond === FLY) continue;
    // A face has no flank either. The flank is a half-metre wall hanging off the
    // edge of the ribbon, and on a face that is a second vertical sheet in the
    // same place as the ground the face is carried by - so it z-fights it, and
    // a face drawn twice with a hair between the two copies flickers.
    if (rows[i].face || rows[i + 1].face) continue;
    for (let k = 0; k < 2; k++) {
      const a = i * 4 + k * 2, b = a + 1, c = (i + 1) * 4 + k * 2, d = c + 1;
      if (k === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(rockW, 3));
  g.setAttribute('trackUv', new THREE.BufferAttribute(tuv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.ledge);
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

/** Water surfaces: one strip per stretch of basin. */
const WATER_TILE = 2.2;            // metres to a repeat of the ripple
function buildWater(tr) {
  const group = new THREE.Group();
  const meshes = [];
  let i = 0;
  while (i < tr.n) {
    if (tr.sm[i].basin <= 0.05) { i++; continue; }
    let j = i;
    while (j + 1 <= tr.n && tr.sm[j + 1].basin > 0.05) j++;
    const count = j - i + 1, C = 5;
    const pos = new Float32Array(count * C * 3), col = new Float32Array(count * C * 3);
    const uv = new Float32Array(count * C * 2);
    const idx = [];
    const v = new THREE.Vector3();
    // **The level is the first sample of the run that actually carries one, and
    // not the first sample of the run.** Those are different samples whenever a
    // pool is reached down a slope, and it cost a sheet of water in the air:
    // the basin is stamped over a pool's whole gap, the *water* is stamped over
    // the part of that gap the water is in, and where the two do not start
    // together the first sample's level is `null`. Water is a number that is
    // subtracted from, and `null - 0.10` is `-0.10`: on Skydrift the pool sits at
    // minus six and eight one, and the whole surface was built at about zero -
    // a flat blue sheet lying over the bank that leads down to it, six metres
    // above the pool, with the trench floor visible under its far edge. A null
    // that becomes zero in an arithmetic expression is the whole of it.
    let wy = null;
    for (let a = 0; a < count && wy === null; a++) if (tr.sm[i + a].water !== null) wy = tr.sm[i + a].water;
    if (wy === null) { i = j + 1; continue; }          // a basin with no water in it
    // And **a row is water only where the ground under it is below the surface.**
    // The level is flat because water is level, so a run that reaches its pool
    // down a slope has ground above the surface at its near end, and a surface
    // drawn across the whole run is a plane lying over the bank that leads to
    // the pool. The bank is the pool's own descent and the plan is right about
    // it; the surface is the thing that has to be clipped to it.
    const under = [];
    let firstWet = -1, lastWet = -1;
    for (let a = 0; a < count; a++) {
      const sm = tr.sm[i + a];
      const wet = sm.water !== null && sm.y - 0.06 < wy;
      under.push(wet);
      if (wet) { if (firstWet < 0) firstWet = a; lastWet = a; }
    }
    // how far along the course one sample is, which is the distance the
    // ripple runs down a pool
    const row = tr.length / tr.n;
    for (let a = 0; a < count; a++) {
      const sm = tr.sm[i + a];
      const hw = Math.max(0.2, bankRadius(sm) - 0.04);
      // the first and last rows of a pool are its two ends, where the ground
      // the water is dug into comes up level with the surface: the water is
      // dipped a little there so that ground wins outright and the join reads
      // as a waterline instead of a seam. **The first and last rows that are
      // water**, and not the first and last of the run, for the same reason the
      // level is not the first of the run.
      const endDip = (a === firstWet || a === lastWet) ? 0.10 : 0;
      for (let c = 0; c < C; c++) {
        const t = c / (C - 1) * 2 - 1;
        laneVertex(sm, t * hw, v);
        const o = (a * C + c) * 3;
        pos[o] = v.x;
        pos[o + 1] = wy - endDip - (Math.abs(t) > 0.99 ? 0.06 : 0);
        pos[o + 2] = v.z;
        // deeper towards the middle, and a little sky reflected at the edge
        _c.copy(PAL.waterA).lerp(PAL.waterB, Math.pow(Math.abs(t), 2.2));
        _c.lerp(PAL.waterB, 0.18 * vnoise(sm.x * 0.5, t * 3));
        col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
        // The ripple is sampled in the pool's own frame: across it is `t`, and
        // down it is the distance along the course, both of which are already
        // to hand. The surface animation rewrites positions every frame and
        // never touches this, so the ripple rides the swell instead of
        // sliding off it.
        uv[(a * C + c) * 2] = t * (hw / WATER_TILE);
        uv[(a * C + c) * 2 + 1] = ((i + a) * row) / WATER_TILE;
      }
    }
    for (let a = 0; a < count - 1; a++) {
      // and a quad is only a quad if the water is on both of its rows
      if (!under[a] || !under[a + 1]) continue;
      for (let c = 0; c < C - 1; c++) {
        const v0 = a * C + c, v1 = a * C + c + 1, v2 = (a + 1) * C + c, v3 = (a + 1) * C + c + 1;
        idx.push(v0, v1, v2, v1, v3, v2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.base = pos.slice(0);
    // **A material of this pool's own**, so the reflections row can hang this
    // pool's own cube probe off it - see `poolWaterMat()`. One draw call either
    // way, and the ripple drift is a shared uniform so the pools still move as
    // one body of water. Registered so `dropCourse()` can give it back: it is
    // the course's, and nothing else in the county owns it.
    const wm = poolWaterMat();
    courseWaterMats.push(wm);
    const m = new THREE.Mesh(g, wm);
    m.renderOrder = 3;
    m.frustumCulled = false;
    // **Where this pool's probe stands**: half a metre above the middle of the
    // surface, so the cube camera is out of the water it is reflecting and as far
    // from the bank as the pool allows - a probe sitting on the surface reflects
    // the floor it is half in.
    // `computeBoundingSphere()` writes the sphere onto the geometry and returns
    // nothing, which is worth knowing before it costs an afternoon
    g.computeBoundingSphere();
    m.userData.probeAt = g.boundingSphere.center.clone();
    m.userData.probeAt.y = wy + 0.5;
    group.add(m);
    meshes.push(m);
    i = j + 1;
  }
  group.userData.meshes = meshes;
  return group;
}

/** The countryside either side of the lane, following it round the corners. */
/** How far either side of a sample the true radius is measured over, and how far
 *  the tightest one within `gfxBendReach()` of it counts for the whole neighbourhood
 *  - in samples, and **the two are not the same number and the reason is the
 *  whole of this pair of constants.**
 *
 * The **basis is four**, three metres, and it is four for a reason that took the
 * measurement to see. A radius read over a long chord is a radius *averaged* over
 * it, and a corner shorter than the chord is washed out by the straight road
 * either side of it: measured over sixteen samples the tightest radius on Lily
 * Deep reads 124 where the course's own tightest step is 62, and on Grand
 * Marathon 28 where it is eighteen. A cap computed from a corner it cannot see
 * is exactly the cap that lets the fold through, and the fold is what a notch in
 * a meadow's outline is.
 *
 * It was sixteen, and the note beside it claimed a *narrow* basis was the
 * dangerous one - four samples reported a five-metre radius on a course whose
 * tightest corner was eighteen, and it would "pinch the whole country in". That
 * was true of the narrow basis **with a twelve-metre reach**, where a single
 * wobbly sample's radius was the whole of the neighbourhood's evidence. With the
 * reach at the offset's own width the argument inverts: the reach is what
 * gathers the evidence, and the basis only has to resolve one corner. A wiggle
 * that reports too small a radius now costs a strip of meadow, and a corner that
 * reports too large one costs the fold - and only one of those can be seen.
 *
 * The **reach is the ground edge**, and that is the number that was wrong by an
 * order of magnitude. It was sixteen as well, twelve metres, on the reasoning
 * that "the scale a wedge of a corner is actually about" - and the reasoning is
 * about the *corner*, not about the *offset*. A ground row is the lane's path
 * pushed out sideways by its own distance, so a row a hundred and twenty metres
 * out is being pushed past a hundred and twenty metres of lane: **every bit of
 * curvature within a hundred and twenty metres of it can fold it**, and a window
 * that only looks twelve metres either side cannot see the corner thirty metres
 * round. So the cap was computed correctly from the corners beside the sample
 * and the row folded on the ones it could not see, and the two cancelled: the
 * edge went out at seventy-one metres through the middle of a corner whose
 * radius was forty, wrapped through its own centre, and the meadow's outline
 * came back on itself as a notch.
 *
 * The reach is the offset's own width, worked out from it rather than written
 * beside it, so the two cannot fall out of step a second time.
 */
/** How far out the ground is drawn to, and how many rows the country between the
 *  verge and it is packed on.
 *
 * **A hundred and twenty is where the backdrop's hills are, and that is a real
 * number, not a taste.** The near hills stand a hundred and five to a hundred and
 * forty-five metres out with radii of twenty-six to forty-four, so the ground has
 * to finish *about where they stand* - in front of the far ones, and inside the
 * near ones, which is the only position where a hill rises out of a meadow
 * rather than sitting behind one or being buried under it. It is the number the
 * whole of the far-country work was tuned at, and it is what the draw-distance
 * row's middle step asks for, so the default is the tuned figure and the other
 * five steps move off it rather than the middle step being a compromise.
 *
 * It was **two hundred and sixty-eight**, on the reasoning that a country
 * sampled coarsely to a long way is a country that looks folded. It is: a ribbon
 * drawn to two hundred and sixty-eight is five hundred and thirty-six metres of
 * meadow, it swallows the near hills whole - their centres are a hundred and
 * forty out and they are eight to fifteen tall, so under a ground that has
 * climbed to meet them they are a wrinkle - and what is left is a green plateau
 * with a straight cut edge and sky underneath it. Wider is not further away.
 *
 * **Which is also why the low steps have to be careful.** A ground edge that stops
 * inside the near hills is fine - the fog closes over it first, at a hundred and
 * thirty metres of the hundred-and-thirty-metre fog - but a ground edge that stops
 * in open country is a straight cut with sky underneath it, and that is the shape
 * the whole paragraph above exists to avoid. So the fog ladder and the edge ladder
 * are one setting and not two, and the low steps pull the fog in to meet the edge
 * rather than trusting the edge to hide.
 *
 * The rows between the verge and it are packed on a **ratio worked out per
 * sample** so that the last of them lands exactly on the edge: a fixed ratio
 * multiplied out from a verge that moves leaves the outermost row at a hundred and
 * twenty-six here and a hundred and seventy there, so the country under it
 * is sampled at two different rates and the silhouette is two different shapes.
 */

/** The two sample counts the bend radius is read over, and they are not the same
 *  number. */
const BEND_BASIS = 4;
const gfxBendReach = () => Math.round(gfxEdge() / STEP);
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
/** How close to the centre of a bend the ground on its inside may be drawn, as
 *  a fraction of the radius, and the floor on that in metres. Just short of the
 *  radius is the cusp; a tenth short is a ribbon that is narrow on the inside
 *  of a tight corner and does not come back on itself. */
const NEST_FRACTION = 0.9;
const NEST = 12;
/** How many rows the country between the verge and the edge is packed on, read
 * through `gfxWideRows()`: a fixed count *per build*, because the ground mesh is
 *  laid on one row stride for the whole course and a sample with a different
 *  number of rows than its neighbour quietly writes over the end of the vertex
 *  array. It scales with the reach so the far-field row spacing stays roughly
 *  constant as the draw distance changes, and it is ten at the middle step, which
 *  is what the far-country work below was tuned at. */
/** How far of the way from the height a course starts at to the height it ends
 *  at its outer edge sits. A third: enough that the edge is plainly lower than
 *  the road on a climbing course, little enough that the country is still the
 *  same country and not a plain. */
const EDGE_THIRD = 1 / 3;
function groundColumns(sm) {
  // The rows hug the shoreline where there is water, and follow the verge
  // where the lane is cut into a slope, so neither the bank nor the face is
  // smeared across a coarse quad. Out past the verge the rows are packed
  // closer together too, or the open country breaks into big flat wedges
  // where the hillside is sampled more coarsely than it varies.
  const br = bankRadius(sm);
  const band = vergeBand(sm);
  const a = Math.max(band + 0.8, br);
  // And the half-dozen rows **inside** the verge are packed on a ratio rather
  // than spread evenly, because the verge is where the ground is steep and the
  // rows either side of it are not. Five rows one metre apart across a face that
  // drops three metres in the first metre is one long triangle where the face
  // of a cliff should be; five rows on a ratio put three of them inside the
  // first metre and get the shape of the lip, whatever the lip's height happens
  // to be. It is also why the ground beside a leap looks like a hillside and
  // not like a plane with a road glued to it.
  const e = Math.max(0.5, band - sm.w), near = [];
  for (let k = 0.06; k < 0.95; k *= 1.9) near.push(sm.w + e * k);
  // **And the far field is denser than it was, and runs further out.** Ten rows
  // between the verge and a hundred and twenty metres put the last of them
  // fifteen metres apart, and a taper spread over five rows of fifteen metres is
  // not a taper - it is four flat shelves with a crease between each, and the
  // outermost one is a straight line two hundred metres long, which from a high
  // camera is a silhouette of a straight line against the sky. That is the
  // shape the ground was being read as having: a curled-in edge, when what it
  // is is a coarse one.
  //
  // So the far rows are packed down - `gfxWideRows()` of them on a ratio, ten at
  // the middle draw distance and as many as two dozen at the top one, which puts
  // the outermost row fourteen to twenty-four metres out. An earlier note here
  // claimed "about seven metres, carried out to two hundred and sixty"; neither
  // half of that has been true since the edge came back to a hundred and twenty,
  // and leaving it would have read as the authority for the derivation above.
  // The extra rows are the whole of the cost and it is the cheapest fix here:
  // nothing about the height field changes, only how finely it is sampled.
  // **And the country out past the verge is packed the same way the verge is**,
  // on a ratio, over a band a good deal wider - which is the whole of what makes
  // the ground the tower stands on flat rather than merely level. The verge rows
  // are packed densely because the ground is steep there; the same argument
  // applies further out with less force, and the ground between the lane and the
  // tower is the one stretch of a course that is both: flat enough to build on,
  // and a long way from the lane. Sampled coarsely - four rows between six and
  // twenty-eight metres - it is a straight line between two of them where the
  // profile is still curving, so the drawn ground and the profile it is standing
  // on differ by most of a metre, and the tower sits on whichever of the two
  // its own depth was asked about. Packing it costs nothing but vertices and
  // makes the two the same thing.
  //
  // **A fixed number of rows, and always increasing**, and both matter. The rows
  // next to the verge are offsets of the lane and the rows out in the country
  // are offsets too, so a deep cutting puts its own verge past thirteen metres
  // and collides with the row at thirteen - a column list that goes backwards
  // is a quad with its ends the wrong way round. And the count must not vary
  // from one sample to the next, because `buildGround()` lays the mesh on a
  // single row stride: a sample with fewer rows than the one before it repeats
  // the previous row's tail, and a sample with more writes off the end of the
  // vertex array. Both are silent. So the rows are built to a length and then
  // nudged into order, rather than filtered into it - a filter changes the
  // length, which is the thing that cannot be allowed to change.
  const w0 = Math.max(a + 6, 12.5);
  const WIDE = gfxWideRows();
  /** The far field: `WIDE` rows from just past the verge out to `to`,
   *  packed on a ratio worked out so that the last of them is *exactly* `to`. */
  const far = (to) => {
    const r = Math.pow(to / w0, 1 / WIDE), rows = [];
    for (let i = 1; i <= WIDE; i++) rows.push(w0 * Math.pow(r, i));
    return rows;
  };
  const head = [0, sm.w * 0.99, ...near, band, lerp(band, a, 0.5), a, a + 1.1, a + 2.4, a + 4, a + 6];

  // **The far field is the same on both sides**, and `groundEdge()` is what says
  // how far out that is - the tightest bend in reach, held on *both* sides, and
  // the ground edge beyond it. It is the *same* function the height eases out to,
  // so the outermost row and the end of the ease cannot fall out of step about
  // where the edge is, and it takes no side at all, so the two halves of the
  // ribbon are the same shape and the outline cannot step from one to the other.
  //
  // And it is **rebuilt** to the cap rather than trimmed to it. The old way took
  // every row past the radius and *put it at* the radius, so a tight bend put
  // four rows on one offset and no country at all beyond it: one side of a corner
  // a hundred and fifty metres of meadow and the other side five hundred, and
  // since a course's bends change sign, so did the wide side. That is the whole
  // of "the grass stretches out far too wide, but sometimes only partially" - not
  // one ribbon of one width, but a lawn that changes its mind about how far it
  // goes from one corner to the next. Rebuilt on the same count and the same
  // ratio, the two sides differ by the spacing of a few rows and every row is
  // still its own row. A course so tight that even the verge would fold has
  // nowhere to put its ground, and the floor on the cap is `w0 * 1.35`: out past
  // the verge, well past `NEST`, because a far field squeezed into twelve metres
  // is a crease.
  const one = (sign) => [
    ...head.map((q) => sign * q),
    ...far(groundEdge(sm)).map((q) => sign * q),
  ];
  const pos = one(1);
  // and the other side, which `one(-1)` has already signed, so it is only
  // reversed to run from the far edge in to the verge
  const out = one(-1).slice(1).reverse().concat(pos)
    .map((q, i, all) => (i && q <= all[i - 1] ? all[i - 1] + 0.05 : q));
  return out;
}

/**
 * The height of the ground **as it is drawn**, which is not the same question as
 * `groundYAt()` and the difference between the two is the whole of a flower
 * standing in mid-air.
 *
 * A course surface is a polyline. `groundColumns()` says where the rows are and
 * `buildGround()` puts a vertex at each of them with the height `groundYAt()`
 * gives there, so between two columns the ground the player can see is a straight
 * line joining the two - while `groundYAt()` itself is an analytic profile that
 * carries on curving through the gap. A prop placed by `scatter()` is placed at
 * whatever `d` its own draw happened to land on, which is almost never a column,
 * so on the inner half of the mesh the two agree to a millimetre and on the outer
 * half they can be a **metre** apart: out past the verge the columns are at
 * `a + 6, 14, 18.5, 24` and the ground falls away fast across a wall's shoulder,
 * so the straight line between two of them sits well above the curve.
 *
 * Which is a flower in the air over the top of a ramp, and it is why the same
 * scatter is correct on the meadow - where the columns are a metre apart and the
 * curve is shallow - and wrong on every ramp and lip on the course.
 *
 * So this asks the question the mesh asks: bracket `d` between the two columns
 * either side of it and take the height off the line between them. One entry of
 * cache, because a scatter walks the samples in order and asks about the same row
 * many times running.
 */
/** How wide the drawn ground is on the narrow side of a sample, and it is
 *  **the narrower of the two**, because the ribbon is held to one width on both
 *  sides and a piece on the wide side of a narrow sample is a piece on air.
 *  Shared with the placement below through the same column cache `groundDrawnAt`
 *  uses, so a scatter that walks the samples in order builds the list once. */
function groundHalfAt(sm) {
  if (_colFor !== sm) { _colFor = sm; _colCache = groundColumns(sm); }
  const cols = _colCache;
  return Math.min(-cols[0], cols[cols.length - 1]);
}
let _colFor = null, _colCache = null;
function groundDrawnAt(sm, d) {
  if (_colFor !== sm) { _colFor = sm; _colCache = groundColumns(sm); }
  const cols = _colCache;
  if (d <= cols[0] || d >= cols[cols.length - 1]) return groundYAt(sm, d);
  for (let i = 1; i < cols.length; i++) {
    if (d <= cols[i]) {
      const a = cols[i - 1], b = cols[i];
      return lerp(groundYAt(sm, a), groundYAt(sm, b), (d - a) / (b - a));
    }
  }
  return groundYAt(sm, d);
}

/** How many rows the ground has across, and it is **asked of `groundColumns()`
 *  rather than written down here** - which is the whole of why it is here. It
 *  was a constant of forty-five and the row list grew to fifty-nine, and a
 *  typed array written past its end does not complain: the vertices past the
 *  end are simply dropped, with no error and no console line, and what that
 *  looks like is a course with a hole in it. The ground lost everything from
 *  eighty-eight metres out on **both** sides at once and read as a green wedge
 *  floating in front of the backdrop.
 *
 *  A number that has to be kept in step with a list by hand is a number that
 *  will not be, so this one is derived from the list every time a course is
 *  built. The rows are laid out symmetrically, so the count is the same for
 *  every sample and the first will do.
 */
function buildGround(tr) {
  const C = groundColumns(tr.sm[0]).length;
  // **The rows are `roadRows()` and not the samples**, and this is the third
  // surface that takes them — ribbon, flank and ground are one surface with three
  // names for where it is drawn from, and a ground laid on the samples beside a
  // ribbon laid on packed rows is a straight line between two samples drawn next
  // to a wall. A crate's notch is where it shows: the ground eases down over three
  // quarters of a metre and puts a hillside over the bottom two thirds of a hole
  // the ribbon has just cut eighty-four degrees deep.
  const rows = roadRows(tr), R = rows.length;
  const pos = new Float32Array(R * C * 3), col = new Float32Array(R * C * 3);
  // How much of each of the county's other two surfaces this vertex is standing
  // in, 0 to 1: `bare` is the `rim` the stone colour is laid on with, `shore`
  // is the `smoothstep` the sand is laid on with, and `trodden` is the stone
  // again where a snail could be put down on it. All three are kept because the
  // material split below has to happen on the same numbers the colour did, and a
  // per-quad average of the four corners is the only place a quad and a vertex
  // can be asked the same question.
  const bare = new Float32Array(R * C);
  const shore = new Float32Array(R * C);
  const trodden = new Float32Array(R * C);
  // and the three weights the shader blends the three sets by, which are the
  // same three numbers written out for the geometry rather than asked of it a
  // quad at a time
  const wgt = new Float32Array(R * C * 3);
  // **How much of the track's sand edge this stretch of course is wearing**, which
  // is `1 - rampShare()` — the same number the flank's own maps are cross-faded
  // by, read here for the band the flank fades into. It is a second caller of
  // `rampShare()` on purpose: the sand on the ground and the sand on the flank
  // are one material in two places, and a band that ended where the face began
  // would be the seam this whole change is about. **Read between the samples**, for
  // the packed rows' sake, exactly as the ribbon and the flank read it.
  const rock = rampShare(tr);
  const fr = newFrame();
  const v = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    const sm = rowFrame(tr, row, fr);
    const sandShare = 1 - rampShareAt(rock, row.s);
    const cols = groundColumns(sm);
    // Once a row, because both of these are asked of the same sample over and
    // over and neither of them is cheap: a face is stone, and it is stone *all
    // the way*, which is the whole difference between a fringe round the meadow
    // and a surface of its own.
    const face = isFace(sm);
    const rocky = sm.rock || face;
    for (let c = 0; c < C; c++) {
      const d = cols[c];
      laneVertex(sm, d, v);
      const o = (i * C + c) * 3;
      const gy = groundYAt(sm, d);
      pos[o] = v.x; pos[o + 1] = gy; pos[o + 2] = v.z;
      const ad = Math.abs(d);
      // grass, drier on the high ground
      const patch = fbm(sm.x * 0.021, (sm.z + d) * 0.021, 2);
      const fine = vnoise(sm.x * 0.09, (sm.z + d) * 0.09);
      _c.copy(PAL.grassA).lerp(PAL.grassB, clamp(patch * 0.6 + fine * 0.25, 0, 1));
      _c.lerp(PAL.deep, smoothstep(0.6, 0.95, patch) * 0.45);
      _c.lerp(PAL.dry, smoothstep(0.4, 2.8, gy - sm.ground) * 0.55);
      // **The sand of the track's edge, spread out into the bank.**
      //
      // This branch used to hold a ring of `dirtEdge` laid on with a `smoothstep`
      // running a metre and a two out from the lane, which put a soft band of
      // trodden earth round every course *inside* the ribbon's own painted line -
      // and the join between the track and the meadow was therefore two gradients
      // stacked, so the one thing that ought to be a cut was a fade.
      //
      // The cut is now the paint, four rows of ribbon in `buildRoad()`, and this
      // is the one band that is left: the **flank** is sand (`buildSkirt()`), and
      // sand does not meet a grass bank by stopping. It is raked out into it and
      // thins, so what lies on the ground here is a continuation of the flank
      // rather than a second thing, and it is the same `PAL.sand` and the same
      // share the flank uses, so it thins to nothing over exactly the same metre
      // and a half the flank's rock takes to arrive.
      //
      // It is **not** the old ring. That one was a stain in a colour nothing else
      // in the county wears, and it started under the paint; this one is the
      // colour of the surface immediately above it, it begins at the flank's
      // outer edge rather than the lane's, and it ends in the meadow.
      if (sandShare > 0.002) {
        // measured from the **flank's** outer edge and not the lane's, so the two
        // surfaces meet at full strength instead of the band peaking somewhere
        // underneath the flank where nothing can see it
        const out = smoothstep(sm.w + 1.5, sm.w + 0.5, ad);
        const edge = out * sandShare;
        // **and it goes into the shore bucket, not only into the colour.** The shore
        // is the sand set, and a band that laid sand on the vertex and left the
        // weight on the turf is a metre of beach wearing the meadow's grain, which
        // is a join as visible as the one the paint just cut: `grass-albedo` at
        // 1.20 and `sand-albedo` at 1.35 are different greens from different
        // maps, and they change across a weight that did not move. Colour and
        // weight off the same number is the rule this whole mesh is built on.
        const k = i * C + c;
        if (edge > shore[k]) shore[k] = edge;
        _c.lerp(PAL.sand, edge * 0.92);
        // and the grit in it, the shore's own terms, because this is the shore's
        // material in the shore's place and half of it is the grain
        const g = vnoise(sm.x * 0.8, (sm.z + d) * 0.8);
        _c.lerp(PAL.earthDeep, Math.max(0, g - 0.42) * 0.8 * out);
        _c.lerp(PAL.dirtLight, Math.max(0, 0.34 - g) * 0.7 * out);
      }
      const br = bankRadius(sm);
      if (br > 0.05) {
        // The shore: dry sand up the bank, wet sand and mud right at the
        // waterline, and the bed showing through where it is shallow. It is a
        // band rather than a line, and it is mottled, or the water reads as
        // having been laid on the grass. The band is wide: the sand runs a
        // good way out past the water before the meadow takes it back.
        const dry = smoothstep(br + POOL_BERM + 2.2, br - 0.2, ad) * 0.92;
        // `max` and not `=`: a pool's own sand band and the track's edge band can
        // overlap on a course that has both, and whichever asked for more of the
        // shore is the one that is standing there.
        shore[i * C + c] = Math.max(shore[i * C + c], dry);
        _c.lerp(PAL.sand, dry);
        _c.lerp(PAL.earthDeep, smoothstep(br + 0.2, br - 1.2, ad) * 0.55);
        const grit = vnoise(sm.x * 0.8, (sm.z + d) * 0.8);
        _c.lerp(PAL.earthDeep, Math.max(0, grit - 0.42) * 0.8);
        _c.lerp(PAL.dirtLight, Math.max(0, 0.34 - grit) * 0.7);
        _c.multiplyScalar(0.9 + 0.2 * fbm((sm.x + d) * 0.05, (sm.z + d) * 0.05, 2));
      }
      // And the floor of a hole is broken stone rather than meadow - sampled in
      // world space, so the bedding runs along the floor as well as across it,
      // and a good deal darker the further down the walls you are, because the
      // bottom of a hole has to read as a bottom and not as a strip of the
      // surface let down.
      //
      // A **face** is stone for the same reason, and it is the same block: the
      // bed and the flank both stop at FACE_SLOPE, so on a face this is the only
      // thing there is. Without it the front of the lip of a leapClimb was sand
      // where the road had just been, which is a bank with a hole cut in it.
      //
      // It is **laid over** the meadow and not instead of it, because the row is
      // two hundred and forty metres wide. Colouring a whole sample stone put
      // the broken rock of a chasm out to the horizon on both sides of Skydrift
      // and turned a two-metre hole in the county into a moor of it.
      if (rocky) {
        const wx = sm.x + sm.right.x * d, wz = sm.z + sm.right.z * d;
        const depth = clamp((sm.y - gy) / 1.2, 0, 1);
        // The stone does not begin at a constant distance from the middle of the
        // lane, and this is the line in the county that says so. The fade is
        // **pushed in and out in world space** by two octaves, so the break in
        // the turf wanders across the hillside instead of running dead parallel to
        // the course for the whole of it: a smoothstep on distance alone is an
        // **offset curve of the lane**, and an offset curve of a straight lane is
        // a ruled line - which is what the turf-to-stone edge looked like from the
        // air. Both edges of the smoothstep move together, so the band stays nine
        // metres wide and it is the *place* that moves, not the softness.
        //
        // Damped to nothing on a **face**, and that is the one place it has to
        // be: on a face the stone is not a fringe round the edge of the meadow,
        // it is the surface, and a boundary that wandered across it would leave
        // turf hanging on a cliff.
        const wob = ((fbm(wx * 0.055, wz * 0.055, 3) - 0.5) * 7.0
          + (fbm(wx * 0.16, wz * 0.16, 2) - 0.5) * 2.4
          + (fbm(wx * 0.42, wz * 0.42, 2) - 0.5) * 0.9) * (face ? 0.12 : 1);
        const rim = 1 - smoothstep(sm.w + 2.0 + wob, sm.w + 11 + wob, ad);
        bare[i * C + c] = rim;
        if (rim > 0.004) {
          _s.copy(PAL.stoneA).lerp(PAL.stoneB, 0.18 + 0.62 * fbm(wx * 0.17, wz * 0.17, 2));
          // broken slabs, and bedding across them
          _s.multiplyScalar(0.80 + 0.34 * vnoise(wx * 0.95, wz * 0.95));
          _s.lerp(PAL.stoneB, Math.max(0, vnoise(wx * 0.5 + 4, wz * 0.5) - 0.4) * 1.5);
          // and the odd patch of grit and shadow in the cracks
          _s.lerp(PAL.earthDeep, Math.max(0, 0.44 - fbm(wx * 0.4, wz * 0.4, 2)) * 0.85);
          _s.lerp(PAL.earthDeep, depth * 0.4);
          _c.lerp(_s, rim * 0.95);

          // **A snail can walk a good deal of this rock, and the top of a wall is
          // meant to be a terrace and not a shelf of stone.** The top of a `climb`
          // stands at the full height of the wall it is, so there is a wide flat
          // shoulder either side of the lane at the top of it - and that was drawn
          // as stone, which made the one surface on a climbing course a snail
          // spends real time on read as the same cliff it is climbing.
          //
          // So the walkable part is **sand**, laid over the stone and not instead
          // of it, on the same `rim` that decides the stone, so the colour and the
          // material change together the way every other join on this mesh does. It
          // goes into the **existing** sand bucket and not a fourth group: sand is
          // one material here however it got there, and a terrace is the same sand
          // a pool has round it.
          //
          // **What decides walkable is the ground's own cross-slope here**, and it
          // used to be `isFace(sm)` and that was the whole of the straight line
          // across the terrace. `isFace` is a **per-row** answer - it is hoisted out
          // of the inner loop because it only asks about the *lane's* grade - and
          // the lane's grade says nothing whatever about where the ground turns
          // across a row that is two hundred and forty metres wide. So the sand/rock
          // line was drawn at whatever lateral position one number for the whole row
          // implied, which is a line running dead parallel to the road and is what
          // the photograph is of. The drawn ground's own fall over a column and a
          // half either side is the right question, and it has the other property
          // that matters: it varies **continuously** with `d`, so the boundary lands
          // on the real turn in the ground and follows it round.
          //
          // 0.55 is a rise over run of about twenty-nine degrees, and it is set by
          // the two slopes it has to tell apart rather than by taste: a terrace
          // beside a wall falls away at under a tenth, and the face below it stands
          // at the fifty-eight the cliff is drawn at. There is nothing in the county
          // between those two to get wrong.
          const fall = (groundDrawnAt(sm, d + 1.6) - groundDrawnAt(sm, d - 1.6)) / 3.2;
          const trod = Math.abs(fall) < 0.55 ? rim : 0;
          trodden[i * C + c] = trod;
          if (trod > 0.004) {
            _s.copy(PAL.sand).lerp(PAL.dirtLight, 0.12 + 0.34 * fbm(wx * 0.19, wz * 0.19, 2));
            _s.multiplyScalar(0.88 + 0.26 * vnoise(wx * 0.8, wz * 0.8));
            _s.lerp(PAL.earthDeep, Math.max(0, 0.42 - fbm(wx * 0.36, wz * 0.36, 2)) * 0.7);
            _c.lerp(_s, trod * 0.95);
          }
        }
      }
      _c.multiplyScalar(0.84 + 0.3 * vnoise(sm.x * 0.42, (sm.z + d) * 0.42));
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      // The `detailW` the shader cross-fades on, written here beside the colour
      // it belongs to because **it is the same three numbers**: the turf's share
      // is what is left of the fade the colour was laid on with, the rock's is
      // `rim`, and the sand's is the shore's band *or* the walkable terrace —
      // whichever asks for more of it, because a terrace at a pool's edge is both
      // and it is sand either way.
      //
      // They sum to one, and where they would not the largest two are scaled down
      // to fit rather than the third being pushed below zero, because a negative
      // weight is not "no share of that set" — it is the *other* end of the blend
      // and the shader would take it as such.
      const q = o / 3;
      let wr = bare[i * C + c], ws = Math.max(shore[i * C + c], trodden[i * C + c]);
      const tot = wr + ws;
      if (tot > 1) { wr /= tot; ws /= tot; }
      wgt[q * 3] = 1 - wr - ws;
      wgt[q * 3 + 1] = wr;
      wgt[q * 3 + 2] = ws;
    }
  }
  // **One index list and one material, where this was three groups and three.**
  //
  // The three buckets were turf for the meadow, cliff for the bare rock of a hole
  // and the face of a leap, and sand for the shore round a pool, each split on the
  // halfway point of the same fade its colour was laid on with. That was right
  // about the colour and it could not be right about the **material**, and the
  // reason is now written into `triplanarSets()`: a material boundary is a row of
  // pixels where the maps change, and no fade of the vertex colour can take that
  // row out. So the split is gone and the three numbers the split was asking for
  // are the weights instead, and the shader blends the three sets by them.
  //
  // So the turf-to-stone edge is now the width of a **quad** and a gradient across
  // it, out on the open country where a quad is two to six metres, and the same
  // edge close in beside the lane where the rows are a metre apart is a metre of
  // gradient. That is as fine as this mesh can make it, and it is a blend and not
  // a seam at every width.
  //
  // The `wob` above is what actually decides *where* the edge is, and the jitter
  // that used to break it up is gone: a dither is a way of softening a step by
  // making it messy, and there is no step left to soften. Two notes on what that
  // loses. The dither used to let stone and turf **interleave** in patches, which
  // is how broken ground goes over; a weight cannot interleave, it can only fade,
  // and the fading is across one quad rather than across several. And the
  // halfway-point rule is now the rule for the *weight* rather than for the
  // material, which means the stone and the turf are each at half in the middle of
  // the band instead of one of them being wholly in charge of the quad - which is
  // the point.
  //
  // The vertices are shared as they always were, so `computeVertexNormals()`
  // still gives the whole surface one set of normals.
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let c = 0; c < C - 1; c++) {
      const a = i * C + c, b = a + 1, cc = (i + 1) * C + c, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(wgt, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.course);
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}
/* ------------------------------------------------------------------ *
 * Scenery, scattered along the lane
 * ------------------------------------------------------------------ */
/**
 * Where the half-way mark goes.
 *
 * The middle of a race is the middle of the **raced** span - the grid to the
 * finish - and not the middle of the course's plan, because a plan's `x` is not
 * its arc length: by the half-way the lane has been round a good many corners
 * and through whatever the features put in it. So the mark starts at
 * `(START_S + finish) / 2` exactly, which is the right answer whenever it is
 * usable.
 *
 * And quite often it is not, because the middle of a course is quite often the
 * middle of a pool, and a line laid across two metres of water is not a line
 * anybody sees. So it walks outward to the nearest stretch of dry plain lane,
 * within a fifth of the race, which is far enough to always find one and near
 * enough that the mark is still the half-way. A wall will do as a second
 * answer, because a line on a ramp is a line and a line in a chasm is not.
 *
 * The tower goes wherever the mark went. A tower and a line that disagree about
 * where the half-way is would be worse than having neither.
 *
 * **And the ground has to be there.** Dry lane is a question about the road; a
 * tower is a seventeen-metre building on a nine-metre footprint standing fifteen
 * metres off it, and it needs two things the lane beside it says nothing about.
 * Its ground has to be **level across that footprint**, or the tower shows a
 * metre of its own base above the grass on the downhill side and is buried to
 * the first course on the other. And the lane beside it must not be **perched**:
 * a lane standing well above the country is a lane on the lip of a drop, and the
 * ground fifteen metres out from under it is the bottom of a face - which on
 * Crag Ascent is a tower at the bottom of a three-metre step, which is not a
 * flat site whatever the arithmetic half-way says about it.
 *
 * So the walk outward asks for those first and settles for the road's own
 * dryness only if it cannot have them, which is the same order the two tests
 * already had: the best answer that is still the half-way, and an answer at worst
 * a whole clear stretch away. A course that is all cliff gets the road's answer,
 * because a tower is better than no tower.
 */
/** How much clear ground the middle of a course is promised either side of the
 *  road as well as under the tower, and the floor on the whole claim. */
const MID_CLEAR = 16;
const TOWER_FOOT = 4.5;        // the tower's own radius, for the ground it stands on
const MID_FLAT = 1.0;          // metres of fall across that footprint, at the most
const MID_PERCH = 1.6;         // metres the lane may stand above the country
const midwayOf = (tr) => {
  // **And a shove run is not clear, however plain it looks.** The three and a
  // half metres of ordinary `RUN` lane in front of a crate hole - the road a
  // snail walks up before it puts its hands on its own crate - are exactly the
  // sort of stretch this function is looking for: flat, dry, wide, and `RUN`.
  // Nothing in the sample says a crate, because the samples *are* footpath, and
  // the eight crates are placed after the tower rather than scattered and so
  // nothing else knows they are there. So the run is asked about directly, and
  // it is `tr.leaps` and not the conditions because the condition is exactly
  // what is lying.
  const shoving = (s) => tr.leaps.some((lp) => lp.crate
    && s > lp.crate.startS - CRATE_GAP - 0.5 && s < lp.s0);
  // **The middle of the clearest stretch of the course.** Not the arithmetic
  // middle, and not the middle of the clear band either - the band is laid down
  // in the plan's own `x`, and converting that to a place on the track means
  // comparing a design coordinate against a sample's, and a sample's `x` is the
  // design `x` re-sampled along the curve rather than the arc distance the
  // checkpoint is placed in. The two drift, and the drift is not a rounding
  // error: on Lily Deep the band claims to begin seven metres before the second
  // pool ends, and its centre lands eleven metres short of the middle of the gap
  // it was cut for.
  //
  // So it is found on the track, in the space the checkpoint is actually placed
  // in: **the widest run of plain lane on the course, and the centre of that.**
  // The band the plan reserves is by a long way the widest clear stretch there
  // is - it is the only one built to be that wide - so the rule finds it, and
  // it finds it in the units it is going to be used in. Nothing has to convert
  // between the planner's coordinates and the track's, because the only
  // coordinate involved is the track's own.
  //
  // **and never past the finish line, which is the whole of what was wrong with
  // it.** The samples carry on beyond `finish` into the run-out the finishing
  // camera stands in, and the run-out is a long flat straight lane with nothing
  // in it at all - so on a water course it is the widest clear stretch there is.
  // Lily Deep's is twenty-four point eight metres against the band's twenty-one,
  // it won, `want` clamped itself to `tr.finish`, and the tower and the half-way
  // line were both built on the line. A stretch of lane the race never covers is
  // not a candidate for its own half-way mark however clear it happens to be.
  const i0 = clamp(Math.ceil(START_S / STEP), 0, tr.n);
  const i1 = clamp(Math.floor(tr.finish / STEP), 0, tr.n);
  const midS = (START_S + tr.finish) / 2;
  // the stretch the site search below is allowed to move inside, which is the
  // clear run itself where there was one and the whole race where there was not
  let want = midS, winLo = START_S, winHi = tr.finish;
  {
    const clear = (sm) => sm.water === null && !sm.rock && sm.cond === RUN && !shoving(sm.s);
    let best = null, runStart = -1;
    for (let i = i0; i <= i1 + 1; i++) {
      const ok = i <= i1 && clear(tr.sm[i]);
      if (ok && runStart < 0) runStart = i;
      if (!ok && runStart >= 0) {
        // the run closes on `finish` and not on the sample after it, because the
        // samples are half a metre apart in `s` and the race can end inside one
        const s0 = runStart * STEP, s1 = Math.min(i * STEP, tr.finish), c = (s0 + s1) / 2;
        // **length against nearness, in metres**, so the one stretch built to be
        // wide wins without a narrow footpath at one end of the course able to
        // outscore it by being marginally longer
        const score = (s1 - s0) - 3 * Math.abs(c - midS);
        if (!best || score > best.score) best = { score, s0, s1 };
        runStart = -1;
      }
    }
    if (best) { want = (best.s0 + best.s1) / 2; winLo = best.s0; winHi = best.s1; }
  }
  const at = (s) => tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
  const plain = (sm) => sm.water === null && !sm.rock && sm.basin <= 0.05 && sm.cond === RUN && !shoving(sm.s);
  const dry = (sm) => sm.water === null && !sm.rock;
  // The site, asked of the **drawn** ground and not of the profile: fifteen
  // metres out is where the rows are four to seven metres apart, and the mesh is
  // a straight line between them where the profile is still curving, so what the
  // tower is actually standing on is the drawn one.
  //
  // And it is asked over the **whole footprint in two dimensions**, which is the
  // half that was missing. A building nine metres across on a hillside that
  // climbs along the course is not standing on one height: the ground under the
  // downhill end of it is a couple of metres below the ground under the uphill
  // end, and a test that walks out sideways at a single point measures a lawn
  // and says yes. That is how a tower ended up with three metres of its own
  // buttresses under the turf on a climbing course - the ground beside it was
  // flat in every direction the test looked and a slope in the one it did not.
  const fr = newFrame();
  const site = (s, sm) => {
    const c = sm.crown;
    let lo = Infinity, hi = -Infinity;
    for (let along = -TOWER_FOOT; along <= TOWER_FOOT; along += TOWER_FOOT) {
      trackAt(tr, s + along, fr);
      for (let d = c - TOWER_FOOT; d <= c + TOWER_FOOT; d += TOWER_FOOT / 2) {
        const y = groundDrawnAt(fr, -d);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return hi - lo <= MID_FLAT && Math.abs(fr.y - fr.ground) <= MID_PERCH;
  };
  const tries = [
    (s, sm) => site(s, sm) && plain(sm),
    (s, sm) => site(s, sm) && dry(sm),
    (s, sm) => plain(sm),
    (s, sm) => dry(sm),
  ];
  for (const ok of tries) {
    if (ok(want, at(want))) return want;
    for (let step = STEP; step <= winHi - winLo; step += STEP) {
      for (const s of [want + step, want - step]) {
        if (s < winLo || s > winHi) continue;
        const sm = at(s);
        if (ok(s, sm)) return s;
      }
    }
  }
  return want;
};
/**
 * The half-way, and it is two things: the tower in the middle of the sweep and
 * the line the lane runs under it.
 *
 * The tower is the only thing in the county that is **not scattered** - there
 * is one per course, it is put down by name, and everything about it is aimed.
 * It stands the sample's own **crown** out on the inside of the arc, which is
 * that crown's centre of curvature and so the one place on the course the lane
 * is genuinely going round, and it is turned to face the road. It is put on the
 * **drawn** ground and not on the analytic profile, for the reason
 * `groundDrawnAt()` exists: fifteen metres out past the lane the ground's rows
 * are four to seven metres apart and the mesh is a straight line between them
 * where the profile is still curving, so a tower placed on the profile hangs in
 * the air or sinks into the hill by most of a metre.
 *
 * The crown is the sample's and not the constant, because the plan cut the sweep
 * to whatever that point's drop could afford: a tower fifteen metres out on a
 * lane that was cut for a twenty-metre arc would be standing inside the arc's
 * own inside edge, which is not the centre of anything.
 */
/**
 * The ground the tower stands on, where there is not any.
 *
 * A tower eight metres across on a hillside that falls five metres across those
 * eight metres cannot sit level, and on a climbing course there is nowhere that
 * it can: every site within a quarter of the race of the middle is on the same
 * slope, because the whole of the course is on it. So it is set on the highest
 * ground under it - the only placement that is never buried - and whatever is
 * left underneath is a **knoll**: a hill of its own, with the tower on a terrace
 * at the top of it and the ground coming up to meet the knoll's foot.
 *
 * It is built as a hill rather than as a block because a block is the wrong
 * shape twice over. A drum of masonry five metres tall beside a building looks
 * like a wedding cake, and it is also the wrong *size*: the gap it fills is not
 * the same all the way round, because the ground under a hillside is not. So the
 * knoll is a ring of ground samples, each one placed at whatever height its own
 * piece of terrain asks for, and the total height is whatever the **lowest**
 * ground in the footprint needs it to be - which on a course with a gentler
 * middle is nothing at all, and then no knoll is built.
 *
 * The profile is the county's own wall profile turned on its side: a terrace at
 * the top, a **cliff** down from it standing at sixty degrees or better, and the
 * last of it easing out onto the turf. A cliff and not a slope, because a slope
 * is a thing you walk up and this is meant to read as the tower having been put
 * on the top of something that was already there.
 */
const knoll = (tr, s, sm, p) => {
  // The radii, and against them how far down the knoll has fallen at each as a
  // fraction of its own height. **This is the knoll's own profile and the
  // terrain never enters it** - the shape is a terrace, a cliff and a foot, and
  // it is the same shape whichever hill it is standing on. That is the whole of
  // the difference between a hill and a stain: sampled from the ground under
  // it, a knoll takes the ground's shape with a hill drawn on it, and on a
  // hillside that comes out as a flat sheet lying on the turf with the cliff
  // texture showing through the middle of it.
  //
  // The last ring is the **skirt**, and it goes *under* the ground rather than
  // onto it. Everywhere else the knoll is free to be proud of the terrain and
  // everywhere else it is free to be swallowed by it, which is what a hill does
  // and is also how anything is planted on a hillside without a seam showing
  // where its edge meets the turf.
  const RINGS = [
    { r: 0.0, t: 0.0 }, { r: 4.2, t: 0.0 }, { r: 4.8, t: 0.55 }, { r: 5.6, t: 0.82 },
    { r: 7.0, t: 0.93 }, { r: 8.6, t: 1.0 },
  ];
  const SKIRT = 1.0;
  const BURY = 2.2;
  const SIDES = 18;
  const fr = newFrame();
  // the ground under a world offset from the tower, asked in the lane's own
  // frame because that is the only place `groundDrawnAt()` can be asked
  const under = (ox, oz) => {
    const along = ox * sm.fwd.x + oz * sm.fwd.z;
    const side = ox * sm.right.x + oz * sm.right.z;
    trackAt(tr, s + along, fr);
    return groundDrawnAt(fr, side);
  };
  // how tall it has to be to be a hill at all: the deepest the ground comes up
  // against the knoll's **body**, which is the rings up to the foot. The skirt
  // is not counted, because the skirt is under the ground by definition.
  let need = 0;
  for (let j = 0; j < RINGS.length - 1; j++) {
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      const g = under(Math.sin(a) * RINGS[j].r, Math.cos(a) * RINGS[j].r);
      need = Math.max(need, p.y - g);
    }
  }
  if (need < 0.3) return null;
  const pos = [], col = [], wgt = [], idx = [];
  const cc = new THREE.Color();
  const pale = colour(C.limePale), dark = colour(C.limeShade), turf = colour(C.grassB);
  let prevY = null;
  for (let j = 0; j < RINGS.length; j++) {
    const ring = RINGS[j];
    for (let i = 0; i <= SIDES; i++) {
      const a = ((i % SIDES) / SIDES) * Math.PI * 2;
      const wob = 1 + 0.12 * vnoise(Math.cos(a) * 2.1, Math.sin(a) * 2.1);
      const r = ring.r * wob;
      const ox = Math.sin(a) * r, oz = Math.cos(a) * r;
      const g = under(ox, oz);
      // **the knoll's own profile**, and only its skirt is allowed to look at
      // the ground - and it looks at it to get *under* it
      const own = p.y - need * ring.t;
      const y = j === RINGS.length - 1 ? Math.min(own, g - BURY) : own;
      pos.push(p.x + ox, y, p.z + oz);
      // **grass where it is flat and rock where it stands up**, which is the
      // whole of what makes it read as a hill rather than as a stain: the same
      // `detailW` the course surface is built on, so the knoll takes the turf
      // and cliff sets out of the same shader and the same maps as the ground it
      // is standing on. The terrace and the foot are turf; the two rings across
      // the cliff are stone, and the blend is across the edge of the cliff
      // rather than up and down it, which is where a hill's grass stops.
      // and the skirt is turf where it is buried, so a seam never shows
      const cliff = j === RINGS.length - 1 ? 0
        : smoothstep(0.5, 0.72, ring.t) * (1 - smoothstep(0.86, 0.99, ring.t));
      wgt.push(1 - cliff, cliff, 0);
      cc.copy(turf).lerp(dark, cliff);
      cc.lerp(pale, cliff * 0.4);
      cc.multiplyScalar(0.9 + 0.18 * vnoise(a * 3.3, ring.t * 9.1));
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let j = 0; j < RINGS.length - 1; j++) {
    for (let i = 0; i < SIDES; i++) {
      const a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(new Float32Array(wgt), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the **course** material, not the rock one: the knoll is turf with a cliff
  // on it, and it is the same shader and the same maps as the ground round it
  const mesh = new THREE.Mesh(g, mat.course);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // and it stands in the register as well, or the birch comes up through it
  standIt(p.x, p.z, crowdOf(props['watchtower'], 1) + 3, props['watchtower']);
  return mesh;
};

function placeMidway(tr, grp) {
  const s = midwayOf(tr);
  const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
  // the line first, in the amber and white of the tower's own stone
  grp.add(gateGroup(tr, s, false, true));
  const geo = props['watchtower'];
  if (!geo) return s;
  const d = -sm.crown;
  const p = new THREE.Vector3();
  laneVertex(sm, d, p);
  // **On the highest ground under it, not on the ground beside it.** A single
  // sample is the ground at the middle of the footprint, and a footprint is nine
  // metres across; on anything that is not dead level that puts the downhill
  // half of the tower in the air and the uphill half under the turf, and which
  // way it goes is the slope's business rather than the tower's. So the base is
  // set to the **highest** of the ground the whole footprint stands on, less a
  // hand's breadth. The site test above has already made sure the spread across
  // that footprint is small enough for this to bury nothing; this is the half
  // that keeps it honest when the site test has settled for less than it asked.
  const fr = newFrame();
  let base = -Infinity, low = Infinity;
  for (let along = -TOWER_FOOT; along <= TOWER_FOOT; along += TOWER_FOOT) {
    trackAt(tr, s + along, fr);
    for (let dd = sm.crown - TOWER_FOOT; dd <= sm.crown + TOWER_FOOT; dd += TOWER_FOOT / 2) {
      const y = groundDrawnAt(fr, -dd);
      if (y > base) base = y;
      if (y < low) low = y;
    }
  }
  p.y = (isFinite(base) ? base : groundDrawnAt(sm, d)) - 0.25;
  // **And a plinth under it**, which is the answer on a course that climbs.
  // A building eight metres across on ground falling five metres across those
  // eight metres cannot sit level, and there is nowhere on Crag Ascent that
  // can: every site within a quarter of the race of the middle is on the same
  // slope, because the whole of the course is on it. So the tower is set on the
  // **highest** ground under it, which is the only way it is never buried, and
  // the gap that leaves on the downhill side is masonry - a drum of the same
  // stone, from the tower's own base down to the lowest ground in its footprint.
  // That is what a tower on a hill is actually founded on, and it is the honest
  // answer where the alternative is a building hanging in the air on one side
  // and swallowed by the turf on the other.
  const drop = p.y - (isFinite(low) ? low : p.y);
  if (drop > 0.3) {
    const hill = knoll(tr, s, sm, p);
    if (hill) grp.add(hill);
  }
  // **Three meshes**, because the tower is three surfaces: its masonry, the
  // timber the lantern in the top of it hangs on, and the paper. The paper is
  // `mat.paper` and always will be, for the reason the verge lanterns are: the
  // hour drives that material's emissive by name, and a paper drawn in the
  // material out of its own file has no emissive for the hour to touch, so the
  // top of the tower is a dark box at midnight. The other two are drawn in the
  // material out of their own parts' files and wear their own grain, limestone
  // and timber, which is the whole of what the manifest's per-part entry is for.
  const tparts = props['watchtower.parts'];
  const tower = new THREE.Group();
  for (const key of ['', 'hanging']) {
    if (!tparts || !tparts[key]) continue;
    const mesh = new THREE.Mesh(tparts[key], key ? partMat(tparts[key], mat.vcol) : matFor('watchtower', mat.rock));
    mesh.castShadow = true; mesh.receiveShadow = true;
    tower.add(mesh);
  }
  if (tparts && tparts.paper) {
    const paper = new THREE.Mesh(tparts.paper, mat.paper);
    paper.castShadow = false;   // paper this thin casts nothing worth having
    tower.add(paper);
  }
  tower.position.copy(p);
  // the doorway is on the piece's `+z` face and the road is on the tower's
  // `+right`, so this one number aims the front of the building at the lane -
  // and it matters, because a tower with its back to the road is a chimney
  tower.rotation.y = Math.atan2(sm.right.x, sm.right.z);
  grp.add(tower);
  // and it is **stood**, not reserved, so that the audit at the end of a build
  // can name the tower as the thing a tree is standing inside of. Its radius is
  // its own footprint - the loader measures the piece, and the piece is the
  // root flare alone, which is the widest thing on it and the reason the ground
  // under `TOWER_FOOT` is a nine-metre square - at the same ninety-five per cent
  // the scatter gives everything else, so a birch comes up at the edge of the
  // clearing and not through the doorway.
  standIt(p.x, p.z, crowdOf(geo, 1), geo);
  // **And the flat space about it is claimed as well**, which is a different
  // thing and not the tower's own ground. The tower is `crown` metres off the
  // road, so the two of them and the sweep's arc between them are one place -
  // a lawn with a road at one edge and a tower at the other - and the flatness
  // of it is the thing the whole sweep is for. Left to the scatter, that ground
  // is worth as much as anywhere else on the course, and a wood comes up across
  // the middle of it: a birch standing in the gap a snail is watching the
  // tower through, which is the one sightline the tower was placed for.
  //
  // So the clearing is claimed at the width of the **corridor**, not the width
  // of the building - a circle about the tower that reaches past the road on the
  // far side of it, because that is the only circle that covers the middle. The
  // tower's own `standIt` is kept as well and is the smaller of the two: it is
  // the one the audit names, and the one that says the tower is a thing in the
  // county rather than a clearing in it.
  // So the clearing is claimed as a circle about the **middle of the corridor**
  // rather than about the tower, because the flat space that matters is the gap
  // between the road and the tower and not the ground under the building: a
  // circle drawn round the tower spends most of its area out behind the tower,
  // where there is nothing to see it from, and leaves the middle - the ground
  // a snail is watching the tower across - with only what happens to be left
  // over. Drawn round the middle, the same area lands where it is seen.
  const mid = laneVertex(sm, d * 0.5, new THREE.Vector3());
  reserveIt(mid.x, mid.z, Math.abs(d) * 0.5 + MID_CLEAR);
  return s;
}
/**
 * Lamps down the side of the course: a street light every so often, and
 * lanterns here and there between them. They are placed on a walk of their own
 * rather than through the scenery scatter, because the post and its glass have
 * to be in exactly the same spot and the scatter cannot promise that, and
 * because the four lamps that cast real light are chosen from where these are.
 */
const lampPosts = [];
/**
 * **Where the light goes is the glass's own centre**, read off the geometry the
 * glass is drawn from, and not a number written down beside the call.
 *
 * The street lamp's head is **not over its post**: the arm reaches out to
 * `x = -0.567` and the glass hangs at the end of it, its own bounds centred on
 * `(-0.42, 2.36, 0)`. The light was placed at `(0, 2.36, 0)` - the right height
 * and **42 centimetres inboard, on the post itself** - so the halo sat on the
 * upright and the lamp head beside it was dark. The lantern is the same story
 * with a smaller number: its glass hangs off to one side at `z = -0.32` and the
 * light was on the pole.
 *
 * Two things come off reading the number off the model rather than typing it.
 * The first is that the light follows the **instance's own scale**, which is
 * 0.92 to 1.12 and was not applied to the hand-written offset at all, so the
 * light was up to 12 per cent of the post's height from the head on a tall one.
 * The second is that the number cannot go stale: rebuild `lamp-post.glb` with a
 * taller arm and the light is in the glass again without a line of this file
 * changing.
 *
 * The glass is drawn with the **same matrix** as its post, so the head is that
 * local point run through the instance matrix and nothing else.
 */
function glassMid(geo) {
  if (!geo) return new THREE.Vector3();
  if (!geo.boundingBox) geo.computeBoundingBox();
  return new THREE.Vector3().addVectors(geo.boundingBox.min, geo.boundingBox.max).multiplyScalar(0.5);
}
/**
 * **The light goes in the part that lights up**, which for a piece with parts is
 * the part the tint is applied to and for a piece without one is the piece. Same
 * rule as the street lamp's, one step further out, and the numbers say the same
 * thing it did there: `lantern-pole`'s glass hangs **2.33 m out along its arm**
 * at 2.98 m up, and the light was being put at `(0, 3.0 × scale, 0)` — the right
 * height on the **pole**, with the lantern itself two metres to the side of it.
 *
 * So `lampY` is gone rather than corrected: it was a number written down beside a
 * model, and the model's own geometry already says where the light goes. The
 * fallback is a piece whose part carries no tint, and there the whole piece is
 * the lamp.
 */
function lampHeadOf(meshes, parts, matrix) {
  for (let k = 0; k < meshes.length; k++) {
    if (!parts || !parts[k] || !parts[k].tint) continue;
    return glassMid(meshes[k].geometry).applyMatrix4(matrix);
  }
  return glassMid(meshes[0].geometry).applyMatrix4(matrix);
}
// where along the course the walk of lamps stands, so the lanterns scattered
// elsewhere on the course can be kept from landing on top of it
const lampWalk = [];
function placeLamps(tr, group) {
  const postGeo = props['lamp-post'], glassGeo = props['lamp-glass'];
  const lpostGeo = props['lantern-post'], lglassGeo = props['lantern-glass'];
  const lampHead = glassMid(glassGeo), lanternHead = glassMid(lglassGeo);
  const count = Math.max(2, Math.floor((tr.finish - START_S) / LAMP_SPACING));
  const posts = new THREE.InstancedMesh(postGeo, matFor('lamp-post', mat.rock), count);
  const glass = new THREE.InstancedMesh(glassGeo, matFor('lamp-glass', mat.lampGlass), count);
  const lposts = new THREE.InstancedMesh(lpostGeo, matFor('lantern-post', mat.rock), count * 2);
  const lglass = new THREE.InstancedMesh(lglassGeo, matFor('lantern-glass', mat.lampGlass), count * 2);
  for (const m of [posts, glass, lposts, lglass]) {
    m.castShadow = true; m.frustumCulled = true;
    group.add(m);
  }
  const o = new THREE.Object3D();
  const r = makeRng(trackSeed(tr.catId) ^ 0x5eed);
  let n = 0, nl = 0;
  // the walk alternates from one side of the lane to the other, so two posts
  // are never standing side by side on the same verge
  let lastSide = r() < 0.5 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const s = START_S + 6 + (i + r() * 0.5) * LAMP_SPACING;
    if (s > tr.finish - 4) break;
    const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
    const side = lastSide;
    lastSide = -side;
    // a post wants its feet on the ground: out past the wet sand, or not at all
    const d = side * Math.max(sm.w + 0.9, bankRadius(sm) + 1.9);
    if (Math.abs(d) > 26) continue;
    o.position.set(sm.p.x + sm.right.x * d, sm.y, sm.p.z + sm.right.z * d);
    o.rotation.set(0, Math.atan2(sm.right.x * side, sm.right.z * side), 0);
    o.scale.setScalar(0.92 + r() * 0.2);
    o.updateMatrix();
    posts.setMatrixAt(n, o.matrix);
    glass.setMatrixAt(n, o.matrix);
    lampPosts.push({ p: lampHead.clone().applyMatrix4(o.matrix), post: true, colour: LAMP_COLOUR, power: 9, reach: 15 });
    lampWalk.push(s);
    n++;
    // and a lantern further along, but a good way along and on the far side of
    // the lane: hung close beside its own post the two read as one clump, and
    // a verge with three lanterns in twenty metres is a fence of them
    if (r() < 0.62) {
      const s2 = Math.min(tr.finish - 4, s + 8 + r() * 13);
      const sm2 = tr.sm[clamp(Math.round(s2 / STEP), 0, tr.n)];
      const side2 = lastSide;
      lastSide = -side2;
      const d2 = side2 * Math.max(sm2.w + 0.7, bankRadius(sm2) + 1.6);
      o.position.set(sm2.p.x + sm2.right.x * d2, sm2.y, sm2.p.z + sm2.right.z * d2);
      o.rotation.set(0, Math.atan2(sm2.right.x * side2, sm2.right.z * side2) + (side2 < 0 ? Math.PI : 0), 0);
      o.scale.setScalar(0.9 + r() * 0.25);
      o.updateMatrix();
      lposts.setMatrixAt(nl, o.matrix);
      lglass.setMatrixAt(nl, o.matrix);
      lampPosts.push({ p: lanternHead.clone().applyMatrix4(o.matrix), post: false, colour: LAMP_COLOUR, power: 9, reach: 15 });
      lampWalk.push(s2);
      nl++;
    }
  }
  for (const [m, used] of [[posts, n], [glass, n], [lposts, nl], [lglass, nl]]) {
    o.scale.setScalar(0);
    o.updateMatrix();
    for (let i = used; i < m.count; i++) m.setMatrixAt(i, o.matrix);
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }
  o.position.set(0, -999, 0); o.updateMatrix();
  lampPosts.push({ p: o.position, post: true, colour: LAMP_COLOUR, power: 9, reach: 15 });  // one always-dark spare
}

/** Scatter instances along the lane, skipping the water and the running surface. */
/**
 * Scatter a piece along the course. Most pieces are one geometry, but a piece
 * can be made of parts - the paper of a lantern and the frame it hangs on - and
 * then every part is drawn as its own instanced mesh, sharing one set of
 * transforms, so a piece is still placed once and costs one matrix to place.
 * `opts.lamps` is handed back every piece that carries a light, so the few
 * real lights in the world can find the nearest of them as the race goes.
 *
 * A part is drawn in the material its own file declared once it has been
 * converted - that is the whole reason `propMatFor` exists - and otherwise in
 * the material the call site passed. `opts.material` overrides both, and is
 * applied per part, so a piece whose parts want different materials still can.
 */
/**
 * What is already standing, as a footprint each: `{x, z, r}` in metres.
 *
 * The county is arranged, not sprinkled. A giant mushroom is the biggest thing
 * in it, and sixteen of them thrown at random along two hundred metres will
 * stand in each other, grow through a conifer and pitch a cap through the roof
 * of a farm's windmill - and that is what they did, because every piece used to
 * know only where it was going and nothing about what was already there. So a
 * piece that is big enough to be noticed registers itself here and is kept off
 * everything already in here, and a piece that is not is invisible to the whole
 * arrangement, which is right: a tuft has no business being kept off a mushroom
 * and a mushroom has no business growing through a tuft either.
 *
 * `r` is a *crowding* radius and not a collision one - a fifth under the real
 * footprint - so two canopies may touch and a trunk may stand in front of a
 * hedge, while two trunks in the same place may not. Nothing here is exact
 * geometry; it is a promise that the arrangement reads as a country rather than
 * as a collision.
 */
let STANDING = [];
/** Ground that is spoken for without anything standing on it: a farm's yard. */
let RESERVED = [];
/**
 * Under this radius a piece takes no part in the arrangement at all. It is set
 * where it is because the two kinds of tree in the county sit either side of it:
 * a conifer's canopy is 1.63 m out from its own axis and a broadleaf's is 1.47,
 * and a giant mushroom growing up through a conifer is exactly the thing this
 * whole arrangement exists to stop. Below them a stone is 0.7, a tuft 0.22 and a
 * marker 0.17, and those are the pieces that must be left out of it: the tufts
 * are fifteen hundred to a course and the stones are strewn. The broadleaf's
 * number came from a model that was a smooth ball on a stick a metre and a bit
 * across; the maple's crown reaches further out than that and further up, so it
 * has to say so here or a mushroom comes up through its edge.
 */
const NOT_WORTH_CLEARING = 0.45;
/**
 * How much of its own footprint a piece is treated as standing, and it is
 * nearly all of it. A wide flat thing - and the widest thing in the county is a
 * giant mushroom cap, six and a half metres to the radius at full scale - is
 * mostly air with a stem in the middle, and two of them eight metres apart have
 * five metres of cap inside each other. So a canopy is treated as nearly its
 * own size, and two canopies are allowed to *touch*: mushrooms in a wood stand
 * shoulder to shoulder and their caps do meet, and what must not happen is two
 * stems in the same patch of ground.
 */
const CROWDING = 0.95;
/** The crowding radius a piece of this geometry at this scale takes up. */
const crowdOf = (geo, scale) => {
  const foot = (geo && geo.userData && geo.userData.foot) || 0;
  return foot * scale * CROWDING;
};
/**
 * Is this spot clear of everything standing and everything reserved - and if it
 * is not, what was in the way. Returning the blocker rather than a bare false is
 * the difference between "something had nowhere to go" and a report you can
 * act on, and the thing in the way is usually the answer.
 */
function clearOf(x, z, r, pad = 0) {
  for (const list of [STANDING, RESERVED]) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const dx = x - s.x, dz = z - s.z, need = r + s.r + pad;
      if (dx * dx + dz * dz < need * need) return s;
    }
  }
  return null;
}
/**
 * Put a piece on the register. Anything below the threshold is not recorded.
 * `exempt` marks the ones that were let in on purpose - a scarecrow standing in
 * its own field, the fence round that field - so the report can leave them out
 * of the "standing inside something" answer instead of calling them a clash.
 */
function standIt(x, z, r, geo, exempt = false) {
  if (r >= NOT_WORTH_CLEARING) STANDING.push({ x, z, r, geo, exempt });
}
/** Claim ground for nothing to stand on. Not a piece, so it is kept apart. */
const reserveIt = (x, z, r) => RESERVED.push({ x, z, r });

function scatter(tr, geo, material, count, opts) {
  const parts = opts.parts || [{ geo, material, tint: opts.tint !== false }];
  // **The prop-density row is this one multiply**, and it is here rather than in
  // any of the forty-odd call sites because every one of them asks for a count
  // per hundred and fifty metres and every one of them is a prop. Nothing here is
  // a *different* prop at a different density - it is the same arrangement of the
  // same pieces, fewer or more of them.
  const want = Math.max(4, Math.round(count * gfxPropDensity() * (tr.length / 150)));
  const meshes = parts.map((p) => {
    const im = new THREE.InstancedMesh(p.geo, opts.material || propMatFor.get(p.geo) || p.material, want);
    im.castShadow = opts.shadow !== false;
    im.receiveShadow = false;
    im.frustumCulled = true;
    // Stamped, not guessed at: the shadows row toggles casting by walking for
    // this flag, and a walk that has to work out what a mesh *is* is a walk that
    // eventually decides the water casts a shadow. Set here, at build time,
    // because `dropCourse()` throws these away and rebuilds them constantly.
    if (im.castShadow) im.userData.gfxCast = true;
    return windMark(im);
  });
  const o = new THREE.Object3D();
  const tint = new THREE.Color();
  // `opts.minGap` keeps a piece from landing too near one it has already
  // placed, measured along the course, and `opts.avoid` names the places it
  // has to keep clear of whatever put them there. `opts.tries` says how many
  // draws it may make looking for room: a scatter that has to find clear
  // ground keeps looking longer than one that has the whole country to itself.
  const placed = [];
  let n = 0;
  // and how many draws were thrown away because there was no ground under them,
  // which is reported with the rest of what turned a scatter short - a scatter
  // that cannot put a stone on a wall because the wall is all lip and no top
  // should say so rather than quietly place nothing
  let noGround = 0;
  // and the arrangement. A piece big enough to be noticed draws more often
  // before it gives up, because it is being turned away from a good deal more
  // often than a tuft is - a mushroom in open meadow finds room in a handful of
  // draws and a mushroom next to a farmstead may want a hundred. Ten is the
  // figure for the small stuff and is left alone. The test is against the
  // geometry's own footprint at unit scale: the real radius is worked out per
  // instance below, once the scale is known, and this is only asking whether
  // the piece is one of the big ones.
  const wantsRoom = (opts.r !== undefined ? opts.r : crowdOf(geo, 1)) >= NOT_WORTH_CLEARING;
  // **And the draws allowed go up with the density as well**, because `tries` is
  // `want * k` and the pieces get in each other's way: `minGap` rejects about
  // twice as often when there are twice as many, so holding `k` fixed would make
  // a dense course a *sparse* one and the setting would be a lie. One at the
  // middle step - exactly the figure this has always used - and one and a half at
  // twice the density. A scatter that cannot place what it was asked for says so
  // below rather than quietly coming up short, which is the AGENTS.md failure this
  // is guarding against.
  const tries = Math.round(want * (opts.tries || (wantsRoom ? 60 : 10)) * triesBoost());
  // what turned each draw away, counted, so that a scatter which comes up short
  // can say what it was up against rather than only that it was
  const turned = new Map();
  const avoid = opts.avoid || [];
  const avoidGap = opts.avoidGap || opts.minGap;
  for (let i = 0; i < tries && n < want; i++) {
    const s = 1.5 + rand() * (tr.finish - 3.5);
    if (opts.minGap && (placed.some((q) => Math.abs(q - s) < opts.minGap) || avoid.some((q) => Math.abs(q - s) < avoidGap))) continue;
    const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
    if (opts.skip && opts.skip(sm)) continue;
    const side = rand() < 0.5 ? -1 : 1;
    // **and the piece is kept inside the ground that is actually drawn.** The
    // country is a ribbon - every row of it is the lane's own path pushed out to
    // that row's distance - so the ribbon's width is set by the tightest bend in
    // reach, and on a course that doubles back there are places where it is
    // fifty metres wide and places where it is a hundred and twenty. A scatter
    // that asked for fifty-six and got a fifty-eight-wide ribbon was lucky by two
    // metres, and the margin has nothing to do with the *piece*: a giant mushroom
    // is drawn four metres across, so its cap hangs over the edge of the ground
    // that is carrying its stalk, and from anything above the course that reads as
    // scenery hanging in the air.
    //
    // So a draw that lands past the edge is **pulled in to it** rather than
    // turned away. Not turned away, because the far country is where the good
    // draws are: it pulls the draw in to the last row and then the rest of the
    // tests - the bank, the road, the spacing - run on the piece's own terms, and
    // the tree line is against the edge of the meadow where a tree line belongs.
    const d = side * Math.min(opts.at(sm, rand), groundHalfAt(sm) - 3);
    const ad = Math.abs(d);
    if (sm.basin > 0.05) {
      // Water is the one place a thing may sit inside the edge rather than
      // beside it: a plant in a pool grows where it likes in it, and only has
      // to stay off the bank. Everything else keeps its berth.
      if (!opts.inWater && ad < sm.basin + (opts.clear === undefined ? 1.0 : opts.clear)) continue;
      // and nothing that grows is planted in the road, however much water
      // there is to grow in
      if (opts.offLane !== undefined && ad < sm.w + opts.offLane) continue;
      // Water belongs to the water and the sand beside it. Everything that is
      // not part of a shore keeps out of the wet band altogether, so a river has
      // reeds and shells and wet sand on it and nothing else.
      if (!opts.shore && ad < bankRadius(sm) + (opts.dry === undefined ? 1.6 : opts.dry)) continue;
    } else if (!(opts.keep && opts.keep(sm)) && ad < sm.w + 1.0) continue;
    // **Is there ground to stand on?** Everything above this line asks where a
    // piece *is*; this asks whether the ground is actually there under it, and
    // the two are not the same question at a lip. A draw that lands on the top of
    // a wall or the near edge of a chasm is standing on a polyline with nothing
    // behind it: the foot is on the ground and the rest of the piece is in the
    // air, and no amount of correct height fixes that.
    //
    // So the ground is asked again a short way to either side, and a piece whose
    // ground falls away further than it could possibly hide its own is turned
    // away and another draw is made. It is a short way on purpose - a quarter of
    // a metre - because this is not a test for steepness. A piece on a smooth
    // slope of any angle has ground directly under its own middle and the
    // neighbour is only asking whether there is a **step** there, which is what a
    // lip is and a hillside is not. A long way round would be a slope test, and a
    // slope test takes every stone off every wall.
    //
    // Measured across three courses it costs nothing: 0% of the draws on Crag
    // Ascent and the Grand Marathon, and 0.8% on Skydrift, which is the one with
    // the chasms - and the ones it turns away there are the lips, at 1.2 m of
    // nothing under them. A water plant is left alone: it is placed at the water
    // and meant to be in the water.
    const y0 = opts.onWater && sm.basin > 0.05 ? sm.water : groundDrawnAt(sm, d);
    if (!opts.onWater && y0 - Math.min(groundDrawnAt(sm, d - 0.4), groundDrawnAt(sm, d + 0.4))
      > (opts.stand === undefined ? 0.35 : opts.stand)) { noGround++; continue; }
    laneVertex(sm, d, o.position);
    // On the ground **as it is drawn** and not as `groundYAt()` reports it: the
    // two are the same to a millimetre where the ground mesh has rows close
    // together and a metre apart out past the verge, and a metre is a flower in
    // the air. See `groundDrawnAt()`.
    o.position.y = y0 + (opts.lift ? opts.lift(rand) : 0);
    o.rotation.set(opts.tilt ? (rand() - 0.5) * opts.tilt : 0, rand() * TAU, opts.tilt ? (rand() - 0.5) * opts.tilt : 0);
    o.scale.setScalar(opts.scale(rand));
    o.updateMatrix();
    // and the one test that makes the county an arrangement rather than a
    // sprinkle: is there already something standing here, or hereabouts, that
    // this piece would be inside of. The radius is read off the piece's own
    // geometry, so a windmill asks for the room a windmill needs.
    const cr = opts.r !== undefined ? opts.r : crowdOf(geo, o.scale.x);
    if (cr >= NOT_WORTH_CLEARING) {
      const block = clearOf(o.position.x, o.position.z, cr, opts.clearPad || 0);
      if (block) {
        const what = Object.keys(props).find((k) => props[k] === block.geo) || (block.geo ? 'a clearing' : '?');
        turned.set(what, (turned.get(what) || 0) + 1);
        continue;
      }
    }
    // A tint may be a shade - 0 to 1, or a little over, so one plant can be
    // paler than another - or a whole colour, which arrives as a hex number
    // and is always far bigger than any shade. Reading a hex number as a shade
    // clamps it to 1 and every instance comes out white, which is how a field
    // of flowers turns into a field of white stones; reading a shade of 1.16
    // as a colour turns every other tree black.
    const t = opts.tint ? opts.tint(rand) : 1;
    if (t > 0xff) tint.setHex(t); else tint.setScalar(t);
    for (let k = 0; k < meshes.length; k++) {
      meshes[k].setMatrixAt(n, o.matrix);
      // the frame of a piece is left its own colour: only the part that lights
      // up takes the tint, or a red lantern would come with a red pole
      meshes[k].setColorAt(n, parts[k].tint ? tint : WHITE);
    }
    if (opts.lamps) {
      opts.lamps.push({
        p: lampHeadOf(meshes, parts, o.matrix),
        post: false, colour: t > 0xff ? t : LAMP_COLOUR,
        power: opts.lampPower || 9, reach: opts.lampReach || 15,
      });
    }
    if (opts.minGap) placed.push(s);
    // and it is on the register, so the next thing to be placed knows about it
    standIt(o.position.x, o.position.z, cr, geo);
    n++;
  }
  // A scatter that came up short places nothing for the difference and says
  // nothing about it, which is how a course ends up with fourteen giant
  // mushrooms where it asked for sixteen and the reason is never written down.
  // A scatter that came up short places nothing for the difference, and says
  // nothing about it, which is how a course ends up with fourteen giant
  // mushrooms where it asked for sixteen and the reason is never written down.
  // It only speaks when the *arrangement* is what turned the draws away: a
  // scatter that is short for any other reason - a climbing course with no
  // water in it has nowhere to put a mossy stone, and always has - was short
  // before this existed and is not this's news.
  //
  // **Standing room is not the arrangement**, so it gets its own line, and it
  // speaks whenever it cost anything rather than only when the scatter came up
  // short. A piece that will not place itself anywhere with ground under it is a
  // different fact from a piece that found the ground crowded, and a course
  // author wants to know which one emptied their wall.
  if (noGround) {
    console.warn(`${propName(geo)}: ${noGround} draws on ${tr.catId} turned away for no ground to stand on`);
  }
  if (n < want && wantsRoom && turned.size) {
    const against = [...turned.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${v} by ${k}`).join(', ');
    console.warn(`${propName(geo)}: ${n} of ${want} placed on ${tr.catId}, turned away by ${against}`);
  }
  o.scale.setScalar(0);
  o.updateMatrix();
  for (const im of meshes) {
    for (let i = n; i < want; i++) im.setMatrixAt(i, o.matrix);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // An InstancedMesh culls on one sphere around the whole lot, so it has to
    // be worked out after the last matrix is written. A piece that pops in at
    // the edge of the frame is a sphere that is too small, not a reason to stop
    // culling: a scatter of six thousand tufts costs a great deal more to draw
    // than to bound.
    im.computeBoundingSphere();
  }
  return meshes.length === 1 ? meshes[0] : meshes;
}

/**
 * What to call a piece in a line of the console, from the geometry it was drawn
 * with. A prop that has been split into parts is drawn with one of its parts and
 * no key in `props` **is** that part - `props[name]` is the first part and the
 * rest live under `props[name + '.parts']` - so looking only at `props` calls a
 * pale mushroom's cap "a piece", and a warning nobody can act on is a warning
 * that did not happen.
 */
function propName(geo) {
  let name = Object.keys(props).find((k) => props[k] === geo);
  if (name) return name;
  for (const k of Object.keys(props)) {
    if (!k.endsWith('.parts')) continue;
    const parts = props[k];
    for (const key of Object.keys(parts)) {
      if (parts[key] === geo) return (key ? k.slice(0, -6) + '-' + key : k.slice(0, -6));
    }
  }
  return 'a piece';
}

/**
 * A prop's parts as `scatter()` wants them: the piece itself first, then
 * whatever else the file was split into, in the order it was written. A part
 * that has been converted is drawn in the material its own file declared, which
 * `scatter()` looks up from the geometry, so this only has to say what the
 * piece is. A prop of one part gets null and is scattered as it always was.
 */
function partList(name, material) {
  const parts = props[name + '.parts'];
  return parts ? Object.values(parts).map((geo) => ({ geo, material })) : null;
}

function populate(tr, group) {
  // The register was emptied by `buildCourse()`, before the tower went down,
  // and the order of the rest of this function *is* the order of the arrangement:
  // whatever goes down first is what everything after it has to arrange itself
  // around. The farms therefore go first - a farmstead is a place the country
  // was cleared for and it is not something you drop a giant mushroom into
  // afterwards.
  populateFarms(tr, group);
  // a chasm is not meadow: nothing roots in the bottom of one
  const offRock = { skip: (sm) => sm.rock };
  // And the ones the whole valley is named for: giant mushrooms, and they go
  // down **first** of anything that grows, because they are the biggest things
  // in the country by a long way and this function is an order of precedence.
  // Placed among the trees they were being crowded out of their own meadow -
  // twenty-three asked for and five fit - because a conifer a metre across was
  // claiming its metre before a mushroom six metres across had said anything.
  // They are kept well back out of the lane and clear of each other and of
  // everything else big, which is not a figure in these calls but the register
  // in `STANDING`, read off each cap's own geometry; a mushroom that cannot
  // find room is left out rather than put on top of something. Three kinds of
  // them: the broad brown one, the pale one of the wet ground with its strands
  // hanging off the rim, and the rooted one with the crown of knobs under its
  // cap. They are the skyline.
  const mushroomAt = (r) => 26 + r() * 30;
  // All three mushrooms are three surfaces - the stalk, the outside of the cap
  // and the inside of it - so three meshes, each of which is worn by the maps
  // out of its own file's material, because the manifest can only hand a map to
  // a material. `scatter()` hands back **an array** for a prop that has been
  // given parts, one `InstancedMesh` per part, all of them through the same
  // instance matrix, and `Group.add()` takes an object - so the array has to be
  // spread. Handed over whole it throws a warning and adds nothing at all, and a
  // mushroom that is nowhere in the country is a hard thing to see from the
  // finish line.
  const mush = (name, want, scale, tint) => {
    const got = scatter(tr, props[name], mat.foliage, want, {
      at: (sm, r) => mushroomAt(r), scale, tilt: 0.05, tint, skip: (sm) => sm.rock,
      parts: partList(name, mat.foliage),
    });
    for (const im of [].concat(got)) group.add(im);
  };
  mush('mushroom-giant', 16, (r) => 0.8 + r() * 0.8, (r) => 0.84 + r() * 0.3);
  mush('mushroom-pale', 9, (r) => 0.85 + r() * 0.75, (r) => 0.86 + r() * 0.26);
  mush('mushroom-rooted', 9, (r) => 0.8 + r() * 0.8, (r) => 0.86 + r() * 0.26);
  group.add(scatter(tr, props.conifer, mat.foliage, 46, Object.assign({
    at: (sm, r) => 13 + r() * 30, scale: (r) => 0.8 + r() * 0.8, tint: (r) => 0.82 + r() * 0.34,
  }, offRock)));
  group.add(scatter(tr, props.evergreen, mat.foliage, 32, Object.assign({
    at: (sm, r) => 12 + r() * 28, scale: (r) => 0.75 + r() * 0.7, tint: (r) => 0.84 + r() * 0.32,
  }, offRock)));
  group.add(scatter(tr, props.broadleaf, mat.foliage, 38, Object.assign({
    at: (sm, r) => 14 + r() * 26, scale: (r) => 0.75 + r() * 0.7, tint: (r) => 0.85 + r() * 0.3,
  }, offRock)));
  group.add(scatter(tr, props.bush, mat.foliage, 70, Object.assign({
    at: (sm, r) => 3.2 + r() * 22, scale: (r) => 0.55 + r() * 0.55, tint: (r) => 0.85 + r() * 0.3,
  }, offRock)));
  group.add(scatter(tr, props.rock, mat.rock, 64, Object.assign({
    at: (sm, r) => (r() < 0.3 ? sm.w + 0.5 + r() * 1.2 : 3.5 + r() * 24),
    scale: (r) => ROCK_SCALE + r() * 0.34, tint: (r) => 0.85 + r() * 0.3,
  }, offRock)));
  // and the mossy ones, which are stones of the wet ground: they stand in the
  // band the pools reach, out in the shallows and on the wet sand, and they
  // are not put in the meadow at all, because a dry mossy stone is a green one.
  // A mossy stone is two pieces of geometry and two materials, so it goes out
  // as both: the frame and the moss share one set of transforms, so it is
  // placed once and costs one matrix to place, and each is drawn in the
  // material its own part of the file declared.
  group.add(...scatter(tr, props['mossy-rock'], mat.rock, 30, Object.assign({
    parts: partList('mossy-rock', mat.rock),
    at: (sm, r) => bankRadius(sm) * (0.88 + r() * 0.28),
    scale: (r) => ROCK_SCALE * 1.15 + r() * 0.3, tint: (r) => 0.88 + r() * 0.28,
    shore: true, inWater: true, offLane: 1.0, lift: () => 0.01,
    skip: (sm) => sm.basin <= 0.05, tries: 30,
  }, offRock)));
  // and the bottom of one is where the loose stone collects: broken rock
  // strewn about the floor, including out in the middle of it
  group.add(scatter(tr, props.rock, mat.rock, 40, {
    at: (sm, r) => 0.3 + r() * (sm.w + 2.4), scale: (r) => ROCK_SCALE * 0.8 + r() * 0.34, tilt: 0.6,
    keep: (sm) => sm.rock, tint: (r) => 0.80 + r() * 0.34,
  }));
  // and the grass is thick: it is the ground the whole country is made of
  group.add(scatter(tr, props.tuft, mat.grass, grassCount(), Object.assign({
    at: (sm, r) => sm.w + 0.25 + r() * 13, scale: (r) => 0.5 + r() * 0.8, shadow: false, tilt: 0.14,
  }, offRock)));
  group.add(scatter(tr, new THREE.IcosahedronGeometry(0.075, 0), mat.flower, 120, Object.assign({
    at: (sm, r) => sm.w + 0.5 + r() * 11, scale: (r) => 0.7 + r() * 0.8, shadow: false,
    tint: (r) => FLOWER_COLORS[(r() * FLOWER_COLORS.length) | 0],
  }, offRock)));
  // Mushrooms, in the grass at the side of the lane: the red ones in a clump
  // where they turn up, the brown ones scattered through, which is how both of
  // them actually grow.
  group.add(scatter(tr, props['mushroom-red'], mat.foliage, MUSHROOM_COUNT, Object.assign({
    at: (sm, r) => sm.w + 0.5 + r() * 5.5, scale: (r) => 0.7 + r() * 0.6, shadow: false, tilt: 0.18,
    tint: (r) => 0.88 + r() * 0.22,
  }, offRock)));
  group.add(scatter(tr, props['mushroom-brown'], mat.foliage, MUSHROOM_COUNT, Object.assign({
    at: (sm, r) => sm.w + 0.4 + r() * 7, scale: (r) => 0.75 + r() * 0.7, shadow: false, tilt: 0.14,
    tint: (r) => 0.86 + r() * 0.26,
  }, offRock)));
  group.add(scatter(tr, props.marker, mat.rock, 34, {
    at: (sm, r) => sm.w + 0.95 + r() * 0.5, scale: (r) => 0.62 + r() * 0.26, tilt: 0.1,
  }));
  // Paper lanterns, hung on poles beside the lane and on a few arches thrown
  // over it. They are dark by day and burn from within once the hour asks for
  // them, each in the colour it is painted - the warm cream of most, a red one
  // or two, and now and then a pink or a green. The few of them near the snail
  // are the ones that cast real light, so the verge goes the colour of whatever
  // lantern is closest to it.
  // The paper of a lantern is `mat.paper` and always will be: the hour drives
  // that material's emissive by name, and a paper drawn in the material out of
  // its own file has no emissive for the hour to touch, so it is a paper
  // lantern that is dark at midnight. The frame is a different matter - nothing
  // lights it by name - so the frame is drawn in the material out of its own
  // file and wears its own grain.
  //
  // The order is the file's: paper first, and the first part is the one the
  // loader names `props[name]`, which is what a prop of one part falls back to.
  const lanternParts = (name) => {
    const p = props[name + '.parts'];
    return p
      ? [{ geo: p.paper, material: mat.paper, tint: true },
        { geo: p.frame, material: propMat[name] || mat.vcol, tint: false }]
      : [{ geo: props[name], material: mat.vcol, tint: true }];
  };
  const LANTERN_COLOURS = [0xffe6bd, 0xffe6bd, 0xffe6bd, 0xf7d7a4, 0xffb9a0, 0xe89ec0, 0xa8e0cf];
  const lanternTint = (r) => LANTERN_COLOURS[(r() * LANTERN_COLOURS.length) | 0];
  // a piece can come back as one mesh or as its parts, so everything placed
  // goes through here and lands the same way
  const place = (geo, material, count, opts) => {
    for (const im of [].concat(scatter(tr, geo, material, count, opts))) group.add(im);
  };
  // The arches are found first, as points on the course rather than as
  // anything standing on it, because the poles hung with lanterns have to be
  // kept clear of them as well as of the lamp walk: an arch is a landmark, and
  // a pole standing in front of one hides the thing it is standing in front of.
  const archParts = lanternParts('lantern-arch');
  const archS = (() => {
    const want = Math.max(2, Math.round(tr.length / 62));
    const arches = [];
    for (let i = 0; i < want * 20 && arches.length < want; i++) {
      const s = 24 + rand() * Math.max(1, tr.finish - 46);
      const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
      if (sm.basin > 0.02) continue;
      if (arches.some((a) => Math.abs(a - s) < 34)) continue;
      arches.push(s);
    }
    return arches;
  })();
  place(props['lantern-pole'], mat.vcol, 26, {
    parts: lanternParts('lantern-pole'), at: (sm, r) => sm.w + 0.7 + r() * 3.4,
    scale: (r) => 0.85 + r() * 0.5, tilt: 0.03, tint: lanternTint,
    lamps: lampPosts, lampPower: 7, lampReach: 12,
    // a pole wants ground to stand on: no rock face, and no standing in a pool
    skip: (sm) => sm.rock || sm.basin > 0.05,
    // and a pole wants room: a lantern is a landmark, and two of them within
    // sight of each other stop being landmarks and start being a row. The
    // walk of lamps is only held at arm's length rather than kept well clear,
    // or a course that is mostly water has nowhere left to put a pole at all.
    minGap: 13, avoidGap: 5, avoid: lampWalk.concat(archS), tries: 160,
    // and the arrangement is told a pole's real size, which is the thickness of
    // a post. Left to its own geometry it is measured by the reach of its lantern
    // arm - two and a half metres - and a pole is two and a half metres of air
    // with a post in the middle of it. Its spacing is the `minGap` above, which
    // is the number that matters: thirteen metres, because a lantern is a
    // landmark and two of them in sight of each other are a row.
    r: 0.8,
  });
  // and the arches themselves, which go across the lane square to it, and that
  // you race under
  {
    const arches = archS;
    const archColours = arches.map(() => lanternTint(rand));
    for (let k = 0; k < archParts.length; k++) {
      const part = archParts[k];
      const im = new THREE.InstancedMesh(part.geo, part.material, Math.max(1, arches.length));
      im.castShadow = true; im.frustumCulled = true;
      const o = new THREE.Object3D(), c = new THREE.Color();
      arches.forEach((s, i) => {
        const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
        laneVertex(sm, 0, o.position);
        o.position.y = groundYAt(sm, 0) - 0.15;
        // square to the lane, so the arch stands across the road
        o.rotation.set(0, Math.atan2(sm.fwd.x, sm.fwd.z), 0);
        o.scale.setScalar(0.95 + rand() * 0.25);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        // the paper takes the tint of its lantern, the frame keeps its own
        c.setHex(part.tint ? archColours[i] : 0xffffff);
        im.setColorAt(i, c);
        if (k === 0) {
          lampPosts.push({
            p: o.position.clone().add(new THREE.Vector3(0, 2.4 * o.scale.y, 0)),
            post: false, colour: archColours[i], power: 15, reach: 24,
          });
        }
      });
      for (let i = arches.length; i < im.count; i++) { o.scale.setScalar(0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  // and the flowers themselves, standing out of the same water on their own
  // short stems. A plant that grows in a pool is given `inWater`, like the
  // pads: without it the `clear` rule asks for a berth out past the waterline,
  // and a range offered inside the pool is thrown away every time.
  group.add(scatter(tr, props.lily, mat.foliage, 56, {
    at: (sm, r) => sm.w + 0.6 + r() * Math.max(0.2, sm.basin - sm.w - 1.2), scale: (r) => 0.7 + r() * 0.9,
    shadow: false, onWater: true, inWater: true, offLane: 0.6, shore: true, tint: (r) => 0.9 + r() * 0.2,
    tries: 40,
  }));
  // and the pads floating on the same water: a flower's own leaf, with the
  // notch in it and another flower open on it, lying flat on the surface. They
  // sit a little proud of it, or the water draws over them, and they are given
  // right out into the open water, so a pool reads as planted rather than bare.
  group.add(scatter(tr, props['lily-pad'], mat.foliage, 76, {
    at: (sm, r) => sm.w + 0.9 + r() * Math.max(0.2, sm.basin - sm.w - 1.6), scale: (r) => 0.7 + r() * 0.9,
    shadow: false, onWater: true, inWater: true, offLane: 0.9, shore: true, lift: () => 0.022,
    tint: (r) => 0.88 + r() * 0.24, tries: 40,
  }));
  // The wet band is its own small world: sugar cane in the shallows and on the
  // wet sand, and shells left on the sand. Both only ever appear where there is
  // water, and nothing else does.
  group.add(scatter(tr, props.reeds, mat.foliage, 54, {
    at: (sm, r) => bankRadius(sm) * (0.74 + r() * 0.34), scale: (r) => 0.9 + r() * 0.8,
    tilt: 0.05, shadow: false, shore: true, inWater: true, offLane: 0.8,
    lift: () => 0.03, skip: (sm) => sm.basin <= 0.05, tint: (r) => 0.88 + r() * 0.26, tries: 40,
  }));
  group.add(scatter(tr, props.seashell, mat.vcol, 34, {
    at: (sm, r) => bankRadius(sm) * (0.9 + r() * 0.5), scale: (r) => 1.1 + r() * 0.9,
    tilt: 0.5, shadow: false, shore: true, inWater: true, offLane: 0.8,
    lift: () => 0.02, skip: (sm) => sm.basin <= 0.05, tint: (r) => 0.9 + r() * 0.2,
  }));
  return group;
}

/* ================================================================== *
 * The farms. A farm is a clearing set back from the lane: a house on stilts,
 * sometimes a second one and a windmill on the skyline, a well, a yard of
 * crates, and a field or two behind a fence. They are the reason the country
 * reads as farmed rather than as wilderness, so they are placed where there is
 * ground flat enough to build on and always turned to face the track - that is
 * how you come across one.
 * ================================================================== */
const FARM_STEP = 46;          // roughly a farm every this much of track
const FARM_FOOT = 28;          // and how far off the lane one stands
/** How far from a farm's own centre its layout reaches, and it is the number the
 *  farm's berth is set back by. The house is at nil and the windmill is at
 *  eighteen, twelve; the corner of the two is twenty-four, and a mill is six
 *  metres across, so twenty-eight is the spread with a round number on it. */
const FARM_SPREAD = 28;

/**
 * Where the fan of a windmill hangs, in the mill's own frame: the middle of the
 * sails, which is the end of the windshaft and the only thing about a windmill
 * that moves.
 *
 * The sails are authored **centred on that point** and not where they stand, so
 * that turning them is one number on one object rather than a matrix composed
 * about a point buried in a vertex buffer. That is the whole reason a windmill is
 * three meshes and not one, and it puts a number in the game that belongs to a
 * model - so it is written out here, and `meshes/build-scenery.html` hangs the
 * cap to match. There is no way for the two to be made to agree; there is only
 * this number and a comment on the other side of it.
 */
const WINDMILL_FAN = [0, 4.35, 1.55];
/** The windmills on the course, and the pivots their fans turn on. */
const fans = [];
/**
 * The fans, turning. The other thing in the county that is alive when nothing is
 * racing, and walked from the same two frames that walk the water, so a mill on
 * a course is a mill in the inspector too.
 *
 * Not at a constant rate: a mill turns faster in a gust and coasts when the
 * wind drops, and a fan that goes round at one speed for ever is a clock hand
 * with sails on it. So each fan has its own phase and a rate that wanders
 * slowly, and the two never quite line up - which is the whole difference
 * between a windmill and a turntable.
 */
function spinFans(dt) {
  for (const f of fans) {
    f.rotation.z += dt * (0.34 + 0.26 * Math.sin(clock * 0.21 + f.userData.phase)
      + 0.1 * Math.sin(clock * 0.07 + f.userData.phase * 2.1));
  }
}

/** A point out in the meadow, and how level the ground is around it. */
function farmSpot(tr, s, d, out) {
  const fr = newFrame();
  const probe = new THREE.Vector3();
  trackAt(tr, s, fr);
  const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
  if (sm.basin > 0.02) return null;               // not in a pond
  out.set(fr.p.x + fr.right.x * d, 0, fr.p.z + fr.right.z * d);
  // and the spread of the ground over the footprint, which is what decides
  // whether a plot can lie flat or a house can stand square
  let lo = Infinity, hi = -Infinity;
  for (const [ds, dd] of [[-5, -4], [5, -4], [-5, 4], [5, 4], [0, 0]]) {
    const f2 = newFrame();
    trackAt(tr, s + ds, f2);
    const y = groundYAt(f2, d + dd);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
    if (dd === 0) probe.y = y;
  }
  out.y = (lo + hi) / 2 - 0.08;
  out.spread = hi - lo;
  // the lane position and the **signed** lateral distance this farm was cut at,
  // so a thing standing on the farm can ask the ground what is under *it* and
  // not only what is under the farm's middle - which is the whole of what a field
  // lying on a slope needs. The sign matters and the distance is not FARM_FOOT:
  // the pitch is `side * (w + FARM_FOOT + up to sixteen)`, so a farm can be
  // thirty-one to forty-eight metres out and on either hand, and asking about
  // `FARM_FOOT` gets the ground on the other side of the lane.
  out.s = s;
  out.d = d;
  out.right = fr.right;
  out.fwd = fr.fwd;
  out.up = new THREE.Vector3(0, 1, 0);
  out.flat = hi - lo;
  return out;
}

function farmstead(tr, spot, r) {
  const grp = new THREE.Group();
  // the yard is laid out in the frame of the track, so a farm turns with it
  const at = (x, z) => [
    spot.x + spot.right.x * x + spot.fwd.x * z,
    spot.z + spot.right.z * x + spot.fwd.z * z,
  ];
  const face = (ry) => Math.atan2(
    spot.right.x * Math.cos(ry) + spot.fwd.x * Math.sin(ry),
    spot.right.z * Math.cos(ry) + spot.fwd.z * Math.sin(ry));
  /**
   * The ground under a point given in the **farm's own frame**, and how it is
   * falling.
   *
   * A farm's axes are the track's, so a farm-local offset of `(dx, dz)` is a
   * lateral offset of `dx` and an along-lane offset of `dz` from the spot the
   * farm was cut at, and the ground is a function of exactly those two numbers.
   * Which is the point: a field is eleven metres across and the ground under it
   * is not one height, and asking once - for the middle of the farm - is what
   * leaves a plate hanging in the air on the uphill side with a metre of daylight
   * under its far edge.
   */
  const _gf = newFrame();
  const groundAt = (dx, dz) => {
    trackAt(tr, spot.s + dz, _gf);
    return groundYAt(_gf, spot.d + dx);
  };
  /** How the ground under a footprint is falling, as a rise over a run. */
  const groundFall = (dx, dz, hw, hd) => [
    (groundAt(dx + hw, dz) - groundAt(dx - hw, dz)) / (2 * hw),
    (groundAt(dx, dz + hd) - groundAt(dx, dz - hd)) / (2 * hd),
  ];
  // Buildings stand on legs and can be let into the ground a little; a plot is
  // a plate and cannot, so each piece is sunk by what its own ground allows.
  // And each one is checked against the yard before it goes down, because a yard
  // is a *layout* and the layout is hand-written: a windmill on a hand-picked
  // bearing a dozen metres from a barn on another will put a leg through the
  // barn's roof sooner or later, and the fix is to leave the windmill off rather
  // than to move it somewhere the author did not choose.
  const put = (name, x, z, ry, sc = 1, sink = 0.3, exempt = false, tilt = null) => {
    const [px, pz] = at(x, z);
    const cr = crowdOf(props[name], sc);
    // `clearOf` answers with whatever was in the way, or null for nothing, so
    // the test is for a blocker and not for the absence of one
    if (!exempt && cr >= NOT_WORTH_CLEARING && clearOf(px, pz, cr, 0.6)) return null;
    const mesh = new THREE.Mesh(props[name], matFor(name, mat.vcol));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.set(px, spot.y - sink, pz);
    if (tilt) {
      // Laid on the land rather than hovering over it. The yaw is applied
      // **first** and the lay-on after, so the tilt is in the thing's own frame
      // and the piece ends up lying on the slope rather than tipping away from
      // the direction it was turned to face - 'YXZ' because that is the order
      // that says so.
      mesh.rotation.set(tilt[0], face(ry), tilt[1], 'YXZ');
    } else {
      mesh.rotation.y = face(ry);
    }
    mesh.scale.setScalar(sc);
    grp.add(mesh);
    standIt(px, pz, cr, props[name], exempt);
    return mesh;
  };
  /**
   * A plot: a plate of tilled ground, and the one thing on a farm that has to
   * **lie on** the land rather than stand on it.
   *
   * It was doing neither. `farmSpot` seats a farm at the *midpoint* of the
   * ground under it, so a spot is up to half the farm's own spread above the
   * ground at the low corner and the same below it at the high one; the sink
   * every piece was given was a flat fraction of that spread, and a field six
   * metres deep on a slope came out with one edge buried and the other hanging
   * in the air. That is the floating field.
   *
   * The seat is the fix, and it is the **highest** ground under the plate's
   * corners rather than the ground under its middle. A ploughed field is level
   * and cut into a slope: it sits on its uphill edge and its downhill edge is
   * in the earth, which is the opposite of seating it on the middle and letting
   * half of it hang over a drop.
   *
   * And it only leans a **third** of the way with the ground. Laying a rigid
   * plate on the full gradient of a rolling hillside turns the field into a
   * ramp, and a field is not a ramp - it is flat, and what it does about the
   * hill it is on is get cut into it.
   */
  const PLATE_TOP = { 'corn-plot': 0.25, 'sprout-plot': 0.25 };
  const plot = (name, x, z, ry, sc, exempt = false) => {
    const cr = crowdOf(props[name], sc);
    const hx = cr * 0.8, hz = cr * 0.8;
    let high = -Infinity;
    for (const [dx, dz] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz], [0, 0]]) {
      high = Math.max(high, groundAt(x + dx, z + dz));
    }
    // the plate's own surface has to land on that, and a hair under it so the
    // join is in the ground and not a hairline of daylight along it
    const sink = spot.y - high + (PLATE_TOP[name] == null ? 0.25 : PLATE_TOP[name]) * sc - 0.06;
    const [gx, gz] = groundFall(x, z, hx, hz);
    const lean = 0.34;
    return put(name, x, z, ry, sc, Math.max(0.12, sink), exempt,
      [-Math.atan(gz) * lean, Math.atan(gx) * lean]);
  };
  /**
   * A fence run, which is not a plate and must not be treated as one. A fence
   * stands on the ground at **each post**, so it follows the fall along its own
   * length and buries nothing; seating it on the highest ground under its whole
   * eight metres would put the downhill posts in a hole.
   *
   * So it sits on the ground under its middle and leans by the fall along its
   * own run, which is the farm's right for a side fence and the farm's forward
   * for an end one - the same ground asked along the direction it is actually
   * going, rather than a gradient the fence has no interest in.
   */
  const fenceRun = (x, z, ry, sc, exempt = true) => {
    const cr = crowdOf(props.fence, sc);
    const dx = Math.cos(ry) * cr * 0.8, dz = Math.sin(ry) * cr * 0.8;
    const fall = (groundAt(x + dx, z + dz) - groundAt(x - dx, z - dz)) / (2 * cr * 0.8);
    return put('fence', x, z, ry, sc, spot.y - groundAt(x, z) - 0.1, exempt, [0, -Math.atan(fall)]);
  };
  /**
   * A windmill, which is the one thing on a farm that is not a single mesh.
   *
   * It is a group of three - the stone tower, the timber cap with its tail, and
   * the fan - and the fan is the odd one out: it hangs on a **pivot** at the end
   * of the windshaft rather than on the mill, so that turning it is one number
   * per frame instead of a matrix composed about a point in a vertex buffer. The
   * pivot is an empty Object3D at `WINDMILL_FAN` with the sails as its child at
   * no offset at all, which is the other end of the bargain the builder made by
   * authoring the fan about its own middle.
   *
   * The reservation is the **tower's**, from `props.windmill`, and not the
   * fan's: a mill that reserved a clearing for a seven-metre fan would refuse
   * to stand near its own barn, because the fan is above everything in the yard
   * and sweeps over it. See the note in the loader about the footprint being a
   * horizontal radius and not a bounding sphere.
   */
  const mill = (x, z, ry, sc) => {
    const parts = props['windmill.parts'];
    if (!parts) return null;
    const [px, pz] = at(x, z);
    const cr = crowdOf(props.windmill, sc);
    if (cr >= NOT_WORTH_CLEARING && clearOf(px, pz, cr, 0.6)) return null;
    const g = new THREE.Group();
    g.position.set(px, spot.y - 0.3, pz);
    g.rotation.y = face(ry);
    g.scale.setScalar(sc);
    for (const key of ['', 'cap']) {
      const mesh = new THREE.Mesh(parts[key], partMat(parts[key], mat.vcol));
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    }
    const hub = new THREE.Object3D();
    hub.position.set(WINDMILL_FAN[0], WINDMILL_FAN[1], WINDMILL_FAN[2]);
    // every mill on a course turns at its own rate and in its own time
    hub.userData.phase = r() * TAU;
    g.add(hub);
    const fan = new THREE.Mesh(parts.sails, partMat(parts.sails, mat.vcol));
    fan.castShadow = true; fan.receiveShadow = true;
    hub.add(fan);
    grp.add(g);
    fans.push(hub);
    standIt(px, pz, cr, props.windmill, false);
    return g;
  };
  // The house, front on to the track, and its deck looking down it. It is the
  // largest thing here and everything else is placed *round* it at a distance
  // the arrangement will actually accept: a hut is a stilted house twelve metres
  // across, so it is six metres from its own origin, and a well eight metres
  // from the house's origin is a well standing in the house.
  put('hut', 0, 0, 0, 0.9 + r() * 0.3);
  // a second one, turned away, long and low
  if (r() < 0.75) put('hut', 12 + r() * 3, -8 - r() * 4, 1.9 + r() * 0.7, 0.8 + r() * 0.2);
  // the windmill, out on the far side where it can be seen a long way off
  if (r() < 0.7) mill(-13 - r() * 5, 12 + r() * 5, r() * TAU, 0.85 + r() * 0.3);
  // and a barn or a shed
  if (r() < 0.65) put('barn', -12 - r() * 3, -6 - r() * 3, r() * TAU, 0.85 + r() * 0.25);
  // the yard: a well and some crates, out by the gate and off to one side
  put('well', 8 + r() * 1.2, 8 + r() * 1.2, r() * TAU, 0.8 + r() * 0.2);
  for (let i = 0; i < 2 + (r() * 2 | 0); i++) {
    put('crate', -7 - r() * 2, 7 + r() * 2, r() * TAU, 0.8 + r() * 0.4, 0.12);
  }
  // the fields, each behind its own fence, and a scarecrow out over the crop
  for (const [name, fx, fz] of [['corn-plot', 12 + r() * 4, 9 + r() * 5],
    ['sprout-plot', 11 + r() * 5, -9 - r() * 4]]) {
    if (r() < 0.25) continue;
    const turn = (r() - 0.5) * 0.6;
    // A field claims the ground rather than standing on it, so the fence round
    // it and the scarecrow in it are inside its own footprint - but the field
    // itself is no more exempt from the test than anything else, and a field
    // that cannot find room takes its fence and its scarecrow with it rather
    // than leaving four runs of fence round nothing.
    if (!plot(name, fx, fz, turn, 0.9 + r() * 0.4)) continue;
    // four runs, one at each corner of the plot - and the four *corners*, which
    // this used not to be: the far edge and the near edge were chosen by
    // `side % 2` and so sides one and three came out at the same place, and a
    // farmstead in every county since has had a doubled fence run in it.
    for (let side = 0; side < 4; side++) {
      const x = fx + (side % 2 ? 6.8 : 0);
      const z = fz + (side < 2 ? -5.8 : 5.8);
      fenceRun(x, z, (side % 2 ? 0 : Math.PI / 2) + turn, 0.95);
    }
    if (r() < 0.6) plot('scarecrow', fx - 1.8, fz - 1.6, r() * TAU, 0.9 + r() * 0.3, true);
  }
  // And then the yard itself, as a clearing: a farm is a place the country was
  // cleared for, and the twenty metres round it belong to it - so everything
  // scattered afterwards keeps out of the whole thing rather than out of each of
  // its pieces, and a giant mushroom comes up over the hedge and not through it.
  reserveIt(spot.x, spot.z, 20);
  return grp;
}

function populateFarms(tr, group) {
  const r = makeRng(trackSeed(tr.catId) ^ 0xfa12);
  const spot = new THREE.Vector3();
  let placed = 0;
  for (let s = 26; s < tr.finish - 22; s += FARM_STEP) {
    // a handful of candidates for each pitch: the ground rolls, and a farm
    // wants a flat enough shelf somewhere near where it was going to go
    for (let k = 0; k < 6; k++) {
      const ss = clamp(s + (k - 2) * 9 + (r() - 0.5) * 10, 18, tr.finish - 18);
      const sm = tr.sm[clamp(Math.round(ss / STEP), 0, tr.n)];
      const side = k % 2 ? 1 : -1;
      // **A farm is the widest thing the course puts down** - its own layout runs
      // to twenty-five metres from here, and a windmill is six across - so its
      // berth has to be clear of the ribbon's edge by that whole spread, not by
      // the house's own radius. A farm on the far side of a corner, with its mill
      // hanging over the edge of the ground that is carrying it, is the worst of
      // the floating scenery because it is the biggest of it.
      const d = side * Math.min(sm.w + FARM_FOOT + r() * 16, groundHalfAt(sm) - FARM_SPREAD - 4);
      const at = farmSpot(tr, ss, d, spot);
      if (!at || at.spread > 1.5) continue;
      const farm = farmstead(tr, at, r);
      if (!farm) continue;
      group.add(farm);
      placed++;
      break;
    }
  }
  return placed;
}

/* Start, half-way and finish furniture. */
function gateGroup(tr, s, finish, midway) {
  const grp = new THREE.Group();
  const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
  const w = sm.w + 0.5;
  const parts = [];
  const postH = finish ? 2.5 : 1.25;
  // the half-way wears the finish's amber rather than the start's blue: three
  // marks on a lane, and the middle one wants to be the one that is neither of
  // the two that matter
  const capC = finish || midway ? [0.90, 0.70, 0.20] : [0.35, 0.45, 0.55];
  for (const side of [-1, 1]) {
    parts.push({ g: new THREE.CylinderGeometry(0.09, 0.11, postH, 6), m: M(side * w, postH / 2, 0), c: [0.78, 0.74, 0.66] });
    parts.push({ g: new THREE.IcosahedronGeometry(0.11, 0), m: M(side * w, postH + 0.06, 0), c: capC });
  }
  if (finish) {
    // the beam across the lane, and a chequered banner hanging off it
    parts.push({ g: new THREE.BoxGeometry(w * 2, 0.18, 0.16), m: M(0, postH - 0.09, 0), c: [0.78, 0.74, 0.66] });
    const segs = 9, bw = (w * 2 - 0.7) / segs;
    for (let i = 0; i < segs; i++) {
      parts.push({
        g: new THREE.BoxGeometry(bw * 0.93, 0.46, 0.05),
        m: M(-w + 0.35 + bw * (i + 0.5), postH - 0.42, 0),
        c: i % 2 ? [0.16, 0.20, 0.26] : [0.90, 0.88, 0.84],
      });
    }
    for (const side of [-1, 1]) {
      parts.push({ g: new THREE.ConeGeometry(0.17, 0.55, 4), m: M(side * (w - 0.2), postH - 0.62, 0, 1, 1, 1, 0.5), c: [0.86, 0.30, 0.28] });
    }
  }
  const mesh = new THREE.Mesh(bake(parts), mat.vcol);
  mesh.castShadow = true;
  grp.add(mesh);
  // **And nothing on the ground.** The start and the half-way used to carry a
  // chequered band of geometry laid across the lane here, ten boxes a lane wide,
  // and it is gone: the line across the lane is painted into the road's own
  // vertex colour by `roadRows()`, and see `lineMarks()` for the measurement of
  // what the band was doing to the frame.
  grp.position.set(sm.p.x, sm.y, sm.p.z);
  // the gate's own +X has to run across the lane, not along it, or the
  // banner ends up edge-on and the posts sit one behind the other
  grp.rotation.y = Math.atan2(-sm.right.z, sm.right.x);
  return grp;
}

/* ================================================================== *
 * Backdrop: clouds and far ridges that travel with the action
 * ================================================================== */
function makeBackdrop(seed) {
  const g = new THREE.Group();
  const R = makeRng(seed);
  for (let i = 0; i < 14; i++) {
    const parts = [];
    const n = 3 + ((R() * 3) | 0);
    for (let j = 0; j < n; j++) {
      parts.push({
        g: new THREE.IcosahedronGeometry(1, 0),
        m: M((j - n / 2) * 1.5 + R(), R() * 0.5, (R() - 0.5) * 1.4,
          1.5 + R() * 1.2, 0.62 + R() * 0.3, 1.1 + R() * 0.6),
        c: [1, 1, 1],
      });
    }
    const cloud = new THREE.Mesh(bake(parts), mat.cloud);
    cloud.position.set(-300 + i * 44 + R() * 26, 17 + R() * 15, -175 + R() * 205);
    cloud.scale.setScalar(1.8 + R() * 2.2);
    cloud.frustumCulled = false;
    g.add(cloud);
  }
  for (let i = 0; i < 16; i++) {
    const near = i % 3 === 0;
    const h = (near ? 8 : 12) + R() * (near ? 7 : 12);
    const r = (near ? 26 : 40) + R() * (near ? 18 : 34);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), near ? mat.hillNear : mat.hillFar);
    hill.scale.set(r, h, r * 0.8);
    hill.position.set(-520 + i * 68 + R() * 60, -h * 0.55, (R() < 0.6 ? -1 : 1) * (near ? 105 + R() * 40 : 150 + R() * 70));
    hill.rotation.y = R() * TAU;
    hill.frustumCulled = false;
    g.add(hill);
  }
  return g;
}
const backdrop = makeBackdrop(77);
/* ================================================================== *
 * The snail. Body, spiral shell, two retractable eye stalks and a foot
 * that ripples as it goes. It is meshes/snail.glb, cloned per racer: the
 * geometry is shared and only the materials differ, so a full field of eight
 * is eight materials, not eight builds. The parts that move are nodes in the
 * file, found by name; the ones that take the snail's colour are found by the
 * name of their material.
 * ================================================================== */
const BODY_Y = 0.088;
// how big a snail is drawn, eight abreast across a lane
const SNAIL_SCALE = 0.82;
/** A shell, by style - the whorl pattern is baked into the file's vertices. */
const shellFor = (style) => props['shell-' + (style || 'bands')];

function makeSnail(def) {
  // a copy of the file, with this snail's colours on it
  const group = snailTemplate.clone(true);
  const node = {};
  group.traverse((o) => { if (o.name) node[o.name] = o; });
  const bodyG = node.bodyG, shellG = node.shellG, headG = node.headG;
  const stalks = [node.stalk0, node.stalk1];
  const foot = node.footM;
  bodyG.position.y = BODY_Y;
  // the meshes grouped by the material they came out of the file with
  const parts = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const k = o.material.name;
    if (!parts.has(k)) parts.set(k, []);
    parts.get(k).push(o);
  });
  const paint = (key, material) => { for (const m of parts.get(key) || []) m.material = material; };

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: def.body, vertexColors: true, roughness: 0.35, metalness: 0.05,
    clearcoat: 0.8, clearcoatRoughness: 0.13,
    envMapIntensity: 1.4,
  });
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: def.shell, vertexColors: true,
    roughness: 0.25, metalness: 0.1,
    clearcoat: 0.8, clearcoatRoughness: 0.13,
    envMapIntensity: 1.6,
  });
  const footMat = new THREE.MeshStandardMaterial({
    color: def.body, vertexColors: true, roughness: 0.66,
  });
  const stalkMat = new THREE.MeshStandardMaterial({
    color: def.body, vertexColors: true, roughness: 0.6,
  });

  // hand the snail its colours: the file's own eye materials are left as they
  // are, and everything that takes the body or shell colour is repainted
  paint('body', bodyMat);
  paint('foot', footMat);
  paint('shell', shellMat);
  paint('stalk', stalkMat);
  const shell = node.shellM;
  shell.geometry = shellFor(def.style);
  // the foot is the one part that moves: its vertices are rewritten every
  // frame, so each snail needs its own copy of the geometry to write into
  foot.geometry = foot.geometry.clone();
  const footBase = foot.geometry.attributes.position.array.slice(0);
group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.gfxCast = true; } });
  // The pose the file gives each part. The animation moves every one of them
  // from here rather than from numbers written into this code, so the mesh
  // can be reshaped - a taller body, a head further forward, stalks that
  // splay - without the snail walking through itself.
  const base = {
    headY: headG.position.y, headZ: headG.rotation.z,
    shellY: shellG.rotation.y, shellZ: shellG.rotation.z,
    stalkZ: [stalks[0].rotation.z, stalks[1].rotation.z],
    stalkX: [stalks[0].rotation.x, stalks[1].rotation.x],
  };

  const sn = {
    def, group, bodyG, shellG, headG, stalks, foot, footBase,
    phase: Math.random() * 10, mats: [bodyMat, shellMat, footMat, stalkMat],
    /**
     * `st` carries the motion state: travelled distance, speed and what the
     * snail is currently doing (running, swimming or in the air).
     */
    update(dt, st) {
      sn.phase += st.v * dt * 0.30;
      const p = sn.phase * TAU;
      const glide = Math.sin(p);
      const swim = st.cond === SWIM, air = st.cond === FLY;
      const sg = st.surge || 0;
      const amp = (air ? 0.5 : swim ? 1.25 : 1.0) * (1 + sg * 0.35);
      bodyG.position.x = 0.055 * glide * amp;
      bodyG.scale.set(1 + 0.05 * glide * amp, 1 - 0.045 * glide * amp, 1 + 0.03 * glide);
      // flat out, it gets down over its foot
      bodyG.rotation.z = (air ? -0.16 : 0) + 0.09 * Math.sin(p * 2) - sg * 0.13;
      bodyG.rotation.y = swim ? 0.16 * Math.sin(p * 0.9) : 0.04 * Math.sin(p + 1.1);
      headG.position.y = base.headY + 0.022 * Math.sin(p + 0.8);
      headG.rotation.z = base.headZ + 0.16 * glide * amp - sg * 0.06;
      shellG.rotation.z = base.shellZ + 0.05 * Math.sin(p * 2 + 0.4) * amp;
      shellG.rotation.y = base.shellY;
      // the shell lights up while the bar is down, which is how you pick the
      // snail next to you out of the pack at a glance
      if (sg > 0.001 || sn.glow > 0.001) {
        sn.glow = sg;
        // a warm bloom on the shell, kept well under the point where it eats
        // the spiral, so you can still tell one snail from another
        shellMat.emissive.setHex(0xffd9a0);
        shellMat.emissiveIntensity = sg * 0.30;
        bodyMat.emissive.setHex(0xffcf8c);
        bodyMat.emissiveIntensity = sg * 0.06;
      } else if (shellMat.emissiveIntensity !== 0) {
        shellMat.emissiveIntensity = 0;
        bodyMat.emissiveIntensity = 0;
      }
      // the stalks come in when the snail is off the ground
      const ext = air ? 0.52 : 1.0;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        stalks[i].scale.y = ext;
        stalks[i].rotation.z = base.stalkZ[i] * ext + 0.10 * Math.sin(p * 1.4 + i * 0.7) - sg * 0.10;
        stalks[i].rotation.x = base.stalkX[i] * ext + s * 0.07 * Math.sin(p * 1.1 + i) - sg * 0.06;
      }
      // the foot ripples underneath as it goes
      const pos = foot.geometry.attributes.position;
      const arr = pos.array, still = footBase;
      for (let i = 0; i < pos.count; i++) {
        const bx = still[i * 3];
        arr[i * 3 + 1] = still[i * 3 + 1] + 0.013 * Math.sin(p - bx * 7.5) * (air ? 0.2 : 1);
      }
      pos.needsUpdate = true;
      foot.geometry.computeVertexNormals();
    },
    setShellStyle(style) {
      shell.geometry = shellFor(style);
    },
    dispose() {
      for (const m of sn.mats) m.dispose();
      foot.geometry.dispose();      // this snail's own copy, from the clone
    },
  };
  return sn;
}
/* ================================================================== *
 * The field. Thirty-two rivals, each with a rating earned from the
 * places they finish in; a race is drawn against the player's rating.
 * ================================================================== */
const NAMES = ['Nim', 'Wren', 'Bram', 'Pell', 'Otto', 'Hask', 'Marl', 'Dob', 'Yuki', 'Fen', 'Jul', 'Mike', 'Dick',
  'Cobb', 'Tulip', 'Rask', 'Gert', 'Sable', 'Pike', 'Mire', 'Odo', 'Vex', 'Lark', 'Nora', 'Phoe', 'Quill',
  'Bolt', 'Dune', 'Ember', 'Fizz', 'Gil', 'Holl', 'Iver', 'Juno', 'Kelp', 'Lux', 'Mara', 'Nova', 'Pete',
  'Otto', 'Pete', 'Quin', 'Roger', 'Sher', 'Tom', 'Uly', 'Vict', 'Wade', 'Xena', 'Yuki', 'Zane', 'Adam',
  'Moss', 'Rune', 'Hank', 'Nick', 'Otto', 'Pete', 'Quin', 'Roger', 'Sher', 'Tom', 'Uly', 'Vict', 'Wend', 'Xena', 'Yuki', 'Zack'];
const HUES = [0.06, 0.09, 0.12, 0.02, 0.55, 0.62, 0.75, 0.92, 0.45, 0.35];
const STYLES = ['bands', 'swirl', 'spots'];

function rndColor(r) {
  return new THREE.Color().setHSL(HUES[(r() * HUES.length) | 0], 0.30 + r() * 0.45, 0.42 + r() * 0.34).getHex();
}
function makePool() {
  const r = makeRng(99123);
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    // The pool is a ladder, not a bell: each rival is given a total spread
    // evenly across the whole range, then that total is split at random
    // between the five attributes. So every tier has rivals in it, and a
    // tier's field is a spread of strengths rather than seven of a kind.
    //
    // The bottom rung is not a spread at all. CLUB_SNAILS of them are the same
    // modest snail every time - three of everything - which is what the foot
    // of a ladder actually looks like from the inside, and it means the lowest
    // season has something in it you can see yourself beating.
    const sum = Math.round(lerp(6, 158, i / (POOL_SIZE - 1)));
    const attrs = {};
    if (i < CLUB_SNAILS) {
      for (const a of ATTRS) attrs[a.key] = CLUB_ATTR;
    } else {
      let left = sum;
      for (let k = 0; k < ATTRS.length - 1; k++) {
        const rest = ATTRS.length - 1 - k;
        const lo = Math.max(1, left - ATTR_MAX * rest);
        const hi = Math.min(ATTR_MAX, left - rest);
        const v = lo + ((r() * (hi - lo + 1)) | 0);
        attrs[ATTRS[k].key] = v;
        left -= v;
      }
      attrs[ATTRS[ATTRS.length - 1].key] = clamp(left, 1, ATTR_MAX);
    }
    let total = 0;
    for (const a of ATTRS) total += attrs[a.key];
    pool.push({
      id: i, name: NAMES[i], attrs, rating: total * RATING_PER_ATTR,
      body: rndColor(r), shell: rndColor(r), style: STYLES[(r() * 3) | 0],
      skill: 0.94 + r() * 0.13,
      greed: 0.15 + r() * 0.75,
      jitter: r() * TAU,
      races: 0, pts: 0, wins: 0, avg: 0,
    });
  }
  return pool;
}

/**
 * A rating, worked out from a mean points per race so one bad race is not a
 * collapse - a win is worth about 1200, a second about 800, a third about 400.
 *
 * But a rating that jumps straight to wherever the average says you ought to
 * be puts you a whole tier up the ladder on the back of one race, and back
 * down again on the back of the next, which is not a ladder so much as a
 * yo-yo. So a race only moves you RATING_EASE of the way to the target the
 * average implies, and never more than RATING_STEP in one go. You walk up the
 * ladder over a season instead of being catapulted onto it, and a first race
 * is worth something whether it goes well or badly.
 */
function ratingFor(pts, races, prev) {
  if (!races) return START_RATING;
  const target = START_RATING + (pts / races) * RATING_PER_WIN;
  const from = prev == null || !isFinite(prev) ? START_RATING : prev;
  const eased = from + (target - from) * RATING_EASE;
  return clamp(Math.round(from + clamp(eased - from, -RATING_STEP, RATING_STEP)), 5, 1280);
}
const state = {
  season: 1,
  name: 'Wilma',
  gold: START_GOLD,
  stats: freshSnail(),
  body: 0xe0b183, shell: 0xc8a05a, style: 'bands',
  tier: seasonFor(START_RATING).id,            // which season you are racing this one
  order: seasonPicks(seasonFor(START_RATING).id).slice(),
  field: null,                               // ...and the seven in it with you
  results: [],
  rating: START_RATING, races: 0, pts: 0, wins: 0,
  pool: makePool(),
};
const SEED_BASE = { v: 4200 };
const trackSeed = (catId) => SEED_BASE.v * 7 + CATS.findIndex((c) => c.id === catId) * 977 + state.season * 131;

/* ================================================================== *
 * The race
 * ================================================================== */
const env = makeEnv(78, 300);
const scene = env.scene;
scene.add(backdrop);

const race = {
  catId: null, tr: null, group: null, racers: [], player: null,
  t: 0, phase: 'idle', cd: 3.0, result: null, ripples: null, autoSurge: false,
};
// the debug runner never holds the surge button unless it is told to
let simSurge = false;
const waterMeshes = [];

/**
 * The season you are in is the one you picked, and it is fixed for the whole
 * season: you are told who you are racing and you race them. It is worked out
 * again when the next one starts.
 */
function inTier(rating, id) {
  const t = TIERS.find((x) => x.id === id) || TIERS[0];
  return rating >= t.lo && rating < t.hi;
}
/**
 * The seven a season would put you up against. Everyone in the pool belongs to
 * a season by their rating, and a field is drawn from yours, so it is always
 * seven snails of about your own standing - and the bands overlap, so a good
 * snail is racing in one of two or three seasons.
 *
 * Within the season the draw is weighted towards your own rating, so a snail
 * high on the ladder is not handed the bottom of a wide band. It is only a
 * slight pull: the season still decides who you are allowed to race, and the
 * field is still spread across it, so you are not given seven mirror images
 * of yourself. A thin season borrows the nearest rivals from the rungs either
 * side rather than field a short grid, and borrows the ones nearest you.
 */
const FIELD_BIAS = 90;            // rating points either side of you at which a rival counts half
const FIELD_FRESH = 0.9;          // and how hard a rival's race count counts against being picked
const FIELD_REPEAT = 0.35;        // and how hard the seven you just raced are held back
/**
 * The seven a season would put you up against. Everyone in the pool belongs to
 * a season by their rating, and a field is drawn from yours, so it is always
 * seven snails of about your own standing - and the bands overlap, so a good
 * snail is racing in one of two or three seasons.
 *
 * The draw is weighted three ways, and every season it is a new one. It leans
 * towards your own rating, so a snail high on the ladder is not handed the
 * bottom of a wide band. It leans towards the rivals who have raced least,
 * because `races` counts up for the whole career and without that the same
 * busy half of the pool would be in every field you ever run. And it leans
 * away from the seven you raced last season, so a new season is a new grid
 * rather than the same seven coming round again.
 *
 * A thin season borrows the nearest rivals from the rungs either side rather
 * than field a short grid, and borrows the ones nearest you.
 */
function drawSeasonField(id, n, avoid) {
  const seen = avoid || [];
  const wasHere = (p) => seen.includes(p.id) || seen.includes(p.name);
  const pool = state.pool.filter((p) => inTier(p.rating, id));
  // The season's own rivals, and then - if it is too thin to field a grid of
  // rivals who have not just been through the same season - the nearest
  // handful from the rungs either side. A season with only eight rivals in its
  // band has seven slots to fill, so without this it would hand you the same
  // seven for ever. Only as many as it is short by, and the nearest ones first,
  // so a thin season widens a little rather than falling back on the whole
  // ladder; the repeat penalty below still decides between them.
  const fresh = pool.filter((p) => !wasHere(p));
  if (fresh.length < n) {
    const rest = state.pool.filter((p) => !pool.includes(p))
      .sort((a, b) => Math.abs(a.rating - state.rating) - Math.abs(b.rating - state.rating));
    pool.push(...rest.slice(0, n - fresh.length));
  }
  // and if the whole ladder cannot cover it, the nearest rivals come in
  if (pool.length < n) {
    const rest = state.pool.filter((p) => !pool.includes(p))
      .sort((a, b) => Math.abs(a.rating - state.rating) - Math.abs(b.rating - state.rating));
    pool.push(...rest.slice(0, n - pool.length));
  }
  // Weighted without replacement: nearer your rating, fewer races behind them,
  // and not one of last season's seven.
  const out = [];
  while (out.length < n && pool.length) {
    let total = 0;
    const w = pool.map((p) => {
      let x = 1 / (1 + Math.abs(p.rating - state.rating) / FIELD_BIAS);
      x *= 1 / (1 + FIELD_FRESH * (p.races || 0));
      if (wasHere(p)) x *= FIELD_REPEAT;
      total += x;
      return x;
    });
    let r = rand() * total, i = 0;
    while (i < pool.length - 1 && (r -= w[i]) > 0) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
/** Who you raced last season, so the next field can be drawn against them. */
function lastSeasonField() {
  const rec = state.results[state.results.length - 1];
  if (!rec || !Array.isArray(rec.field)) return [];
  return rec.field.map((f) => f.id || f.name);
}
const poolByIds = (ids) => ids.map((id) => state.pool.find((p) => p.id === id)).filter(Boolean);
/**
 * The field is drawn per season, not per season *type*: the same Sunday Cup
 * two seasons running is two different grids, and the draw the picker showed
 * is the draw you race, because both come out of the same cache.
 */
const SEASON_FIELD = {};
function seasonField(id, avoid) {
  // A season that has not been raced yet is the one you are in, and its seven
  // are the seven on the card. A season that is over wants a new grid - and
  // because the picker and the join both come through here, they cannot
  // disagree about which seven it is.
  if (!state.results.length && id === state.tier && Array.isArray(state.field) && state.field.length === FIELD - 1) {
    return state.field.slice();
  }
  const key = id + ':' + state.season;
  if (!SEASON_FIELD[key]) SEASON_FIELD[key] = drawSeasonField(id, FIELD - 1, avoid).map((p) => p.id);
  return SEASON_FIELD[key].slice();
}
function forgetSeasonFields() { for (const k of Object.keys(SEASON_FIELD)) delete SEASON_FIELD[k]; }
/** The season's rivals, in the order they were drawn. */
function seasonRivals() {
  if (!Array.isArray(state.field) || state.field.length !== FIELD - 1) {
    state.field = seasonField(state.tier, lastSeasonField());
  }
  return poolByIds(state.field);
}
function pickField() { return seasonRivals(); }

const _f2 = newFrame();

/**
 * The crates of a course: a row of eight crates on the road in front of every
 * crate hole, one per lane, and **one group each and nothing hidden**.
 *
 * They are plain `THREE.Mesh`es over the shared `props['push-crate']`
 * geometries, which `loadMeshes()` has marked `userData.shared`, so
 * `dropCourse()` walks this group and frees the meshes and keeps the crate - a
 * course that goes in and out twenty times a session frees sixteen meshes a time
 * and no geometry. There is no pool and no hide-and-reuse because there are eight
 * of them and they are always on screen, and a hidden mesh that is switched back
 * on in the wrong place is a bug nothing reports.
 *
 * **A crate is two meshes now and not one**, because the iron on it is a metal
 * and a metalness is not a colour: `push-crate.glb` is split into the boards and
 * `push-crate-metal`, each with its own material out of its own file and its own
 * set of maps in the manifest, and the two are drawn through **one instance
 * transform** by parenting the iron to the wood. That is the same bargain
 * `planted()` strikes for a mushroom's three parts - two surfaces are one object
 * or they are two objects a snail can shove apart - and a crate shoved across a
 * road is the one prop in the county where a snail is looking straight at the
 * join.
 *
 * The meshes are built here and **handed to racers in `startRace()`**, group *i*
 * to racer *i*, so a snail is always pushing the crate in its own lane. In the
 * inspector there is no field, so every crate is stood in its own lane slot where
 * it starts, and the eight of them are a row of boxes on the road exactly where
 * the race will find them.
 */
function buildCrates(tr, grp) {
  const geo = props['push-crate'];
  // the material is the crate's own file's, wearing its own sets, because it is
  // in `CONVERTED` - and the name is not `mat`, because `const mat = matFor(…
  // mat.vcol)` reads its own declaration on the right-hand side of the
  // assignment and the course comes up as a `ReferenceError`.
  const wood = matFor('push-crate', mat.vcol);
  // and the iron's, looked up on **its geometry** rather than through `matFor()`:
  // `props['push-crate']` is the boards, and a piece of two parts has a second
  // one the loader has already registered a material for. `mat.metal` is the
  // fallback and is only ever that - a bracket with a metalness of zero is grey
  // plastic, and the file says one.
  const iron = props['push-crate.parts'];
  const metal = iron ? partMat(iron.metal, mat.metal) : wood;
  const rows = [];
  const fr = newFrame();
  for (const lp of tr.leaps) {
    if (!lp.crate) continue;
    const c = lp.crate;
    // **and the width of the apron the crate is stood in**, read off the lane at
    // the crate's own `s` and not off the start line: the road opens out for a
    // crate and the eight slots open with it, so a row placed at the start line's
    // pitch is eight boxes in a lane a metre and a half wider than the one they
    // were placed for, with the gaps in the wrong places.
    trackAt(tr, c.startS, fr);
    const w = fr.w;
    const meshes = [];
    for (let i = 0; i < FIELD; i++) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(geo, wood);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      if (iron && iron.metal) {
        const k = new THREE.Mesh(iron.metal, metal);
        k.castShadow = true;
        k.receiveShadow = true;
        g.add(k);
      }
      g.rotation.order = 'YZX';
      standCrate(g, tr, c, c.startS, crateLane(i, w));
      grp.add(g);
      meshes.push(g);
    }
    rows.push({ leap: lp, crate: c, meshes });
  }
  return rows;
}
/** The lane slot a racer in the field's `i`th place holds, and the same number
 *  `startRace()` gives it - one formula, because two of them is how eight crates
 *  end up on eight lanes that are not the eight lanes. And it is a *share* of the
 *  half-width rather than a distance off the centre line, because the road's
 *  half-width is not the same number at both ends of a course's crate - a slot
 *  written down in metres cannot follow the road it is standing on. */
const laneSlot = (i) => (i - (FIELD - 1) / 2) / ((FIELD - 1) / 2);
const crateLane = (i, w) => laneSlot(i) * (w - 0.5);

/** A whole course, built and standing in the scene: the ground, the bed, the
 * skirt, the water, everything scattered on it, the lamps and the two gates.
 * A race and the inspector both want exactly this, so neither of them builds
 * it - a course looked at on the course card is the same course that gets
 * raced, and the only way to be sure of that is to build it the same way.
 */
function buildCourse(catId) {
  const tr = buildTrack(catId, trackSeed(catId), seasonScale(state.tier));
  const grp = new THREE.Group();
  grp.add(buildGround(tr));
  grp.add(buildRoad(tr));
  grp.add(buildSkirt(tr));
  const water = buildWater(tr);
  grp.add(water);
  for (const m of water.userData.meshes) waterMeshes.push(m);
  // the lamps and the lanterns of this course: the near ones are the ones that
  // cast real light, so the list is emptied here, before either is placed. The
  // walk goes down first, because the lanterns scattered along the course are
  // kept clear of it - a lantern beside a lamp post is a lamp post with a
  // lantern beside it, and the verge stops reading as a verge.
  lampPosts.length = 0;
  lampWalk.length = 0;
  // **The register is emptied here and not at the top of `populate()`,** because
  // the tower has to be in it before a single thing is scattered. It used to be
  // emptied inside `populate()` - which `buildCourse()` calls *after* the tower
  // is down - so the tower's entry was wiped before the first tree asked where
  // it could stand, and a birch came up through the doorway. The clearing
  // `placeMidway()` stands is the only thing in the arrangement that is put down
  // by name rather than by the scatter, and it goes down first.
  STANDING = [];
  RESERVED = [];
  placeLamps(tr, grp);
  // the tower at the half-way and the line under it. It goes after `placeLamps()`
  // and before `populate()` because the scenery has to keep out of it: a
  // seventeen-metre tower with a lane-end post through it is a thing that went
  // wrong, and a mushroom growing out of the doorway is a thing that went
  // wrong quietly. `placeMidway()` stands the tower in the list every scatter
  // checks, so the whole of its ground is spoken for by the time the first tree
  // is placed.
  placeMidway(tr, grp);
  // the crates, after the tower and before the scenery: a crate four metres long
  // standing where a tree wants to be is a tree through a crate, and the shove
  // run in front of it is three and a half metres of lane the scatter would
  // otherwise put a hedge in
  const crates = buildCrates(tr, grp);
  populate(tr, grp);
  grp.add(gateGroup(tr, START_S, false));
  grp.add(gateGroup(tr, tr.finish, true));
  return { tr, grp, crates };
}

/** Take a course out of the scene and give its memory back. */
function dropCourse(grp) {
  // The reflection probes and the per-pool water materials are the course's, and
  // there is one course at a time, so they are dropped here rather than being
  // walked for: a cube render target and a pre-filtered target are tens of
  // megabytes between them on the top step and nothing else in the county would
  // ever free them.
  dropReflections();
  if (!grp) return;
  scene.remove(grp);
  grp.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
}

function startRace(catId) {
  // tear the last course down
  dropCourse(race.group);
  race.group = null;
  for (const sn of race.snails || []) sn.dispose();
  race.snails = [];
  waterMeshes.length = 0;
  fans.length = 0;

  const { tr, grp, crates } = buildCourse(catId);
  race.group = grp;
  scene.add(grp);
  // The pools' reflection probes belong to the course and are built with it -
  // before the hour is set, because `updateTimeOfDay()` is what queues them and a
  // queue built from nothing is nothing.
  syncProbes();
  // the hour starts at the beginning of the course's stretch of the day
  todU = -1; todPainted = -1;
  updateTimeOfDay(true);

  const rivals = pickField();
  const field = [{ player: true, name: state.name, stats: state.stats, body: state.body, shell: state.shell, style: state.style, skill: 1, greed: 0, jitter: 0 }].concat(rivals);
  // the grid is drawn at random, so the player never starts from a set place
  for (let i = field.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = field[i]; field[i] = field[j]; field[j] = t;
  }
  const racers = [];
  const startY = tr.sm[0].y;
  field.forEach((sn, i) => {
    const model = makeSnail(sn);
    model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    model.group.rotation.order = 'YZX';
    model.group.scale.setScalar(SNAIL_SCALE);
    grp.add(model.group);
    const lane = laneSlot(i) * (tr.sm[0].w - 0.5);
    racers.push({
      sn, model, isPlayer: !!sn.player, s: START_S + 0.7 + (FIELD - 1 - i) * 0.13, v: 0,
      lane, laneF: laneSlot(i), y: startY, cond: RUN, state: 'run',
      stam: 1, stamMax: 1, spent: false, surging: false, aiOn: false, aiTimer: 0,
      leapIdx: 0, leap: null, airStart: 0, airT: 0, sh: null, airY: 0,
      // and its own crate, mesh and all, by index: a snail is never pushing
      // another snail's crate, and there is no racer-to-racer contact anywhere
      // in the sim, so the only thing that could put two of them on one crate
      // is a mistake here
      crateIdx: -1, crateS: 0, crateMesh: null,
      finished: false, finishT: 0, place: 0, points: 0, fr: newFrame(), wob: rand() * TAU,
    });
  });
  // and the crates handed out with them, one row per crate hole and mesh *i* to
  // racer *i*, so a racer finds its crate already in the lane it holds
  for (const row of crates) {
    row.meshes.forEach((m, i) => {
      if (!racers[i]) return;
      racers[i].crateMesh = m;
      m.userData.crate = row.crate;
    });
  }
  for (const r of racers) {
    r.sn.eff = effTraits(r.sn);
    r.stamMax = 80 + 8 * r.sn.eff.stamina;    // the bar refills between races
    r.stam = r.stamMax;
  }

  Object.assign(race, {
    catId, tr, group: grp, racers, t: 0, phase: 'countdown', cd: 3.0,
    result: null, waitAll: false,
    player: racers.find((r) => r.isPlayer), snails: racers.map((r) => r.model),
  });
  if (!race.ripples) buildRipples();
  if (!race.streaks) buildSurgeFx();
  syncHUD();
  placeAll();
}

/* --- the look of going flat out ------------------------------------- *
 * Three pooled effects, all driven off the same per-particle numbers so they
 * can share one update. Streaks are the speed lines, stretched along the
 * direction of travel and lit additively so they read as motion rather than
 * as objects. Grit is the dust and small stones kicked off the foot, thrown
 * back and settling under their own weight. The aura is a ring of light on
 * the shell, which is what tells you at a glance that the snail next to you
 * has the bar down.
 * -------------------------------------------------------------------- */
const STREAKS = 18, GRIT = 30;
const _q1 = new THREE.Quaternion();
const _ax1 = new THREE.Vector3(0, 1, 0);

function makeFxPool(n, geo, mat) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    m.renderOrder = 3;
    scene.add(m);
    pool.push({
      mesh: m, birth: -99, life: 1, size: 1, len: 0, grow: 0, fade: 1,
      grav: 0, drag: 0, spin: 0, vel: new THREE.Vector3(),
    });
  }
  return { list: pool, cursor: 0, mat, geo };
}
function buildSurgeFx() {
  race.streaks = makeFxPool(STREAKS,
    new THREE.CylinderGeometry(0.5, 0.06, 1, 5, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xdff0ff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }));
  race.grit = makeFxPool(GRIT,
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      roughness: 1.0, fog: true,
    }));
}
/** Hand out the next free particle in a pool, overwriting the oldest. */
function takeFx(pool) {
  const p = pool.list[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.list.length;
  return p;
}
function updateFx(pool, dt) {
  for (const p of pool.list) {
    const age = clock - p.birth;
    if (age < 0 || age > p.life) { p.mesh.visible = false; continue; }
    const u = age / p.life;
    p.vel.y -= p.grav * dt;
    p.vel.multiplyScalar(1 - Math.min(1, p.drag * dt));
    p.mesh.position.addScaledVector(p.vel, dt);
    // a streak is a sliver stretched along the way it is going; a puff of
    // grit is just a puff
    if (p.len) p.mesh.scale.set(p.size, p.len * (1 + u * p.grow), p.size);
    else p.mesh.scale.setScalar(p.size * (1 + u * p.grow));
    p.mesh.material.opacity = p.fade * (1 - u) * (1 - u);
    if (p.spin) {
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.z += p.spin * 0.6 * dt;
    }
  }
}
/**
 * Throw the surge effects off behind a snail. Streaks stream away along the
 * line of travel; grit is kicked off the foot and falls back. Both are
 * spawned on a fixed rate rather than per frame, so the effect looks the same
 * whatever the frame rate is doing.
 */
function surgeFx(r, dt) {
  const g = r.model.group.position, f = r.fr.fwd;
  if (r.surgeAcc === undefined) r.surgeAcc = 0;
  r.surgeAcc += dt * 40 * clamp(r.v / 7, 0.4, 1.4);
  while (r.surgeAcc >= 1) {
    r.surgeAcc -= 1;
    const back = 0.25 + rand() * 0.7;
    // the streaks are thrown out past the sides of the snail, not straight
    // down its back, or the camera behind it never sees them
    const off = (rand() < 0.5 ? -1 : 1) * (0.34 + rand() * 0.34);
    if (rand() < 0.58) {
      const p = takeFx(race.streaks);
      p.birth = clock;
      p.life = 0.30 + rand() * 0.20;
      p.size = 0.026 + rand() * 0.024;
      p.len = 0.9 + rand() * 0.8;
      p.grow = 0.5;
      p.fade = 0.42 + 0.5 * (r.v / 8);
      p.grav = 0; p.drag = 4.2; p.spin = 0;
      p.mesh.position.set(
        g.x - f.x * back + (-f.z) * off,
        g.y + 0.07 + rand() * 0.20,
        g.z - f.z * back + f.x * off);
      p.vel.set(-f.x * (7 + rand() * 5), (rand() - 0.4) * 0.7, -f.z * (7 + rand() * 5));
      // the sliver lies along the way it is travelling, wide end astern
      p.mesh.quaternion.setFromUnitVectors(_ax1, p.vel.clone().normalize());
      p.mesh.material.color.setHex(r.v > 7 ? 0xffe9b0 : 0xd8ecff);
      p.mesh.visible = true;
    } else {
      const p = takeFx(race.grit);
      p.birth = clock;
      p.life = 0.40 + rand() * 0.35;
      p.size = 0.014 + rand() * 0.024;
      p.len = 0;
      p.grow = 0.3;
      p.fade = 0.55;
      p.grav = 5.2; p.drag = 1.1; p.spin = (rand() - 0.5) * 9;
      p.mesh.position.set(
        g.x - f.x * (0.12 + rand() * 0.25) + (-f.z) * off * 0.7,
        g.y + 0.04,
        g.z - f.z * (0.12 + rand() * 0.25) + f.x * off * 0.7);
      p.vel.set(-f.x * (1.6 + rand() * 1.8), 0.9 + rand() * 1.4, -f.z * (1.6 + rand() * 1.8));
      p.mesh.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
      // the dust is the colour of the ground under the snail: bare earth off
      // the path, a little grass off the verge
      p.mesh.material.color.setHex(rand() < 0.7 ? 0xc0aa80 : 0x93ad5c)
        .multiplyScalar(0.85 + rand() * 0.35);
      p.mesh.visible = true;
    }
  }
}

/* --- ripples, for the ones who do not make it across ---------------- */
const RIPPLES = 18;
function buildRipples() {
  race.ripples = [];
  for (let i = 0; i < RIPPLES; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.9, 14),
      new THREE.MeshBasicMaterial({ color: 0xe4f3fa, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.renderOrder = 4;
    scene.add(m);
    race.ripples.push({ mesh: m, birth: -99 });
  }
}
let rippleCursor = 0;
/**
 * A ring on the water. It is put where the snail actually is, which is out in
 * the lane it is holding and not in the middle of the road: eight of them
 * strung across a pool, each under the one that made it.
 */
function spawnRipple(r, y, power) {
  if (!race.ripples) return;
  const ring = race.ripples[rippleCursor];
  rippleCursor = (rippleCursor + 1) % RIPPLES;
  const fr = r.fr;
  ring.birth = clock;
  ring.power = power || 1;
  ring.mesh.position.set(fr.p.x + fr.right.x * r.lane, y + 0.02, fr.p.z + fr.right.z * r.lane);
  ring.mesh.visible = true;
}
function updateRipples() {
  if (!race.ripples) return;
  for (const r of race.ripples) {
    const age = clock - r.birth;
    if (age < 0 || age > 1.3) { r.mesh.visible = false; continue; }
    const u = age / 1.3;
    r.mesh.scale.setScalar((0.30 + u * 1.7) * r.power);
    r.mesh.material.opacity = 0.34 * (1 - u) * (1 - u) * 3;
  }
}

/* --- the simulation -------------------------------------------------- */
/**
 * A leap off the bank. The run-up sets how hard it goes in; the flying trait
 * sets how slowly it comes down. A snail at the bottom of the scale drops
 * like a stone and barely clears its own feet, one at the top glides the
 * length of the water. That is what decides who is still in the air at the
 * far bank and who is swimming.
 *
 * How high it goes is the feature's business, not the snail's: a leap is
 * taken at height and a pool is a hop off a low bank, which is the whole
 * difference between flying over water and getting into it. Height goes as
 * the square of the vertical speed, so `vy` is the scale on the launch.
 */
const LAUNCH = 46 * Math.PI / 180;
const GRAV = 8.8;
const TAUF = 0.05;                 // how quickly the fall reaches its rate
function leapShot(r, vApproach) {
  const st = r.sn.eff.flying;
  const fn = clamp((st - 1) / (STAT_MAX - 1), 0, 1);
  const v0 = (vApproach * 0.62 + (3.6 + 0.20 * st) * r.sn.skill) * (0.74 + rand() * 0.13);
  const lift = r.leap.vy == null ? 1 : r.leap.vy;
  const vx = v0 * Math.cos(LAUNCH), vy = v0 * Math.sin(LAUNCH) * lift;
  const tUp = vy / GRAV, apex = 0.5 * vy * tUp;
  // How fast it settles into its descent. At the bottom of the scale it
  // drops like a stone; at the top it comes down like a leaf, and even then
  // it keeps a steady clip on rather than hanging in the air for ever.
  const fall = 0.65 + 1.5 * Math.pow(1.5 - fn / 1.1, 1.2);
  return { vx, vy, tUp, apex, fall };
}
/** Height above the launch point, t seconds into the flight. */
function flightY(sh, t) {
  if (t <= sh.tUp) return sh.vy * t - 0.5 * GRAV * t * t;
  const tau = t - sh.tUp;
  return sh.apex - sh.fall * tau * tau / (tau + TAUF);
}
/** The angle of the flight at t: nose up on the way off, nose down coming in. */
function flightPitch(sh, t) {
  let dy;
  if (t <= sh.tUp) dy = sh.vy - GRAV * t;
  else {
    const tau = t - sh.tUp;
    dy = -sh.fall * (tau * (2 * tau + TAUF)) / ((tau + TAUF) * (tau + TAUF));
  }
  return Math.atan(dy / sh.vx);
}
/**
 * A rival only reaches for the bar once the race has got away from them, so a
 * snail that is up among the leaders keeps theirs in reserve and the ones at
 * the back are the ones you see the streaks trailing off. The order is taken
 * once per step, before anybody moves, so every snail in the field is judged
 * against the same race - taking it mid-pass would have them reading a
 * half-updated order and surging on a placing that has already gone.
 */
const AI_SURGE_FROM = 3;               // 4th or worse is where they spend it
const AI_SURGE_MIN = 200;              // and a rival only opens the bar with this much still on it
function markLiveOrder() {
  const rs = race.racers;
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    let n = 1;
    for (let j = 0; j < rs.length; j++) {
      if (i === j) continue;
      const b = rs[j];
      if (b.finished) { if (!a.finished || b.finishT < a.finishT) n++; }
      else if (!a.finished && b.s > a.s) n++;
    }
    a.livePlace = n;
  }
}

/** The stretch of water a snail is over, if any. */
function leapAt(tr, s) {
  for (let i = 0; i < tr.leaps.length; i++) {
    if (s >= tr.leaps[i].s0 && s < tr.leaps[i].s1) return i;
  }
  return -1;
}
/**
 * Where a crate is, and where a snail stands on it.
 *
 * `floor` is the bottom of the groove the crate was shoved into and it is a
 * **number, not a line**: the groove's floor is level, because the planner lays
 * it level, so a cube in it is level and there is no tilt to get wrong. The road
 * either side of the groove is whatever the road is doing, and the two steps -
 * up onto the lid and down off it - come out of that and are near enough equal,
 * which is the whole of what a level groove buys.
 *
 * `crateTopAt` is the lid: a snail crosses this obstacle on the lid, so this is
 * the one height the sim and the mesh must agree about, and the step on and off
 * is `CRATE_S` less the depth of the groove.
 */
const crateTopAt = (c) => c.floor + CRATE_S;
/** Where a crate is drawn: its origin is the centre of its **base**, and the base
 *  is the lane it is standing on. **The lane at the crate's own `s`, and not
 *  `c.floor`** - the two agree where the crate comes to rest, in the dish, and
 *  disagree by the dish's whole depth everywhere else, which is the flat road
 *  `CRATE_BACK` of it is shoved along. A crate that keeps the rest height while
 *  it is being pushed is a crate sunk into the road, and the snail behind it is
 *  at road level walking through it. This is why the shove run is flat road and
 *  the dish is only where the crate stops. */
const crateMeshY = (tr, s) => laneYAt(tr, s);
/** The lane's own level at an arc - the ground a snail runs on, a crate stands
 *  on and a snail climbs onto. */
function laneYAt(tr, s) {
  const i = clamp(Math.round(s / STEP), 0, tr.n);
  return tr.sm[i].y;
}
/** And the ends of it, in `s`, wherever along the crate you ask. */
const crateSpanS = (c, s) => s - CRATE_S / 2;

/** The moment the feet find something: land, or go in with a splash. */
function touchDown(r) {
  const li = leapAt(race.tr, r.s);
  if (li < 0) {
    r.state = 'run';
    r.y = r.fr.y;
    return;
  }
  r.leap = race.tr.leaps[li];
  r.leapIdx = Math.max(r.leapIdx, li + 1);
  if (r.leap.wet) {
    r.state = 'swim';
    r.y = r.fr.y - SWIM_Y;
    r.stam = Math.max(-6, r.stam - 5);
    spawnRipple(r, r.leap.waterY, 1.2);
  } else {
    // a chasm: down at the bottom of it on the lane's own floor, with the far
    // side standing up as a wall between here and the rest of the course
    r.state = 'run';
    r.y = r.fr.y;
    r.stam = Math.max(-6, r.stam - 9);
    // and a crate's chasm, which is a snail that got past its own crate without
    // shoving it - the far ramp is the safety net and this is the half of the
    // safety net that is the *scenery*: the crate goes into the hole without it,
    // because a row of eight boxes left standing on the road behind the field
    // is not the obstacle's failure mode, it is eight holes in the county.
    if (r.leap.crate) { r.crateIdx = li; r.crateS = r.leap.crate.restS; }
  }
}

/**
 * Into, through and out of a crate hole, and it is one state with three parts
 * rather than three states, because the three are one gesture and the sim is
 * easier to read with the whole of it in one place.
 *
 * A racer switches into `'push'` while still on `run` as soon as its next leap
 * carries a crate and it is within the crate's own `gap` of where that crate is
 * standing, so the readout says `crate` from the moment it is on its feet against
 * the box rather than at the moment the box is under it. From there it is at
 * `PUSH` pace, its crate is driven forward at `gap` ahead of it, and **it is
 * clamped to its own crate**: a snail cannot outrun the thing it is pushing and
 * cannot reach the lip while the crate is still on the road, so the launch test
 * below never fires on a crate. That clamp is the whole of the safety and the
 * `&& !lp.crate` is the belt to it, because `leapIdx` is bookkeeping a later edit
 * could reorder.
 *
 * At `restS - CRATE_GAP` the crate stops and the snail walks on at the same
 * speed until it is off the far end of the lid, which is the only way over the
 * groove - and "off the far end" is the crate's own far end and not the far lip,
 * because the crate overhangs the groove and a snail that steps off at the lip is
 * standing on air over it. The far lip is still there - it is a `leap`'s far side
 * and this is a `leap` - and it is never taken.
 */
function stepCrate(r, dt) {
  const c = r.leap.crate;
  // the crate's own live position, and it stops in the middle of the groove
  r.crateS = Math.min(c.restS, Math.max(c.startS, r.s + CRATE_GAP));
  const shoving = r.s < c.restS - CRATE_GAP;
  // and the snail cannot get further forward than the crate's centre is
  if (shoving) r.s = Math.min(r.s + r.v * dt, c.restS - CRATE_GAP);
  else r.s += r.v * dt;
  // **and it is on the lid for the whole of the notch and not for the whole of
  // the crate**, which is the difference between a bridge and a stumble. The
  // notch is one lane sample, and a lane sample is 0.75 m, so it is a little
  // wider than the box that fills it: sixty-five millimetres of lid at each end
  // with air under it. A snail that stepped down onto the notch floor would be
  // standing in a half-metre hole with sixty-five of floor in front of it and a
  // wall behind, so it walks the lid end to end and the overhang is the crate
  // bridging the gap - which is what the overhang is for.
  const lo = crateSpanS(c, r.crateS);
  const off = Math.max(lo + CRATE_S, c.s1);
  r.y = r.s > c.s0 - 0.05 && r.s < off + 0.05 ? crateTopAt(c) : r.fr.y;
  // and off the far end of it, back on foot, with the crate left at rest for good
  if (r.s >= off + 0.1) {
    r.crateS = c.restS;
    r.state = 'run';
    r.leapIdx = Math.max(r.leapIdx, r.crateIdx + 1);
  }
}

const _cfr = newFrame();
/** A crate in a lane at an `s`: the floor of the groove it stands in and the
 *  lane's own yaw - which is the snail's, because the model is built along +x and
 *  +x is the lane's forward. One call, used by the race and by the inspector, and
 *  a crate that stands anywhere the race would not put it is a thing the course
 *  you walk is not the course that gets raced. **The argument is the group and
 *  not a mesh**, because a crate is boards and iron and one shove moves both. */
function standCrate(mesh, tr, c, s, lane) {
  trackAt(tr, s, _cfr);
  mesh.position.set(
    _cfr.p.x + _cfr.right.x * lane, crateMeshY(tr, s), _cfr.p.z + _cfr.right.z * lane);
  mesh.rotation.set(0, Math.atan2(-_cfr.fwd.z, _cfr.fwd.x), 0);
}
function placeAll() {
  for (const r of race.racers) {
    const fr = r.fr;
    trackAt(race.tr, r.s, fr);
    if (r.state === 'run') r.y = fr.y;
    r.model.group.position.set(fr.p.x + fr.right.x * r.lane, r.y, fr.p.z + fr.right.z * r.lane);
    r.model.group.rotation.set(0, Math.atan2(-fr.fwd.z, fr.fwd.x), 0);
    // **and its own crate**, at the live `s` of the shove and at wherever it was
    // left for good afterwards. `crateS` is `0` until the racer has reached it,
    // which is what puts a crate on the road in the inspector where there is no
    // field to hand one to.
    if (r.crateMesh) standCrate(r.crateMesh, race.tr, r.crateMesh.userData.crate,
      r.crateIdx < 0 ? r.crateMesh.userData.crate.startS : r.crateS, r.lane);
  }
}

function stepRacer(r, dt) {
  if (r.finished) return;
  const tr = race.tr;
  trackAt(tr, r.s, r.fr);
  let cond = r.fr.cond;
  let target;

  if (r.state === 'air') {
    // the flight is one continuous arc: it leaves the lip, comes back down
    // through its own height and keeps gliding until it finds the ground
    cond = FLY;
    target = r.sh.vx;
    r.airT += dt;
    r.s = r.airStart + r.sh.vx * r.airT;
    r.y = r.airY + flightY(r.sh, r.airT);
    if (r.y <= r.fr.y || r.s > r.leap.s1 + 20) touchDown(r);
  } else {
    cond = r.state === 'swim' ? SWIM : r.fr.cond;
    if (r.state === 'swim' && r.fr.water === null) { r.state = 'run'; cond = r.fr.cond; }
    // **Into a crate, while still on foot.** The next leap's crate and the snail
    // within a push's length of where its own crate is standing: the switch is
    // made at the moment the snail is on its feet against the box and not at the
    // moment the box is under it, which is a metre of road later.
    if (r.state === 'run') {
      const nl = tr.leaps[r.leapIdx];
      if (nl && nl.crate && r.s + CRATE_GAP >= nl.crate.startS) {
        r.leap = nl;
        r.crateIdx = r.leapIdx;
        r.crateS = nl.crate.startS;
        r.state = 'push';
      }
    }
    if (r.state === 'push') cond = PUSH;
    const attr = COND[cond].attr;
    target = COND[cond].base * (0.62 + 0.22 * r.sn.eff[attr] / STAT_MAX) * (0.5 + r.sn.skill * 0.3);
    if (cond === RUN) target *= 1 - 0.34 * Math.min(1, r.fr.k / 0.055);
    if (cond === CLIMB) {
      // A wall is not one thing. The steeper it stands the slower the climb,
      // measured as a rise over run off the lane itself, so a long shallow
      // ramp can be walked up at nearly footpath pace while the sheer face of a
      // terrace is the slowest going on the course. Downhill costs nothing: a
      // snail coming off the top of a wall is not slowed by the fact that it
      // was steep going up.
      const g = Math.max(0, r.fr.grade);
      target *= 1 / (1 + CLIMB_GRADE * g);
      target *= 1 - 0.10 * Math.min(1, r.fr.k / 0.05);
    }
    if (r.state === 'swim') r.y = r.fr.water - SWIM_Y + 0.05 * Math.sin(clock * 3 + r.wob);
    else if (r.state !== 'push') r.y = r.fr.y;
  }

  // stamina: it drains the whole race, and an empty bar means a quarter speed
  const stamStat = r.sn.eff.stamina;
  // The floor under the bar for spending it. A rival will not open the button
  // with a bare 200 left on it - they want the bar full enough that what they
  // spend is worth having - and a snail whose whole bar never reaches 200
  // never boosts at all, which is what a low-stamina snail is.
  const surgeFloor = Math.max(r.stamMax * 0.30, AI_SURGE_MIN);
  // holding the button surges you, but the bar cuts out before it can kill you
  if (r.isPlayer) r.surging = (surging || race.autoSurge === true) && !r.spent && r.stam > r.stamMax * 0.08;
  else {
    r.aiTimer -= dt;
    if (r.aiTimer <= 0) {
      r.aiTimer = 1.1 + rand() * 2.6;
      r.aiOn = r.livePlace > AI_SURGE_FROM && rand() < 0.26 + r.sn.greed * 0.4;
    }
    // A band, not a threshold: they come off the button with most of the bar
    // still in it and let it come back before they spend it again. A long,
    // lean spending pattern would leave the whole field permanently boosted
    // and there would be nothing left to spend the bar on.
    if (r.aiOn && r.stam < Math.max(r.stamMax * 0.45, AI_SURGE_MIN)) r.aiOn = false;
    // and they stop the moment they get back into the places that do not
    // need the bar, rather than sitting on it to the line
    if (r.aiOn && r.livePlace <= AI_SURGE_FROM) r.aiOn = false;
    r.surging = r.aiOn && !r.spent && r.stam > surgeFloor;
  }
  let drain = (PASSIVE_DRAIN + 0.04 * (24 - stamStat)) * race.tr.drain;
  if (r.surging && !r.spent) { target *= SURGE_MULT; drain += SURGE_DRAIN; }
  // run dry and you are down to a quarter speed until the bar comes back
  if (r.stam <= 0) r.spent = true;
  if (r.spent && r.stam > r.stamMax * 0.18) r.spent = false;
  if (r.spent) target *= TIRED_MULT;
  r.v += (target - r.v) * Math.min(1, dt * 5);
  r.v = clamp(r.v, 0, 12);
  r.stam = r.spent ? r.stam + (REGEN - drain) * dt : r.stam - drain * dt;
  r.stam = clamp(r.stam, 0, r.stamMax);
  r.cond = cond;

  // and a crate, which advances the snail itself because a snail cannot outrun
  // the crate it is pushing and cannot reach the lip while the crate is still on
  // the road
  if (r.state === 'push') stepCrate(r, dt);
  else if (r.state !== 'air') r.s += r.v * dt;

  // did we just leave the lane at a cliff edge?
  const lp = tr.leaps[r.leapIdx];
  if (lp && r.state === 'run' && !lp.crate && r.s >= lp.s0) {
    r.leap = lp;
    r.leapIdx++;
    r.sh = leapShot(r, r.v);
    r.state = 'air';
    r.airStart = r.s;
    r.airT = 0;
    r.airY = lp.lipY;
    r.v = r.sh.vx;
  }
  if (r.leap && r.state === 'swim' && r.s >= r.leap.s1) {
    r.state = 'run';
    // coming out of the water: a ring at the edge, and the snail rides up
    // the bank rather than jumping to the top of the far cliff
    r.y = Math.min(r.y, r.fr.y);
    spawnRipple(r, r.leap.waterY, 1.1);
  }
  // and rings spreading while they work their way across
  if (r.state === 'swim' && r.leap && Math.random() < dt * 2.2) {
    spawnRipple(r, r.leap.waterY, 0.7);
  }

  // the lane they hold, drifting slowly so the field spreads out - and the lane is
  // a share of the half-width, so a road that opens out for a crate opens the
  // field out with it rather than leaving eight boxes on the line they started on.
  // **The drift is read off that same width**, which is what stops it across a
  // shove: a crate that wanders a hundred and twenty either side of the line its
  // snail is holding is a crate in its neighbour, 37 of pitch against 620 of box
  // and two hundred of overlap, and a snail with its hands on a box walks it
  // straight.
  const open = clamp((r.fr.w - LANE_HW) / (CRATE_HW - LANE_HW), 0, 1);
  r.lane = clamp(r.laneF * (r.fr.w - 0.5) + 0.12 * (1 - open) * Math.sin(clock * 0.5 + r.wob),
    -(r.fr.w - 0.35), r.fr.w - 0.35);

  if (r.s >= tr.finish) {
    r.s = tr.finish;
    r.finished = true;
    r.finishT = race.t;
    // it is over: drop the bar, or the snail parks at the line trailing
    // speed lines for the rest of the race
    r.surging = false;
    r.aiOn = false;
  }
}

function stepRace(dt) {
  if (race.phase === 'countdown') {
    race.cd -= dt;
    if (race.cd <= 0) { race.phase = 'running'; race.t = 0; flashGo(); }
    return;
  }
  if (race.phase !== 'running') return;
  race.t += dt;
  markLiveOrder();
  for (const r of race.racers) stepRacer(r, dt);
  placeAll();
  // the race is over when the field is in; you get to watch the rest come in
  if (race.racers.every((r) => r.finished) || race.t > 300) finishRace();
  else if (race.t % 0.1 < dt) updateHUD();
}

function finishRace() {
  if (race.phase === 'done') return;
  race.phase = 'done';
  const order = race.racers.slice().sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return a.finished ? a.finishT - b.finishT : b.s - a.s;
  });
  const entries = order.map((r, i) => {
    r.place = i + 1;
    r.points = i < POINTS.length ? POINTS[i] : 0;
    return r;
  });
  const me = race.player;
  // the season ledger
  const rec = {
    catId: race.catId,
    place: me.place, points: me.points, time: me.finishT,
    length: race.tr.length,
    // the hour on the clock when the flag fell, which is the race's own
    hour: raceHour(race.catId === seasonFinaleId(state.tier)) + me.finishT * HOURS_PER_SECOND,
    field: entries.map((r) => ({
      name: r.sn.name, id: r.sn.id, place: r.place, points: r.points, player: r.isPlayer,
      time: r.finished ? r.finishT : 0, dRating: 0, rating: 0, wasRating: 0,
    })),
  };
  state.results.push(rec);
  // The season is under way, so its seven are settled: drop the draw it was
  // previewed from, and the next season gets a grid of its own rather than the
  // one this season was set up with.
  delete SEASON_FIELD[state.tier + ':' + state.season];
  state.pts += me.points;
  state.races++;
  // A place on the road is a purse: the points you scored are the gold you
  // come home with, so a good race is the only way to feed the snail.
  state.gold += me.points;
  $('goldOut').textContent = state.gold;
  if (me.place === 1) state.wins++;
  // A rating is a running average of the points you have scored, so every
  // finish moves it up or down - including the ones that cost you. The change
  // is recorded per snail, yours and theirs, because a field that only ever
  // climbs is not a field you can read.
  const wasRating = state.rating;
  state.rating = ratingFor(state.pts, state.races, wasRating);
  for (let i = 0; i < entries.length; i++) {
    const r = entries[i], row = rec.field[i];
    if (r.isPlayer) {
      row.dRating = state.rating - wasRating;
      row.rating = state.rating;
      row.wasRating = wasRating;
      continue;
    }
    const p = state.pool[r.sn.id];
    const was = p.rating;
    p.races++;
    p.pts += r.points;
    p.wins += r.place === 1 ? 1 : 0;
    p.avg = (p.avg * (p.races - 1) + r.place) / p.races;
    p.rating = ratingFor(p.pts, p.races, was);
    row.dRating = p.rating - was;
    row.rating = p.rating;
    row.wasRating = was;
  }
  race.result = rec;
  save();
  showResults(rec);
}
/* ================================================================== *
 * The stable: your snail on a plinth, slowly turning
 * ================================================================== */
const stageEnv = makeEnv(34, 150);
const stageScene = stageEnv.scene;
const stageBackdrop = makeBackdrop(881);
stageScene.add(stageBackdrop);
// **The lamp glows are made here, once, on both environments.** They are sixteen
// sprites plus one each, and the effects row only moves their `visible` and their
// scale - so they are never torn down and never rebuilt, which is what makes the
// first rung of the effects ladder free apart from the sixteen draws.
addGlows(env);
addGlows(stageEnv);

/**
 * The stable's pool, and the fountain that stands in it.
 *
 * It stands proud of the lawn rather than being cut into it, and that is the
 * whole reason: the stage is one flat disc with no hole in it, so a basin below
 * the grass would be a pool you could not see the bottom of. A raised basin is
 * also what the thing it is modelled on does, so it is lucky twice.
 *
 * The water is `poolWaterMat()` - a copy of `mat.water` with the same two ripple
 * normals and the same shared drift uniform, so the water on the hub is the
 * county's water and not a blue disc, and it is a copy rather than the material
 * itself because the hub's basin has to carry a reflection probe of its own like
 * any other pool. The pool is not put in `waterMeshes`, which is the list of the
 * surfaces the swell is animated on: a still pond with moving ripples on it is
 * right, and rewriting six hundred vertices a frame for a menu screen is not.
 */
const POOL = { x: 10.8, z: 1.4, apron: 7.2, water: 0.30, coping: 0.52, fountain: 1.5, tile: 4.4 };
/** The inside of the basin, from the waterline in to the middle: the floor. */
const POOL_INNER = [[5.60, 0.30], [4.80, 0.18], [3.40, 0.10], [1.60, 0.07], [0.00, 0.06]];
/** How high the floor of the basin is at `r` metres out, for anything stood in it. */
function poolFloorY(r) {
  for (let i = 0; i < POOL_INNER.length - 1; i++) {
    const [r0, y0] = POOL_INNER[i], [r1, y1] = POOL_INNER[i + 1];
    if (r <= r0 && r >= r1) return lerp(y0, y1, (r0 - r) / (r0 - r1));
  }
  return POOL_INNER[POOL_INNER.length - 1][1];
}
/** three wants its lathes as points, and a section is written as [radius, height]. */
const turn = (section, seg) => new THREE.LatheGeometry(
  section.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function stagePool() {
  const group = new THREE.Group();
  group.position.set(POOL.x, 0, POOL.z);
  // Cut stone, for the pool's basin and its paving: the same marble the fountain
  // is made of and the snail's plinth is cut from, projected rather than sampled
  // by uv because a lathe built here has none, and laid on at a third of its
  // strength because it is a multiplier and not a colour.
  const masonry = triplanarDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    mapTex('marble-n'), 0.62, 0.5, mapTex('marble-albedo'), 0.62, 1);
  // the basin, turned from a cross-section: up the outside, over the coping,
  // and back down the inside to the middle of the floor, which is the way round
  // that leaves every one of those faces pointing where it can be seen from
  const basin = new THREE.Mesh(
    colored(turn([
      [6.10, 0.00], [6.18, 0.12], [6.12, 0.34], [6.10, 0.46], [6.24, POOL.coping], [5.98, POOL.coping],
      [5.86, 0.40],
    ].concat(POOL_INNER), 72), (x, y, z, c) => {
      const d = Math.hypot(x, z);
      c.copy(PAL.stoneB).lerp(PAL.stoneA, clamp((y - 0.08) / 0.44, 0, 1));
      // a wet line just above the water, and the dark a deep floor holds
      if (y < POOL.water + 0.05) c.lerp(PAL.stoneB, 0.5 * (1 - (y - 0.06) / 0.3));
      c.multiplyScalar(0.9 + 0.2 * vnoise(x * 0.9, z * 0.9 + y * 2.0));
      // The coping lies flat and takes the whole of the sun, and a flat stone at
      // this albedo under a noon key tone maps to white - so the top of it is
      // the county's earth rather than its cut stone, and takes the moss that
      // has always been on the edge of a pool.
      if (d > 5.9) c.lerp(PAL.earth, 0.4 + 0.35 * vnoise(x * 3.1, z * 3.1));
    }), masonry);
  basin.castShadow = true; basin.receiveShadow = true;
  group.add(basin);
  // the apron: paving laid in rings round the coping, dished very slightly so it
  // runs the water off, and jointed every half metre and every fifteenth of the
  // turn, which is the one thing that says laid rather than found
  const apron = new THREE.Mesh(
    colored(turn([
      [7.34, -0.02], [7.24, 0.04], [6.7, 0.08], [6.24, 0.10],
    ], 72), (x, y, z, c) => {
      const d = Math.hypot(x, z), a = Math.atan2(z, x);
      const ring = Math.abs((d % 0.62) - 0.31) / 0.31;
      const spoke = Math.abs(((a / TAU * 15 + 30) % 1) - 0.5) * 2;
      c.copy(PAL.stoneA).lerp(PAL.earth, (1 - Math.min(ring, spoke)) * 0.75);
      c.multiplyScalar(0.84 + 0.2 * vnoise(x * 1.7, z * 1.7));
    }), masonry);
  apron.receiveShadow = true;
  group.add(apron);
  // the water: a disc, its uvs in the ripple's own tile rather than its own, and
  // its colour deep in the middle and pale at the edge, as a course's pool is.
  // The tile is twice the course one, and that is a decision about size: a
  // two-metre ripple on eleven metres of water is five repeats of a fine normal
  // map seen from twenty metres away, which is not water, it is a field of
  // white dots. A course's pool is looked at from the bank; this one is looked
  // at across a lawn.
  const wg = new THREE.CircleGeometry(5.62, 64);
  wg.rotateX(-Math.PI / 2);
  const wp = wg.attributes.position, wuv = new Float32Array(wp.count * 2);
  for (let i = 0; i < wp.count; i++) {
    wuv[i * 2] = wp.getX(i) / POOL.tile;
    wuv[i * 2 + 1] = wp.getZ(i) / POOL.tile;
  }
  wg.setAttribute('uv', new THREE.BufferAttribute(wuv, 2));
  const water = new THREE.Mesh(colored(wg, (x, y, z, c) => {
    c.copy(PAL.waterA).lerp(PAL.waterB, Math.pow(Math.hypot(x, z) / 5.62, 2.1) * 0.9);
    c.lerp(PAL.waterB, 0.2 * vnoise(x * 1.4, z * 1.4));
  }), poolWaterMat());
  water.position.y = POOL.water;
  water.renderOrder = 3;
  // the probe stands over the middle of the basin, half a metre above the water
  water.userData.probeAt = new THREE.Vector3(POOL.x, POOL.water + 0.5, POOL.z);
  group.add(water);
  // the fountain, at the scale a twelve-metre pool wants
  const f = new THREE.Mesh(props.fountain, matFor('fountain', mat.rock));
  f.position.y = poolFloorY(0);
  f.scale.setScalar(POOL.fountain);
  f.castShadow = true; f.receiveShadow = true;
  group.add(f);
  // and the water coming out of it: four arcs off the pedestal spouts and one
  // falling column off the finial, each on its own phase so the fountain is
  // never pulsing in lockstep with itself
  const spray = new THREE.MeshStandardMaterial({
    color: PAL.waterB, roughness: 0.14, metalness: 0, transparent: true, opacity: 0.46, depthWrite: false,
  });
  const jets = [];
  const jet = (from, mid, to, rad, phase) => {
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, rad, 6, false), spray);
    m.renderOrder = 4;
    m.userData.phase = phase;
    group.add(m);
    jets.push(m);
    return m;
  };
  const spout = 1.16 * POOL.fountain, reach = 0.45 * POOL.fountain;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const m = jet(
      new THREE.Vector3(reach, spout + poolFloorY(0) + 0.1, 0),
      new THREE.Vector3(reach * 2.6, spout + 0.55, 0),
      new THREE.Vector3(reach * 5.4, POOL.water, 0), 0.055, i * 1.7);
    m.rotation.y = -a;
  }
  jet(new THREE.Vector3(0, 2.3 * POOL.fountain + poolFloorY(0), 0),
    new THREE.Vector3(0, 1.5 * POOL.fountain, 0),
    new THREE.Vector3(0, POOL.water, 0), 0.09, 3.1);
  return { group, jets, water };
}
/** Whether a spot on the lawn is where the pool is, and so is spoken for. */
const onThePool = (x, z, pad = 0) => {
  const dx = x - POOL.x, dz = z - POOL.z;
  return dx * dx + dz * dz < (POOL.apron + pad) ** 2;
};

/**
 * A prop put out on the lawn, instanced.
 *
 * `scatter()` deals in lane space and the stable has no lane, so this is the
 * same idea with a placement function in place of a track sample: one geometry,
 * one draw call, a per-instance matrix and a per-instance tint, and the
 * unplaced instances written as a zero-scale matrix rather than left as a unit
 * cube sitting on the origin. It is the only way to get a lawn that looks like
 * a lawn - grass wants to be in the thousands, and forty-six separate meshes is
 * neither thousands nor forty-six draw calls' worth of anything.
 */
function planted(name, material, count, place, opts = {}) {
  // A prop of more than one part is **one placement** and several meshes: the
  // stalk, the cap and the gills of a mushroom are three pieces of one thing
  // standing in one spot, and they are only one thing if they are all drawn
  // through the same matrix - two InstancedMeshes with the placements worked out
  // separately put the cap somewhere the stalk is not, and there is no warning
  // for it. So the placements are settled here, once, and every part is then
  // built out of them.
  const o = new THREE.Object3D(), tint = new THREE.Color(), none = new THREE.Object3D();
  none.scale.setScalar(0);
  none.updateMatrix();
  /**
   * **The density rows are read here, once**, rather than multiplied into twenty
   * counts at twenty call sites: `opts.density` says which row this piece answers
   * to, and everything on the lawn that is not grass answers to the prop row.
   * This is the stable's counterpart to the one multiply in `scatter()`, and it
   * is the same shape of change for the same reason - it scales the *count* and
   * never the draws, so the arrangement at a different density is the same
   * arrangement with more or fewer things in it and the lawn does not reshuffle.
   */
  const mul = opts.density === 'grass' ? gfxGrassDensity()
    : opts.density === 1 ? 1 : gfxPropDensity();
  const want = Math.max(1, Math.round(count * mul));
  const mats = [], cols = [];
  let n = 0;
  for (let i = 0; i < want * 8 && n < want; i++) {
    const p = place(i, n);
    if (!p) continue;                       // no room here; the next draw is another metre away
    // and nothing is stood on the plinth, whatever the caller asked for. The
    // rockery round the pool is placed on a ring, and a ring that size reaches
    // the middle of the lawn from the far side of the water, and a two-metre
    // boulder arriving on the snail's stone is the one piece of scenery the
    // snail cannot race past. `clear` is how much room to leave, and the grass
    // asks for less of it than anything else: it is the one thing that belongs
    // right up against the plinth.
    if (p.x * p.x + p.z * p.z < (opts.clear === undefined ? 2.2 : opts.clear) ** 2) continue;
    o.position.set(p.x, p.y || 0, p.z);
    o.rotation.set(p.tilt ? (opts.lean || 0.5) * p.tilt * 0.5 : 0, p.rot || 0, p.tilt ? (opts.lean || 0.5) * p.tilt * 0.5 : 0);
    // `squash` is for the things that are wider than they are tall, and a tuft
    // of grass is the one that matters: the county's tuft is drawn as a cone,
    // and a cone standing in a lawn reads as a small pine tree until it is
    // squashed back down into the shape of a plant
    o.scale.set(p.scale, p.scale * (p.squash || 1), p.scale);
    o.updateMatrix();
    mats.push(o.matrix.clone());
    tint.setScalar(p.tint === undefined ? 1 : p.tint);
    cols.push(tint.clone());
    n++;
  }
  const parts = props[name + '.parts'];
  const list = parts
    ? Object.values(parts).map((geo) => ({ geo, material: partMat(geo, material) }))
    : [{ geo: props[name], material: matFor(name, material) }];
  const meshes = list.map(({ geo, material: mat }) => {
    const im = new THREE.InstancedMesh(geo, mat, want);
    im.castShadow = opts.shadow !== false;
    im.receiveShadow = true;
    // the shadows row's flag, stamped here for the same reason `scatter()` stamps
    // it: the stage is rebuilt on every density and casting change, so a flag
    // applied by walking has to be reapplied every time and a flag applied at
    // build is simply there
    if (im.castShadow) im.userData.gfxCast = true;
    for (let i = 0; i < want; i++) im.setMatrixAt(i, i < n ? mats[i] : none.matrix);
    for (let i = 0; i < want; i++) im.setColorAt(i, i < n ? cols[i] : WHITE);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // one sphere around the whole lot, so it has to be worked out after the last
    // matrix is written: a scatter that culls on a sphere it guessed at is a
    // scatter that vanishes at the edge of the frame
    im.computeBoundingSphere();
    return windMark(im);
  });
  if (meshes.length === 1) return meshes[0];
  const g = new THREE.Group();
  for (const im of meshes) g.add(im);
  return g;
}

/** The stable, built. Null between a `dropStage()` and the `restage()` that
 *  follows it, and `let` rather than `const` for that reason and no other. */
let stage = null;

/**
 * A whole stable, built and standing on the stage scene: the lawn, the rim, the
 * snail's stone, the pool and its fountain, the grass, the stones, the grove, the
 * palms and the snail.
 *
 * **A function and not a one-time IIFE**, because the options menu changes how
 * many of those there are and the settings behind it have to be *seen*. It used
 * to be built once at module scope, which is why a density step would have had
 * to either take effect on the next boot or reach inside a built scene and guess
 * which of six thousand meshes was a thing it could remove. So it is built, and
 * dropped, the way a course is built and dropped - see `dropStage()`.
 *
 * The seed stays at `1177` for the same reason it always was: the lawn is an
 * arrangement, and re-dealing it on every settings click would shuffle the whole
 * county under the modal. The densities multiply the *counts*, never the draws,
 * so the same seed at a different count is the same lawn with more or fewer
 * things in it.
 */
function buildStage() {
  const s = new THREE.Group();
  const disc = new THREE.Mesh(
    colored(new THREE.CircleGeometry(58, 40), (x, y, z, c) => {
      const n = fbm(x * 0.09, z * 0.09, 3);
      c.copy(PAL.grassA).lerp(PAL.grassB, n * 0.9);
      c.lerp(PAL.dry, Math.max(0, n - 0.62) * 1.6);
      c.multiplyScalar(0.90 + 0.20 * vnoise(x * 0.5, z * 0.5));
    }),
    // The same county the courses are cut through, but seen from a metre away
    // rather than from a snail, so both halves of it are finer than they are on
    // a course. The normal goes on at a forty-centimetre tile, which is the
    // grain the sun catches. The colour goes on much coarser - a metre and a
    // half - and that is not a compromise but the only tile that reads at all
    // from a camera a metre and a half off the ground: the stems in that map
    // are a centimetre and a half, which is what a lawn is made of at a distance
    // of a few metres and is one pixel long at twenty. The vertex colours above
    // carry the low frequency - where the lawn is dry and where it is deep -
    // and there is one vertex in the middle of this disc, so everything between
    // a metre and a hundred has to be the map.
    //
    // The gain is **1.20**, and it is not the map's mean put back - the mean of
    // the map this wears is 0.58 linear, so parity would be **1.73**, and the
    // 1.20 leaves the surface at 0.69 of its vertex colour, which is the number
    // this county's turf wants whatever map is under it. A map that puts its
    // mean back exactly spends its ceiling: at 1.73 nearly half the texels of
    // this one arrive as white, which is a lawn with the shadow taken out of it.
    //
    // It has moved twice and both times it is the map's *mean* that moved under
    // a constant: the surface brightness is the thing being held still, so a
    // rebuild that changes how much blade the map carries pays for it in the gain
    // rather than in a lawn that goes pale. It was 1.45 on the 1024 map, whose
    // mean was 0.47, and 1.79 before that. What the gain is buying is range: the
    // shadow floor sits four times below the mean, where the map from before all
    // of this sat at 1.39, and a lit turf is dark anyway, so the range is worth
    // more than the brightness.
    //
    // It is the same number `mat.course` and `mat.grass` use because it is the
    // same map.
    //
    // And the two tiles disagree on purpose, which is the one place in the
    // county they do: the normal here is still `ground-n` rather than
    // `grass-n`, so the disc is not in register with its own colour the way the
    // courses are. That is left alone because a disc the size of the lawn with a
    // camera a metre and a half off it wants the coarser, older grain in the
    // normal and the finer one in the colour, and swapping the normal over is a
    // change to the hub rather than to the courses. The last argument is the
    // declaration: `triplanarDetail` warns about a colour on a different tile
    // from its normal, and this is the one call that is allowed to.
    triplanarDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      detailOf('ground', 'normalMap'), 2.4, 0.9, detailOf('ground', 'map'), 0.7, 1, 1.20, true)
  );
  disc.rotation.x = -Math.PI / 2;
  disc.receiveShadow = true;
  s.add(disc);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(58.1, 57, 2.4, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x6f5f43, roughness: 1, side: THREE.DoubleSide })
  );
  rim.position.y = -1.2;
  s.add(rim);
  // The snail's own stone, and the one piece of the county that is cut rather
  // than found, so it is the marble: a twelve-sided drum and its cap, the same
  // map the fountain and the pool's paving wear, projected rather than sampled
  // because `bake()` writes a position, a normal and a colour and no uv at all.
  // The vertex colours are a shade under the marble's own so that a pale stone
  // in full sun is a pale stone and not a white one - the map multiplies them,
  // and a plinth that was reading as a lump of chalk is a fault in the value,
  // not in the grain.
  const plinth = new THREE.Mesh(
    bake([
      { g: new THREE.CylinderGeometry(0.92, 1.06, 0.34, 12), m: M(0, 0.17, 0), c: [0.46, 0.45, 0.42] },
      { g: new THREE.CylinderGeometry(0.82, 0.88, 0.12, 12), m: M(0, 0.38, 0), c: [0.62, 0.60, 0.57] },
    ]),
    triplanarDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
      mapTex('marble-n'), 0.9, 0.45, mapTex('marble-albedo'), 0.9, 1)
  );
  plinth.castShadow = true; plinth.receiveShadow = true;
  s.add(plinth);
  // The key light's shadow is a twenty-six metre box round the plinth, which is
  // the right box for a snail on a stone and much too small for a lawn with a
  // pool and a grove on it: at that width nothing past the plinth had a shadow
  // at all, and a tree with no shadow stands on the grass like a sticker. The
  // hub's box is wider, and its shadows are coarser - fifty-one texels to the
  // metre at 2048, and the snail is the only thing here close enough to read
  // the difference.
  {
    const cam = stageEnv.key.shadow.camera;
    cam.left = -30; cam.right = 30; cam.top = 30; cam.bottom = -14;
    cam.far = 50;
    cam.updateProjectionMatrix();
  }
  // the pool, off to one side so the snail has the middle of the lawn to itself
  // and the water comes into frame and out of it as the camera goes round
  const pool = stagePool();
  s.add(pool.group);
  /**
   * The lawn. Grass first, because grass is what a lawn is: the ring of
   * forty-six pieces this replaces left the middle of it bare, and a bare
   * middle is what makes half the orbit look like nothing is out there at all.
   * Everything below is instanced and everything is spread over the whole disc,
   * so that whichever way the camera happens to be facing there is country in
   * front of the snail.
   */
  const lr = makeRng(1177);
  /** Open lawn between `r0` and `r1` metres out, and null where it is spoken for. */
  const onLawn = (r0, r1, pow = 1) => () => {
    const a = lr() * TAU;
    const d = r0 + (r1 - r0) * Math.pow(lr(), pow);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (d < 1.75 || onThePool(x, z, 0.35)) return null;
    return { x, z, scale: 0.55 + lr() * 0.85, rot: lr() * TAU, tilt: 0.1, tint: 0.84 + lr() * 0.32 };
  };
  /** The rockery: a band round the pool, off the paving. */
  const onTheRing = (r0, r1) => () => {
    const a = lr() * TAU, d = r0 + (r1 - r0) * lr();
    return {
      x: POOL.x + Math.cos(a) * d, z: POOL.z + Math.sin(a) * d,
      rot: lr() * TAU, tilt: 0.1, tint: 0.86 + lr() * 0.3,
    };
  };
  /**
   * How big a stone is at `d` metres out from the middle of the lawn: small
   * round the snail, large out in the country.
   *
   * That is what the eye wants and it is the only thing that works with a
   * camera this low. A stone four metres away is an object and has to be a
   * believable size - a metre and a bit, the size the county's stones are - and
   * the same stone forty metres away is a shape on the skyline, where the only
   * thing it can be is big. It also stops the lawn reading as a gravel path:
   * stones of one size scattered evenly are a surface, and stones that grow
   * with the distance are a country.
   */
  const rockSize = (d, lo, hi) => {
    const t = clamp((d - 2.5) / 23);
    return (lo + (hi - lo) * t * t * (3 - 2 * t)) * (0.88 + lr() * 0.24);
  };
  /** A stone, at the size a stone is from where it stands. */
  const stoneAt = (p, lo, hi) => (p ? Object.assign(p, { scale: rockSize(Math.hypot(p.x, p.z), lo, hi) }) : null);
  // the grass itself: in the thousands, and thicker towards the middle, because
  // the middle is the part the camera is standing in. A tuft at full size is
  // forty centimetres of spike, which in this many reads as a field of shark
  // fins rather than as grass, so they go in at about two thirds of it.
  s.add(planted('tuft', mat.grass, 3600, () => {
    const a = lr() * TAU;
    const d = 1.35 + 27 * Math.pow(lr(), 1.25);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 0.3)) return null;
    return { x, z, scale: 0.3 + lr() * 0.5, squash: 0.62, rot: lr() * TAU, tilt: 0.22, tint: 0.8 + lr() * 0.42 };
  }, { shadow: false, clear: 1.3, density: 'grass' }));
  // and a thinner band of it out past where the middle one runs, so the lawn
  // carries on to the hills instead of stopping in a ring
  s.add(planted('tuft', mat.grass, 1500, () => {
    const a = lr() * TAU;
    const d = 27 + 19 * Math.pow(lr(), 0.6);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 0.3)) return null;
    return { x, z, scale: 0.38 + lr() * 0.56, squash: 0.62, rot: lr() * TAU, tilt: 0.22, tint: 0.8 + lr() * 0.4 };
  }, { shadow: false, clear: 1.3, density: 'grass' }));
  // Stones, at the size a stone is from where it stands: a yard of rubble round
  // the plinth and boulders out past the trees.
  s.add(planted('rock', mat.rock, 64, () => stoneAt(onLawn(3, 27, 0.75)(), 0.4, 1.7)));
  s.add(planted('mossy-rock', mat.rock, 34, () => stoneAt(onLawn(3.5, 26, 0.75)(), 0.4, 1.5)));
  // No bushes on the lawn. A bush in this county is a green mass standing in
  // two pale stones, and at the scale a course gives it those stones read as
  // stones - but a lawn is looked at from a metre and a half with nothing
  // between the eye and them, and at that range they read as plates of white
  // lying in the grass. There are five thousand tufts here instead, and they do
  // the green that the bush was only ever being asked to do.
  // the rockery the pool is cut into, and the bank of big stones behind it
  s.add(planted('rock', mat.rock, 18, () => stoneAt(onTheRing(POOL.apron + 0.45, POOL.apron + 1.9)(), 0.45, 1.8)));
  s.add(planted('mossy-rock', mat.rock, 12, () => stoneAt(onTheRing(POOL.apron + 0.4, POOL.apron + 1.6)(), 0.45, 1.6)));
  s.add(planted('rock', mat.rock, 5, () => {
    const a = lr() * TAU, d = POOL.apron + 4.6 + lr() * 3.4;
    const x = POOL.x + Math.cos(a) * d, z = POOL.z + Math.sin(a) * d;
    if (Math.hypot(x, z) < 10) return null;      // a big stone close in is a third of the screen
    return { x, z, scale: 1.5 + lr() * 0.9, rot: lr() * TAU, tilt: 0.06, tint: 0.9 + lr() * 0.2 };
  }));
  // and the far country: boulders out past the grass, which is what the hills
  // are made of and the only thing that stops the lawn ending in a ring
  s.add(planted('rock', mat.rock, 40, () => {
    const a = lr() * TAU, d = 28 + 18 * Math.pow(lr(), 0.6);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 1)) return null;
    return { x, z, scale: 1.5 + lr() * 1.2, rot: lr() * TAU, tilt: 0.06, tint: 0.86 + lr() * 0.28 };
  }));
  s.add(planted('mossy-rock', mat.rock, 18, () => {
    const a = lr() * TAU, d = 30 + 17 * Math.pow(lr(), 0.6);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 1)) return null;
    return { x, z, scale: 1.4 + lr() * 1.1, rot: lr() * TAU, tilt: 0.06, tint: 0.86 + lr() * 0.28 };
  }));
  // The county's mushrooms, out in the far country where the lawn is going
  // anyway: four of them on even azimuths, thirty metres out and a little
  // further, so a giant one comes up over the horizon behind the grove and
  // there is a landmark in every direction. Nothing within twenty-five metres
  // of the snail, because a mushroom is five and a half metres tall and ten
  // across, and the camera walks a four-metre circle.
  s.add(planted('mushroom-giant', mat.foliage, 4, (i) => {
    const a = (i / 4) * TAU + 0.9;
    const d = 31 + lr() * 9;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 3)) return null;
    return { x, z, scale: 1.15 + lr() * 0.6, rot: lr() * TAU, tilt: 0.02, tint: 0.86 + lr() * 0.26 };
  }));
  s.add(planted('mushroom-rooted', mat.foliage, 3, (i) => {
    const a = (i / 3) * TAU + 2.1;
    const d = 27 + lr() * 8;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 3)) return null;
    return { x, z, scale: 1 + lr() * 0.5, rot: lr() * TAU, tilt: 0.02, tint: 0.86 + lr() * 0.26 };
  }));
  /**
   * A grove on the far side of the lawn from the pool, and a few trees loose
   * elsewhere. The pool fills one half of the orbit and the trees fill the
   * other, which is the whole of the fix for an angle with nothing in it: the
   * two sit almost exactly opposite each other, and between them every degree
   * of the circle has something at the far end of it.
   */
  const grove = { x: -12.6, z: -1.6 };
  const inGrove = (spread) => () => {
    const a = lr() * TAU, d = Math.pow(lr(), 0.55) * spread;
    return {
      x: grove.x + Math.cos(a) * d, z: grove.z + Math.sin(a) * d,
      scale: 0.85 + lr() * 0.85, rot: lr() * TAU, tilt: 0.05, tint: 0.8 + lr() * 0.34,
    };
  };
  s.add(planted('conifer', mat.foliage, 11, inGrove(15)));
  s.add(planted('evergreen', mat.foliage, 8, inGrove(14)));
  s.add(planted('broadleaf', mat.foliage, 7, inGrove(13.5)));
  s.add(planted('conifer', mat.foliage, 5, onLawn(19, 29, 0.7)));
  s.add(planted('evergreen', mat.foliage, 4, onLawn(17, 27, 0.7)));
  s.add(planted('broadleaf', mat.foliage, 4, onLawn(17, 28, 0.7)));
  /**
   * The palms go round the whole lawn rather than round the pool, on twelve
   * even azimuths, because a palm at a given angle is the one thing in this
   * scene tall enough to be in frame from a camera a metre and a half off the
   * ground - and the complaint that started all this was an angle with nothing
   * in it. Nothing stands within twelve and a half metres of the middle, since
   * the camera walks a three-point-nine metre circle and anything inside that
   * is a bare trunk across the screen every twenty seconds.
   */
  s.add(planted('palm', mat.foliage, 12, (i) => {
    const a = (i / 12) * TAU + 0.7 + (lr() - 0.5) * 0.4;
    const d = 13.5 + lr() * 12;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onThePool(x, z, 1.4)) return null;
    return { x, z, scale: 0.85 + lr() * 0.4, rot: lr() * TAU, tilt: 0.03, tint: 0.9 + lr() * 0.25 };
  }));
  // and what is in the water: reeds standing on the floor of it, and pads
  // floating on the top of it
  s.add(planted('reeds', mat.foliage, 13, () => {
    const a = lr() * TAU, d = 3.4 + lr() * 2.1;
    return {
      x: POOL.x + Math.cos(a) * d, z: POOL.z + Math.sin(a) * d, y: poolFloorY(d),
      scale: 0.8 + lr() * 0.5, rot: lr() * TAU, tilt: 0.1, tint: 0.9 + lr() * 0.25,
    };
  }));
  s.add(planted('lily-pad', mat.foliage, 8, () => {
    const a = lr() * TAU, d = 1.2 + lr() * 3.6;
    return {
      x: POOL.x + Math.cos(a) * d, z: POOL.z + Math.sin(a) * d, y: POOL.water + 0.015,
      scale: 0.7 + lr() * 0.6, rot: lr() * TAU, tint: 0.9 + lr() * 0.25,
    };
  }, { shadow: false }));
  const snail = makeSnail({ body: state.body, shell: state.shell, style: state.style });
  snail.group.scale.setScalar(SNAIL_SCALE * 1.6);   // on the plinth, it is the only thing on show
  snail.group.position.y = 0.44;
  s.add(snail.group);
  return { group: s, snail, pool, spin: 0 };
}

/**
 * Take the stable off the stage scene and give its memory back, mirroring
 * `dropCourse()`. `planted()`'s meshes are instanced and are disposed as such;
 * the meshes `bake()` built for the plinth and the fountain's stonework are
 * disposed as geometry.
 *
 * The snail is the one thing that is *not* walked: `makeSnail()` clones a
 * template and rewrites the foot's own copy of the geometry every frame, so the
 * clone has to be handed back through its own `dispose()` and not by traversal.
 */
function dropStage() {
  const st = stage;
  if (!st) return;
  stageScene.remove(st.group);
  st.group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
  st.snail.dispose();
  // the pool's own water material, and the probe hanging off it
  if (st.pool && st.pool.water) {
    const p = st.pool.water.material.userData.probe;
    if (p) dropProbe(p);
    st.pool.water.material.dispose();
  }
  stage = null;
}

/**
 * Put the stable back. Debounced, because rebuilding five thousand tufts and a
 * dozen groves on every button click is a stutter, and the button grid is one
 * where a player clicks five times in two seconds.
 */
let restageTimer = 0;
function requestRestage() {
  clearTimeout(restageTimer);
  restageTimer = setTimeout(() => {
    restageTimer = 0;
    restage();
    gfxStageDirty = false;
  }, 150);
}
function restage() {
  dropStage();
  stage = buildStage();
  stageScene.add(stage.group);
  // the snail's colours are not a build parameter - they are a save - so a
  // rebuild has to be handed them again, and `applyLook()` also refreshes the two
  // colour inputs and the style buttons, which is exactly what a rebuild wants
  applyLook();
  gfxCastApplied = null;
  applyShadows();
  syncProbes();
}

/** Set by whichever row changes need a stage rebuild to be visible. */
let gfxStageDirty = false;
function applyLook() {
  stage.snail.def.body = state.body;
  stage.snail.def.shell = state.shell;
  stage.snail.mats[0].color.setHex(state.body);
  stage.snail.mats[2].color.setHex(state.body);
  stage.snail.mats[3].color.setHex(state.body);
  stage.snail.mats[1].color.setHex(state.shell);
  stage.snail.setShellStyle(state.style);
  for (const el of document.querySelectorAll('#styles button')) el.classList.toggle('sel', el.dataset.s === state.style);
  $('bodyColor').value = '#' + state.body.toString(16).padStart(6, '0');
  $('shellColor').value = '#' + state.shell.toString(16).padStart(6, '0');
}

/* ================================================================== *
 * Camera and the main loop
 * ================================================================== */
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.3, 1400);
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), orbit: 0 };
// the backdrop sits with the course, so a course that climbs a long way
// still has country round it instead of a skyline underneath its feet
let backLift = 0;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _fr2 = newFrame(), _fr3 = newFrame();
let mode = 'stable';
let clock = 0;

function fieldCentre(out) {
  out.set(0, 0, 0);
  for (const r of race.racers) out.add(r.model.group.position);
  return out.multiplyScalar(1 / Math.max(1, race.racers.length));
}

function stageFrame(dt) {
  stage.spin += dt * 0.22;
  const a = stage.spin;
  camera.position.set(Math.cos(a) * 3.9, 1.55 + Math.sin(a * 0.7) * 0.16, Math.sin(a) * 3.9);
  camera.lookAt(0, 0.74, 0);
  stage.snail.group.rotation.y = -a * 0.6;
  stage.snail.update(dt, { v: 1.1, cond: RUN });
  // the fountain runs all the time the hub is up: each jet on its own phase, and
  // the ripple on the pool drifting, which is the same `updateWater()` a race
  // calls - it walks `waterMeshes`, which is empty until a course is built
  for (const j of stage.pool.jets) {
    const s = 0.92 + 0.1 * Math.sin(clock * 2.3 + j.userData.phase);
    j.scale.set(s, 0.94 + 0.12 * Math.sin(clock * 1.7 + j.userData.phase * 1.3), s);
  }
  updateWater();
  stageEnv.sky.position.copy(camera.position);
  stageEnv.key.position.set(3.2, 5.4, 3.0);
  stageEnv.key.target.position.set(0, 0.6, 0);
  stageEnv.fill.position.copy(camera.position);
  stageEnv.fill.target.position.set(0, 0.6, 0);
  stageBackdrop.position.set(0, 0, 0);
}

/**
 * The stable, walked about rather than orbited.
 *
 * Everything the orbit does to the place still happens - the snail turns on its
 * plinth, the fountain runs, the water drifts, a windmill's fan turns - and the
 * camera is the only thing that changed. Which is the point of a free camera on
 * a menu: the orbit shows you the plinth, and the plinth is three metres of a
 * hundred-metre piece of county.
 *
 * The light is the one thing that genuinely has to change. The orbit's key is
 * pinned over the plinth, which is stage lighting and not a sun: it is right
 * for a shot of one object and wrong for walking out to the tree line, where it
 * would light the same three trees whichever way you faced. So the key follows
 * the camera and its height off the hour, exactly as it does on a course.
 */
function strollFrame(dt) {
  // the camera is the walker's, which is the whole of the difference
  camera.position.copy(freeCam.pos);
  camera.lookAt(
    freeCam.pos.x + Math.sin(freeCam.yaw) * Math.cos(freeCam.pitch),
    freeCam.pos.y + Math.sin(freeCam.pitch),
    freeCam.pos.z + Math.cos(freeCam.yaw) * Math.cos(freeCam.pitch));
  stage.spin += dt * 0.22;
  const a = stage.spin;
  stage.snail.group.rotation.y = -a * 0.6;
  stage.snail.update(dt, { v: 1.1, cond: RUN });
  for (const j of stage.pool.jets) {
    const s = 0.92 + 0.1 * Math.sin(clock * 2.3 + j.userData.phase);
    j.scale.set(s, 0.94 + 0.12 * Math.sin(clock * 1.7 + j.userData.phase * 1.3), s);
  }
  updateWater();
  spinFans(dt);
  stageEnv.sky.position.copy(camera.position);
  stageEnv.key.position.set(
    freeCam.pos.x + 3.6 * stageEnv.sunSide,
    freeCam.pos.y + 5.6 * stageEnv.sunH,
    freeCam.pos.z + 3.4 * stageEnv.sunSide);
  stageEnv.key.target.position.copy(freeCam.pos);
  aimFill(stageEnv, freeCam);
  stageBackdrop.position.set(0, 0, 0);
}

/** Onto the stable, and the camera in the walker's hands. */
function openStroll() {
  mode = 'stroll';
  $('stable').classList.remove('on');
  $('stroll').classList.add('on');
  // start where the orbit left off, looking at the plinth from where you were -
  // so going in and coming straight back out is a no-op and nothing jumps
  freeCam.pos.copy(camera.position);
  freeCam.yaw = Math.atan2(-camera.position.x, -camera.position.z);
  freeCam.pitch = -0.18;
  freeCam.keys.clear();
  freeCam.boost = false;
  freeCam.look = false;
}
function closeStroll() {
  if (mode !== 'stroll') return;
  mode = 'stable';
  $('stroll').classList.remove('on');
  freeCam.keys.clear();
  freeCam.look = false;
  show('stable');
  updateTimeOfDay(true);
}

function raceFrame(dt) {
  if (race.phase === 'countdown' || race.phase === 'running') {
    stepRace(dt);
    for (const r of race.racers) {
      const fr = r.fr;
      const g = r.model.group;
      const cond = r.state === 'air' ? FLY : r.state === 'swim' ? SWIM : fr.cond;
      g.rotation.set(0, Math.atan2(-fr.fwd.z, fr.fwd.x), 0);
      if (r.state === 'air') g.rotation.z = flightPitch(r.sh, r.airT);
      else g.rotation.z = Math.asin(clamp(fr.fwd.y, -1, 1)) * 0.9;
      // the bar is down and there is something to show for it
      const fast = r.surging && !r.spent && cond !== FLY;
      r.surgeVis = (r.surgeVis || 0) + ((fast ? 1 : 0) - (r.surgeVis || 0)) * Math.min(1, dt * 9);
      if (fast) surgeFx(r, dt); else r.surgeAcc = 0;
      r.model.update(dt, { v: r.v, cond, surge: r.surgeVis || 0 });
    }
    updateWater();
  }
  spinFans(dt);
  updateRipples();
  if (race.streaks) { updateFx(race.streaks, dt); updateFx(race.grit, dt); }

  const r = race.player, g = r.model.group.position;
  if (race.phase === 'countdown') {
    camState.orbit += dt * 0.5;
    const c = fieldCentre(_v1);
    camState.pos.set(c.x + Math.cos(camState.orbit) * 10.5, c.y + 3.2, c.z + Math.sin(camState.orbit) * 10.5);
    camState.look.lerp(_v2.set(c.x, c.y + 0.5, c.z), Math.min(1, dt * 4));
  } else {
    // A three-quarter view from behind: mostly astern but swung to one side,
    // so the course reads across the frame instead of straight down it and the
    // corners come round into shot. The two ends are the exceptions. The start
    // is swung much further round than the rest of the race - far enough to
    // take in the whole grid broadside - and settles into the racing view over
    // the first stretch, so the race opens up from the side and then gets
    // behind the snail. The last stretch is swung further round still: the
    // camera has to cross from behind the field to in front of it to watch the
    // race come in, and off astern that is a spin on the spot, whereas round
    // by the side it is one long arc across the front of the snails. The
    // further round it goes, the longer and calmer that arc is, which is what
    // makes the last few seconds a move rather than a cut. Both of those swings
    // are arcs on one circle, though, and the distance that holds them there is
    // the one number below: going further round is a longer sweep of the same
    // shot and never a wider one, so the race does not breathe as it runs.
    const tr = race.tr;
    const back = 8.0;
    const ramp = Math.min(70, tr.finish * 0.22);
    const swing = lerp(0.58, 0.25, smoothstep(START_S + 5, START_S + 5 + ramp, r.s));
    const lateLen = Math.min(110, (tr.finish - START_S) * 0.4);
    const late = smoothstep(tr.finish - lateLen - 14, tr.finish - 16, r.s);
    const side = back * (swing + 1.6 * late);
    const atLine = smoothstep(tr.finish - 14, tr.finish - 1.5, r.s);
    trackAt(tr, lerp(Math.max(0.4, r.s - back), tr.finish + 11, atLine), _fr);
    // What the shot is *about*, and it is the snail: the aim leads it by four
    // and a half metres, which is far enough to keep the next corner and the
    // next gap in the top of the frame and near enough that the snail is not
    // sitting a third of the way down the picture. It used to lead by eight and
    // a half, which wanted the snail two thirds of the way out to the bottom
    // edge, so the clamp below spent the whole race pulling the aim back off it
    // and the framing was the clamp rather than a decision.
    trackAt(tr, lerp(r.s + 4.5, r.s - 1.0, atLine), _fr3);
    // held high enough to clear the ground it is actually standing over as
    // well as whatever the snail is about to have to climb
    let want = Math.max(g.y + 2.4, _fr.y + 2.2, _fr.ground + 2.0);
    for (let a = 2.5; a <= 8; a += 2.5) {
      trackAt(tr, r.s + a, _fr2);
      want = Math.max(want, Math.min(_fr2.y + 1.4 + a * 0.22, g.y + 4.2));
    }
    const sw = side * (1 - 0.62 * atLine);
    // The snail is the subject and the subject keeps its size. Every swing above
    // is a *direction* and not a distance: a ten-metre lateral offset on a
    // course the camera is eight behind is an arc round the snail, but a camera
    // that carries the offset out as a range reads the last stretch as half
    // again as far off as the middle of the race, and the whole thing zooms out
    // and then zooms back in again for the line. So the offset is held to a
    // flat radius, pulled in only and never pushed out, and the racing view is
    // the one that sits inside it - so the middle of the race is the part that
    // does not move at all. The height is left as it was found, because that is
    // the clearance over the ground and not the framing, and a radius shorter
    // than the one asked for sits over ground nearer the lane, which the height
    // above already reads. The radius is a shade inside the one the framing
    // asks for, because the subject is worth the half metre: eight metres back
    // and a snail is a thumbnail, and seven and a half is a snail you can watch.
    const dx = _fr.p.x + _fr.right.x * sw - g.x;
    const dz = _fr.p.z + _fr.right.z * sw - g.z;
    const flat = Math.hypot(dx, dz);
    const pull = flat > 1e-4 ? Math.min(1, back * 0.95 / flat) : 1;
    camState.pos.lerp(_v1.set(g.x + dx * pull, want, g.z + dz * pull), 1 - Math.pow(0.0018, dt));
    const look = _v2.set(_fr3.p.x, _fr3.y + 0.5, _fr3.p.z);
    camState.look.lerp(look, 1 - Math.pow(0.0009, dt));
  }
  // The snail has to be in shot, whatever the shot wants, and it is the shot:
  // the aim goes where the framing takes it - down the course, out to a corner,
  // or round to the finish - and the sideways offset and the player's own lane
  // can together carry the player most of the way to the edge of the frame, so
  // swing the aim back whenever it has gone further than a fifth of the field.
  // That fifth is the whole composition, and it is a fifth rather than the third
  // it was because a third is not a framing at all: it is the whole lower half
  // of the picture, and on four courses of five the aim was sitting on that
  // limit for the whole race, so the camera was pointed wherever the clamp left
  // it and the framing had stopped being a decision. Measuring it here, on the
  // frame that is about to be drawn, is what makes it a guarantee rather than a
  // hope: the smoothing above cannot leave the snail out of shot.
  {
    const aim = _v1.subVectors(camState.look, camState.pos);
    const toMe = _v2.subVectors(g, camState.pos);
    const aimLen = aim.length();
    if (aimLen > 1e-4 && toMe.lengthSq() > 1e-6) {
      const off = Math.acos(clamp(aim.dot(toMe) / (aimLen * toMe.length()), -1, 1));
      const lim = camera.fov * 0.2 * Math.PI / 180;
      if (off > lim) {
        const axis = _v3.crossVectors(aim, toMe);
        if (axis.lengthSq() > 1e-9) {
          axis.normalize();
          aim.applyAxisAngle(axis, off - lim);
          camState.look.set(camState.pos.x + aim.x, camState.pos.y + aim.y, camState.pos.z + aim.z);
        }
      }
    }
  }
  camera.position.copy(camState.pos);
  camera.lookAt(camState.look);
  env.sky.position.copy(camera.position);
  updateTimeOfDay();
  backLift += (g.y - 3 - backLift) * Math.min(1, dt * 1.1);
  backdrop.position.set(g.x, backLift, g.z);
  env.key.position.set(g.x + 3.6 * env.sunSide, g.y + 5.6 * env.sunH, g.z + 3.4 * env.sunSide);
  env.key.target.position.set(g.x, g.y, g.z);
  env.fill.position.copy(camera.position);
  env.fill.target.position.copy(camState.look);
  updateCountdown();
}

/**
 * Walk the hour. The four courses of a season run from first light to the
 * middle of the day and the finale runs from dusk into the dark, and it runs
 * them on a clock: a minute of racing is an hour of the day, so the light moves
 * under you at a steady rate whether you are quick or slow. The dome is one
 * mesh of vertex colours, so it is only repainted once the light has actually
 * moved far enough to be worth it.
 */
let todU = -1, todFinale = null, todPainted = -1;
function updateTimeOfDay(force) {
  const p = race.player;
  const running = race.tr && p && race.phase !== 'idle';
  const finale = running && race.catId === seasonFinaleId(state.tier);
  // the light is on the clock, not on the snail: whatever the field is doing,
  // the hour goes by at HOURS_PER_SECOND and the course simply gets raced
  // somewhere in that stretch of the day
  const clock = raceClock(finale);
  // When nothing is racing the hour is **pinned**, and the pin belongs to the
  // place being looked at and not to the camera looking at it. The stable stands
  // at 0.55 - a high, pale, mid-morning sun - and a course stands at 0, which is
  // the hour a course is inspected at.
  //
  // It is written as two places rather than one, and getting it wrong is not a
  // small thing: the free camera on the stable fell out of the stable's half of
  // this line and so showed the stable at **hour 0** - a low, warm, dim sun at
  // 0.95 against 1.28, and a third of the elevation. Walking about your own
  // lobby in the evening when standing still in it is lunchtime is not a camera
  // difference; it is the county moving without you, and the shadows swing round
  // with the hour as well as stretching out.
  const onStage = mode === 'stable' || mode === 'stroll';
  const u = running ? clamp((race.t * HOURS_PER_SECOND) / clock.span, 0, 1)
    : (onStage ? 0.55 : 0);
  if (u === todU && finale === todFinale && !force) return;
  todU = u; todFinale = finale;
  timeOfDay(u, finale, TOD);
  // the dome is a whole mesh of vertex colours, so it only gets repainted once
  // the hour has moved far enough to be worth it - and the environment, which
  // costs a pre-filter to build, is refreshed in the same breath, because a
  // dome repainted under a stale environment is the exact disagreement the
  // plan for this calls out
  if (force || Math.abs(u - todPainted) > 0.02) {
    todPainted = u;
    paintSky(_todSky);
    refreshEnvironment(_todSky);
    // **The probes are requeued in the same breath as the dome**, because a pool
    // reflecting a sky that has just changed colour is the exact disagreement the
    // paragraph above is about - and a probe is six scene renders, so it is
    // queued and not taken. `pumpProbes()` spends one a quarter of a second.
    if (gfxReflOn()) queueProbes();
  }
  for (const e of [env, stageEnv]) {
    e.key.color.copy(TOD.sun);
    e.key.intensity = TOD.sunI;
    e.sunH = TOD.sunH;
    e.sunSide = TOD.sunSide;
    e.rim.intensity = lerp(0.35, 0.14, u);
    e.fill.intensity = lerp(0.55, 0.42, u);   // never so dark the snail is hard to see
    e.hemi.color.copy(TOD.hemiSky);
    e.hemi.groundColor.copy(TOD.hemiGround);
    e.hemi.intensity = TOD.hemiI;
    e.scene.fog.color.copy(TOD.fog);
  }
  renderer.toneMappingExposure = TOD.exposure;
  // the clouds are lit by the sun, so they have to go with it or they hang in
  // a night sky as bright white paper
  mat.cloud.color.copy(TOD.cloud);
  mat.cloud.emissive.copy(TOD.cloud);
  mat.cloud.emissiveIntensity = 0.12 + 0.42 * clamp(TOD.sunI / 1.55, 0, 1);
  // the far country sits outside the fog, so it has to take the colour of the
  // air by hand or it stands there lit up in the middle of the night
  mat.hillFar.color.setHex(0xb2c8c6).lerp(TOD.fog, TOD.haze);
  mat.hillNear.color.setHex(0x8cae94).lerp(TOD.fog, TOD.haze * 0.85);
  mat.lampGlass.emissiveIntensity = TOD.lamps * 2.6;
  // The paper carries most of its own light in its own colour, so that
  // whatever colour a lantern is painted is the colour it gives out; the
  // emissive only lifts it a little once the hour is on it.
  mat.paper.emissiveIntensity = 0.10 + TOD.lamps * 0.35;
  // and the few lamps close enough to be worth lighting the ground under
  for (const l of env.lamps) { l.intensity = 0; l.visible = false; }
  if (TOD.lamps > 0.02 && lampPosts.length) {
    const g = race.player ? race.player.model.group.position : camera.position;
    const near = lampPosts
      .map((l) => ({ l, d: (l.p.x - g.x) ** 2 + (l.p.z - g.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(LAMP_LIGHTS, near.length); i++) {
      const lamp = env.lamps[i];
      // **No offset at all**, and that is the second half of the glass's own
      // centre: `near[i].l.p` *is* the glass in world space, post and lantern
      // alike, so there is nothing to add and a number added here is a number
      // that will drift from the model the day the model changes
      lamp.position.copy(near[i].l.p);
      // a lantern lights the ground its own colour, a street lamp the one
      // colour they all are
      lamp.color.setHex(near[i].l.colour || LAMP_COLOUR);
      lamp.intensity = (near[i].l.power || 9) * Math.max(TOD.lamps, 0.25)
        * clamp(1 - Math.sqrt(near[i].d) / 34, 0.15, 1);
      lamp.distance = near[i].l.reach || 15;
      lamp.visible = true;
    }
  }
  // The glows follow the lamps they belong to, in the same block and for the same
  // reason: a glow scaled once and left is a glow that is wrong from the moment
  // the light moves. The sun's is placed from the key light's own direction off
  // the eye, so it is where the sun is from wherever you are standing - and only
  // the env being drawn needs it placed, because the other one is not on screen.
  syncGlow(env);
  syncGlow(stageEnv);
  const lit = mode === 'stable' || mode === 'stroll' ? stageEnv : env;
  if (lit.sunGlow && lit.sunGlow.visible) {
    _v1.copy(lit.key.position).sub(camera.position);
    if (_v1.lengthSq() < 1e-6) _v1.set(0.4, 0.5, 0.3);
    lit.sunGlow.position.copy(camera.position).add(_v1.normalize().multiplyScalar(320));
  }
}
function updateWater() {
  const t = clock;
  // the two ripple layers drift against each other, which is what makes a pool
  // read as moving water rather than as a photograph of moving water
  rippleU.tRipple.value.set(t * 0.035, t * 0.021);
  for (const m of waterMeshes) {
    const pos = m.geometry.attributes.position;
    const arr = pos.array, base = m.geometry.userData.base;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      arr[i * 3 + 1] = base[i * 3 + 1]
        + 0.035 * Math.sin(x * 0.7 + t * 1.5)
        + 0.025 * Math.sin(z * 0.9 - t * 1.9);
    }
    pos.needsUpdate = true;
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  // the canvas is native and takes its size from the window in CSS pixels; the
  // chain is a share of that and follows `applyChainSize()`, which is also where
  // the half-resolution G-buffer is put back after `setSize()` has given it the
  // full one, and where `presentPass` is told the source size its shader reads
  applyRenderScale();
});

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - last;
  const dt = Math.max(0, Math.min(raw / 1000, 0.05));
  last = now;
  clock += dt;
  // **Shown by the mode and not by whichever screen was switched on.** Two of the
  // four places the county can be - a race and the inspector - are the ones where
  // the frame cost is the thing being judged, and a panel driven off `mode` has no
  // call site to forget: `showRace()`, `openInspector()`, `show()` and
  // `closeInspector()` set `mode` and this follows it. The counter resets on the
  // way in, so a race's average is that race's average and not the session's.
  const wantPerf = mode === 'race' || mode === 'inspect';
  if (wantPerf !== perfOn) {
    perfOn = wantPerf;
    $('perf').classList.toggle('on', wantPerf);
    if (wantPerf) perfReset();
  }
  if (perfOn) perfPush(raw);
  // Cloud shadow and grass wind ride the frame's own clock rather than a second
  // one. Two effect clocks that are not the same number drift against each other
  // within seconds - a shadow sliding one way over grass leaning another - and a
  // second clock buys nothing that `gfxU` sharing `clock` does not.
  gfxU.uCloudTime.value = clock;
  gfxU.uWindTime.value = clock;
  if (mode === 'stable') { stageFrame(dt); updateTimeOfDay(); }
  else if (mode === 'stroll') { freeCameraFrame(dt); strollFrame(dt); updateTimeOfDay(); }
  else if (mode === 'race') { raceFrame(dt); updateTimeOfDay(); }
  else if (mode === 'inspect') { freeCameraFrame(dt); inspectFrame(dt); }
  // **One shadow pass a frame, on both paths.** `WebGLRenderer.render()` runs the
  // shadow map unconditionally and `autoUpdate` is on by default, so `GTAOPass` -
  // which renders the whole scene a second time into its normal buffer - would
  // cost a second shadow pass with it, for a map that was already correct. The
  // flag is cleared by whichever render consumes it first, which on the composer
  // path is `RenderPass`, so the G-buffer gets the map for nothing. Set every
  // frame, because the sun moves and the snails move.
  renderer.shadowMap.needsUpdate = true;
  // **Counted before anything is drawn**, so the frame's calls are the whole
  // frame and not whichever pass ran last - see the note on `info.autoReset`. It
  // goes above `pumpProbes()` and not below it: a probe is six scene renders and a
  // PMREM, and the note counts those six among the frame's calls, so a reset
  // written under the pump quietly drops every probe frame's cost out of the
  // readout - which is the one frame in 260 where the county is doing the most.
  renderer.info.reset();
  // one probe at a time, a quarter of a second apart, and only when the hour has
  // moved far enough to want one - see `queueProbes()`
  pumpProbes(now);
  if (composerUp) {
    // The scene the passes are holding is written every frame rather than at
    // construction, because there are two of them and which one is up changes
    // with the mode; a pass built against the other one would render the stable
    // into a race's occlusion and produce nothing at all rather than something
    // wrong, which is much harder to see. **Both of them, unconditionally** -
    // the occlusion pass was written once at construction and left there while
    // the beauty pass was already correct, so on the stable the depth buffer was
    // full of a course nobody could see.
    const sc = mode === 'stable' || mode === 'stroll' ? stageScene : scene;
    renderPass.scene = sc;
    if (gtaoPass) gtaoPass.scene = sc;
    // and the bounce's, which is **its own scene field because it renders the
    // albedo with its own override material** - the same argument as the line
    // above, and the same cost of getting it wrong: a bounce built from the
    // stable's colour while the occlusion was built from the county's is an
    // irradiance estimate of the wrong county, which looks like a colour cast
    // rather than like an error.
    if (gtaoGiPass) gtaoGiPass.scene = sc;
    composer.render();
  } else {
    renderer.render(mode === 'stable' || mode === 'stroll' ? stageScene : scene, camera);
  }
  // vignette and grain, on whichever of the two paths just ran
  drawOverlay();
  // a readback asked for from the console, answered by the frame that has the
  // picture on it and by no other
  if (grabWanted) { const g = grabWanted; grabWanted = null; doGrab(g); }
  // four paints a second, not sixty: the numbers change slower than the eye reads
  // them and a panel that rewrites sixteen cells every frame is a layout the
  // readout itself is measuring
  if (perfOn && now - perfPaintedAt > PERF_PAINT_MS) { perfPaintedAt = now; perfPaint(); }
}
requestAnimationFrame(frame);
/* ================================================================== *
 * PERFORMANCE READOUT
 *
 * Shown while racing and while walking a course round, which are the two modes
 * where the frame cost is the thing you are here to judge: the stable is a fixed
 * camera on a stage that is rebuilt on demand and the race is a moving one.
 *
 * **The frame time is the raw gap between rAF callbacks and not the loop's own
 * `dt`,** because `dt` is clamped to 50 ms so a long frame cannot teleport a
 * snail through a wall, and a clamped `dt` reports a stutter as exactly 20 fps -
 * a floor, and the one number a performance readout must never invent. The loop
 * hands over the unclamped value.
 *
 * **The low numbers come off a ring of the last 300 frames, the average off every
 * frame since the mode was entered.** Those are different windows on purpose: an
 * average over a whole race is the honest answer to "was this smooth", and a
 * 1% low over the last five seconds is the honest answer to "is it hitching now".
 * A 1% low taken over the whole race is a number that cannot move again after the
 * first hitch, which is a number that stops being a warning. The panel says which
 * is which, because a readout that does not is two numbers wearing one label.
 *
 * The ring is sorted **once per paint and not once per frame** - at four paints a
 * second a 300-element sort is free, and a sort a frame is a thing the readout
 * itself would then be measuring.
 * ------------------------------------------------------------------ */
const PERF_RING = 300, PERF_PAINT_MS = 250;
const perfT = new Float64Array(PERF_RING);
const perfSorted = new Float64Array(PERF_RING);
let perfHead = 0, perfHeld = 0, perfTotal = 0, perfCount = 0, perfEma = 0;
let perfOn = false, perfPaintedAt = 0;

function perfReset() {
  perfHead = 0; perfHeld = 0; perfTotal = 0; perfCount = 0; perfEma = 0;
  perfPaintedAt = 0;
}
function perfPush(ms) {
  // a tab that was in the background comes back with one enormous gap, and it is
  // not a frame the county drew; a gap over a second is not a hitch either
  if (ms <= 0 || ms > 1000) return;
  perfT[perfHead] = ms;
  perfHead = (perfHead + 1) % PERF_RING;
  if (perfHeld < PERF_RING) perfHeld++;
  perfTotal += ms;
  perfCount++;
  // a gentle average of the frame *time*, because an average of the frame rate is
  // an average of a reciprocal and it is dragged by the good frames twice as hard
  perfEma = perfEma ? perfEma + (ms - perfEma) * 0.12 : ms;
}
/**
 * A frame time out of the ring, by **how many frames may be slower than it** —
 * which is the direction "1% low" counts in and the opposite of the obvious one.
 *
 * The sort is ascending, so index zero is the **fastest** frame in the window and
 * the answer is counted back from the last one. Taking the percentile from the
 * front instead returns the wrong end of the distribution entirely: on a hundred
 * and twenty-five frames, `1%` by that route lands on index **1**, the second
 * **quickest** frame, and the panel printed a 1% low of 60 beside a current 48 —
 * a stutter detector reporting a better frame rate than the one it was sitting
 * in. And `0` slower is not index zero, it is the last one: a "min" read off the
 * front of the sort is the best frame in the window, which is how it came out at
 * 61 next to a current 46.
 *
 * `allowed` is a count and not a percentage because a percentage of a ring that
 * is not full is a lie about the window: on forty frames, one per cent is a
 * fraction of a frame and the honest answer is the slowest of them.
 */
function perfSlowest(allowed) {
  if (!perfHeld) return 0;
  for (let i = 0; i < perfHeld; i++) perfSorted[i] = perfT[i];
  const a = perfSorted.subarray(0, perfHeld).slice().sort();
  return a[clamp(perfHeld - 1 - allowed, 0, perfHeld - 1)];
}
function perfPaint() {
  const r = renderer.info;
  const low = perfSlowest(Math.floor(perfHeld / 100)), worst = perfSlowest(0);
  const f = (ms) => (ms > 0 ? (1000 / ms) : 0);
  $('pNow').textContent = f(perfEma).toFixed(0);
  $('pNow').parentNode.classList.toggle('warn', f(perfEma) < 30);
  $('pAvg').textContent = perfTotal ? f(perfTotal / perfCount).toFixed(0) : '—';
  $('pLow').textContent = f(low).toFixed(0);
  $('pMin').textContent = f(worst).toFixed(0);
  $('pFrames').textContent = String(perfCount);
  // **The path, by name and not by whether it felt slower.** The whole point of
  // the regression gate is that the two are told apart by something that is not
  // an opinion, and a panel sitting next to the frame rate is where that is
  // cheapest to read.
  $('pPath').textContent = composerUp ? 'compositor' : 'direct';
  $('pTier').textContent = gfx.preset ? `tier ${gfx.preset}` : 'mixed';
  // **The ratio the county is drawn at, and not the canvas's.** The canvas is native
  // whatever the render row says and is therefore a constant, so a cell reporting it
  // would be a cell reporting the display; this one reports the number the frame
  // rate is a rate *of*.
  $('pDpr').textContent = sceneRatio().toFixed(2);
  // The sample count and not the step, for the same reason the row is: `off` is
  // zero and is the only one of the three that is not a number of samples a
  // pixel, so a raw integer would read as 1x and mean none.
  $('pMsaa').textContent = MSAA_NAMES[gfx.msaa - 1];
  // The kernel and not the step, for the same reason the row is: `nearest` is not a
  // number of anything and a raw `1` would read as the fetch count and mean the
  // cheapest filter in the list.
  $('pScale').textContent = SCALE_NAMES[gfx.scale - 1];
  // **The pixels, and off the county's buffer rather than the canvas's**: the two
  // part company the moment the render row leaves 1x, and it is the county's that a
  // frame is rendered into and resolved out of.
  const [sw, sh] = scenePixels();
  $('pPix').textContent = (sw * sh / 1e6).toFixed(1) + 'M';
  $('pSsao').textContent = String(gfx.ssao);
  $('pRefl').textContent = String(gfx.refl);
  // **The effects are a count and not a level**, because there is no level any
  // more: six switches, and `n/6` is every one of them at a glance. It is read
  // off the same table the modal is drawn from rather than off a ladder, so a
  // picture with four things on it and a picture with one thing on it very hard
  // cannot print the same number.
  $('pFx').textContent = `${FX_TOGGLES.filter((r) => gfx[r.key] > 0).length}/${FX_TOGGLES.length}`;
  $('pCalls').textContent = String(r.render.calls);
  $('pTris').textContent = (r.render.triangles / 1000).toFixed(0) + 'k';
  $('pGeo').textContent = String(r.memory.geometries);
  $('pTex').textContent = String(r.memory.textures);
  $('pProg').textContent = String(r.programs ? r.programs.length : 0);
  // the probe queue is a performance number and not a scenery one: a probe is six
  // scene renders and a full PMREM, so a queue that is draining slowly is a
  // machine dropping frames on purpose and one that is standing at four is four
  // pools whose reflections are a whole race stale
  $('pProbe').textContent = courseProbes.length ? `${courseProbes.length}/${probeQueue.length}` : '0';
  const names = composerUp ? composer.passes.filter((p) => p.enabled).map((p) => p.constructor.name.replace('Pass', '')) : [];
  $('pPasses').textContent = names.length ? names.join('·') : '—';
  // **The foot says which window each of the four numbers came off**, because the
  // top line now puts them side by side and the two windows can disagree in the
  // direction that looks like a mistake: three seconds after a course is built, an
  // average taken over the whole visit is still carrying the build's long frames,
  // so `avg` prints 110 under a `min` of 118. Both are true, and without the
  // sentence the panel is claiming one of them is broken.
  $('pFoot').textContent = `avg whole visit · lows last ${(perfHeld * (perfEma || 16) / 1000).toFixed(0)}s · resets on entry`;
}
/* ================================================================== *
 * HUD
 * ================================================================== */
const standRows = [];
function buildStandings() {
  const wrap = $('standings');
  wrap.innerHTML = '';
  standRows.length = 0;
  for (let i = 0; i < FIELD; i++) {
    const d = document.createElement('div');
    d.className = 'row2';
    d.innerHTML = '<span class="pl"></span><span class="dot"></span><span class="nm"></span><span class="g"></span>';
    wrap.appendChild(d);
    standRows.push(d);
  }
}
function syncHUD() {
  const cat = CAT_BY_ID[race.catId];
  const races = seasonLength();
  const n = Math.min(races, state.results.length + 1);
  $('raceName').textContent = cat.name;
  const tally = race.tr.plan.tally;
  const bits = [`race ${n} of ${races}`];
  if (cat.trait) bits.push(`tests ${cat.trait}`);
  if (tally.leaps) bits.push(`${tally.leaps} gap${tally.leaps > 1 ? 's' : ''} to fly`);
  if (tally.pools) bits.push(`${tally.pools} pool${tally.pools > 1 ? 's' : ''} to swim`);
  if (tally.floods) bits.push(`${tally.floods} flooded chasm${tally.floods > 1 ? 's' : ''} to fly or swim`);
  if (tally.crates) bits.push(`${tally.crates} crate${tally.crates > 1 ? 's' : ''} to push`);
  $('raceSub').textContent = bits.join(' · ') + ` · ${Math.round(race.tr.length)} m`;

  // the rail, coloured by what each stretch of the course asks of you
  const rail = $('rail');
  rail.innerHTML = '';
  // **and it is built from `COND` and not written out.** It was a literal of
  // five, which is five conditions' worth of a silent contract: add a sixth to
  // the condition enum and the progress rail quietly loses the crate stretch,
  // with nothing wrong anywhere - a shorter flex total, so the bar still
  // reaches the line, just with one colour missing off the middle of it.
  const rail2 = COND.map(() => 0);
  for (let i = 0; i <= race.tr.n; i++) rail2[race.tr.sm[i].cond]++;
  const cols = ['#b08f5c', '#8a8078', '#4e9cc0', '#7f92b4', '#6f6a63', '#a97c3f'];
  rail2.forEach((c, i) => {
    if (!c) return;
    const el = document.createElement('i');
    el.style.flex = String(c);
    el.style.background = cols[i];
    el.title = COND[i].name;
    rail.appendChild(el);
  });

  // one marker per racer on the progress bar
  $('trackbar').querySelectorAll('.mark').forEach((m) => m.remove());
  race.racers.forEach((r) => {
    const m = document.createElement('div');
    m.className = 'mark';
    m.style.background = '#' + r.sn.body.toString(16).padStart(6, '0');
    m.title = r.sn.name;
    $('trackbar').appendChild(m);
    r.mark = m;
  });
  buildStandings();
  updateHUD();
}

function updateHUD() {
  if (!race.racers.length) return;
  const p = race.player;
  const order = race.racers.slice().sort((a, b) => b.s - a.s);
  const lead = order[0].s;
  for (let i = 0; i < order.length; i++) {
    const r = order[i], row = standRows[i];
    row.classList.toggle('me', r.isPlayer);
    row.children[0].textContent = String(i + 1);
    row.children[1].style.background = '#' + r.sn.body.toString(16).padStart(6, '0');
    row.children[2].textContent = r.sn.name;
    row.children[3].textContent = i === 0 ? '—' : '-' + (lead - r.s).toFixed(0) + 'm';
    if (r.mark) r.mark.style.left = (clamp(r.s / race.tr.finish, 0, 1) * 100).toFixed(2) + '%';
  }
  const f = clamp(p.stam / p.stamMax, 0, 1);
  $('stamBar').style.width = (f * 100).toFixed(1) + '%';
  $('stamBar').style.background = f > 0.5 ? '#3f8f4f' : f > 0.2 ? '#d2912b' : '#bf4a37';
  $('stamOut').textContent = Math.max(0, Math.round(p.stam)) + ' / ' + Math.round(p.stamMax);
  $('spd').textContent = p.v.toFixed(1);
  const cond = p.state === 'air' ? FLY : p.state === 'swim' ? SWIM
    : p.state === 'push' ? PUSH : p.fr.cond;
  $('cond').textContent = (p.spent ? 'spent' : COND[cond].name) + (p.surging && !p.spent ? ' · surging' : '');
  const btn = $('surge');
  btn.classList.toggle('on', surging && !p.spent);
  btn.disabled = p.spent;
}

let lastCount = '';
function updateCountdown() {
  const el = $('count');
  if (race.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(race.cd - 0.25));
    if (lastCount !== String(n)) {
      lastCount = String(n);
      el.innerHTML = `<span>${n}</span>`;
    }
  } else if (race.phase === 'running' && race.t < 0.7) {
    if (lastCount !== 'GO') { lastCount = 'GO'; el.innerHTML = '<span>GO</span>'; }
  } else if (lastCount) {
    lastCount = '';
    el.textContent = '';
  }
}
function flashGo() {
  const f = $('flash');
  f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 70);
}

/* ================================================================== *
 * The stable screen
 * ================================================================== */
function doneIds() { return state.results.map((r) => r.catId); }
function nextRaceId() {
  const d = doneIds();
  for (const id of state.order || []) if (!d.includes(id)) return id;
  const f = seasonFinaleId(state.tier);
  return f && !d.includes(f) ? f : null;
}
function seasonComplete() { return nextRaceId() === null; }

function profileSVG(plan) {
  const w = 122, h = 38, pad = 3;
  const pts = plan.pts;
  let minY = 1e9, maxY = -1e9, maxX = 1;
  for (let i = 0; i < pts.length; i++) {
    const y = Math.max(pts[i].y, plan.meta[i].water === null ? -1e9 : plan.meta[i].water);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); maxX = Math.max(maxX, pts[i].x);
  }
  const sc = (h - pad * 2) / Math.max(1, maxY - minY);
  const X = (i) => ((pts[i].x / maxX) * w).toFixed(1);
  const Y = (v) => (h - pad - (v - minY) * sc).toFixed(1);
  const YP = (i) => Y(pts[i].y);
  // the ground the lane is cut through, so the wall, the drop and the bank
  // all read the way they are built
  let g = '';
  for (let i = 0; i < plan.meta.length; i++) g += (i ? 'L' : 'M') + X(i) + ' ' + Y(plan.meta[i].ground);
  let s = `<path d="${g}" fill="none" stroke="#7d9c4e" stroke-width="1.1" opacity="0.85"/>`;
  // the water, sitting in the ground: a filled body between its surface and
  // its floor
  let wpath = '', on = false, band = '';
  for (let i = 0; i < plan.meta.length; i++) {
    const m = plan.meta[i];
    if (m.water !== null) {
      wpath += (on ? 'L' : 'M') + X(i) + ' ' + Y(m.water);
      band += (on ? 'L' : 'M') + X(i) + ' ' + Y(m.floor);
      on = true;
    } else if (on) {
      wpath += 'L' + X(i - 1) + ' ' + Y(plan.meta[i - 1].water);
      band += 'L' + X(i - 1) + ' ' + Y(plan.meta[i - 1].floor);
      on = false;
    }
  }
  if (wpath) {
    const first = plan.meta.findIndex((m) => m.water !== null);
    let last = first;
    for (let i = first; i < plan.meta.length; i++) if (plan.meta[i].water !== null) last = i;
    const fill = band + `L${X(last)} ${Y(plan.meta[last].water)}L${X(first)} ${Y(plan.meta[first].water)}Z`;
    s += `<path d="${fill}" fill="#63a8c6" fill-opacity="0.4" stroke="none"/>`;
    s += `<path d="${wpath}" fill="none" stroke="#3f88ab" stroke-width="1.2" stroke-linecap="round"/>`;
  }
  // and the lane itself, coloured by what it asks of you. It is not
  // exhaustive - `WALK` and `SWIM` are not in it - and a crate's span is here
  // for the same reason the other three are: a hole you push a crate into is the
  // one feature on the profile that says nothing at all without a colour.
  for (const [cond, col] of [[RUN, '#b08f5c'], [CLIMB, '#7d746a'], [FLY, '#c2a15a'], [PUSH, '#a97c3f']]) {
    let d = '', open = false;
    for (let i = 0; i < plan.meta.length; i++) {
      if (plan.meta[i].cond === cond) { d += (open ? 'L' : 'M') + X(i) + ' ' + YP(i); open = true; }
      else open = false;
    }
    if (d) s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${s}</svg>`;
}
function terrainChips(plan) {
  const t = plan.tally;
  let s = '<span class="chip run">footpath</span>';
  if (t.walls) s += `<span class="chip climb">wall ×${t.walls}</span>`;
  if (t.leaps) s += `<span class="chip fly">gap ×${t.leaps}</span>`;
  if (t.pools) s += `<span class="chip swim">pool ×${t.pools}</span>`;
  if (t.floods) s += `<span class="chip swim">flooded chasm ×${t.floods}</span>`;
  if (t.crates) s += `<span class="chip push">crate ×${t.crates}</span>`;
  return s;
}

/**
 * The season you are in and the seven in it with you, shown before you have
 * raced any of it. The player is listed with them and their rating marked, so
 * the ladder is legible: the number under the rivals is what you are trying
 * to get past, and a win is worth about a thousand points of it.
 */
function renderField() {
  const tier = seasonDef(state.tier);
  $('tierName').textContent = tier.name;
  $('tierRating').textContent = `you · ${state.rating}`;
  $('tierNote').textContent = `${tier.lo}${tier.hi === Infinity ? '+' : '–' + tier.hi} rating`
    + (tier.blurb ? ` · ${tier.blurb}` : '');

  // the ladder, with where you are standing on it
  const bar = document.querySelector('#fieldCard .tierbar');
  if (bar) {
    bar.innerHTML = '';
    for (const t of TIERS) {
      const i = document.createElement('i');
      if (t.id === tier.id) i.className = 'on';
      bar.appendChild(i);
    }
  }

  const wrap = $('field');
  wrap.innerHTML = '';
  const row = (sn, cls) => {
    const d = document.createElement('div');
    d.className = 'rival' + (cls ? ' ' + cls : '');
    d.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="rt"></span>';
    d.querySelector('.dot').style.background = '#' + sn.body.toString(16).padStart(6, '0');
    d.querySelector('.nm').textContent = sn.name;
    d.querySelector('.rt').textContent = sn.rating;
    wrap.appendChild(d);
    return d;
  };
  const rivals = seasonRivals();
  for (const p of rivals) row(p);
  row({ name: state.name, body: state.body, rating: state.rating }, 'me');

  // what the season is actually worth, and how you stand in it
  const lo = Math.min(...rivals.map((p) => p.rating)), hi = Math.max(...rivals.map((p) => p.rating));
  const open = eligibleSeasons(state.rating);
  $('fieldNote').textContent =
    `The seven above are rated ${lo} to ${hi} — that is who you are racing this season, all of it. ` +
    (open.length > 1
      ? `You are good enough for ${open.length} seasons: pick either. `
      : `You are only good enough for this one, for now. `) +
    'Your rating, your snail and your purse all come with you; only the season is new.';
  $('pickSeason').textContent = `choose season · ${open.length > 1 ? open.length + ' open to you' : 'one open to you'}`;
  layoutFieldCard();
}

/**
 * The picker. The bands overlap, so this is a choice rather than a queue: it
 * shows every season, the seven that would be in it with you, and leaves the
 * ones your rating is not good enough for shut. Entering one draws its field
 * and hands the season over - so the names in here are the names on the grid.
 */
function renderSeasons() {
  const wrap = $('seasList');
  wrap.innerHTML = '';
  const started = state.results.length > 0;
  $('seasSub').textContent =
    `rating ${state.rating} · ${eligibleSeasons(state.rating).length} of ${TIERS.length} open to you`
    + (started && state.tier ? ` · you are in the ${seasonDef(state.tier).name} now` : '');

  for (const t of TIERS) {
    const open = canEnter(t.id, state.rating);
    const rivals = poolByIds(seasonField(t.id, lastSeasonField()));
    const lo = rivals.length ? Math.min(...rivals.map((p) => p.rating)) : 0;
    const hi = rivals.length ? Math.max(...rivals.map((p) => p.rating)) : 0;
    const el = document.createElement('div');
    el.className = 'season' + (t.id === state.tier ? ' now' : '') + (open ? '' : ' locked');
    el.innerHTML =
      `<div class="shead"><h3>${t.name}</h3>` +
      `<span class="cap">${t.lo}${t.hi === Infinity ? '+' : '–' + t.hi} rating</span></div>` +
      `<p class="sblurb">${t.blurb || ''}</p>` +
      `<div class="srivals"></div>` +
      `<div class="sfoot"><span class="cap">seven rivals · ${lo}–${hi}</span></div>`;
    const list = el.querySelector('.srivals');
    for (const p of rivals) {
      const r = document.createElement('div');
      r.className = 'rival';
      r.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="rt"></span>';
      r.querySelector('.dot').style.background = '#' + p.body.toString(16).padStart(6, '0');
      r.querySelector('.nm').textContent = p.name;
      r.querySelector('.rt').textContent = p.rating;
      list.appendChild(r);
    }
    const foot = el.querySelector('.sfoot');
    if (open) {
      const b = document.createElement('button');
      b.className = 'big';
      b.textContent = t.id === state.tier ? (started ? 'race this again' : 'already in') : 'join';
      b.disabled = t.id === state.tier && !started;
      b.onclick = () => joinSeason(t.id);
      foot.appendChild(b);
    } else {
      const need = document.createElement('span');
      need.className = 'sneed';
      need.innerHTML = `needs <em>${t.lo}${t.hi === Infinity ? '+' : '–' + t.hi}</em> rating`;
      foot.appendChild(need);
    }
    wrap.appendChild(el);
  }
}
function openSeasons() {
  renderSeasons();
  $('seasons').classList.add('on');
}
function closeSeasons() { $('seasons').classList.remove('on'); }

/**
 * The field card hangs off the bottom of the snail card, so it has to be
 * placed after the snail card has finished being built - the feeding rows are
 * written after this panel, and the window can reflow them - or it ends up
 * sitting on top of the buttons underneath it.
 */
function layoutFieldCard() {
  const card = $('snailCard'), field = $('fieldCard');
  field.style.top = (card.offsetTop + card.offsetHeight + 12) + 'px';
}
if (typeof ResizeObserver === 'function') new ResizeObserver(layoutFieldCard).observe($('snailCard'));

function renderStable() {
  const races = seasonLength();
  $('goldOut').textContent = state.gold;
  $('snailName').value = state.name;
  $('seasonTag').textContent = `season ${state.season} · ${seasonDef(state.tier).name} · rating ${state.rating} · ${Math.min(races, state.results.length)} of ${races} raced · ${state.pts} pts`;
  renderField();

  // pips: which of the season's races are done
  const pips = $('pips');
  pips.innerHTML = '';
  const all = seasonRoster(state.tier);
  for (const id of all) {
    const rec = state.results.find((r) => r.catId === id);
    const el = document.createElement('i');
    if (rec) el.className = rec.place === 1 ? 'won' : 'raced';
    else if (id === nextRaceId()) el.className = 'now';
    pips.appendChild(el);
  }

  // stats and feeding
  const wrap = $('stats');
  wrap.innerHTML = '';
  for (const a of ATTRS) {
    const v = state.stats[a.key];
    const row = document.createElement('div');
    row.className = 'stat';
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = a.name;
    const pips2 = document.createElement('span');
    pips2.className = 'pips';
    for (let i = 0; i < STAT_MAX; i++) {
      const b = document.createElement('b');
      if (i < v) b.className = state.lastFed === a.key && i === v - 1 ? 'on up' : 'on';
      pips2.appendChild(b);
    }
    const val = document.createElement('span');
    val.className = 'v'; val.textContent = v;
    const btn = document.createElement('button');
    btn.className = 'feed';
    btn.textContent = '+1 · 10g';
    btn.disabled = state.gold < GOLD_PER_FRUIT || v >= STAT_MAX;
    btn.title = v >= STAT_MAX ? 'already at the top' : 'feed a fruit';
    btn.onclick = () => {
      if (state.gold < GOLD_PER_FRUIT || state.stats[a.key] >= STAT_MAX) return;
      state.gold -= GOLD_PER_FRUIT;
      state.stats[a.key]++;
      state.lastFed = a.key;
      save();
      applyLook();
      renderStable();
    };
    row.append(nm, pips2, val, btn);
    wrap.appendChild(row);
  }

  // the season card
  const cards = $('cards');
  cards.innerHTML = '';
  const done = doneIds();
  const picks = state.order;
  for (let i = 0; i < picks.length; i++) {
    const id = picks[i];
    const cat = CAT_BY_ID[id];
    const plan = planTrack(id, trackSeed(id), seasonScale(state.tier));
    const rec = state.results.find((r) => r.catId === id);
    const el = document.createElement('div');
    el.className = 'card' + (rec ? ' done' : '');
    const movable = !rec;
    const up = i > 0 && movable && !state.results.find((r) => r.catId === picks[i - 1]);
    const dn = i < picks.length - 1 && movable && !state.results.find((r) => r.catId === picks[i + 1]);
    el.innerHTML =
      `<div class="idx">${rec ? rec.place : i + 1}</div>` +
      `<div class="info">` +
      `<div class="cname">${cat.name}</div>` +
      `<div class="cmeta">${cat.trait ? 'tests ' + cat.trait : 'everything, all at once'} · ${Math.round(plan.length)} m` +
      (rec ? ` · finished ${rec.place}${placeWord(rec.place)}${rec.points ? ' · +' + rec.points + ' pts' : ''}` : '') + `</div>` +
      `<div class="chips">${terrainChips(plan)}</div>` +
      profileSVG(plan) +
      `</div>`;
    const mv = document.createElement('div');
    mv.className = 'move';
    const bu = document.createElement('button'); bu.textContent = '▲'; bu.disabled = !up;
    bu.onclick = () => { swap(i, i - 1); };
    const bd = document.createElement('button'); bd.textContent = '▼'; bd.disabled = !dn;
    bd.onclick = () => { swap(i, i + 1); };
    // and a way to stand in the course and walk about it, because the profile
    // drawing cannot say how steep that wall really is or what is on the verge
    // at the half-way mark
    mv.append(bu, bd, inspectButton(id));
    el.appendChild(mv);
    cards.appendChild(el);
    void movable;
  }
  // the finale, always last
  {
    const fid = seasonFinaleId(state.tier);
    const cat = CAT_BY_ID[fid];
    const plan = planTrack(fid, trackSeed(fid), seasonScale(state.tier));
    const rec = state.results.find((r) => r.catId === fid);
    const el = document.createElement('div');
    el.className = 'card marathon' + (rec ? ' done' : '');
    el.innerHTML =
      `<div class="idx">${races + 1}</div>` +
      `<div class="info">` +
      `<div class="cname">${cat.name}</div>` +
      `<div class="cmeta">${cat.trait ? 'tests ' + cat.trait : 'every trait'} · ${Math.round(plan.length)} m` +
      (rec ? ` · finished ${rec.place}${placeWord(rec.place)} · +${rec.points} pts` : ' · runs last, whatever order you pick') + `</div>` +
      `<div class="chips">${terrainChips(plan)}</div>` +
      profileSVG(plan) + `</div>`;
    const mi = document.createElement('div');
    mi.className = 'move';
    mi.appendChild(inspectButton(fid));
    el.appendChild(mi);
    cards.appendChild(el);
  }

  const btn = $('startRace');
  if (seasonComplete()) {
    btn.textContent = 'See the season';
    btn.onclick = showSummary;
  } else {
    const nx = CAT_BY_ID[nextRaceId()];
    btn.textContent = 'Race: ' + nx.name;
    btn.onclick = () => { startRace(nextRaceId()); showRace(); };
  }
}
function placeWord(p) { return p === 1 ? 'st' : p === 2 ? 'nd' : p === 3 ? 'rd' : 'th'; }
/** The button that stands you in a course, for the card of any of them. */
function inspectButton(catId) {
  const b = document.createElement('button');
  b.className = 'peek';
  b.textContent = 'inspect';
  b.title = `walk about ${CAT_BY_ID[catId].name}`;
  b.onclick = () => { if (mode === 'inspect') closeInspector(); else openInspector(catId); };
  return b;
}
function swap(a, b) {
  const t = state.order[a];
  state.order[a] = state.order[b];
  state.order[b] = t;
  save();
  renderStable();
}

/* ================================================================== *
 * Looking a course over
 *
 * Every course on the season card can be stood in and walked about, which is
 * the only way to answer the questions the little profile drawing cannot: is
 * that wall as bad as it looks, where does that pool sit under the road, and
 * what is on the verge at the half-way mark. It is the same course the race
 * would be, built the same way, with no field on it and no clock running.
 *
 * WASD to walk, the mouse held down to look, Q and E for up and down, and
 * shift to go faster.
 * ================================================================== */
const freeCam = {
  pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set(), look: false, boost: false,
};
let inspecting = null;

function openInspector(catId) {
  if (inspecting) closeInspector();
  $('stable').classList.remove('on');
  $('hud').classList.remove('on');
  $('inspect').classList.add('on');
  $('inspectName').textContent = CAT_BY_ID[catId].name;
  // building a course is a moment's work; say so rather than freeze
  $('inspectName').textContent = CAT_BY_ID[catId].name + ' — building…';
  requestAnimationFrame(() => {
    // a race's windmills are still in the register - opening the inspector does
    // not tear a race down - and a farm built here adds its own, so the list is
    // emptied here rather than on the way out of the last thing that used it
    fans.length = 0;
    const { tr, grp } = buildCourse(catId);
    inspecting = { catId, tr, grp };
    scene.add(grp);
    // this course's pools get their probes now, exactly as a race's would - the
    // course you walk is the course that gets raced, and that includes the water
    syncProbes();
    // stand at the start line, off to one side and above it, looking down the
    // course the way the race camera would see it
    const fr = newFrame();
    trackAt(tr, START_S, fr);
    freeCam.pos.set(fr.p.x - fr.right.x * 4, fr.p.y + 5.5, fr.p.z - fr.right.z * 4);
    freeCam.yaw = Math.atan2(fr.fwd.x, fr.fwd.z);
    freeCam.pitch = -0.22;
    freeCam.keys.clear();
    freeCam.look = false;
    // and the light of the hour the course is raced in
    todU = -1; todPainted = -1;
    mode = 'inspect';
    $('inspectName').textContent = CAT_BY_ID[catId].name;
  });
}

function closeInspector() {
  if (!inspecting) return;
  dropCourse(inspecting.grp);
  waterMeshes.length = 0;
  fans.length = 0;
  inspecting = null;
  $('inspect').classList.remove('on');
  freeCam.keys.clear();
  freeCam.look = false;
  show('stable');
}

const _fcFwd = new THREE.Vector3(), _fcRight = new THREE.Vector3();
/**
 * The stable's ground: a flat disc at y zero, fifty-eight metres across, with a
 * rim round it. The free camera is walked on this rather than on `hills()`,
 * which is the course's terrain and is the rolling country *outside* the rim -
 * so a course's floor in the middle of the stable is a few metres above the
 * lawn, and the camera starts underground.
 */
const STAGE_FLOOR = 0.6, STAGE_EDGE = 55;
function freeCameraFrame(dt) {
  const c = freeCam;
  // the way it is facing, and the ground under it
  const fwd = _fcFwd.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
  const flat = Math.hypot(fwd.x, fwd.z) || 1;
  const right = _fcRight.set(fwd.z / flat, 0, -fwd.x / flat);
  const k = c.keys;
  let v = 0;
  if (k.has('KeyW') || k.has('ArrowUp')) v += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) v -= 1;
  let strafe = 0;
  if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1;
  let rise = 0;
  if (k.has('KeyE') || k.has('Space')) rise += 1;
  if (k.has('KeyQ')) rise -= 1;
  if (!v && !strafe && !rise) return;
  // shift to hurry: a course is a long thing to walk at a snail's pace
  const speed = (c.boost ? 46 : 15) * dt;
  c.pos.addScaledVector(fwd, v * speed);
  c.pos.addScaledVector(right, strafe * speed);
  c.pos.y += rise * speed;
  // and it stays above the country rather than going under it. Which country is
  // the question: a course is a lane cut through hills and the ground under it is
  // `hills()`, while **the stable is a flat disc at y zero** with a rim round it
  // - and `hills()` out on the lawn is the rolling country beyond the rim, which
  // is a few metres above the lawn itself. So walking the stable with a
  // course's floor puts the camera under the grass in the first stride.
  const floor = mode === 'inspect' ? hills(c.pos.x, c.pos.z) + 0.6 : STAGE_FLOOR;
  if (c.pos.y < floor) c.pos.y = floor;
  if (c.pos.y > 260) c.pos.y = 260;
  // and it stays inside the county, on the stable or on a course alike: the
  // lawn is a fifty-eight metre disc and walking off the edge of it drops the
  // camera into the void beyond the rim
  const r = Math.hypot(c.pos.x, c.pos.z);
  if (r > STAGE_EDGE && mode !== 'inspect') {
    c.pos.x *= STAGE_EDGE / r;
    c.pos.z *= STAGE_EDGE / r;
  }
}

  /**
   * Point the fill **along the view, from the eye**.
   *
   * The fill is a directional light and a directional light's direction is
   * `position - target` - so setting both to the camera's own position does not
   * make a light that shines wherever the camera is, it makes a light with **no
   * direction at all**, and it contributes nothing. Measured: on the stable's
   * orbit the fill's direction is 4.05 and it lights the scene at 0.48; on a
   * free camera it is exactly 0 and the scene loses a light worth about a third
   * of the key. That is the whole of "the free camera is darker".
   *
   * So the fill sits at the eye and is aimed some way down the line of sight,
   * which is what a fill *is*: the faces turned away from the sun get the light
   * from behind the viewer and not from nowhere. It was measured the same way
   * on the course's own free camera, so walking a course has been losing its
   * fill since the free camera was added; the orbit never did, because it aims
   * the fill at the plinth.
   */
  const FILL_AIM = 10;
  function aimFill(e, c) {
    const cp = Math.cos(c.pitch);
    e.fill.position.copy(c.pos);
    e.fill.target.position.set(
      c.pos.x + Math.sin(c.yaw) * cp * FILL_AIM,
      c.pos.y + Math.sin(c.pitch) * FILL_AIM,
      c.pos.z + Math.cos(c.yaw) * cp * FILL_AIM);
  }
  /** The course, looked at: the water moves, the hour stands, nothing races. */
function inspectFrame(dt) {
  const tr = inspecting && inspecting.tr;
  if (!tr) return;
  // the water is animated off the same clock it is in a race, so a pool is
  // still moving while it is being looked at - and so is a windmill's fan, which
  // is the other thing on a course that is alive when nothing is
  updateWater();
  spinFans(dt);
  for (const e of [env]) {
    e.key.color.copy(TOD.sun);
    e.key.intensity = TOD.sunI;
    e.sunH = TOD.sunH;
    e.sunSide = TOD.sunSide;
    e.rim.intensity = lerp(0.35, 0.14, 0.5);
    e.fill.intensity = 0.5;
    e.hemi.color.copy(TOD.hemiSky);
    e.hemi.groundColor.copy(TOD.hemiGround);
    e.hemi.intensity = TOD.hemiI;
    e.scene.fog.color.copy(TOD.fog);
  }
  mat.cloud.emissiveIntensity = 0.12 + 0.42 * clamp(TOD.sunI / 1.55, 0, 1);
  mat.hillFar.color.setHex(0xb2c8c6).lerp(TOD.fog, TOD.haze);
  mat.hillNear.color.setHex(0x8cae94).lerp(TOD.fog, TOD.haze * 0.85);
  mat.lampGlass.emissiveIntensity = TOD.lamps * 2.6;
  mat.paper.emissiveIntensity = 0.10 + TOD.lamps * 0.35;
  renderer.toneMappingExposure = TOD.exposure;
  // and the lanterns near the eye are the ones that light the ground
  for (const l of env.lamps) { l.intensity = 0; l.visible = false; }
  if (TOD.lamps > 0.02 && lampPosts.length) {
    const near = lampPosts
      .map((l) => ({ l, d: (l.p.x - freeCam.pos.x) ** 2 + (l.p.z - freeCam.pos.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(LAMP_LIGHTS, near.length); i++) {
      const lamp = env.lamps[i], n = near[i].l;
      lamp.position.set(n.p.x, n.p.y, n.p.z);
      lamp.color.setHex(n.colour || LAMP_COLOUR);
      lamp.intensity = (n.power || 9) * Math.max(TOD.lamps, 0.25) * clamp(1 - Math.sqrt(near[i].d) / 34, 0.15, 1);
      lamp.distance = n.reach || 15;
      lamp.visible = true;
    }
  }
  camera.position.copy(freeCam.pos);
  camera.lookAt(
    freeCam.pos.x + Math.sin(freeCam.yaw) * Math.cos(freeCam.pitch),
    freeCam.pos.y + Math.sin(freeCam.pitch),
    freeCam.pos.z + Math.cos(freeCam.yaw) * Math.cos(freeCam.pitch));
  env.sky.position.copy(camera.position);
  // the backdrop follows, or the far country slides about behind the course
  backdrop.position.set(freeCam.pos.x, freeCam.pos.y - 3, freeCam.pos.z);
  env.key.position.set(freeCam.pos.x + 3.6 * env.sunSide, freeCam.pos.y + 5.6 * env.sunH, freeCam.pos.z + 3.4 * env.sunSide);
  env.key.target.position.set(freeCam.pos.x, freeCam.pos.y, freeCam.pos.z);
  aimFill(env, freeCam);
  updateTimeOfDay(true);
}

/** The keys and the mouse, which are only wanted while a course is being looked at. */
function bindInspector() {
  addEventListener('keydown', (e) => {
    // and the stable, which can be looked about the same way - the two are the
    // same camera and the same keys, so the gate is "is a free camera in hand"
    // rather than a list of two modes to remember to keep in step
    if (mode !== 'inspect' && mode !== 'stroll') return;
    freeCam.keys.add(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') freeCam.boost = true;
    if (e.code === 'Escape') {
      if (mode === 'stroll') closeStroll(); else closeInspector();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => {
    freeCam.keys.delete(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') freeCam.boost = false;
  });
  addEventListener('blur', () => { freeCam.keys.clear(); freeCam.boost = false; freeCam.look = false; });
  // mouselook while a button is held: the pointer is not taken over, so the
  // button that closed the course is still there to press again
  const el = renderer.domElement;
  el.addEventListener('pointerdown', () => { if (mode === 'inspect' || mode === 'stroll') freeCam.look = true; });
  addEventListener('pointerup', () => { freeCam.look = false; });
  el.addEventListener('pointermove', (e) => {
    if ((mode !== 'inspect' && mode !== 'stroll') || !freeCam.look) return;
    freeCam.yaw -= e.movementX * 0.0032;
    freeCam.pitch = clamp(freeCam.pitch - e.movementY * 0.0032, -1.45, 1.45);
  });
  el.addEventListener('contextmenu', (e) => { if (mode === 'inspect') e.preventDefault(); });
}

function show(screen) {
  $('stable').classList.toggle('on', screen === 'stable');
  $('hud').classList.toggle('on', screen === 'race');
  mode = screen === 'stable' ? 'stable' : 'race';
  if (screen === 'stable') applyLook();
}
function showRace() {
  mode = 'race';
  $('stable').classList.remove('on');
  $('hud').classList.add('on');
  camState.pos.copy(race.player.model.group.position).add(new THREE.Vector3(0, 6, 12));
  camState.look.copy(race.player.model.group.position);
  lastCount = '';
  $('count').textContent = '';
}

/* ================================================================== *
 * Results and the season summary
 * ================================================================== */
function showResults(rec) {
  const body = $('resBody');
  body.innerHTML = '';
  for (const f of rec.field) {
    const tr = document.createElement('tr');
    if (f.player) tr.className = 'me';
    // where the rating came from and where it ended up, coloured by the way it
    // went: the number it was is dimmed back and the one it is now is the
    // point, so the ladder is readable at a glance without a second column
    const up = f.dRating > 0 ? 'up' : f.dRating < 0 ? 'dn' : 'flat';
    const move = `${f.dRating > 0 ? '+' : f.dRating < 0 ? '−' : ''}${Math.abs(f.dRating || 0)}`;
    tr.innerHTML =
      `<td class="p">${f.place}</td>` +
      `<td><span class="dot" style="background:#${(f.player ? state.body : (state.pool.find((p) => p.name === f.name) || { body: 0x888888 }).body).toString(16).padStart(6, '0')}"></span> ${f.name}</td>` +
      `<td class="tm">${f.time ? f.time.toFixed(1) + 's' : '—'}</td>` +
      `<td class="pts">${f.points || '—'}</td>` +
      `<td class="rt ${up}" title="${f.wasRating} → ${f.rating} (${move})">` +
      `<span class="was">${f.wasRating}</span> → ${f.rating}</td>`;
    body.appendChild(tr);
  }
  const strip = $('resStrip');
  strip.innerHTML = '';
  const finale = seasonFinaleId(state.tier);
  for (const r of state.results.slice(-6)) {
    const el = document.createElement('i');
    el.className = r.place <= 4 ? 'p' + r.place : (r.catId === finale ? 'm' : '');
    el.textContent = r.place + placeWord(r.place);
    el.title = CAT_BY_ID[r.catId].name;
    strip.appendChild(el);
  }
  $('resTitle').textContent = rec.place <= 3 ? ['Winner!', 'Second place', 'Third place'][rec.place - 1] : 'Result';
  $('resSub').textContent = `${CAT_BY_ID[rec.catId].name} · ${Math.round(rec.length)} m · finished ${rec.place}${placeWord(rec.place)} of ${FIELD} · ${clockText(rec.hour == null ? 12 : rec.hour)}`;
  $('resTot').innerHTML =
    `<div><div class="k">points</div><div class="v">+${rec.points}</div></div>` +
    `<div><div class="k">gold</div><div class="v">+${rec.points}</div></div>` +
    `<div><div class="k">season total</div><div class="v">${state.pts}</div></div>` +
    `<div><div class="k">rating</div><div class="v">${state.rating}</div></div>`;
  const allDone = race.racers.every((r) => r.finished);
  $('resStay').style.display = allDone ? 'none' : '';
  $('resStay').onclick = () => { race.waitAll = true; $('results').classList.remove('on'); };
  $('resNext').textContent = seasonComplete() ? 'Season results' : 'Back to the stable';
  $('resNext').onclick = () => {
    $('results').classList.remove('on');
    if (seasonComplete()) showSummary();
    else { show('stable'); renderStable(); }
  };
  $('results').classList.add('on');
}

function showSummary() {
  const body = $('sumBody');
  body.innerHTML = '';
  for (let i = 0; i < state.results.length; i++) {
    const r = state.results[i];
    const cat = CAT_BY_ID[r.catId];
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="p">${i + 1}</td>` +
      `<td>${cat.name}</td>` +
      `<td class="cmeta" style="font-family:var(--mono);font-size:10px;color:var(--dim)">${cat.trait || 'all'}</td>` +
      `<td class="tm">${r.place}${placeWord(r.place)}</td>` +
      `<td class="pts">${r.points}</td>`;
    body.appendChild(tr);
  }
  const champ = state.pool.slice().sort((a, b) => b.wins - a.wins || b.rating - a.rating)[0];
  $('sumTitle').textContent = state.wins >= 3 ? 'A fine season' : 'Season complete';
  $('sumSub').textContent = `${seasonWord(seasonLength())} races · ${state.wins} win${state.wins === 1 ? '' : 's'} · final rating ${state.rating}`;
  $('sumTot').innerHTML =
    `<div><div class="k">points</div><div class="v">${state.pts}</div></div>` +
    `<div><div class="k">wins</div><div class="v">${state.wins}</div></div>` +
    `<div><div class="k">races</div><div class="v">${state.races}</div></div>` +
    `<div><div class="k">snail of the year</div><div class="v" style="font-size:14px">${champ.name}</div></div>`;
  $('summary').classList.add('on');
}

function shuffleOrder() {
  const r = makeRng((Date.now() ^ (Math.random() * 0xffffff)) | 0);
  state.order = seasonPicks(state.tier);
  for (let i = state.order.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = state.order[i]; state.order[i] = state.order[j]; state.order[j] = t;
  }
}
/**
 * Enter a season. Three things come with you: your rating, which is the ladder
 * and says which seasons you may enter; the snail itself, because every trait
 * you have fed is still on it and a snail does not go back to being a club
 * snail because it is racing a better field; and the gold in your purse, which
 * is what you have been earning all this time. What goes back to scratch is the
 * season: the results, the points, and the seven the picker showed you.
 */
function joinSeason(id) {
  if (!canEnter(id, state.rating) && !confirm(`You are not rated for the ${seasonDef(id).name}. Race it anyway?`)) return;
  if (state.results.length && id !== state.tier && !confirm('Abandon this season and start again?')) return;
  // who you raced in the season just gone, taken before the results are wiped
  const lastField = lastSeasonField();
  // A new season, a new grid: drawn against those seven and against the rivals
  // who have had least of a run. Drawn before the season number moves, so it
  // comes out of the same cache the picker read and you race the seven you were
  // shown; the next season draws on a fresh key. A season that has not been
  // raced yet keeps the seven it has.
  state.field = null;
  const field = seasonField(id, lastField);
  state.season++;
  state.tier = id;
  state.field = field;
  forgetSeasonFields();
  state.results = [];
  state.races = 0; state.pts = 0; state.wins = 0;
  shuffleOrder();
  seasonRivals();               // this season's seven, on the board
  save();
  $('summary').classList.remove('on');
  closeSeasons();
  show('stable');
  renderStable();
}

/**
 * Throw the saved game away and start again from nothing: a fresh snail, a
 * fresh field, season one. Anything mid-race is dropped, and the fresh game is
 * written straight back out, so there is only ever one state and a reload
 * cannot bring the old one back.
 */
function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { void e; }
  // the course still on the scene is torn down by the next startRace
  Object.assign(race, { catId: null, tr: null, racers: [], player: null, t: 0, phase: 'idle', result: null, waitAll: false });
  $('results').classList.remove('on');
  $('summary').classList.remove('on');
  closeSeasons();
  forgetSeasonFields();
  state.season = 1;
  state.name = 'Wilma';
  state.gold = START_GOLD;
  state.body = 0xe0b183; state.shell = 0xc8a05a; state.style = 'bands';
  state.stats = freshSnail();
  state.results = [];
  state.rating = START_RATING; state.races = 0; state.pts = 0; state.wins = 0;
  state.tier = seasonFor(START_RATING).id;
  state.order = seasonPicks(state.tier);
  state.field = null;
  // the cast of rivals is the same every game, but their season records are
  // not: this puts all of them back to a clean sheet
  state.pool = makePool();
  shuffleOrder();
  save();
  show('stable');
  renderStable();
  applyLook();
}

/* ================================================================== *
 * Saving
 * ================================================================== */
const SAVE_KEY = 'snail-grand-prix-v1';
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({ v: 2 }, state))); } catch (e) { void e; }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    // **A version and not a migration, and that is the house rule.** The stat
    // called `climbing` is called `power` now, and `effTraits()` reads every key
    // in `ATTRS` out of a save without asking whether it is there - so a save
    // with a stale key hands `effFor()` an `undefined` and every speed on the
    // course comes out `NaN` on the first frame, which is a black screen and a
    // console full of nothing. A fresh save is the answer that always works and
    // it is one `state = freshSnail()` away, so a renamed stat is worth a
    // version and not a patch to `load()`. The file is overwritten by the same
    // key on the first write, so nothing of the old one is left lying about.
    if (!d || d.v !== 2 || !Array.isArray(d.pool) || d.pool.length !== POOL_SIZE) return false;
    // rivals now carry attributes rather than the old 1-12 traits; a save from
    // before that has a pool the current code cannot read, so take the new one
    if (!d.pool.every((p) => p && p.attrs && typeof p.rating === 'number')) return false;
    Object.assign(state, d);
    if (typeof state.rating !== 'number' || !isFinite(state.rating)) state.rating = START_RATING;
    // a save from before the seasons existed has no tier; put it in the one
    // its rating earns and draw the field
    state.tier = TIER_BY_ID[state.tier] ? state.tier : seasonFor(state.rating).id;
    // A course can be taken out of the game, and a season can change its
    // roster, so a save made before it was will be pointing at courses this
    // season does not run. Give the save back the season's own list, in the
    // order it had raced them where that is still true.
    const picks = seasonPicks(state.tier);
    state.order = (Array.isArray(state.order) ? state.order : picks).filter((id) => picks.includes(id));
    if (state.order.length !== picks.length) state.order = picks.slice();
    state.results = (Array.isArray(state.results) ? state.results : []).filter((r) => r && CAT_BY_ID[r.catId]);
    if (!Array.isArray(state.field)) state.field = null;
    return true;
  } catch (e) { void e; return false; }
}

/* ================================================================== *
 * Input
 * ================================================================== */
let surging = false;
addEventListener('keydown', (e) => {
  // **Gated on the mode, and only on the mode.** As written this fired in every
  // mode and called `preventDefault()` in every mode, which is what a page that
  // cares about a game getting the key does - except that on the stable and over
  // a modal it means Space cannot activate the button you have just focused, and
  // six rows of six buttons is a lot of keyboard to lose. The gate is the race,
  // because the race is the only place Space is the surge.
  if (e.code === 'Space' && mode === 'race') { e.preventDefault(); surging = true; }
});
addEventListener('keyup', (e) => { if (e.code === 'Space' && mode === 'race') surging = false; });
// and Escape closes the options, which nothing else did: it is only handled in
// the two free-camera modes, so no modal on this page has ever closed on it.
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && optionsOpen) { e.preventDefault(); closeOptions(); }
});
const surgeBtn = $('surge');
const surgeOn = (e) => { e.preventDefault(); surging = true; };
const surgeOff = () => { surging = false; };
surgeBtn.addEventListener('pointerdown', surgeOn);
addEventListener('pointerup', surgeOff);
addEventListener('pointercancel', surgeOff);

$('snailName').addEventListener('input', (e) => {
  state.name = e.target.value.slice(0, 14) || 'Snail';
  save();
});
$('bodyColor').addEventListener('input', (e) => { state.body = parseInt(e.target.value.slice(1), 16); applyLook(); save(); });
$('shellColor').addEventListener('input', (e) => { state.shell = parseInt(e.target.value.slice(1), 16); applyLook(); save(); });
for (const el of document.querySelectorAll('#styles button')) {
  el.addEventListener('click', () => { state.style = el.dataset.s; applyLook(); save(); });
}
$('newSeason').addEventListener('click', openSeasons);
$('pickSeason').addEventListener('click', openSeasons);
$('seasClose').addEventListener('click', closeSeasons);
$('sumNew').addEventListener('click', openSeasons);
// And the free camera on the stable, which is the same camera a course gets and
// the same keys; the button is a shortcut into it, and everything else about the
// place carries on exactly as the orbit left it.
$('freeLook').addEventListener('click', openStroll);
$('strollBack').addEventListener('click', closeStroll);

// The saved game is the only thing that carries a season across a reload, so
// throwing it away is a real loss. It takes two clicks and the button says so
// once you have asked, rather than one stray click on a small quiet button.
let wipeArmed = 0;
const wipeBtn = $('wipeSave');
function disarmWipe() {
  clearTimeout(wipeArmed);
  wipeArmed = 0;
  wipeBtn.classList.remove('armed');
  wipeBtn.textContent = 'Delete save';
  wipeBtn.title = 'throw the saved game away and start a new snail';
}
wipeBtn.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = setTimeout(() => { wipeArmed = 0; wipeBtn.classList.remove('armed'); wipeBtn.textContent = 'Delete save'; }, 4000);
    wipeBtn.classList.add('armed');
    wipeBtn.textContent = 'Tap again to erase';
    wipeBtn.title = 'this erases the season, the gold and the snail for good';
    return;
  }
  disarmWipe();
  wipeSave();
});

/* ================================================================== *
 * Go
 * ================================================================== */
if (!load()) shuffleOrder();
seasonRivals();          // you are told who you are racing before you race them
// The wind and the cloud shades are injected into the county's surfaces once, at
// setup, and driven by uniform thereafter - see `gfxSurfaceTargets()`
gfxSurfaceTargets();
stage = buildStage();
stageScene.add(stage.group);
applyLook();
bindInspector();
$('inspectBack').onclick = closeInspector;
updateTimeOfDay(true);   // and the day it is raced in
renderStable();
$('openOptions').addEventListener('click', openOptions);
$('optClose').addEventListener('click', closeOptions);
// "Reset to current" is the middle step of every row, which is today's build -
// and it is the same code as choosing preset 3, plus the one row preset 3 does
// not own, because the button says every row and not the rows a preset has.
$('optDefaults').addEventListener('click', () => {
  setDefaults();
  gfxSave();
  for (const k of STAGE_ROWS) markStageDirty(k);
  renderOptions();
  applyGraphics();
});
// and the settings themselves, applied once at boot so a saved tier above the
// bottom is standing before the first frame rather than arriving a second later.
// A tier that needs a post pass fetches one on the way; the frame loop draws the
// direct path until it lands, which is a frame, not a fault.
applyGraphics();
$('boot').classList.add('gone');
setTimeout(() => { const b = $('boot'); if (b) b.remove(); }, 700);
window.__snail = {
  state, race, get stage() { return stage; },
  get gfx() { return { ...gfx, composerUp, needsComposer: needsComposer(), probes: courseProbes.length }; },
  setGfx: (k, n) => { setRow(k, n); gfxSave(); markStageDirty(k); renderOptions(); return applyGraphics(); },
  
    /**
   * What the renderer is actually doing, which is the only honest way to check
   * that the bottom tier is really running the game's own single `render()`: the
   * call count and the number of render targets in memory, before and after a
   * step. A tier that wants no composer should show no ping-pong targets.
   */
  info: () => ({
    mode, calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
    targets: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
    pixelRatio: renderer.getPixelRatio(),
    passes: composer ? composer.passes.map((p) => p.constructor.name) : [],
    // **Read off the buffer rather than off the setting**, because those two
    // disagree exactly when the interesting thing has happened: a target's sample
    // count is baked into its framebuffer when that framebuffer is built, so
    // `msaa` saying x4 and this saying 0 is a machine whose setting did not land.
    samples: composer ? composer.renderTarget1.samples : 0,
    // **The chain's own buffer beside the canvas's**, because they are two
    // resolutions that are *meant* to differ and are not allowed to: the canvas is
    // native and the chain is a share of it, and the ratio between them is the
    // render row. Read them against each other, not against the setting.
    rt: composer ? [composer.renderTarget1.width, composer.renderTarget1.height] : null,
    canvas: [renderer.domElement.width, renderer.domElement.height],
    // **A black frame has two causes and they need opposite fixes** - a scene that
    // is genuinely black, or a program that did not compile - and only the second is
    // silent about it. three keeps the log on the program wrapper when
    // `checkShaderErrors` is on, so this is the line that tells them apart, and the
    // `glError` is the flag that says a draw was dropped rather than done. The tell
    // that this is worth having: `gl_FragColor : syntax error` at a tone-map line,
    // with every line above it correct, because the fragment closed `main()` a line
    // early and put the tail at global scope.
    glError: renderer.getContext().getError(),
    badProgram: (renderer.info.programs || [])
      .filter((p) => p.diagnostics && !p.diagnostics.runnable)
      .map((p) => `${p.name}: ${(p.diagnostics.fragmentShader || {}).log || p.diagnostics.programLog}`.trim())
      .slice(0, 3),
  }),
  get mode() { return mode; },
  /** The last frame, as numbers. `grab() - grab()` is two frames of the same
   *  path; `grab()` on either side of a tier change is the two paths. */
  grab: (cols, rows) => grabPixels(cols, rows),
  /** Whether the sky and the hills are still switched on, and which scene the
   *  G-buffer is being built from. The two used to disagree in a way nothing
   *  else could see: a pass that hides them for its own depth pass can only put
   *  back what it walked, and the county has two of everything. */
  background: () => ({
    raceSky: env.sky.visible, stageSky: stageEnv.sky.visible,
    raceHills: backdrop.visible, stageHills: stageBackdrop.visible,
    passScene: !gtaoPass ? null : (gtaoPass.scene === scene ? 'race' : 'stage'),
    mode,
  }),
  plan: (id) => planTrack(id, trackSeed(id), seasonScale(state.tier)),
  track: (id) => buildTrack(id, trackSeed(id), seasonScale(state.tier)),
  groundYAt, trackAt, newFrame,
  groundColumns, groundDrawnAt,
  /**
   * What is standing on the last course built, and whether any of it is
   * standing inside any of the rest. `tightest` names the two pieces, because
   * "two things are too close" is a report nobody can act on.
   */
  standing: () => {
    const named = (g) => Object.keys(props).find((k) => props[k] === g) || '?';
    const by = {};
    for (const s of STANDING) {
      const k = s.geo ? named(s.geo) : 'a clearing';
      by[k] = (by[k] || 0) + 1;
    }
    let worst = null;
    for (let i = 0; i < STANDING.length; i++) {
      for (let j = i + 1; j < STANDING.length; j++) {
        const a = STANDING[i], b = STANDING[j];
        if (a.exempt || b.exempt) continue;      // a scarecrow in its own field
        const need = a.r + b.r, d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d >= need) continue;
        if (!worst || need - d > worst.over) {
          worst = { over: +(need - d).toFixed(2), apart: +d.toFixed(1), need: +need.toFixed(1),
            a: named(a.geo), b: named(b.geo) };
        }
      }
    }
    return {
      pieces: STANDING.length,
      reserved: RESERVED.length,
      // what is standing, and the yards, because a farm is worth looking at and
      // this is where one is
      by,
      yards: RESERVED.map((z) => [+z.x.toFixed(1), +z.z.toFixed(1), z.r]),
      tightest: worst,
    };
  },

  /**
   * Where the windmills on this course are, and how far round each fan has got.
   * A mill is the one thing on a course that is not a prop the register knows
   * about - it is a group with a pivot in it - so it is the one thing that has to
   * be asked for separately, and being told where it is and what it is doing is
   * how you check the fans turned at all.
   */
  mills: () => fans.map((f) => ({
    at: f.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)),
    turned: +f.rotation.z.toFixed(2),
  })),

  get cam() {    // `want` is where the race camera is heading, and there is no race on the
    // stable or in the inspector - and a debug getter that throws is a debug
    // getter that stops being used, which is how the free camera on the stable
    // went in with nobody able to read where it was
    const p = race.player;
    return {
      mode,
      pos: camera.position.toArray().map((v) => +v.toFixed(2)),
      look: camState.look.toArray().map((v) => +v.toFixed(2)),
      free: mode === 'inspect' || mode === 'stroll'
        ? { pos: freeCam.pos.toArray().map((v) => +v.toFixed(2)), yaw: +freeCam.yaw.toFixed(2) }
        : null,
      want: p && p.model ? [p.model.group.position.x - p.fr.fwd.x * 7.4,
        p.model.group.position.y + 3.1,
        p.model.group.position.z - p.fr.fwd.z * 7.4].map((v) => +v.toFixed(2)) : null,
    };
  },
  /**
   * park the camera anywhere, for looking at a piece of course closely
   *
   * It parks **freeCam**, which is the camera the inspector actually reads, and
   * works out the yaw and pitch off the point it is told to look at. It used to
   * write `camState` and the camera position outright, and neither of those is
   * read in inspect mode - the free camera copies itself onto the camera at the
   * end of its own frame - so it set nothing and the next frame put the camera
   * back where the walk had it. The only way to look at anything on a course
   * before now was to walk to it, which is the opposite of parking.
   */
  view: (x, y, z, lx, ly, lz) => {
    mode = 'inspect';
    const dx = lx - x, dy = ly - y, dz = lz - z;
    freeCam.pos.set(x, y, z);
    freeCam.yaw = Math.atan2(dx, dz);
    freeCam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    freeCam.keys.clear();
    freeCam.look = false;
    return true;
  },
  start: (id) => { startRace(id || nextRaceId() || seasonFinaleId(state.tier)); showRace(); },
  /** run a whole race with the clock, for checking balance without watching it */
  sim: (secs, dt) => {
    dt = dt || 0.04;
    race.phase = 'running';
    for (let i = 0; i < secs / dt && race.phase === 'running'; i++) {
      const p = race.player;
      // the bar belongs to the player and nobody else: an unassisted snail
      // holds its own pace, and only the button in your own hand spends it
      race.autoSurge = simSurge && !p.spent && p.stam > p.stamMax * 0.08;
      stepRace(dt);
    }
    race.autoSurge = false;
    return race.result;
  },
  /** stand in for a player holding the surge button, for balance checks */
  surge: (on) => { simSurge = !!on; },
  finish: () => finishRace(),
  skip: () => { for (const r of race.racers) { r.s = race.tr.finish; r.finished = true; r.finishT = 1; } finishRace(); },
  feed: (k) => { state.gold -= GOLD_PER_FRUIT; state.stats[k]++; renderStable(); },
};
