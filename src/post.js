/* ================================================================== *
 * post.js
 *
 * Everything between the county and the window: the settings panel and the
 * functions that put a row into effect, the post chain and the four passes on
 * it, the two flat buffers they sample, the grain and the vignette, the
 * readback, the glows, and the reflection probes.
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
import { THREE, $, clamp } from './core.js';
import {
  world,
  gfx,
  gfxScale,
  setPreset,
  setRow,
  setToggle,
  gfxSave,
  RENDER_SCALE,
  RENDER_SCALE_CAP,
  SCALE_TAPS,
  GFX_STEPS,
  GFX_ROWS,
  nativePixelRatio,
  canvasRatio,
  sceneRatio,
  needsResample,
  FOG_LADDER,
  EDGE_LADDER,
  SHADOW_MAP,
  SHADOW_RADIUS,
  SHADOW_CAST,
  PROP_DENSITY,
  GRASS_DENSITY,
  SKY_LADDER,
  AO_LADDER,
  GI_RADIUS,
  GI_INNER,
  GI_THICK,
  REFL_LADDER,
  REFL_FRESNEL,
  MSAA_LADDER,
  POM_STEPS,
  POM_BISECT,
  PRESET_NAMES,
  FX_TOGGLES,
  gfxMsaa,
  gfxSsao,
  gfxReflSize,
  gfxReflOn,
  grassCount,
  renderer,
  buildSkyGeo,
  setSkyGeo,
  skyGeo,
  paintSky,
  envPmrem,
  LAMP_COLOUR,
  TOD,
  _todSky,
} from './graphics.js';
import { gfxU, gtaoWind, gtaoReflect, waterFresnel, setWindEnabled } from './materials.js';

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
 * They are mapped in the same import map at the same 0.170 pin as the library
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
let renderPass = null, presentPass = null, gtaoPass = null, gtaoGiPass = null;
let ssrPass = null, bloomPass = null;
/** The set of passes currently in the chain, so `syncPasses()` is a no-op when
 *  nothing crossed. `a` is ambient occlusion, `g` is the bounce, `s` is the
 *  reflection march and `b` is bloom - **four terms**, and all four are in the key
 *  because all four change what is on the chain without changing *which* passes
 *  are: the bounce and the march are separate passes with separate targets, and a
 *  key that knew only about occlusion would return early and leave one of them
 *  standing with nothing reading it. */
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
 * The reflection march, and **whether it is wanted is a question about two rows** -
 * its own and the occlusion's - which is the whole reason this is a function and
 * not a field. `fxSsr` asks for the effect; `ssao` asks for the normal-and-depth
 * buffer it traces against, and there is nothing to trace without one.
 *
 * **So it is derived once and asked by `needsComposer()` and `syncPasses()` and
 * nothing else**, and the cost of the dependency is that `fxSsr: 1` on a machine
 * with the occlusion off is *armed and inert*: the switch reads on, the chain is
 * not built, and there is no picture to show. That is disclosed in the row's
 * `cost` and in its tooltip rather than papered over, and it is the trade the
 * dependency buys - it replaces a silently wrong reflection with a stated
 * restriction.
 *
 * **The occlusion's ladder is why this can be a function at all.** Every cell
 * from two up is full-res, so there is no step on which the buffer this traces
 * is the wrong size - see `AO_LADDER`.
 */
const gfxSsrOn = () => gfx.ssao >= 2 && gfx.fxSsr > 0;

/**
 * The one predicate the whole cost story hangs off. **Four things raise it and
 * only one of them is not a pass**, and that one is the interesting one: a
 * resample is a buffer whose size is not the window's, so a machine that asks for
 * a render scale off 1× cannot have a direct path any more. It gets the chain with
 * `RenderPass` and `presentPass` on it and nothing else, which is one scene render
 * and one resolve - so the direct path is still `renderer.render()` and still
 * spends no render targets, but only because the settings say so.
 *
 * **Multi-sampling is not on this list any more, and that is the change.** It was,
 * and it made the anti-aliasing row reachable only by building a post chain: a
 * player on the bottom tier who wanted smoother edges had to buy a compositor to get
 * them, and the frame they were smoothing was one the composer then drew. The context
 * carries its own MSAA now - see the renderer at the bottom of `graphics.js` - so
 * the direct path is smoothed without a buffer and `x2`/`x4` have something to say
 * only once something else has put the chain up.
 *
 * **The failure this invites is a row naming a count nothing is drawing into**, and
 * it is met twice: `gfxCaption()` says `idle, no chain` rather than quoting a cost
 * that is not being paid, and the settings that *are* paying wear an orange border -
 * so a player who has set `x4` and sees no border anywhere learns in one glance that
 * nothing in the frame is spending on it.
 */
function needsComposer() {
  return gfx.ssao >= 2 || gfx.fxBloom > 0 || gfxSsrOn() || needsResample();
}

/**
 * Which cells of which row put the compositor up if they are picked, **and the
 * question is asked of the cell rather than of the row's current value.**
 *
 * That is the whole difference between a cost and a state. A frame around the row
 * answers "is the chain up now", which is one step behind the player and has to be
 * read *after* they have pressed something; a frame on the button answers "what will
 * this cost me", which is the question they were asking when they looked at it. So
 * the border is drawn while the panel is built and **nothing turns it on or off** -
 * `syncOptions()` moves the lit cell and the captions and leaves the frames exactly
 * where they were, because a button that changed shape when you pressed it would be
 * telling you about the past.
 *
* **It is not "would the chain be up if I picked this", which is a different question
 * and a worse one.** That answer moves as the other rows move - bloom on and `1×`
 * stops being free - so the same button would gain and lose its frame for reasons the
 * player never touched, and a border that flickers on an unrelated row is not a cost,
 * it is noise. **So every term of `needsComposer()` that is decidable from its own
 * row alone carries a frame, and a term that is not carries its cost in its tooltip
 * instead** - which is the same answer the anti-aliasing row already has, below.
 *
 * **The reflection row is the second thing not here**, and it is not here for the
 * same reason and one more: `gfxSsrOn()` is `ssao >= 2 && fxSsr > 0`, so framing its
 * `on` cells would put a border on a button that gains and loses it as the occlusion
 * row moves, for reasons the player never touched. Its cost sentence lives in the
 * row's `cost` - which `syncOptions()` prints as the visible caption - and in the
 * tooltip beside `reflectReport()`.
 */
const CHAIN_CELLS = {
  // **The render scale, and the one cell that carries no frame is `1×`.** Every other
  // step is a buffer whose size is not the window's, which is the whole reason
  // `presentPass` exists - so `1×` is the single cell on this row that costs nothing
  // at all, and framing it would be the border lying about the cheap option.
  render: (n) => Math.abs(RENDER_SCALE[n - 1] - 1) > 1e-3,
  // **The occlusion, and cell 1 is off** because `AO_LADDER`'s first entry is `null`:
  // every cell from two up builds a `GTAOPass` and a full-resolution G-buffer with it.
  ssao: (n) => n >= 2,
  // **And the bloom, which is a switch and not a ladder** - hence `n > 0` and not
  // `n >= 1`, because zero is its first cell rather than a level below the first.
  fxBloom: (n) => n > 0,
};

/** The scene the frame is about to draw, which is the stable's on the stable and
 *  on a stroll and the county's everywhere else. */
const renderScene = () => world.renderScene();

/**
 * The buffer the scene is drawn into, at the sample count asked for. Passing it
 * in is the only way to get multi-sampling *onto this buffer*: `EffectComposer`
 * builds its own pair at `samples: 0` when it is handed no target, and `clone()`
 * copies the count onto the second one, so both halves of the ping-pong are
 * multisampled and whichever one `RenderPass` writes is the one that is.
 *
 * **The count is the `msaa` row's and it only reaches a frame that has one.** The
 * context's own multisampled default framebuffer is a separate mechanism on a
 * separate path and is not negotiable at runtime - see the renderer in
 * `graphics.js` - so a frame is smoothed by the row or by the context or by both,
 * and `needsComposer()` decides which.
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
  // **The window's dimensions and the county's ratio are two numbers,
  // and the composer wants both.** Its pair is sized in CSS pixels and
  // multiplied by its pixel ratio inside `setSize()`, and
  // `setPixelRatio()` alone resizes to the dimensions the chain was
  // *built* at - which on a window that has moved is the old window's,
  // so the beauty buffers kept the first window's size while the
  // occlusion and the resample were told the new one. The ratio goes
  // in first and the window's own size after it, because the last
  // `setSize()` is the one the buffers keep.
  composer.setPixelRatio(sceneRatio());
  composer.setSize(innerWidth, innerHeight);
  sizeGBuffers();
  if (presentPass) presentPass.setSource(w, h);
}

/** Everything a chain owns, given back. The dome is repainted because it was
 *  painted to suit whichever path was running and that has just changed. */
function dropComposer() {
  if (composer) {
    if (gtaoPass) { composer.removePass(gtaoPass); gtaoPass.dispose(); gtaoPass = null; }
    if (gtaoGiPass) { composer.removePass(gtaoGiPass); gtaoGiPass.dispose(); gtaoGiPass = null; }
    if (ssrPass) { composer.removePass(ssrPass); ssrPass.dispose(); ssrPass = null; }
    if (bloomPass) { composer.removePass(bloomPass); bloomPass.dispose(); bloomPass = null; }
    // frees both ping-pong targets and the copy pass
    composer.dispose();
  }
  dropFlat();
  composer = null; renderPass = null; presentPass = null; passKey = '';
  composerUp = false; msaaKey = -1; sceneKey = 0;
  if (_todSky) paintSky(_todSky, composerUp);
}

/**
* Point the whole chain at a scene, **all four passes at once and every frame**,
 * and this is a function rather than four exported `let`s because that is what
 * it has to be. There are two scenes - the county's and the stable's - and which
 * one is up changes with the mode; a pass left pointing at the other one renders
 * the stable into a race's occlusion and produces nothing at all rather than
 * something wrong, which is much harder to see.
 *
 * **All four, unconditionally.** The occlusion pass was written once at
 * construction and left there while the beauty pass was already right, so on the
 * stable its depth buffer was full of a course nobody could see. And the bounce
 * has its own scene field because it renders the flat colour with its own
 * override material, for the same reason and with the same cost of getting it
 * wrong: a bounce built from the stable's colour while the occlusion was built
 * from the county's is an irradiance estimate of the wrong county, and a colour
 * cast does not look like an error. The march is that case a third time: it
 * renders the mark with the same override material and its own hide-set, so a
 * reflection standing on the lobby and traced against a race's buffers is a
 * plausible picture of nothing at all.
 */
function setChainScene(sc) {
  if (renderPass) renderPass.scene = sc;
  if (gtaoPass) gtaoPass.scene = sc;
  if (gtaoGiPass) gtaoGiPass.scene = sc;
  if (ssrPass) ssrPass.scene = sc;
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
  // standing at is the buffer it is standing at. **The second clause only counts
  // while the chain is wanted** - `msaaKey` is -1 with no chain up, and the row can
  // hold a real count against a buffer that does not exist, which is exactly what the
  // direct path is now: a sample count the menu can name and the frame never spends a
  // buffer on. Comparing the two anyway would rebuild nothing on every apply and
  // return the same answer, which is the cost of a guard that is not guarding.
  if (want === composerUp && (!want || samples === msaaKey)) return;
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
  // in before any pass exists, and `sizeGBuffers()` puts the county's own
  // resolution back afterwards, because `addPass()` would otherwise immediately
  // overwrite the G-buffer with a full-size one and the flat buffers are not in
  // the composer at all. `setSize()` disposes a target whose size moved, so the
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
  const wantAO = !!a, wantGI = !!(a && a.gi), wantSsr = gfxSsrOn();
  const wantBloom = gfx.fxBloom > 0;
  const key = (wantAO ? 'a' : '') + (wantGI ? 'g' : '') + (wantSsr ? 's' : '')
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
  // And the march, constructed **after** the occlusion above and not before it: the
  // gate is `gfxSsrOn()`, which cannot be true with `gtaoPass` null, so by this line
  // there is a G-buffer to read. Dropped on the gate alone rather than on the
  // bounce's field, so lowering the occlusion to `1` with `fxSsr` still standing
  // takes the pass away - it reads a G-buffer that is no longer there.
  if (wantSsr && !ssrPass) ssrPass = newSsrPass(gtaoPass, world.camera);
  if (!wantSsr && ssrPass) { ssrPass.dispose(); ssrPass = null; }
  if (wantBloom && !bloomPass) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.55, 1.15);
  }
  if (!wantBloom && bloomPass) { bloomPass.dispose(); bloomPass = null; }
  // **The two flat buffers follow the wanted list and not the passes**, because the
  // bounce owns one and the march owns the other and neither owns its render: a
  // target that outlived its reader is a texture nobody reads, and one that did not
  // outlive it is a null a shader is still holding.
  if (wantGI || wantSsr) buildFlat(wantSsr);
  else dropFlat();
// **Order is the whole of what this chain is.** The scene, then the occlusion
  // multiply, then the bounce, then the march, then bloom, then the one pass that
  // tone-maps and encodes. GTAO has to precede the bounce because the bounce is
  // *light arriving at* a surface and the occlusion is how much of the sun's own
  // is getting here; a bounce added before the multiply is a bounce the occlusion
  // then darkens, which is the same as not having one in a crease. The march sits
  // after the bounce and before bloom because **a reflection already carrying the
  // sun's own share must not then be multiplied into the bloom** - and after the
  // bounce because a bounce added on top of a reflection is the same term twice
  // over on the one surface in the county that is both. Bloom has to precede
  // OutputPass for the reason above, and OutputPass has to be last because it is
  // what applies ACES and the sRGB transfer to the finished frame.
  //
  // So the array is rebuilt from the wanted list rather than appended to, which is
  // also what makes it correct when a tier *drops*: `addPass()` would put the
  // new pass at the end, after `presentPass`, and the frame would come out
  // untone-mapped with the occlusion applied to nothing.
  composer.passes.length = 0;
  composer.addPass(renderPass);
  if (gtaoPass) composer.addPass(gtaoPass);
  if (gtaoGiPass) composer.addPass(gtaoGiPass);
  if (ssrPass) composer.addPass(ssrPass);
  if (bloomPass) composer.addPass(bloomPass);
  composer.addPass(presentPass);
  sizeGBuffers();
  tuneGtao();
  tuneBloom();
}

/**
 * Every buffer in the chain that is the county's resolution rather than the
 * window's, sized from one number.
 *
 * **It is one function because it is one question.** It was two - `sizeGtao()`
 * and `sizeGtaoGi()` - for as long as the ladder had a half-resolution cell on
 * it, because each pass read `a.half` and a second reader of the same field is a
 * second answer to the same question, and the failure is not a crash: a bounce
 * ray marched against a depth buffer of the wrong size is a bounce that lands on
 * the wrong piece of the county and the picture comes out plausible. The cell is
 * gone, so both passes and both flat buffers want `scenePixels()` and there is
 * nothing left to disagree about.
 *
 * **The ladder decides, not the passes.** The two disagree for the length of one
 * `applyGraphics()`, because the passes are dropped in `syncComposer()` at the end
 * of it and the pixel ratio is applied at the start: a change that switches the
 * occlusion off arrives here with the old pass still standing and a `null` on the
 * row. **That is why this asks the row rather than the resources it is sizing**,
 * and the guard outlives the field it was written for - it was written for a
 * `.half` read off a null and there is no `half` left to read.
 */
function sizeGBuffers() {
  const a = gfxSsao();
  if (!a) return;
  const [w, h] = scenePixels();
  if (gtaoPass) gtaoPass.setSize(w, h);
  if (flatRT) flatRT.setSize(Math.max(1, w), Math.max(1, h));
  if (maskRT) { maskRT.setSize(Math.max(1, w), Math.max(1, h)); sizeDepth(maskRT, w, h); }
}

/** `WebGLRenderTarget.setSize()` resizes the target's *colour* textures and its
 *  viewport, and **not** an attached `depthTexture`** - which is left at whatever
 *  size it was built at. A target built at 1x1 and then sized to the county is
 *  therefore a 900x560 colour attachment with a **1x1 depth one**, and the march
 *  reads that: every marked pixel reconstructs its origin at the near plane, the
 *  ray leaves from nowhere, and the result is a smear across the terrain rather
 *  than a reflection in the water. **It is silent, and it is not a crash** - the
 *  framebuffer is complete, the colour is right, and the depth is a depth
 *  texture of the wrong size being sampled.
 *
 *  So the two are resized together, here, where the number is already known. */
function sizeDepth(target, w, h) {
  const d = target.depthTexture;
  if (d && (d.image.width !== w || d.image.height !== h)) {
    d.image.width = Math.max(1, w); d.image.height = Math.max(1, h);
    d.needsUpdate = true;
  }
}

/** The county's own resolution, and `sizeGBuffers()`'s one answer to it. Asked by
 *  the readout rather than recomputed, so a spec comparing the buffers against
 *  the number they were sized from is comparing them against the same number
 *  twice and not against a second reading of the same question. */
const gbuffers = () => scenePixels();
/** And the two flat targets' own sizes, or `null` when the effect that wants them
 *  is off. **`null` and not `[1, 1]`**: a target that has been built but never
 *  sized is one the pass would read at one pixel, and a spec asking "is there a
 *  mask buffer" wants the difference between that and no buffer at all. */
const flatSize = () => (flatRT ? [flatRT.width, flatRT.height] : null);
const maskSize = () => (maskRT ? [maskRT.width, maskRT.height] : null);
/** **And the mask's depth attachment's own size, which is not the same thing** and
 *  which `maskSize()` cannot see: `WebGLRenderTarget.setSize()` resizes the
 *  target's colour textures and leaves an attached `depthTexture` at the size it
 *  was built at. `sizeDepth()` is what keeps the two in step, and this is how a
 *  spec sees whether it did. A target whose colour is the county's resolution and
 *  whose depth is 1x1 is a target the march reads a near-plane origin out of. */
const maskDepthSize = () => (maskRT && maskRT.depthTexture
  ? [maskRT.depthTexture.image.width, maskRT.depthTexture.image.height] : null);

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
  // It is asked for the ladder and not for the pass, for the reason
  // `sizeGBuffers()` gives: the two disagree for the length of one
  // `applyGraphics()`.
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
 *
 * **And `keep` is how the mark render gets its water in.** The water is
 * `transparent` with `depthWrite: false`, so the walk below hides it - correctly,
 * since a sheet that does not write depth cannot occlude and an occlusion buffer
 * is a depth map. The reflection mask is the one thing in the county that needs
 * it *drawn*, and it is a caller-supplied predicate rather than a second copy of
 * this one, because two walks that are meant to agree and do not is a pond that
 * reflects a puddle it hid.
 */
function hideFromGBuffer(sc, cache, keep) {
  if (!sc) return;
  sc.traverse((o) => {
    // **The record is optional and is what makes this function usable twice.**
    // `GTAOPass` has its own cache and its own `restoreVisibility()`, so it walks
    // in here with no map and nothing to put back; the bounce's albedo render
    // keeps its own, because it is not a `GTAOPass` and the map `overrideVisibility`
    // fills is emptied before the frame loop reaches it.
    if (cache) cache.set(o, o.visible);
    if (!o.visible || o.isPoints || o.isLine) return;
    if (keep && keep(o)) return;
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

/** The predicate `hideFromGBuffer()` asks about a piece before it hides it, and it
 *  is **the attribute and not the material**: the mark is stamped on the geometry,
 *  one float per vertex, and a piece wearing one is in the mask render whatever it
 *  is made of. Reading the material instead would be a list of names, and a list
 *  of names is a list that goes quiet the day something is not on it - which is a
 *  pool that stopped reflecting, with the switch still lit and the row still on. */
const isMarked = (o) => !!(o.geometry && o.geometry.attributes
  && o.geometry.attributes.gfxReflect);

/* ------------------------------------------------------------------ *
 * The two flat buffers, and the one render that draws them.
 *
 * **Both are a whole scene through one override material**, and that is the
 * shape they share: `MeshBasicMaterial` with the vertex colours and nothing
 * else, so the colour a piece writes is the flat base colour baked into its
 * geometry, with no maps and no light. The bounce reads the `.rgb` of one; the
 * reflection march reads the `.a` of the other.
 *
 * **Two buffers and not one, and the reason is a hide-set and not a
 * convenience.** They want opposite things out of the same walk: the bounce is
 * an estimate of what the *ground* can see, so the water has to be out of it -
 * it is `transparent`, writes no depth, and is excluded from the occlusion's
 * buffer for exactly that reason - while the march needs the water *in*, or the
 * ray it starts on a pool starts on the pool's floor and reflects about the
 * floor's slope, which leans away from the viewer at every bank. Sharing one
 * buffer would mean the bounce reading a pool's own colour where it used to read
 * the sand under it, **on every machine whether or not a single reflection was
 * switched on** - and a feature that changes the picture when it is off is not
 * off.
 *
 * **So they are two renders, and the second one only happens when a reflection
 * is standing.** That is the price of the pair and it is paid off, not on: with
 * `fxSsr` at 0 neither target exists and the bounce's render is the one it has
 * always been.
 * ------------------------------------------------------------------ */
let flatRT = null, flatMat = null;
let maskRT = null;
let flatVis = new Map(), maskVis = new Map();
const _flatClear = new THREE.Color();

/** The override material, and it is **one material for both buffers** - same
 *  geometry, same vertex colours, same wind, and the only thing that differs is
 *  which channel the reader looks in. Two would be two programs for a draw that
 *  has one answer.
 *
 *  The wind is here for the reason `gtaoWind()` gives at length: a tree that leans
 *  in the beauty pass and stands still in a buffer the county reads is a ghost of
 *  its own canopy hanging under it. And `gtaoReflect()` is here for the same class
 *  of reason it is on the normal material: the mark is an attribute, and an
 *  attribute nobody reads is an attribute nobody wrote.
 */
function buildFlat(wantMask) {
  if (flatMat) return;
  flatRT = new THREE.WebGLRenderTarget(1, 1);
  flatRT.texture.name = 'county.flat';
  // **The mask target carries a depth texture and no depth buffer**, which is the
  // same shape `GTAOPass` builds its own in: three attaches a `depthTexture` in
  // place of a renderbuffer, and the mark render needs to be *read* - which is the
  // whole reason it exists. The bounce's target is the other way round, a plain
  // depth buffer it tests against and never samples.
  if (wantMask && !maskRT) {
    maskRT = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false, depthTexture: new THREE.DepthTexture(1, 1),
    });
    maskRT.texture.name = 'county.mask';
    // **The depth texture is built at 1x1 and sized in step by `sizeDepth()`**, and
    // the reason it is 1x1 at all is that a render target is built before the
    // county knows how big it is. See `sizeDepth()` for what that costs.
  }
  // **A fresh basic material, and not `gtaoPass.normalMaterial`**: that one is a
  // `MeshNormalMaterial` and its whole output is a direction. This one reads the
  // vertex colours and stops, and it opts out of the tone map for the same reason
  // `matSky` does - the buffer is a light source to be read by a later pass, and
  // a second ACES on it is a second curve through the county's colours.
  flatMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, toneMapped: false, fog: false,
  });
  gtaoWind(flatMat);
  gtaoReflect(flatMat);
}
function dropFlat() {
  if (flatRT) { flatRT.dispose(); flatRT = null; }
  // **The depth texture is the render target's own and `dispose()` frees it** -
  // three's `deallocateRenderTarget()` disposes an attached `depthTexture` and
  // removes its properties, so handing it back a second time would be a dispose
  // of a texture that is no longer in the renderer's map.
  if (maskRT) { maskRT.dispose(); maskRT = null; }
  if (flatMat) { flatMat.dispose(); flatMat = null; }
}

/**
 * The render, and **the reason it is a function over the bounce's own is that
 * both passes were reaching for the same thing.** `GtaoGiPass` used to own its
 * target and its override material and did this inline; the reflection march
 * needs a buffer of its own with the water in it, and two copies of a render
 * with a hide-set and four pieces of state saved around it are two that can
 * disagree about the county.
 *
 * **`keep` is the whole difference between the two calls**: the bounce passes
 * nothing and gets today's picture, the march passes `isMarked` and gets the water.
 *
 * **And the clear alpha is zero**, which is the one behavioural thing here and it
 * is not cosmetic: `renderer.autoClear` clears the alpha channel too, the
 * renderer's clear alpha is one, and the mask's whole meaning is "nothing is
 * reflecting" on a pixel nothing was drawn into. One is not nothing - a pond
 * whose depth the frame never touched would read as a full-strength reflection
 * the first time the camera walked past its edge.
 */
function renderFlat(target, sc, keep) {
  if (!target || !flatMat || !sc) return;
  const cache = target === maskRT ? maskVis : flatVis;
  // The same scene, behind the same traversal the occlusion's G-buffer is built
  // behind, so the two buffers agree about what is a piece of county and what is a
  // sky - and `keep` is the one thing that is different between them.
  hideFromGBuffer(sc, cache, keep);
  const prevOverride = sc.overrideMaterial;
  const prevAuto = renderer.autoClear;
  const prevAlpha = renderer.getClearAlpha();
  // **The clear colour is saved and put back and nothing here changes it**, which
  // is on purpose: `GTAOPass` saves and puts it back round the same render and
  // does change it, and a render that reaches round the renderer's state is a
  // render that has to hand it back. It costs a colour object and it means the
  // next pass in the chain does not have to know whether we were here.
  renderer.getClearColor(_flatClear);
  sc.overrideMaterial = flatMat;
  renderer.setRenderTarget(target);
  // `autoClear` on rather than a `clear()` of our own, because the colour it
  // leaves is never read: a pixel the G-buffer has geometry in is a pixel this
  // render drew, since both are the same geometry behind the same test.
  renderer.autoClear = true;
  renderer.setClearAlpha(0);
  renderer.render(sc, world.camera);
  renderer.autoClear = prevAuto;
  renderer.setClearColor(_flatClear);
  renderer.setClearAlpha(prevAlpha);
  sc.overrideMaterial = prevOverride;
  restoreGBuffer(sc, cache);
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
 * `sizeGBuffers()` already decides how many pixels that is. A pass that wanted its
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
 *
 * **The flat colour it samples is the county's and not this pass's** - see the
 * two flat buffers above - so this constructor builds one `ShaderMaterial` and a
 * quad and nothing else, and `render()` asks `renderFlat()` for its input. That
 * is the whole of what changed when the buffer was lifted, and the picture it
 * draws is the picture it drew before.
 */
function newGtaoGiPass(gtao, cam) {
  const { Pass, FullScreenQuad } = GFX_ADDONS;
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
      this.material = material;
      this.fsQuad = new FullScreenQuad(material);
      this.strength = 0;
    }
    /**
     * The composer's own resize is a no-op here **by design and not by
     * omission**: the county draws this pass's inputs at the *G-buffer's* size and
     * not at the chain's, so `sizeGBuffers()` is the only thing that decides it -
     * and the buffer it sizes is the county's, not this pass's. A `setSize()` that
     * resized the target would be a second answer to the same question, and the two
     * would be right on different frames. The sentence used to end in `a.half`,
     * which is no longer a field; **the guard outlives the field it was written
     * for**, which is the general form of everything in this file.
     */
    setSize() {}
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
      renderFlat(flatRT, this.scene);

      const u = this.material.uniforms;
      u.tDiffuse.value = readBuffer.texture;
      u.tAlbedo.value = flatRT.texture;
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
      this.material.dispose();
      this.fsQuad.dispose();
    }
  }
  return new GtaoGiPass();
}

/* ------------------------------------------------------------------ *
 * The reflection march: what is in front of the camera, reflected about the
 * surface it lands on and mixed back into the frame.
 *
 * **It reads the occlusion's G-buffer for its normals and the county's mask
 * buffer for its geometry, and it renders neither itself.** That is the whole of
 * the wiring and it is deliberately two sources rather than one: `GTAOPass`
 * already re-renders the scene into a view-normal target with a depth texture
 * attached, every frame, and a pass that wanted its own would be a second scene
 * render before it could march a single step.
 *
 * **Why the mask buffer and not the G-buffer's depth, and it is not tidiness.**
 * `mat.water` is `transparent` with `depthWrite: false`, and `hideFromGBuffer()`
 * excludes it from the occlusion's buffer on purpose - a sheet that writes no
 * depth cannot occlude. So at a pixel of pool, the G-buffer holds the pool's
 * *floor*: a reflected ray started there starts a metre below the surface, and
 * one reflected about the floor's slope leans away from the viewer at every
 * bank. The mask render is the one render that draws the water, so its depth is
 * the water's own, and the march starts where the surface is.
 *
 * **What it shares with the bounce is the convention and not the buffer**:
 * `perspectiveDepthToViewZ` and the `sd - q.z` penetration reading, so a ray
 * point's depth inside a surface means the same number in both shaders. What it
 * does not share is `frameFor()` - GI builds an orthonormal frame round a normal
 * because eight hemisphere directions need one, and a reflection has exactly one
 * direction and needs no frame at all.
 * ------------------------------------------------------------------ */
/** Coarse steps, then binary refinements. **Eight and four is the whole of the
 *  budget and it is a quality choice rather than a cheap one**: the bounce moved
 *  off six-by-four because a ray's discrete ladder draws shells on a curved
 *  surface, and a reflection that resolves to four pixels of error is a mirror
 *  with stepping in it. The refinement is what removes the rest - a fixed stride
 *  lands a hit somewhere inside the last step, and four bisections narrow that
 *  to a fraction of a pixel at the cost of four taps. */
const SSR_STEPS = 8, SSR_REFINE = 4;
/** How far a ray walks before it is given up on, in metres. Past this the screen
 *  no longer holds what it would have found and a hit is a guess, so the mix is
 *  faded out over the last of it rather than cut. A course is 300-900 m long and
 *  the far bank of a pool is tens of metres off; this is about the reflection in
 *  the water beside the snail, not about the county in the water. */
const SSR_FAR = 42;
/** Where a ray starts, over and above a bias that scales with the pixel's own
 *  world size - see the shader. */
const SSR_BIAS = 2.5;
/** How far inside a surface counts as having caught the ray, on the bounce's own
 *  convention. A fence rail is 30 mm thick and this county's props are what the
 *  reflection is *for*, so it is the bounce's 0.6 rather than something thin. */
const SSR_THICK = 0.6;
const SSR_FRAG = /* glsl */`
  precision highp float;

  #include <packing>

  uniform sampler2D tDiffuse;
  uniform sampler2D tMask;              // .a is the strength a marked vertex carries
  uniform sampler2D tMaskDepth;         // and this is the marked surface's own depth
  uniform sampler2D tNormal;            // the occlusion pass's view normals
  uniform mat4 cameraProjectionMatrix;
  uniform mat4 cameraProjectionMatrixInverse;
  uniform vec3 uUp;                     // the world's up, in view space
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float uThick;
  uniform float uFar;
  uniform float uBias;                  // metres per pixel at one metre of depth

  varying vec2 vUv;

  const int SSR_STEPS = ${SSR_STEPS};
  const int SSR_REFINE = ${SSR_REFINE};

  /**
   * The bounce's penetration reading, byte for byte: view space looks down -Z, so
   * a surface *nearer* the camera than the ray point is a surface the ray point
   * is behind, and the difference is the depth of the ray point inside it. It is
   * sd minus q.z, and not the other way round, because getting it backwards makes
   * every hit register as a miss and the pass is then a full-screen no-op that
   * costs a full screen.
   */
  float pen( float sd, float qz ) {
    return perspectiveDepthToViewZ( sd, cameraNear, cameraFar ) - qz;
  }

  void main() {
    vec4 base = texture2D( tDiffuse, vUv );
    // **The mask, and it is the whole of whether this pixel does anything.** It is
    // read before the depth because it is one fetch and it is zero on most of the
    // frame, so most pixels leave here having done no more than two fetches.
    float m = texture2D( tMask, vUv ).a;
    // **0.004 is byte one**, and it still means *nothing is reflecting*: the mark
    // is a reflectance now, so the smallest one anybody marks is water's 0.02 -
    // five bytes - and everything below a single step of the target's alpha is a
    // surface that was never stamped.
    if ( m < 0.004 ) { gl_FragColor = base; return; }
    float f0 = abs( m );

    float depth = texture2D( tMaskDepth, vUv ).x;
    // Sky is depth one, and the dome is out of the mask render by the same walk
    // that keeps it out of the G-buffer - it writes no depth at all. There is
    // nothing in front of the camera to reflect and the frame already holds the
    // material's own probe.
    if ( depth >= 1.0 ) { gl_FragColor = base; return; }

    vec4 view = cameraProjectionMatrixInverse * vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
    vec3 p = view.xyz / view.w;
    // **The normal, and one pixel of this shader decides where it comes from.** A
    // positive mark is a surface the occlusion buffer holds - the stable's mirror,
    // and a shell the day something gives one - and this reads its own normal. A
    // negative mark is a surface that is not in that buffer, which today is only
    // the water, and it takes the world's up. **That is not a stand-in for the
    // pool's ripple normal**,
    // which lives in two scrolling detail maps the mask render has no access to;
    // it is the surface's own normal, and the ripples' few degrees are missing
    // rather than wrong. A ripple-perturbed mirror would be a second water pass.
    vec3 n = m > 0.0 ? normalize( unpackRGBToNormal( texture2D( tNormal, vUv ).rgb ) ) : uUp;
    // **Turned to face the eye**, because the water is DoubleSide and a ray
    // reflected about a normal pointing away from the camera leaves the surface
    // rather than the surface's reflection.
    if ( dot( n, p ) > 0.0 ) n = -n;
    vec3 rd = normalize( reflect( normalize( p ), n ) );

    // **The start offset is a pixel's world size and not a constant**, and that is
    // the fix for the one artefact this march has that the bounce does not: on the
    // near edge of a pool the neighbouring pixel is nearer than the ray point by
    // more than any constant bias, so a fixed 5 cm finds the pool's own edge and
    // paints the bank into the water. uBias is metres per pixel at one metre of
    // depth, so uBias times length(p) is the footprint here - and it grows with
    // distance because the footprint does.
    float t0 = max( 0.02, uBias * length( p ) );
    float stride = max( ( uFar - t0 ) / float( SSR_STEPS ), 1e-3 );

    float t = t0, tPrev = t0, hitT = -1.0;
    for ( int i = 0; i < SSR_STEPS; i ++ ) {
      vec3 q = p + rd * t;
      vec4 clip = cameraProjectionMatrix * vec4( q, 1.0 );
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      // **Off the edge is a miss and not a hit**, so a ray that walks off screen
      // falls back rather than reaching a hard line at the border. The fade below
      // is the other half of the same thing and catches what leaves the frame
      // *slowly*.
      if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 ) break;
      float sd = texture2D( tMaskDepth, suv ).x;
      // **And the coarse test is a positive penetration and nothing else, which is
      // the whole of what this shader was getting wrong.** The stride is metres - 42 m of walk
      // over eight steps - so the first sample past a surface lands the ray *deep
      // inside* whatever it crossed: a mirror four metres off the camera has the
      // lawn at eight and the sample at 5.25 puts the point two and a half metres
      // under it. Reading that as "too far behind to be real" and giving up is
      // what left a polished cube flat white with a few slivers of reflection
      // where the geometry happened to be close enough. **The bisection below is
      // what resolves an overshoot**, and it cannot do its job on an interval it
      // is never handed.
      if ( sd < 1.0 && pen( sd, q.z ) > 0.0 ) { hitT = t; break; }
      tPrev = t;
      t += stride;
    }
    if ( hitT < 0.0 ) { gl_FragColor = base; return; }

    // **Four bisections on the straddling interval**, which is the only part of
    // this that is not per-pixel uniform work and the part that decides whether
    // the reflection has a hard edge or a soft one.
    float lo = tPrev, hi = hitT;
    for ( int j = 0; j < SSR_REFINE; j ++ ) {
      float mid = 0.5 * ( lo + hi );
      vec3 q = p + rd * mid;
      vec4 clip = cameraProjectionMatrix * vec4( q, 1.0 );
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if ( pen( texture2D( tMaskDepth, suv ).x, q.z ) > 0.0 ) hi = mid; else lo = mid;
    }
    // **And the thickness test, here and not in the loop above.** Bisection walks
    // into the surface until the penetration turns positive, so lo is the last
    // moment the ray was provably in front of it and hi is a sixteenth of a stride
    // past the crossing: **if the point at hi is still deeper inside the surface
    // than a thickness, four steps could not resolve this crossing** and the hit is
    // a guess. That is the test's whole meaning - a resolved crossing from an
    // unresolved one - and it is why the plan's version of it could not live in the
    // loop, where it was measuring the stride rather than the crossing.
    vec3 fine3 = p + rd * hi;
    vec4 fine = cameraProjectionMatrix * vec4( fine3, 1.0 );
    vec2 hit = fine.xy / fine.w * 0.5 + 0.5;
    if ( pen( texture2D( tMaskDepth, hit ).x, fine3.z ) > uThick ) {
      gl_FragColor = base; return;
    }

    // **Two fades and both of them are about confidence rather than about looks.**
    // The first is the border: a ray whose hit lands near the edge of the frame is
    // one where the screen ran out, and a hard line there is a seam in the water.
    // The second is the far end of the walk, where a hit is a guess.
    float edge = smoothstep( 0.0, 0.05, hit.x ) * smoothstep( 1.0, 0.95, hit.x )
               * smoothstep( 0.0, 0.05, hit.y ) * smoothstep( 1.0, 0.95, hit.y );
    float reach = 1.0 - smoothstep( uFar * 0.55, uFar, hi );
    // **Schlick, off the mark, in the shader.** This is the term that decides what
    // the feature is: at water's 0.02 a pool is two per cent looking straight down
    // into it and all of it at a grazing angle, which is why a course's water wants
    // you at its edge and not above it - and at a polished metal's 0.92 the same
    // shader is a mirror from every angle a player can stand at. **One number per
    // surface and no uniform at all**, which is what makes a shell or a fitting a
    // one-line plant site rather than a second place a reflectance is written down.
    float cosT = clamp( dot( -normalize( p ), n ), 0.0, 1.0 );
    float fres = f0 + ( 1.0 - f0 ) * pow( 1.0 - cosT, 5.0 );

    vec3 got = texture2D( tDiffuse, hit ).rgb;
    gl_FragColor = vec4( mix( base.rgb, got, clamp( fres * edge * reach, 0.0, 1.0 ) ), base.a );
  }
`;

/**
 * The same constructor shape as `newGtaoGiPass(gtao, cam)` and for the same reason
 * - it is a `Pass` in everything `EffectComposer` asks of one, so it goes into the
 * array beside `GTAOPass` and is rebuilt from the wanted list like any other.
 *
 * **No `setSize()`, no `setGBufferSize()`, and a `dispose()` that frees two
 * uniforms' worth of nothing.** Every target it reads is somebody else's and is
 * sized by `sizeGBuffers()`: the mask buffer the county draws, and the occlusion
 * pass's normal target. A `setSize()` here would be a second answer to the same
 * question and the two would be right on different frames - which is the exact
 * shape of the bug `GtaoGiPass`'s no-op `setSize()` already documents.
 */
function newSsrPass(gtao, cam) {
  const { Pass, FullScreenQuad } = GFX_ADDONS;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, tMask: { value: null },
      tMaskDepth: { value: null }, tNormal: { value: null },
      cameraProjectionMatrix: { value: new THREE.Matrix4() },
      cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      cameraNear: { value: 0.1 }, cameraFar: { value: 1000 },
      uThick: { value: SSR_THICK }, uFar: { value: SSR_FAR },
      uBias: { value: 0 },
    },
    vertexShader: GI_VERT,
    fragmentShader: SSR_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });

  class SsrPass extends Pass {
    constructor() {
      super();
      this.needsSwap = true;
      this.scene = world.scene;
      this.camera = cam;
      this.gtao = gtao;
      this.material = material;
      this.fsQuad = new FullScreenQuad(material);
      this._up = new THREE.Vector3();
      this._inv = new THREE.Matrix4();
    }
    setSize() {}
    render(renderer, writeBuffer, readBuffer) {
      if (!maskRT || !this.gtao) {
        this.fsQuad.material = this.material;
        this.material.uniforms.tDiffuse.value = readBuffer.texture;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        if (this.clear) renderer.clear();
        this.fsQuad.render(renderer);
        return;
      }
      renderFlat(maskRT, this.scene, isMarked);

      const u = this.material.uniforms;
      u.tDiffuse.value = readBuffer.texture;
      u.tMask.value = maskRT.texture;
      u.tMaskDepth.value = maskRT.depthTexture;
      u.tNormal.value = this.gtao.normalRenderTarget.texture;
      u.cameraNear.value = this.camera.near;
      u.cameraFar.value = this.camera.far;
      u.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
      u.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
      // **The world's up, in view space**, taken off the camera's own world matrix
      // and not written down as a vector: the county's up is +Y because its ground
      // is, and a shader that hard-coded the view-space answer would be right on
      // one camera and wrong on every other - which is all of them, once the
      // free camera in the inspector has looked anywhere but straight ahead.
      this._inv.copy(this.camera.matrixWorld);
      u.uUp.value.set(0, 1, 0).transformDirection(this._inv);
      // **Metres per pixel at one metre of depth**, from the projection the frame
      // is being drawn with and the height the chain is drawing at: the vertical
      // extent of the frustum at one metre, over the height it covers. It is the
      // ray's own start bias and it is the only number in this shader that had to
      // come from somewhere other than a constant. The chain's height and not the
      // canvas's, because the mask buffer is the chain's size and a bias computed
      // against the window is a bias scaled by the render row.
      u.uBias.value = 2 * Math.tan(this.camera.fov * Math.PI / 360)
        / Math.max(1, scenePixels()[1]) * SSR_BIAS;
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
  return new SsrPass();
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

/** Three resampling kernels and one body. Each defines `float cr( float x )`
 *  under the same name and the body below calls nothing else, so the three
 *  differ in their middle and nothing else - which is the whole of why the
 *  body is one constant and not three.
 *
 *  **The outer segment is a whole polynomial and not the first half of the
 *  inner one.** Written as `0.5 * (-x³ + 5x² - 8x + 4)` it reaches 0 at
 *  both ends of its span and dips to -0.0625 in the middle; written as
 *  `-0.5x³ + 2.5x² - 1` - which is what you get from copying the inner
 *  segment and changing the sign of the leading term - it is 1.0 where it
 *  should be 0.0, the four weights come to about 5 between them, and the
 *  frame comes back **2.5 times too bright**, tone mapped, on every pixel
 *  of it. Nothing overflows and nothing clips, so it reads as a blown-out
 *  picture rather than as an error.
 *
 *  **And the four weights are then divided by their sum**, which is
 *  the other half. **A resampling filter's DC gain is one**, or
 *  choosing one changes the exposure rather than the reconstruction.
 *  The sum is one at integer phases and drifts off them - the fourth
 *  tap falls outside the kernel's radius at every phase, so the body
 *  sums three live taps - by a sixteenth for B-spline at the phase
 *  extreme, an eighteenth for Mitchell, and up to a tenth for
 *  Lanczos-2, so the divide is load-bearing for all three and not
 *  only for the kernels with negative lobes. */
/** Keys' B-spline, a = -1 - the softest of the three and the one that took
 *  bicubic's place at the middle of the row, because a preset that rises in
 *  quality should rise in smoothness before it rises in sharpness.
 *  **Non-negative**: no negative lobe means no ringing and no
 *  overshoot anywhere in the frame, and the price is an edge softer
 *  than the eye asked for. The outer segment is
 *  `(2 - x)³ / 6`, factored so it is self-evidently zero at x = 2 rather
 *  than a polynomial that has to be trusted. */
const PRESENT_BSPLINE = /* glsl */`
  float cr( float x ) {
    x = abs( x );
    if ( x < 1.0 ) return ( 4.0 - 6.0 * x * x + 3.0 * x * x * x ) / 6.0;
    if ( x < 2.0 ) { float t = 2.0 - x; return t * t * t / 6.0; }
    return 0.0;
  }
`;
/** Mitchell-Netravali at B = C = 1/3 - the middle of the row. The
 *  coefficients are exact thirds (`16/3`, `-7/3`, `32/3`) and not
 *  rounded decimals, because the kernel's partition of unity is
 *  arithmetic: rounded, the taps would drift off the one they
 *  sum to at integer phases. Mild negative lobes, a minimum of
 *  about -0.036, buy back some of the edge B-spline gives
 *  away, and cost a faint halo on the hardest edge in the
 *  frame. */
const PRESENT_MITCHELL = /* glsl */`
  float cr( float x ) {
    x = abs( x );
    if ( x < 1.0 ) return ( 7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0 ) / 6.0;
    if ( x < 2.0 ) return ( -7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0 ) / 6.0;
    return 0.0;
  }
`;
/** Lanczos with a = 2 - `sinc(x) * sinc(x/2)` inside the radius, the
 *  sharpest of the three and the one that rings. **The guard is
 *  load-bearing**: integer phases occur on every texel-aligned pixel and
 *  `sin(p) / p` is 0/0 there, so without `if ( x < 1e-4 ) return 1.0;`
 *  the frame comes back NaN-black with nothing in the console to explain
 *  it. Negative lobes of about -0.09 bound the overshoot at roughly that
 *  much, and it shows as ringing on a high-contrast *texture* edge - the
 *  lane's painted line against the clay. **MSAA softens geometry
 *  silhouettes** (the resolve writes intermediate coverage, so the 0-to-1
 *  step becomes a ramp) **and does nothing for texture edges**, and the
 *  e2e tier runs with MSAA off: the mitigation is real and it is
 *  partial. */
const PRESENT_LANCZOS = /* glsl */`
  float cr( float x ) {
    x = abs( x );
    if ( x >= 2.0 ) return 0.0;
    if ( x < 1e-4 ) return 1.0;
    float p = 3.14159265 * x;
    return ( sin( p ) / p ) * ( sin( p * 0.5 ) / ( p * 0.5 ) );
  }
`;

/** The body all three kernels share, byte for byte: a separable 4x4
 *  weighted sum with the divide-by-sum DC correction. It calls `cr()` and
 *  nothing else, which is the whole of why one constant serves three
 *  kernels. */
const PRESENT_CUBIC = /* glsl */`
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
                 + srcAt( b + vec2( 1.0, float( j ) - 1.0 ) ) * wx[2]
                 + srcAt( b + vec2( 2.0, float( j ) - 1.0 ) ) * wx[3];
        sum += row * wy[j];
      }
      gl_FragColor = vec4( sum * inv, 1.0 );
    `;

/** `void main()` opens here and closes after the tail, so **the tail is inside the
 *  function** - which is where three puts it, and the difference is the whole of one
 *  bug this cost: an appended fragment that closes `main()` before the tone map puts
 *  `gl_FragColor = ...` at global scope, where it is not an assignment and the
 *  compiler answers `gl_FragColor : syntax error` rather than anything about the
 *  lines above it. The bracket is here rather than at the end of each body so the
 *  five kernels differ in their middle and nothing else. */
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
  // other four rather than a different mechanism with a hardware filter behind it
  PRESENT_HEAD + PRESENT_TAP + PRESENT_OPEN + /* glsl */`
      vec2 t = vUv * uSrc - 0.5;
      vec2 b = floor( t );
      vec2 f = t - b;
      vec3 a = mix( srcAt( b ), srcAt( b + vec2( 1.0, 0.0 ) ), f.x );
      vec3 c = mix( srcAt( b + vec2( 0.0, 1.0 ) ), srcAt( b + vec2( 1.0 ) ), f.x );
      gl_FragColor = vec4( mix( a, c, f.y ), 1.0 );
    ` + PRESENT_TAIL + PRESENT_CLOSE,
  // 2 b-spline - sixteen fetches, in two separable halves so it is four weighted
  // sums of four rather than sixteen multiplied out
  PRESENT_HEAD + PRESENT_TAP + PRESENT_BSPLINE + PRESENT_OPEN + PRESENT_CUBIC + PRESENT_TAIL + PRESENT_CLOSE,
  // 3 mitchell - the same sixteen fetches and the same body, a sharper kernel
  PRESENT_HEAD + PRESENT_TAP + PRESENT_MITCHELL + PRESENT_OPEN + PRESENT_CUBIC + PRESENT_TAIL + PRESENT_CLOSE,
  // 4 lanczos - the same sixteen fetches and the same body, the sharpest kernel
  PRESENT_HEAD + PRESENT_TAP + PRESENT_LANCZOS + PRESENT_OPEN + PRESENT_CUBIC + PRESENT_TAIL + PRESENT_CLOSE,
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
 * sixteen lights are bound to lamps as the eye moves and a glow that kept the
 * colour of the lamp it was on a moment ago is a glow on the wrong lamp.
 *
 * **And a light that is off has no glow at all**, which is the other half of
 * "the glow is the light" and the thing that makes it true rather than a
 * sentence. The visibility asked about is the *light's own*, not the hour's: a
 * slot holding no lamp is switched off by `litLamps()`, and this was showing it
 * a halo anyway - at whatever place the slot last had a lamp, in whatever colour
 * that lamp was. Sixteen such halos stacked at the world origin is what the
 * stable was drawing at a dark hour, with no lamp and no light behind any of
 * them, and one stale halo is what a lamp looked like for the frame after it lost
 * its light. **The tell is a glow with no light in it**, and on a course you walk
 * it is the halo that moves and changes colour on its own.
 */
/** The eye, worked out of whatever the camera is this frame. A scratch vector of
 *  this file's own rather than the frame loop's, because a glow pushed along the
 *  view axis is this file's arithmetic and nothing else touches it. */
const _glowV = new THREE.Vector3();
function syncGlow(e) {
  const on = gfx.fxGlow > 0;
  for (let i = 0; i < e.lampGlow.length; i++) {
    const s = e.lampGlow[i], l = e.lamps[i];
    // **The light's own two facts and not the hour's**, which is what makes this
    // "a glow is a light" rather than "a glow is a lamp-shaped sprite": a slot
    // holding no lamp is off, and an off slot draws nothing at all. The second
    // half is the intensity, because the binding is kept running under a dark hour
    // and the hour darkens the lights without unbinding them - so `lampOn` alone
    // would be a halo on a lamp whose light is out, which is the tell above wearing
    // a different hat.
    s.visible = on && e.lampOn[i] && l.intensity > 0;
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
 * **The canvas follows the window, and the ratio follows the display.** The
 *  canvas is native whatever the render row says - it is the window, and the
 *  window is however many device pixels the display has - and the county is
 *  drawn at a share of it. So the ratio moves only when the display did, and
 *  the county's own resolution goes to the chain on every step of the row.
 *
 * **`setSize()` is the resize, and it is not the ratio's to make.** The
 *  backing store and the CSS size both come out of it, so a guard that waits
 *  for the ratio leaves the last window's canvas standing in the new one: the
 *  county drawn at the old size into a corner of a bigger window, cut off by
 *  a smaller one, the camera's aspect already right and nothing left to be
 *  right about. The row that moved is the one case where the canvas call is a
 *  no-op, because the window did not move with it - and `applyGraphics()`
 *  puts this first and `syncComposer()` last, so a 0.5x step arrives with a
 *  chain still standing from the old scale.
 */
function applyRenderScale() {
  const canvas = canvasRatio();
  if (Math.abs(renderer.getPixelRatio() - canvas) > 1e-4) {
    renderer.setPixelRatio(canvas);
  }
  renderer.setSize(innerWidth, innerHeight);
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
  // **And the wind is a recompile and not only a uniform write** - see
  // `setWindEnabled()` in `materials.js` for the whole of it: the three lines are
  // vertex work with no branch, so a uniform of zero leaves the instructions in
  // and the work being done. `setWindEnabled()` returns whether it changed the
  // shape, and a preset press that does not move the wind cell costs nothing: the
  // uniform write below is one line on every apply, and the recompile is one frame
  // **on the six wind programs** and only when the cell actually moved.
  gfxU.uWindAmp.value = gfx.fxWind > 0 ? 0.055 : 0;
  setWindEnabled(gfx.fxWind > 0);
  // **The parallax march is a uniform write and not a recompile**, the same
  // one-line-per-effect shape as `uCloudAmt` and `uWindAmp` above. The step
  // count and the bisection are off two tables beside `AO_LADDER` and
  // `MSAA_LADDER` - the same reason: it keeps the mapping between a cell and a
  // number in one place rather than a switch in the applier - and the two-sided
  // flag is off the cell's own identity: cell 1 is the two-sided sample and not
  // a march, so it writes 0 steps and 1 two-sided, which is the whole of the
  // difference between the two cells and one cell writing both. **And the
  // bisection is a table rather than a test on the step count**, because relief
  // 8 and parallax 8 are both 8 - see `POM_BISECT`. The off path (fxPom: 0)
  // writes 0 and 0, and the GLSL branch is gated on those two being zero, so the
  // frame is byte-identical to today's and the off cell pays nothing - the same
  // bargain the other effect rows make.
  gfxU.uPomSteps.value = POM_STEPS[gfx.fxPom];
  gfxU.uPomTwoSided.value = (gfx.fxPom === 1 ? 1 : 0);
  gfxU.uPomBisect.value = POM_BISECT[gfx.fxPom];
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
// **What a step costs and not what it is**: the cells already say direct only,
    // x2 and x4, and the number that matters on the row is the one nobody can see
    // from the button - a multisampled buffer stores a whole frame per sample.
    //
    // **And it says when there is no buffer**, which is the half that is new and the
    // half a player can get wrong. The count is the compositor target's, and a frame
    // on the direct path has no target at all - so quoting a cost there would be
    // quoting a cost nobody is paying, on a row the player deliberately set. The
    // direct path's own smoothing is the context's, and it is *named* rather than
    // counted: `getContext` takes a boolean and the driver picked the number, so the
    // game has no figure to print and does not invent one.
    case 'msaa': {
      const s = MSAA_LADDER[n - 1];
      if (!s) return 'context MSAA · no buffer';
      return chainUp() ? `${s} frames a pixel · ${s}× the buffer`
        : `${s}× the buffer · idle, no chain`;
    }
    // **The tap count, because it is the only number on this row that costs
    // anything.** Nearest and bilinear are what a machine can afford and the
    // three cubics are sixteen fetches a pixel each; the caption is where a
    // player finds that out, which is the same job the render row's caption
    // does with device pixels.
    case 'scale': {
      const t = SCALE_TAPS[n - 1];
      // **And it says when the row is doing nothing**, which is the honest half:
      // at render scale 1x the county's resolution *is* the window's, there is no
      // resample in the frame, and all five kernels are the identity.
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
      // of its own**, because it is a half of the same decision - the row is a 1x2
      // of sample count against indirect light, and a caption that said "16 spp" on
      // a step that also ray-marches four bounces is a caption describing a
      // different machine than the one the player is on.
      //
      // **And the resolution token is gone**, because every cell is full-res now:
      // a caption that prints a constant is a column of noise, and half the words
      // on this row used to be the one thing about it a player could not see.
      return a ? `${a.samples} spp · ${a.radius} m${a.gi ? ' · gi' : ''}` : 'off';
    }
    case 'refl': {
      const s = REFL_LADDER[n - 1];
      // **And cell 1 says `sky only`, not `off`.** At `refl: 1` `syncProbes()`
      // drops the probe and leaves the water on `scene.environment`, so the pool
      // still reflects - only the sky. A row of reflections saying "off" beside
      // another row of reflections is a player comparing two wrong answers.
      return s ? `${s}² cube probe${REFL_FRESNEL[n - 1] ? ' + fresnel' : ''}` : 'sky only';
    }
    // **The reflection row's course-dependent half, and it cannot be a caption.**
    // A switch's caption is `row.cost` - a property of the row, not of where it
    // is set - so this reaches the tooltip instead, where a player reads *before*
    // pressing. Arming the march on a course with no water in it is otherwise a
    // lit button, a built chain and no visible change anywhere.
    case 'fxSsr': return reflectReport();
    // **The parallax relief's march budget, and not what the cell is.** The
    // cells already say two-sided / relief 4 / relief 8 / parallax 8 /
    // parallax 12, and the number that matters is the march cost - how many
    // height samples a fragment spends and whether the last interval is
    // bisected. The caption is that: `0 steps · no march` at off, `1
    // shifted sample` at two-sided, `4-step march` / `8-step march` at the
    // relief cells, `8-step + bisection` / `12-step + bisection` at the
    // parallax cells. The cost sentence lives in `row.cost` (`a height march
    // in the course's own shader`), which `optRow()` prints as the visible
    // caption on the switch rows the way it already does for the other
    // seven. The march is in the material's own shader and not a pass, so
    // the bottom tier pays nothing for having the row - that is the whole
    // difference from `fxSsr`, which needs the occlusion's G-buffer and is
    // a composer pass.
    case 'fxPom': {
      if (n === 0) return '0 steps · no march';
      if (n === 1) return '2 samples · 1 crossing';
      if (n === 2) return '4-step march';
      if (n === 3) return '8-step march';
      if (n === 4) return '8-step + bisection';
      return '12-step + bisection';
    }
    default: return '';
  }
}

/**
 * What is reflecting on the screen in front of you, and **it asks the scene
 * rather than a register of what was built.** The lobby and a course both stand at
 * once and only one of them is drawn, so a register cannot say which: it is either
 * emptied below the thing that fills it or true of one screen and about the other.
 * **So this walks `world.renderScene()`** and reads each piece's own kind, which is
 * the same question `standingReport()` asks about the arrangement - what is
 * standing here - asked of the thing the frame loop is about to draw.
 *
 * **A list of kinds and not a count**, because the answer a player wants is "is
 * there anything for this to reflect", and `3 pools` is not a different answer
 * from `pools`. An empty scene gets the sentence rather than an empty tooltip,
 * because "nothing" in a tooltip is a tooltip that has been scrolled past.
 *
 * **The only way this can be read is with the panel open, and opening the panel
 * rebuilds it** - `openOptions()` calls `renderOptions()` and that calls
 * `syncOptions()`, so the sentence is off the standing scene as it is at the
 * moment the player looked. There is no staleness to guard: a course opened while
 * the panel was closed cannot leave a wrong answer on screen, because the screen
 * the answer was on is the one that re-reads it.
 */
function reflectReport() {
  const kinds = new Set();
  const sc = world.renderScene();
  if (sc) sc.traverse((o) => {
    const k = o.geometry && o.geometry.userData.gfxKind;
    if (k) kinds.add(k);
  });
  return kinds.size ? [...kinds].join(', ') : 'no water on this course';
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
  // The switches get a heading of their own, because a row of two wide cells
  // under a heading is a different kind of control from a row of six and the grid
  // is the only thing saying so. The heading says what the two kinds are: the
  // nine above are a ladder and these are not. **And it says two kinds here too**,
  // because a composer pass is not a filter laid over the finished frame the way
  // grain and a vignette are, and one heading claiming they all are was the menu
  // quietly grouping a ray march in with two quads.
  const head = document.createElement('div');
  head.className = 'optgroup';
  head.textContent = 'effects & reflected light · one switch each';
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
  // **The cell's own cost, asked once at build time.** This is a third thing on a
  // button besides its label and its tooltip: whether picking it builds a post chain.
  // Decided here rather than in `syncOptions()` because it depends on nothing - not
  // the row, not the other rows, not what the player has set - so recomputing it per
  // sync would be work to arrive at the same answer every time, and a button whose
  // frame appeared only after a sync would be reporting the past.
  const costs = CHAIN_CELLS[row.key];
  cells.forEach((label, i) => {
    const n = base + i;
    const chain = !!(costs && costs(n));
    const b = document.createElement('button');
    b.className = chain ? 'optbtn chain' : 'optbtn';
    b.textContent = label;
    // **The cost is in the tooltip as well as in the frame**, because a frame is a
    // colour and a tooltip is a sentence, and the sentence is what a player can read
    // out to somebody else or act on without knowing what orange means in this panel.
    const cap0 = row.preset ? '' : (row.cost ? `${name}: ${label} · ${row.cost}` : gfxCaption(row.key, n));
    // **And one general addition, with no behaviour change for the other six
    // switches: a row can ask for a *live* caption in the tooltip only.** The
    // reflection row is the case that needs it - a switch's caption is `row.cost`,
    // a property of the row rather than of where it is set, so the course-dependent
    // half ("nothing in the county reflects") has nowhere else to go. A ladder row's
    // caption already moves with its cell and already says everything there is to
    // say, and `live` is off on every other row precisely so this cannot become a
    // second place a caption is decided.
    const live = row.live ? gfxCaption(row.key, n) : '';
    b.title = [cap0, live, chain ? 'builds the post chain' : '']
      .filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(' · ');
    b.onclick = () => {
      onPick(n);
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
    // **And nothing else moves.** The compositor frames were set when the row was
    // made and are left alone: they say what a cell costs, not what the panel is
    // currently doing, so a sync that re-derived them would be a sync that could
    // take a frame off a button the player was reaching for.
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
  setChainScene, chainUp, chainScene, gtaoPass,
  gbuffers, flatSize, maskSize, maskDepthSize, reflectReport,
  drawOverlay, takeGrab, grabPixels, doGrab,
  addGlows, syncGlow, courseProbes, probeQueue,
  dropProbe, dropReflections, queueProbes, pumpProbes, syncProbes,
  STAGE_ROWS, markStageDirty, clearStageDirty, applyRenderScale, forgetCastApplied, applyShadows,
  renderOptions, optionsOpen, openOptions, closeOptions,
};