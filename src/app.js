/* ================================================================== *
 * app.js
 *
 * The boot, the camera, the frame loop, the perf panel and every screen: the
 * lobby's shell, the season picker, the shop, the race, the results, the
 * inspector, the course card and the options modal.
 *
 * **It is the last module in the graph and the only one nothing imports**, and
 * that is what keeps the boot one ordered block with the same calls in the same
 * order it has always had. Everything it uses arrives by importing, so every
 * module body has run by the time this one does - and that ordering is load
 * bearing rather than tidy: `world.stage`, `world.scene` and `world.camera` are all
 * read on the first frame, and the first frame happens here.
 *
 * It fills five fields of `world` - camera, modeOf, seasonOf, restage, applyLook
 * and the seven the race asks for - and it is the only file that can fill them,
 * because it is the one that imports the modules whose state they describe.
 * ================================================================== */
/* ================================================================== *
 * Snail Grand Prix
 * A racing game in a walled valley: rock walls to climb, ponds to swim
 * and gaps to fly; every snail carries five traits and the course you are
 * on decides which one is working.
 * ================================================================== */
// The county's palette, and the three builders in meshes/ that paint from the
// same jar. It is a plain module and imports nothing, so it loads before this
// one and costs no round trip of its own.

// The planner is in `src/plan.js` and the courses it plans are `CATS` out of
// `core.js`, so the two things a course needs before anything can be drawn are
// one import apart and not eleven thousand lines.
import { planTrack } from './plan.js';
// The snail, the field, the race, the save, and `state` with them - which is the
// one thing in the county that every other module reads and none of them owns.
import {
  state,
  race,
  waterMeshes,
  env,
  scene,
  makePool,
  buildCourse,
  dropCourse,
  startRace,
  updateFx,
  surgeFx,
  updateRipples,
  flightPitch,
  stepRace,
  finishRace,
  save,
  load,
  SAVE_KEY,
  poolByIds,
  seasonField,
  forgetSeasonFields,
  seasonRivals,
  lastSeasonField,
} from './race.js';

// The stable: the lawn, the plinth, the pool, and the rebuild a density row
// asks for. `stage` is a `let` this file cannot reassign, so the boot asks for one
// to be built and the two frames ask where it is - see `stageOf()`. The scene it
// stands on is `world.stageScene` and the two are the same object.
import {
  stageEnv, stageBackdrop, stageOf, buildStable, requestRestage,
} from './stage.js';

// The things standing next to the lane: the half-way tower, the lamps, the
// scatter, the farms, and the backdrop both screens share. The register is
// emptied and read through functions - see `src/scenery.js`'s footer.
import { lampPosts, backdrop, standingReport, spinFans, fans, mills } from './scenery.js';

// The lane, the frames and the ground either side of it. `NEST` rides along
// because the surfaces' `groundColumns()` is reading the same twelve metres
// the ground function is.
import { buildTrack, trackAt, newFrame, groundYAt } from './course.js';

// The four surfaces, the rows they are laid on, and the half-way mark. The
// ribbon, the skirt, the water and the ground all read the lane through
// `course.js`; the scenery reads all four back out of here.
import { groundColumns, groundDrawnAt, _fr } from './surfaces.js';

// The post chain, the settings panel, the readback, the glows and the probes.
// It reads its scenes through `world` and builds none of them - the course and
// the stable that this chain draws are both built further down the graph.
import {
  renderScene,
  scenePixels,
  needsComposer,
  applyGraphics,
  composer,
  setChainScene,
  chainUp,
  chainScene,
  drawOverlay,
  takeGrab,
  grabPixels,
  doGrab,
  syncGlow,
  courseProbes,
  probeQueue,
  queueProbes,
  pumpProbes,
  syncProbes,
  STAGE_ROWS,
  markStageDirty,
  applyRenderScale,
  renderOptions,
  optionsOpen,
  openOptions,
  closeOptions,
} from './post.js';

// The jar, the loader and the four injections. One import for all of them,
// because the county has one palette and one set of shaders and a file that
// gave you half of either would be a file to cross-reference.
import { mat, rippleU, colour, gfxU, gfxSurfaceTargets } from './materials.js';

// The ladder, the renderer, the dome and the hour. The renderer appends its
// canvas here rather than in that module's body, because a module body runs
// before `DOMContentLoaded` and the canvas wants to land after the panels.
import {
  world,
  gfx,
  setDefaults,
  setRow,
  gfxSave,
  SCALE_NAMES,
  sceneRatio,
  MSAA_NAMES,
  FX_TOGGLES,
  gfxReflOn,
  renderer,
  paintSky,
  timeOfDay,
  refreshEnvironment,
  LAMP_LIGHTS,
  LAMP_COLOUR,
  raceClock,
  clockText,
  TOD,
  _todSky,
} from './graphics.js';
document.body.appendChild(renderer.domElement);


// The leaf: three.js, the numbers, the tuning and the county's own data. It is
// imported here and not in ten places because every module needs it, and one
// edge is one edge.
import {
  THREE,
  $,
  clamp,
  lerp,
  smoothstep,
  CAT_BY_ID,
  RUN,
  CLIMB,
  SWIM,
  FLY,
  PUSH,
  HOURS_PER_SECOND,
  COND,
  ATTRS,
  STAT_MAX,
  GOLD_PER_FRUIT,
  START_GOLD,
  START_RATING,
  FIELD,
  START_S,
  // **And the lane's own sample spacing**, which is here for one reason: the lip test
  // in the browser suite converts a leap's arc distance into a lane index, and a
  // magic 0.75 written into that test is a second copy of this number that fails
  // silently - the wrong three samples of a wrong stretch of road, compared
  // against a baseline that was captured with the right ones.
  STEP,
  freshSnail,
  seasonWord,
  TIERS,
  eligibleSeasons,
  canEnter,
  seasonFor,
  seasonDef,
  seasonScale,
  seasonPicks,
  seasonFinaleId,
  seasonRoster,
  trackSeed,
  makeRng,
  hills,
  M,
} from './core.js';

/** How many races the season runs, and the one function of the season ladder
 *  that reads `state` - so it did not go with the ladder. All three of its
 *  callers are labels on a HUD element, and `state` is the race's, and a leaf
 *  module that imports the thing nine modules up the graph is not a leaf. */
const seasonLength = (id) => seasonRoster(id === undefined ? state.tier : id).length;

/* ================================================================== *
 * Camera and the main loop
 * ================================================================== */
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.3, 1400);
// **The post chain draws through this camera and cannot import it**, because it
// is built in the frame loop and the chain is upstream of the frame loop. It is
// the one field of `world` filled from here rather than by a module below, and
// it is filled at module scope so it is there before the first frame - which is
// the whole condition the registry's other fields are waiting for.
world.camera = camera;
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), orbit: 0 };
// the backdrop sits with the course, so a course that climbs a long way
// still has country round it instead of a skyline underneath its feet
let backLift = 0;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _fr2 = newFrame(), _fr3 = newFrame();
let mode = 'stable';
/** The mode, handed to the registry as a function rather than copied into it -
 *  see `world.modeOf()`. */
world.modeOf = () => mode;
/** And the season, for `trackSeed()` - the scenery is upstream of this file and asks
 *  for it through the registry rather than reading `state` directly. */
world.seasonOf = () => state.season;
let clock = 0;
/** What the race asks the app for: the frame clock, the surge button, and the four
 *  screens. Seven fields of `world`, all functions, all for the reason
 *  `world.modeOf` is - each one reads something reassigned after boot, and a
 *  registry field written once is a field that is wrong on the next frame. */
world.clock = () => clock;
world.surging = () => surging;
world.forceTimeOfDay = forceTimeOfDay;
// **The two the stable asks for**, and both are the app's for the same reason the
// other six are. `restage` is `requestRestage` rather than `restage` because the debounce
// is the reason the row is allowed to be applied on every click, and `applyLook` is a
// screen - two colour inputs and a row of style buttons - with a stable's snail at
// the other end of it.
world.restage = requestRestage;
world.applyLook = applyLook;
world.syncHUD = syncHUD;
world.updateHUD = updateHUD;
world.flashGo = flashGo;
world.showResults = showResults;

function fieldCentre(out) {
  out.set(0, 0, 0);
  for (const r of race.racers) out.add(r.model.group.position);
  return out.multiplyScalar(1 / Math.max(1, race.racers.length));
}

function stageFrame(dt) {
  // the stable is a `let` this file cannot hold, so it is asked for once a
  // frame and used four times - the snail, the fountain, and its own clock
  const st = stageOf();
  st.spin += dt * 0.22;
  const a = st.spin;
  camera.position.set(Math.cos(a) * 3.9, 1.55 + Math.sin(a * 0.7) * 0.16, Math.sin(a) * 3.9);
  camera.lookAt(0, 0.74, 0);
  st.snail.group.rotation.y = -a * 0.6;
  st.snail.update(dt, { v: 1.1, cond: RUN });
  // the fountain runs all the time the hub is up: each jet on its own phase, and
  // the ripple on the pool drifting, which is the same `updateWater()` a race
  // calls - it walks `waterMeshes`, which is empty until a course is built
  for (const j of st.pool.jets) {
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
  // the stable is a `let` this file cannot hold, so it is asked for once a
  // frame and used four times - the snail, the fountain, and its own clock
  const st = stageOf();
  // the camera is the walker's, which is the whole of the difference
  camera.position.copy(freeCam.pos);
  camera.lookAt(
    freeCam.pos.x + Math.sin(freeCam.yaw) * Math.cos(freeCam.pitch),
    freeCam.pos.y + Math.sin(freeCam.pitch),
    freeCam.pos.z + Math.cos(freeCam.yaw) * Math.cos(freeCam.pitch));
  st.spin += dt * 0.22;
  const a = st.spin;
  st.snail.group.rotation.y = -a * 0.6;
  st.snail.update(dt, { v: 1.1, cond: RUN });
  for (const j of st.pool.jets) {
    const s = 0.92 + 0.1 * Math.sin(clock * 2.3 + j.userData.phase);
    j.scale.set(s, 0.94 + 0.12 * Math.sin(clock * 1.7 + j.userData.phase * 1.3), s);
  }
  updateWater();
  spinFans(dt, clock);
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
  spinFans(dt, clock);
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
/** A race's hour starts at the beginning of its own stretch of the day, and the
 *  two assignments in front of `updateTimeOfDay(true)` are the cache's to clear -
 *  which is why the whole of it is asked for through the registry rather than
 *  half of it. */
function forceTimeOfDay() {
  todU = -1; todPainted = -1;
  updateTimeOfDay(true);
}
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
    paintSky(_todSky, chainUp());
    refreshEnvironment(_todSky, [env, stageEnv]);
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
  if (chainUp()) {
    // **All three passes, every frame, unconditionally, in one call** - see
    // `setChainScene()`. There are two scenes and which one is up changes with
    // the mode; a pass left pointing at the other one renders the stable into a
    // race's occlusion and produces nothing at all rather than something wrong,
    // which is much harder to see. And the occlusion pass was written once at
    // construction and left there while the beauty pass was already right, so on
    // the stable its depth buffer was full of a course nobody could see.
    setChainScene(renderScene());
    composer.render();
  } else {
    renderer.render(renderScene(), world.camera);
  }
  // vignette and grain, on whichever of the two paths just ran
  drawOverlay(clock);
  // a readback asked for from the console, answered by the frame that has the
  // picture on it and by no other
  const g = takeGrab();
  if (g) doGrab(g);
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
  $('pPath').textContent = chainUp() ? 'compositor' : 'direct';
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
  const names = chainUp() ? composer.passes.filter((p) => p.enabled).map((p) => p.constructor.name.replace('Pass', '')) : [];
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

/**
 * The snail's colours onto the plinth's snail, and the two colour inputs and the
 * style buttons with them.
 *
 * **This is the app's and not the stable's**, and the reason is the last three
 * lines: a colour input and a row of style buttons are screens, and the file that
 * owns the screens is the one that draws them. The first seven lines are the other
 * half - a rebuilt stable comes up wearing the county's colours otherwise, and
 * `restage()` in `src/stage.js` asks for this through `world.applyLook()`.
 */
function applyLook() {
  const st = stageOf();
  if (!st) return;
  st.snail.def.body = state.body;
  st.snail.def.shell = state.shell;
  st.snail.mats[0].color.setHex(state.body);
  st.snail.mats[2].color.setHex(state.body);
  st.snail.mats[3].color.setHex(state.body);
  st.snail.mats[1].color.setHex(state.shell);
  st.snail.setShellStyle(state.style);
  for (const el of document.querySelectorAll('#styles button')) el.classList.toggle('sel', el.dataset.s === state.style);
  $('bodyColor').value = '#' + state.body.toString(16).padStart(6, '0');
  $('shellColor').value = '#' + state.shell.toString(16).padStart(6, '0');
}

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
    const plan = planTrack(id, trackSeed(id, state.season), seasonScale(state.tier));
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
    const plan = planTrack(fid, trackSeed(fid, state.season), seasonScale(state.tier));
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
  spinFans(dt, clock);
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
// **One call, and `buildStable()` rather than `buildStage()`.** Filling
// `world.stage` and putting the group on the scene are two more statements, and
// they are this file's business: `stage` is a `let` the stable module reassigns
// and this one cannot, which is why the stable is asked for rather than built here.
buildStable();
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
// the debug runner never holds the surge button unless it is told to, and the
// flag is here rather than in `race.js` because this is the only thing that reads
// it - `race.autoSurge` is the field the sim actually spends, and a `let` exported
// out of another module is a `const` here
let simSurge = false;

window.__snail = {
  state, race, get stage() { return stageOf(); },
  get gfx() { return { ...gfx, composerUp: chainUp(), needsComposer: needsComposer(), probes: courseProbes.length }; },
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
    passScene: chainScene() === world.scene ? 'race' : (chainScene() ? 'stage' : null),
    mode,
  }),
  plan: (id) => planTrack(id, trackSeed(id, state.season), seasonScale(state.tier)),
  track: (id) => buildTrack(id, trackSeed(id, state.season), seasonScale(state.tier)),
  groundYAt, trackAt, newFrame,
  // **And the spacing, because a test that converts a distance into a lane index
  //  needs it.** `golden.spec.js` finds the crest of a lip's take-off edge by
  // dividing the leap's arc by the stride; a 0.75 written into that test is a
  // second copy of this number, and the failure of a second copy is silence -
  // the wrong three samples of a wrong stretch of road, compared against a
  // baseline captured with the right ones.
  STEP,
  // and the four that are functions rather than values, so they are spelled
  // as references and not inlined: the surface's own `groundColumns()` and
  // `groundDrawnAt()`, and the scenery's `standing()` and `mills()` - the last
  // two of which are the functions the register was emptied and read through.
  groundColumns, groundDrawnAt, standing: standingReport, mills,

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
