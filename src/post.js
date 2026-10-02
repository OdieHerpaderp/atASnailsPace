/* ================================================================== *
 * post.js
 *
 * Everything between the county and the window: the settings panel and the
 * functions that put a row into effect, the post chain and the three passes on
 * it, the grain and the vignette, the readback, the glows, and the reflection
 * probes.
 *
 * **It reads its scenes through `world` and never imports them, and that is the
 * shape the whole split rests on at this end.** The chain is built before the
 * course it will draw, and rebuilt when the tier moves; it needs the race's
 * scene and the stable's, and both are built further down the graph by modules
 * that import *this* one for `gfxMsaa()` and `needsResample()`. So it reads
 * `world.scene` and `world.stageScene`, and `surfaces.js` and `stage.js` write
 * them at module scope - and the one thing that can fail here is the chain
 * building against a `world` that is still empty, which is why the golden spec
 * takes the tier up and down and draws a whole course through it.
 *
 * **The registry is filled late and that is safe by the import order rather than
 * because anybody ordered anything.** `app.js` imports every module before its
 * own body runs, so by the first frame every `world` field has its write behind
 * it. Nothing in this file runs at module scope against a scene.
 *
 * The row that does not own itself, `render`, is the row that puts this chain on
 * at all, and the bottom tier only skips it because that row is on 1x: the tier
 * that spends no render target is the tier with nothing to resample.
 * ================================================================== */
import { THREE, $, clamp, lerp, TAU } from './core.js';
import {
  world, gfx, gfxScale, setPreset, setDefaults, setRow, setToggle, gfxSave,
  RENDER_SCALE, RENDER_SCALE_CAP, SCALE_NAMES, SCALE_TAPS, GFX_STEPS, GFX_ROWS,
  nativePixelRatio, canvasRatio, sceneRatio, needsResample,
  FOG_LADDER, EDGE_LADDER, SHADOW_MAP, SHADOW_RADIUS, SHADOW_CAST,
  PROP_DENSITY, GRASS_DENSITY, SKY_LADDER, AO_LADDER, GI_RADIUS, GI_INNER, GI_THICK,
  REFL_LADDER, REFL_FRESNEL, MSAA_LADDER, MSAA_NAMES, MSAA_PRESET, PRESET_NAMES,
  FX_TOGGLES, FX_KEYS, FOG_MATCH,
  gfxMsaa, gfxSsao, gfxReflSize, gfxReflOn, triesBoost, grassCount,
  renderer, buildSkyGeo, setSkyGeo, skyGeo, matSky, paintSky, domeToneFix, timeOfDay,
  envPmrem, makeEnv, refreshEnvironment,
  LAMP_LIGHTS, LAMP_SPACING, LAMP_COLOUR,
  raceClock, raceHour, clockText, TOD, WHITE, _todSky,
} from './graphics.js';
import { mat, detailOf, mapTex, gfxU, gtaoWind, windMark, waterFresnel } from './materials.js';/* ================================================================== *
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
const renderScene = () => world.renderScene();

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
  if (_todSky) paintSky(_todSky, composerUp);
}

/**
 * Point the whole chain at a scene, **all three passes at once and every frame**,
 * and this is a function rather than three exported `let`s because that is what
 * it has to be. There are two scenes - the county's and the stable's - and which
 * one is up changes with the mode; a pass left pointing at the other one renders
 * the stable into a race's occlusion and produces nothing at all rather than
 * something wrong, which is much harder to see.
 *
 * **All three, unconditionally.** The occlusion pass was written once at
 * construction and left there while the beauty pass was already right, so on the
 * stable its depth buffer was full of a course nobody could see. And the bounce
 * has its own scene field because it renders the albedo with its own override
 * material, for the same reason and with the same cost of getting it wrong: a
 * bounce built from the stable's colour while the occlusion was built from the
 * county's is an irradiance estimate of the wrong county, and a colour cast does
 * not look like an error.
 */
function setChainScene(sc) {
  if (renderPass) renderPass.scene = sc;
  if (gtaoPass) gtaoPass.scene = sc;
  if (gtaoGiPass) gtaoGiPass.scene = sc;
}

/** Is the chain up, and which scene is it pointed at. Both are read by the frame
 *  loop and the readout, and a `let` reached across the graph is read-only -
 *  so the question is answered here and the answer handed over. */
const chainUp = () => composerUp;
const chainScene = () => (gtaoPass ? gtaoPass.scene : null);

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
  renderPass = new RenderPass(renderScene(), world.camera);
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
  if (_todSky) { paintSky(_todSky, composerUp); if (gfxReflOn()) queueProbes(); }
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
    gtaoPass = new GTAOPass(world.scene, world.camera, 1, 1);
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
  if (wantGI && !gtaoGiPass) gtaoGiPass = newGtaoGiPass(gtaoPass, world.camera);
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
 * quarter of the pixels and its denoise reads a quarter of them. `_renderGBuffer`
 * re-renders the whole scene with a normal material every frame, so this is the
 * single largest saving available on the row and the reason level 2 is not just a
 * smaller radius on level 3. It is also, visibly, softer - which is the honest
 * trade and the reason the level is called Light and not Cheap.
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
}

/**
 * The bounce's own buffer, and it is **the same `a.half` the G-buffer just read**
 * rather than a second decision about resolution. Two answers to the same question
 * would be two that could disagree, and the failure is not a crash: a bounce ray
 * marched against a depth buffer of the wrong size is a bounce that lands on the
 * wrong piece of the county, and the picture comes out plausible.
 *
 * The same reason it asks the ladder and not the pass as `sizeGtao()` does: this
 * is reached for the length of one `applyGraphics()` with a pass that is about to
 * be dropped still standing and a row that says there is nothing to size.
 */
function sizeGtaoGi() {
  if (!gtaoGiPass) return;
  const a = gfxSsao();
  if (!a) return;
  const [w, h] = scenePixels();
  const half = !!a.half;
  gtaoGiPass.setGBufferSize(half ? Math.max(1, Math.round(w / 2)) : w,
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
 * **Scoped to the scene the pass is about to render.** `overrideVisibility()`
 * walks `this.scene` and `restoreVisibility()` walks the same one, so anything
 * hidden outside it is never put back - and the county has two of everything,
 * a race and a stable, each with its own dome and its own hills. Hiding both
 * scenes' worth left whichever one the pass was *not* building its buffer from
 * switched off for good, and the stable came up with no sky at all.
 */
function hideFromGBuffer(sc, cache) {
  if (!sc) return;
  sc.traverse((o) => {
    // **The record is optional and is what makes this function usable twice.**
    // `GTAOPass` has its own cache and its own `restoreVisibility()`, so it walks
    // in here with no map and nothing to put back; the bounce's albedo render
    // keeps its own, because it is not a `GTAOPass` and the map `overrideVisibility`
    // fills is emptied before the frame loop reaches it.
    if (cache) cache.set(o, o.visible);
    if (!o.visible || o.isPoints || o.isLine) return;
    const m = o.material;
    if (!m) return;
    for (const mm of (Array.isArray(m) ? m : [m])) {
      // **`userData.painted` and not the name of the material**, and that is the
      // whole of what this line was rewritten for. It used to be
      // `mm === mat.cloud || mm === mat.hillNear || mm === mat.hillFar`, which
      // put the backdrop's three materials inside this file - and this file is
      // upstream of the jar that owns them, so reading them here is a cycle.
      // The three are marked where they are built (`makeBackdrop()`), which is
      // also the better place for the answer: **a thing that cannot occlude
      // anything because it is painted background says so on itself**, rather
      // than being listed by a name in a file that draws frames.
      if (mm.transparent || mm.depthWrite === false || mm.blending !== THREE.NormalBlending
          || mm.userData.painted) {
        o.visible = false;
        return;
      }
    }
  });
}

/**
 * The other half of the bounce's pair, and **the reason it is a function and not a
 * line repeated at the call site**: `GTAOPass` restores through
 * `restoreVisibility()`, which walks the map *its* `overrideVisibility()` filled,
 * and that map is cleared before the bounce's turn comes round. A bounce that hid
 * a piece of the dome and never put it back would take the sky with it, and a sky
 * that came back on the next pass rather than the next frame is the county's own
 * `restoreVisibility()` bug all over again.
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
 * The bounce: a diffuse-irradiance estimate off the occlusion pass's own
 * normal-and-depth buffer, and one extra scene render for a colour to sample
 * with it.
 *
 * **It reads `GTAOPass`'s buffer rather than building a G-buffer of its own,
 * and that is the whole of the design.** r160's `GTAOPass` already renders the
 * scene into a half-float view-normal target with a depth texture attached, one
 * `MeshNormalMaterial` and one extra draw, every frame - and the county's
 * `sizeGtao()` already decides how many pixels that is. A pass that wanted its
 * own would be a second scene render of its own before it could march a single
 * step, and the two buffers would be two answers to the same question.
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
  const target = new THREE.WebGLRenderTarget(1, 1);
  target.texture.name = 'GtaoGi.albedo';
  // **A fresh basic material, and not `gtaoPass.normalMaterial`**: that one is a
  // `MeshNormalMaterial` and its whole output is a direction. This one reads the
  // vertex colours and stops, and it opts out of the tone map for the same reason
  // `matSky` does - the buffer is a light source to be read by a later pass, and
  // a second ACES on it is a second curve through the county's colours.
  const albedo = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, toneMapped: false, fog: false,
  });
  // **The wind, again, on this one too** - see `gtaoWind()`. The injection is per
  // material and this is a different material from the one the occlusion buffer is
  // built out of, so `gtaoWind(gtaoPass.normalMaterial)` covers none of it. Without
  // this line a tree leans in the beauty pass, leans in the occlusion buffer and
  // stands still in the buffer the bounce reads, which is a ghost of its own
  // colour hanging under it.
  gtaoWind(albedo);
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
      this.scene = world.scene;
      this.camera = cam;
      this.gtao = gtao;
      this.target = target;
      this.albedo = albedo;
      this.material = material;
      this.fsQuad = new FullScreenQuad(material);
      this.strength = 0;
      this._vis = new Map();
      this._clear = new THREE.Color();
    }
    /**
     * The composer's own resize is a no-op here **by design and not by
     * omission**: the county draws this pass's inputs at the *G-buffer's* size and
     * not at the chain's, so the one number that decides it is `a.half` and
     * `sizeGtaoGi()` is the only thing that reads it. A `setSize()` that resized
     * the target would be a second answer to the same question, and the two would
     * be right on different frames.
     */
    setSize() {}
    setGBufferSize(w, h) { this.target.setSize(Math.max(1, w), Math.max(1, h)); }
    render(renderer, writeBuffer, readBuffer) {
      if (this.strength <= 0 || !this.gtao) {
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
      // The colour to bounce with, off the same scene and behind the same
      // traversal the occlusion's G-buffer is built behind, so the two buffers
      // agree about what is a piece of county and what is a sky.
      const sc = this.scene;
      hideFromGBuffer(sc, this._vis);
      const prevOverride = sc.overrideMaterial;
      const prevAuto = renderer.autoClear;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(this._clear);
      sc.overrideMaterial = this.albedo;
      renderer.setRenderTarget(this.target);
      // `autoClear` on rather than a `clear()` of our own, because the colour it
      // leaves is never read: a pixel the G-buffer has geometry in is a pixel this
      // render drew, since both are the same geometry behind the same test.
      renderer.autoClear = true;
      renderer.render(sc, this.camera);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(this._clear);
      renderer.setClearAlpha(prevAlpha);
      sc.overrideMaterial = prevOverride;
      restoreGBuffer(sc, this._vis);

      const u = this.material.uniforms;
      u.tDiffuse.value = readBuffer.texture;
      u.tAlbedo.value = this.target.texture;
      u.tNormal.value = this.gtao.normalRenderTarget.texture;
      u.tDepth.value = this.gtao.depthTexture;
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
      this.target.dispose();
      this.albedo.dispose();
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

/**
 * The grain and the vignette, on whichever of the two paths just ran - and **the
 * frame's time comes in as an argument**, because the frame loop owns the clock
 * and a number read across the graph is a number read on the frame *before* it
 * moved. There is one clock in the county on purpose: two effect clocks that are
 * not the same number drift apart within seconds, and a shadow sliding one way
 * over grass leaning another reads as two effects rather than one.
 *
 * **One quad, and it bails when both switches are off**, so a machine that has
 * neither pays nothing for having them - which is the whole argument for a
 * toggle over a rung on a ladder.
 */
function drawOverlay(t) {
  if (overlayUniforms.uVig.value <= 0 && overlayUniforms.uGrain.value <= 0) return;
  overlayUniforms.uTime.value = t;
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
/**
 * The pending grab, and the taking of it - a request and a consumption in one
 * pair, because **a `let` handed to another module is a `const` there**: the app
 * asking for a frame has to ask this file to hand the request over rather than
 * read the flag and clear it, and the flag is not exported at all so there is
 * nothing to reach in and clear.
 */
function takeGrab() {
  if (!grabWanted) return null;
  const g = grabWanted;
  grabWanted = null;
  return g;
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
/** The eye, worked out of whatever the camera is this frame. A scratch vector of
 *  this file's own rather than the frame loop's, because a glow pushed along the
 *  view axis is this file's arithmetic and nothing else touches it. */
const _glowV = new THREE.Vector3();
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
    s.getWorldPosition(_glowV);
    _glowV.subVectors(world.camera.position, _glowV);
    const d = _glowV.length();
    if (d > 1e-4) s.position.copy(_glowV.multiplyScalar(GLOW_CLEAR / d));
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
/** Probes that want a refresh, and how many are left. */
const probeQueue = [];
let probeLast = -1e9;
/** How often at most one probe is refreshed, in milliseconds. */
const PROBE_GAP = 260;

/** One place that answers "what water is on the course and on the stage", so
 *  the probes and the row that governs them cannot be told about half of it. */
function eachWaterSurface(out) {
  for (const m of world.water) out.push(m);
  const st = world.stage;
  if (st && st.pool && st.pool.water) out.push(st.pool.water);
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
  for (const m of world.courseWater.splice(0)) m.dispose();
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
  if (gfxStageDirty) world.restage();
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
/** The flag and its two halves, and **the clear is a function because the flag
 *  crossed a module edge.** `requestRestage()` reads it and sets it back, and it
 *  lives here rather than with the stage because `markStageDirty()` is the
 *  settings panel's and a module's live bindings cannot be written from outside -
 *  the same lesson `skyGeo` and the scenery register teach, and the third time
 *  this split has paid for it. */
let gfxStageDirty = false;
function markStageDirty(key) {
  if (STAGE_ROWS.includes(key)) gfxStageDirty = true;
}
function clearStageDirty() {
  gfxStageDirty = false;
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
  world.env.scene.fog.near = near;
  world.env.scene.fog.far = far;
  // The stable's air is the same air at a stage's width. Both bounds are scaled
  // by their own middle-step ratio rather than by one figure, so the middle step
  // is *exactly* the 34/150 `makeEnv` was given - a single scale factor cannot
  // do that, because 34/78 and 150/300 are not the same number.
  world.stageEnv.scene.fog.near = near * (34 / 78);
  world.stageEnv.scene.fog.far = far * (150 / 300);
}

/**
 * **The old shadow map is disposed and the reference nulled**, not just left.
 * `shadow.mapSize.set()` only tells the renderer what size to allocate *next*
 * time; the map that is already there is a texture and it is still bound, so a
 * resize that does not dispose it leaves the course rendering into a 2048 map
 * while the material believes it has a 4096 one.
 */
let gfxCastApplied = null;
/** Forget that the cast flags are stamped. **A rebuild has to say so**, because a
 *  prop planted after the row was last applied has never carried the flag and
 *  `applyShadows()` skips the whole walk when the row has not moved - so without
 *  this a rebuilt stage stands in the sun with no props casting at all, and the
 *  row is set to the value it already held, which is the case nobody can see
 *  changing. Asked for through a function for the reason `takeGrab()` gives. */
function forgetCastApplied() {
  gfxCastApplied = null;
}
function applyShadows() {
  const map = SHADOW_MAP[gfx.shadow - 1];
  const radius = SHADOW_RADIUS[gfx.shadow - 1];
  const cast = SHADOW_CAST[gfx.shadow - 1];
  for (const e of [world.env, world.stageEnv]) {
    const sh = e.key.shadow;
    if (sh.mapSize.x !== map) {
      sh.mapSize.set(map, map);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    sh.radius = radius;
  }
  if (cast === gfxCastApplied) return;
  gfxCastApplied = cast;
  for (const root of world.shadowRoots()) {
    if (!root) continue;
    root.traverse((o) => {
      // **Only what was stamped.** A mesh with no flag is not a prop - it is a
      // gate, a plinth, a basin - and the row is about props.
      if (o.userData.gfxCast) o.castShadow = cast;
    });
  }
  for (const r of world.racers()) r.model.group.traverse((o) => {
    if (o.userData.gfxCast) o.castShadow = cast;
  });
}

/** A new dome, a disposed old one, and a repaint - in that order, and the
 *  repaint last so the fresh geometry is the one that gets the hour's stops.
 *  `setSkyGeo()` rather than an assignment, because `skyGeo` is the sky module's
 *  and a module's live bindings cannot be written from outside. */
let skySegs = [SKY_LADDER[2][0], SKY_LADDER[2][1]];
function applySky() {
  const [w, h] = SKY_LADDER[gfx.sky - 1];
  if (w === skySegs[0] && h === skySegs[1]) return;
  skySegs = [w, h];
  const old = setSkyGeo(buildSkyGeo(w, h));
  for (const e of [world.env, world.stageEnv]) if (e) e.sky.geometry = skyGeo;
  old.dispose();
  if (_todSky) paintSky(_todSky, composerUp);
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

// ------------------------------------------------------------------
// The chain and the rows. **Neither environment is exported, because neither
// is built here.** `world.env` and `world.stageEnv` are filled by the two
// modules that build them and read by this one - `refreshEnvironment()`
// hangs a pre-filter on both, `applySky()` swaps both domes' geometry, and
// `applyDrawDistance()` sets both fogs - so the registry is the only shape
// that carries them upstream.
// ------------------------------------------------------------------
export {
  renderScene, scenePixels, needsComposer, applyGraphics,
  composer, renderPass, applyChainSize, dropComposer, syncComposer,
  setChainScene, chainUp, chainScene,
  drawOverlay, takeGrab, grabPixels, doGrab,
  addGlows, syncGlow, courseProbes, probeQueue,
  dropProbe, dropReflections, queueProbes, pumpProbes, syncProbes,
  STAGE_ROWS, markStageDirty, clearStageDirty, applyRenderScale, forgetCastApplied, applyShadows,
  renderOptions, optionsOpen, openOptions, closeOptions,
};