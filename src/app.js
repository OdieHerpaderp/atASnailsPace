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
  adversary,
  duelCatId,
  raceHourKeyOf,
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
  rankOf,
  ladderAt,
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
import { lampPosts, backdrop, standingReport, bowerReport, spinFans, fans, mills } from './scenery.js';

// The county's colour jar and the biome table beside it: `hex()` is the jar's own
// sRGB encoder, so a biome's far-country colour is named rather than written, and
// `BIOMES.temperate` is the one the stable is always in.
import { COUNTY as C, hex } from '../meshes/palette.js';
import { BIOMES } from '../meshes/biomes.js';

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
  gtaoPass,
  gbuffers,
  flatSize,
  maskSize,
  maskDepthSize,
  reflectReport,
} from './post.js';

// The jar, the loader and the four injections. One import for all of them,
// because the county has one palette and one set of shaders and a file that
// gave you half of either would be a file to cross-reference.
import { mat, rippleU, colour, gfxU, gfxSurfaceTargets, biomeNow, PAL as PAL_FOR_TEST } from './materials.js';

// The ladder, the renderer, the dome and the hour. The renderer appends its
// canvas here rather than in that module's body, because a module body runs
// before `DOMContentLoaded` and the canvas wants to land after the panels.
import {
  world,
  gfx,
  setDefaults,
  setRow,
  setToggle,
  gfxSave,
  SCALE_NAMES,
  sceneRatio,
  MSAA_SHORT,
  FX_TOGGLES,
  gfxReflOn,
  renderer,
  paintSky,
  timeOfDay,
  refreshEnvironment,
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
  BOWER,
  HOURS_PER_SECOND,
  COND,
  ATTRS,
  CLUB_ATTR,
  ratingOf,
  faceFor,
  hatFor,
  FACE_SET,
  HAT_SET,
  FACE_BY_NAME,
  HAT_BY_NAME,
  STAT_MAX,
  GOLD_PER_FRUIT,
  START_GOLD,
  START_RATING,
  CLUB_SNAILS,
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
/**
 * Is this frame about the stable? **It is a function and not a bare `mode ===
 * 'stable'`, and that is because the far country and the fog both have to ask it
 ***: `mat.hillNear` and `mat.hillFar` are one pair shared by two backdrops and the
 * course's fog is tinted off the standing biome, so both need to know which
 * screen they are painting for. The stable is always temperate - `buildStable()`
 * says so out loud - so on the stable the biome is `BIOMES.temperate` and not
 * whatever the last course happened to be.
 */
const onStableScreen = () => mode === 'stable' || mode === 'stroll';
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
// screen - two colour inputs - with a stable's snail at the other end of it.
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

/* ------------------------------------------------------------------ *
 * Which material a set-list question is about, and how it is asked.
 * ------------------------------------------------------------------ */

/**
 * `setsOf('road')` - the live set names a set-wearing material is running, in
 * order, or `null` for a material that runs none.
 *
 * **`'road'` and `'mat.road'` are both accepted, and an unknown key throws.**
 * Three spellings are in circulation - the material block's key, the `mat.`
 * prefix a reader reaches for, and the plain role name - and the first version of
 * this took one of them and answered `null` to the other two. **A `null` for a
 * name that is not a material and a `null` for a material that was never asked
 * are the same answer**, which is this project's whole subject: a gate written
 * `expect(setsOf('mat.road')).toEqual([...])` would have passed on a road with
 * no setts at all. So an unknown key is a loud failure with the valid ones in the
 * message, and only a material that genuinely runs no sets answers `null`.
 *
 * **And it reads the material rather than the biome's table**, because the table
 * is what was asked for and this is what was built.
 */
function setsOf(which) {
  const key = String(which).replace(/^mat\./, '');
  const m = mat[key];
  if (!m) throw new Error(`setsOf: '${which}' is not a material. The set-wearing ones are ${Object.keys(mat).filter((k) => mat[k].userData.setNames).join(', ')}`);
  return m.userData.setNames || null;
}

/**
 * `setHeightsOf('road')` - one boolean per live set, in the same order as
 * `setsOf`, and true where the set got a `-h` map and false where it did not.
 *
 * It is the register the POM branch is gated on: `triplanarSets()` writes
 * `userData.setHeights` alongside `setNames`, and a set that declared a `-h`
 * and got none - the loader's quiet-failure path, where `detailOf` answers
 * `null` and the set's height is filtered out and its normal kept - shows up
 * here as a `false` rather than in a picture. **The gate is the material's own
 * register and not the biome's table**, for the same reason `setsOf` is: a
 * surface that marches on the normal alone is indistinguishable, in a frame,
 * from one that never had a `-h at all, and the only thing that says which it
 * is is this list.
 */
function setHeightsOf(which) {
  const key = String(which).replace(/^mat\./, '');
  const m = mat[key];
  if (!m) throw new Error(`setHeightsOf: '${which}' is not a material. The set-wearing ones are ${Object.keys(mat).filter((k) => mat[k].userData.setNames).join(', ')}`);
  return m.userData.setHeights || null;
}

/* ------------------------------------------------------------------ *
 * Which lamps cast real light, and which of them keep it.
 *
 * **A light belongs to a lamp and not to a slot**, and this whole block is that
 * sentence made true. It was written twice - once in `updateTimeOfDay()` and
 * again in `inspectFrame()`, the same six lines over a different camera - and
 * both of them sorted the course's lamps by distance from the eye and handed the
 * nearest sixteen to `env.lamps[0..15]` *by rank*. So the light on a lamp was a
 * property of the camera's neighbourhood rather than of the lamp: the frame the
 * eye crossed the perpendicular bisector between two posts, the two swapped
 * slots, each took the other's glass **and the other's colour**, and a mint
 * lantern standing beside a cream lamp was a cream one for a frame and a mint
 * one for the next. Measured on Hedgerow Dash by walking six metres in
 * centimetre steps: **three handoffs in six metres, every one of them a swap of
 * two adjacent slots, and every swap a different colour.** A sort with no
 * tie-break on a quantity two lamps are exactly equal in is not a near-tie; it
 * is a coin toss every time the eye moves at all - and the walk of lamps
 * alternates from one side of the lane to the other, so the bisectors are the
 * places the eye passes most.
 *
 * So the binding is **held rather than ranked**. A lamp takes one of the sixteen
 * when the eye comes inside `LAMP_ON` and only gives it up once the eye is past
 * `LAMP_OFF`, fourteen metres further out - so a lamp has to be pushed a long
 * way from the eye before its light goes, and two lamps at the same distance
 * both keep what they hold instead of trading it. Which slot a lamp takes is
 * settled once, in order of distance and then of position, so the choice is a
 * function of the course and of where the eye started rather than of the sort's
 * mood. The dead band between the two radii *is* the fix.
 *
 * **And the binding is written on the lamp record rather than kept in an array
 * here.** `lampPosts` is emptied and built again for every course - `race.js`
 * clears it at the top of `startRace()` - so a record rebuilt is a record with no
 * `slot` on it, and the rebuild resets the binding by itself. One fewer piece of
 * state to keep in step, and it cannot be left pointing at a lamp of the last
 * course.
 *
 * **The intensity has no camera term in it at all**, and losing that one is the
 * other half. It was `power * clamp(1 - distance-from-eye / 34, 0.15, 1)`, so a
 * lamp's pool of light on the ground brightened as you walked towards it and
 * dimmed as you walked away - a point light in the world does not do that, and
 * three was already doing the physical falloff (`decay` and a `reach` cutoff) on
 * the same lamp. Two falloffs, one of them imaginary: the nearest lamp was given
 * roughly full power and every lamp beyond thirty metres was squashed onto the
 * 0.15 floor, so the sixteen lamps lit the county almost equally from wherever
 * you happened to be standing. `power` and the hour are the whole of a lamp now,
 * and the light belongs to the lamp for as long as the lamp has one.
 *
 * Called from the frame loop and **not** from `updateTimeOfDay()`, because the
 * hour is not what decides a lamp's light. `updateTimeOfDay()` returns early when
 * the hour has not moved, and a binding that is stateful and lives behind that
 * guard stands frozen for as long as the hour does - which during a countdown it
 * does and on the stable it does. **The value that decides whether a resource is
 * wanted is the setting, and the resource standing there is evidence about the
 * past**: here the value is the eye and the hour is only the switch.
 *
 * **And nothing here switches a light off, because a light that is switched off
 * is not a lamp going dark - it is a recompile of the county.** The binding was
 * written in terms of `lamps[i].visible`, which reads as "does this slot hold a
 * lamp" and is not that at all: three drops a light with `visible === false` out
 * of the render state's light list, the list is what `NUM_POINT_LIGHTS` is written
 * out of, and so every lamp that took a light and gave it back took every
 * material in the county through a fresh program. Measured on Grand Marathon by
 * walking the inspector down the lane in 40 cm steps: **19 of 120 frames compiled
 * a shader, 522 compiles in 120 frames, and all 19 were frames the count had moved
 * on** - 1943 ms on those frames against 666 ms on the ones that compiled
 * nothing under SwiftShader, and on this machine's own renderer **ten frames out
 * of 250 walked cost 682 to 710 ms each**, which is the number a player feels:
 * the frame average over the same walk went from **8.3 ms to 33.2 ms** and back.
 * It is the same sentence the render scale row is written against: **a number that
 * decides what gets compiled may not be a number the camera moves.** So the
 * sixteen are in the scene from `makeEnv()` and are never taken out, and the two
 * halves of "off" are `lampOn[i]` for the binding and `intensity` for the light.
 * ------------------------------------------------------------------ */
/** Metres within which a lamp takes one of the sixteen. Further out than any
 *  lamp's own `reach`, so a lamp's pool of light is already in the county before
 *  it is switched on and the taking is not a pop. */
const LAMP_ON = 34;
/** ... and the further one past which it hands it back. The dead band between
 *  the two numbers is the whole of the fix, so it wants to be wide enough to walk
 *  a lamp's own reach in and not cross it. */
const LAMP_OFF = 48;
const LAMP_ON2 = LAMP_ON * LAMP_ON, LAMP_OFF2 = LAMP_OFF * LAMP_OFF;
/** Scratch lists, reused: the frame loop does not allocate. */
const _lampWant = [];
/** The eye a lamp's light is decided against: **the snail in a race**, because the
 *  road ahead of the snail is what is about to be run and the camera trails it by
 *  seven metres, and the camera everywhere else. The camera is right in all three
 *  of those on its own - `freeCameraFrame()` copies `freeCam` onto it before this
 *  is asked - so the two of them are a race and not-a-race rather than a list of
 *  four modes, and a fifth mode cannot fall through the gap. */
function lampEye() {
  const p = race.player;
  return p && p.model ? p.model.group.position : camera.position;
}
function litLamps() {
  const lamps = env.lamps;
  // **which slot holds a lamp, and not `visible`** - the sixteen are all in the
  // scene whatever they are standing on, because the count of them is baked into
  // every program drawn here (see the note above). `intensity` is the light and
  // this flag is the binding, and neither of them is ever the other's.
  const on = env.lampOn;
  const eye = lampEye();
  const ex = eye.x, ez = eye.z;
  // every lamp that has a light keeps it while the eye is inside `LAMP_OFF` and
  // hands it back past it, so this pass *frees* slots rather than filling them -
  // and it is also where the hour is written, because the hour moves every frame
  // and the binding does not, so a lamp lit once at dawn's 0.30 and left there is
  // a lamp still standing at 0.30 at dusk
  let held = 0;
  for (const l of lampPosts) {
    if (l.slot === undefined) continue;
    const dx = l.p.x - ex, dz = l.p.z - ez;
    if (dx * dx + dz * dz > LAMP_OFF2) {
      on[l.slot] = 0; lamps[l.slot].intensity = 0; l.slot = undefined;
    } else { held++; lamps[l.slot].intensity = (l.power || 9) * Math.max(TOD.lamps, 0.25); }
  }
  // and a lamp takes one when the eye comes inside `LAMP_ON`, nearest first, so
  // the sixteen are spent on what is in front of the eye rather than on whichever
  // side of the course the sort felt like
  const want = _lampWant;
  want.length = 0;
  let free = 0;
  for (let i = 0; i < lamps.length; i++) if (!on[i]) free++;
  // **And the count on each side has to agree, because it is the only thing that
  // notices a course being built.** `startRace()` empties `lampPosts` and builds it
  // again, so a new course's records arrive with no `slot` on them while the
  // sixteen lights are still standing wherever the last course put them - and a
  // binding that only ever *adds* would find every slot taken and light the new
  // course with the old course's lamps. Nothing else can see that: a stale light
  // is a light in the right place with a plausible intensity in it.
  //
  // So the check is one number against one number, counted after the release pass
  // so the two are comparable. They can only differ when one of them belongs to a
  // course that is no longer standing, because `litLamps()` is the only thing that
  // writes either - and `0` against `0` is agreement, which is what a course built
  // at noon leaves behind: every light off, every record gone, and the next course
  // correctly starting from nothing.
  if (held + free !== lamps.length) {
    for (let i = 0; i < lamps.length; i++) { on[i] = 0; lamps[i].intensity = 0; }
    for (const l of lampPosts) l.slot = undefined;
    free = lamps.length;
  }
  if (!free || !lampPosts.length) return;
  for (const l of lampPosts) {
    if (l.slot !== undefined) continue;
    const dx = l.p.x - ex, dz = l.p.z - ez;
    const d2 = dx * dx + dz * dz;
    if (d2 <= LAMP_ON2) want.push(l);
  }
  if (!want.length) return;
  // **and the order of that list is settled rather than incidental**, which is the
  // other half of the tie-break: two lamps at one distance and one lamp to take
  // between them is a choice, and a choice made by `x` and then `z` is the same
  // choice every frame rather than whichever way the sort happened to fall
  want.sort((a, b) => {
    const da = (a.p.x - ex) ** 2 + (a.p.z - ez) ** 2, db = (b.p.x - ex) ** 2 + (b.p.z - ez) ** 2;
    return (da - db) || (a.p.x - b.p.x) || (a.p.z - b.p.z);
  });
  let slot = 0;
  for (const l of want) {
    // the next unlit one, in slot order, so a lamp cannot be handed the slot a
    // nearer lamp gave up a frame ago and then give it straight back
    while (slot < lamps.length && on[slot]) slot++;
    if (slot >= lamps.length) break;
    const lamp = lamps[slot];
    l.slot = slot;
    on[slot] = 1;
    lamp.position.copy(l.p);
    // a lantern lights the ground its own colour, a street lamp the one colour
    // they all are
    lamp.color.setHex(l.colour || LAMP_COLOUR);
    lamp.distance = l.reach || 15;
    // **and the hour is written here as well as on the release pass, because the
    // two are the same answer and a slot that took its lamp this frame with the
    // intensity of the last lamp it held is a light with no light in it** - which
    // is what `syncGlow()` asks about, and the one thing a glow must never have.
    lamp.intensity = (l.power || 9) * Math.max(TOD.lamps, 0.25);
    slot++;
  }
  // and the hour decides whether any of them is lit at all, **with the bindings
  // kept running underneath it** - so the set standing at dusk is the set that has
  // been following the eye, and not a set thrown together by one frame of sorting.
  // **It writes the intensity and not the binding**, which is the other half of the
  // note at the top: a dark hour darkens sixteen lights, and it does not cost the
  // county a program to say so.
  if (TOD.lamps <= 0.02) for (const l of lamps) l.intensity = 0;
}

/**
 * Walk the hour. The four courses of a season run from first light to the
 * middle of the day and the finale runs from dusk into the dark, and it runs
 * them on a clock: a minute of racing is an hour of the day, so the light moves
 * under you at a steady rate whether you are quick or slow. The dome is one
 * mesh of vertex colours, so it is only repainted once the light has actually
 * moved far enough to be worth it.
 *
 * **And nothing here decides a lamp's light any more** - `litLamps()` is in the
 * frame loop, because the hour is the clock and the lamps belong to the eye.
 */
let todU = -1, todFinale = null, todPainted = -1;
/** A race's hour starts at the beginning of its own stretch of the day, and the
 *  two assignments in front of `updateTimeOfDay(true)` are the cache's to clear -
 *  which is why the whole of it is asked for through the registry rather than
 *  half of it. */
function applyHourMaterials(TOD) {
  // **One function and not two.** The hour's lift on the lamps and the far
  // country's colour were written identically in `updateTimeOfDay()` and
  // `inspectFrame()`, so a change to the lift (the 0.35 / 0.72 slopes, or a
  // fourth lit material) had to be made twice or the two screens diverged -
  // the same "two screens disagreeing" failure the lamp binding refactor took
  // out of the block below. The cloud's own colour is not in here: only
  // `updateTimeOfDay()` copies it off `TOD.cloud`, and putting it in this
  // function would paint the inspector's sky with the race's cloud.
  mat.cloud.emissiveIntensity = 0.12 + 0.42 * clamp(TOD.sunI / 1.55, 0, 1);
  // the far country sits outside the fog, so it has to take the colour of the
  // air by hand or it stands there lit up in the middle of the night -
  //
  // **and the base it is taken from is the standing biome's two jar names, not
  // two hexes written here.** They were `0xb2c8c6` and `0x8cae94`, and they were
  // the only course-facing colour in the county that was not out of
  // `meshes/palette.js`, which `AGENTS.md` says nothing outside that file may
  // invent; they got away with it because nothing had ever wanted a second value
  // for them, and a biome wants a second value. `hex()` is the jar's own encoder,
  // so `hillNear` reads back as exactly `0x8cae94`.
  //
  // **And which biome it is depends on the screen, because the two hills
  // materials are global.** `mat.hillNear` and `mat.hillFar` are one pair shared
  // by the course's backdrop and the stable's, and the stable's own backdrop
  // never leaves temperate - so on the stable the base is the stable's and not
  // whatever the last course happened to be. That is the one place in the
  // county where "read the standing biome" is wrong unless it is qualified, and
  // it is qualified here rather than in the biome table, because the screen is
  // what decides it.
  const far = onStableScreen() ? BIOMES.temperate : biomeNow();
  mat.hillFar.color.setHex(hex(far.far.far)).lerp(TOD.fog, TOD.haze);
  mat.hillNear.color.setHex(hex(far.far.near)).lerp(TOD.fog, TOD.haze * 0.85);
  mat.lampGlass.emissiveIntensity = TOD.lamps * 2.6;
  // The paper carries most of its own light in its own colour, so that
  // whatever colour a lantern is painted is the colour it gives out; the
  // emissive only lifts it a little once the hour is on it.
  mat.paper.emissiveIntensity = 0.10 + TOD.lamps * 0.35;
  // **And the wax of a candle lantern is on the same ladder as the paper, at
  // 1.6 times it** - and the factor is the whole of what it is for. The wax is
  // the one lit surface in the county whose brightness has to come out of its
  // emissive rather than out of a light, because a point light on the wick gives
  // a closed cylinder nothing on its sides (`mat.candleWax` has the numbers).
  // Paper needs a small lift because the hour is already lighting it; wax needs
  // most of its brightness from the emissive or it is a dark cylinder, so it
  // gets 0.16 by day and 0.72 at midnight against the paper's 0.10 and 0.45.
  mat.candleWax.emissiveIntensity = 0.16 + TOD.lamps * 0.72;
}
function forceTimeOfDay() {
  todU = -1; todPainted = -1;
  updateTimeOfDay(true);
}
function updateTimeOfDay(force) {
  const p = race.player;
  const running = race.tr && p && race.phase !== 'idle';
  // **and the hour is the course's own answer rather than the tier's finale.**
  // `raceHourKeyOf()` reads a duel's `hour` off its entry, and that is not
  // cosmetic: a duel on a course called `adversary` is not the season's finale,
  // so `race.catId === seasonFinaleId(state.tier)` was false for it and the duel
  // was raced at dawn-to-noon where it was raced at dusk-to-night - a green-lit
  // course with dead ground and no sun in it, which is a wrong picture rather than
  // a broken one and so nothing else would have caught it.
  const finale = running && raceHourKeyOf(race.catId) === 'finale';
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
  for (const [i, e] of [env, stageEnv].entries()) {
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
    // **And the race env's fog takes the standing biome's haze and the stable's
    // does not.** The stable is always temperate - `buildStable()` says so out
    // loud - so tinting its fog off whatever the last course was would paint the
    // lobby the colour of a dead valley. `env` is index zero because that is the
    // order the pair is written in on the line above, which is the only place in
    // the county that knows it.
    if (i === 0) {
      const haze = biomeNow().fog;
      if (haze) e.scene.fog.color.multiply(colour(C[haze]));
    }
  }
  renderer.toneMappingExposure = TOD.exposure;
  // the clouds are lit by the sun, so they have to go with it or they hang in
  // a night sky as bright white paper
  mat.cloud.color.copy(TOD.cloud);
  mat.cloud.emissive.copy(TOD.cloud);
  applyHourMaterials(TOD);
  // **The lamps and their glows are not here.** They were, twice, and both copies
  // of the block are gone: one in this function and one in `inspectFrame()`, each
  // sorting the course's lamps by distance from the eye and handing the nearest
  // sixteen to `env.lamps[0..15]` by rank, which made the light on a lamp a
  // property of the camera rather than of the lamp. It is `litLamps()` in the
  // frame loop now, and it is not behind the early return above - **a binding that
  // is stateful and lives behind the hour's cache stands frozen for as long as
  // the hour stands still**, which during a countdown it does and on the stable it
  // does. The glows go with it, because a glow follows a light and a light
  // follows a lamp, so putting them apart is a third answer to a question with
  // two.
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
  // the county's own resolution is put back on the G-buffer and the two flat
  // buffers after `setSize()` has given them the window's, and where
  // `presentPass` is told the source size its shader reads
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
  // **The lamps and their glows, once, on every path, above the render rather than
  // inside whichever screen happened to want them.** They were in two of the four
  // screens and not the other two, and the ones they were in had their own copy of
  // the same six lines - so what a lamp's light was depended on which screen you
  // were looking at, which is the failure that reads. It goes here because this is
  // the one place every mode has already moved its camera and the one place
  // nothing has drawn yet: a glow placed before the light it belongs to is a glow
  // at the last lamp's place.
  litLamps();
  syncGlow(env);
  syncGlow(stageEnv);
  // The sun's glow is placed from the key light's own direction off the eye, so it
  // is where the sun is from wherever you are standing, and only the env being
  // drawn needs it placed because the other one is not on screen.
  const lit = mode === 'stable' || mode === 'stroll' ? stageEnv : env;
  if (lit.sunGlow && lit.sunGlow.visible) {
    _v1.copy(lit.key.position).sub(camera.position);
    if (_v1.lengthSq() < 1e-6) _v1.set(0.4, 0.5, 0.3);
    lit.sunGlow.position.copy(camera.position).add(_v1.normalize().multiplyScalar(320));
  }
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
    // **All four passes, every frame, unconditionally, in one call** - see
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
  // The count and not the step, for the same reason the row is: `direct` is not a
  // number of samples a pixel, so a raw integer would read as 1x and mean none.
  // **And `MSAA_SHORT` rather than `MSAA_NAMES`** - the panel's value column is 3.4em
  // because the widest thing in it is five characters, so the modal's `direct only`
  // would print as an ellipsis where a word was. The panel has always shortened a
  // cell rather than truncating one.
  $('pMsaa').textContent = MSAA_SHORT[gfx.msaa - 1];
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
/**
 * The HUD's order panel, and **it is the field's own size and not `FIELD`.**
 *
 * `updateHUD()` walks `race.racers` and indexes `standRows[i]`, so a two-snail duel
 * against eight rows would have written the two it has and left six empty ones
 * standing on the screen - six blank rows under a duel, which reads as a race that
 * has not started rather than as a race with two people in it. This is the same
 * number `laneSlot()` and `buildCrates()` take, and all three are the field's size
 * for the same reason: **a duel is a two-snail race and every count of racers in this
 * file has to be willing to say two.**
 */
function buildStandings() {
  const wrap = $('standings');
  wrap.innerHTML = '';
  standRows.length = 0;
  const n = race.racers.length || FIELD;
  for (let i = 0; i < n; i++) {
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
  $('raceName').textContent = race.duel ? 'The Adversary' : cat.name;
  const tally = race.tr.plan.tally;
  // **A duel says "a duel" and not "race 3 of 5".** `state.results` has no duel in
  // it, so the counter below would read the same number the last season race read
  // and then one less - a duel would move the season's own progress bar backwards,
  // which is the one thing `finishRace()`'s branch goes out of its way not to do.
  const bits = race.duel ? ['a duel', 'they do not move'] : [`race ${n} of ${races}`];
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
  //
  // **And the bower's is a leaf green and not a green**, because the rail is a
  // legend: `#b08f5c` is the footpath's own straw and a second green on the same
  // strip is a legend nobody can read. `#6d7a3a` is a leaf, a shade darker and
  // greener than anything else on the rail. It is a literal here with the other
  // four and **not a `PAL` key**, because this is not a surface - nothing is
  // painted in it - and the rail's existing four did not each earn a jar name
  // either.
  //
  // **And it reads `plan.meta` and not the built track**, so a bower shows at the
  // `x` the deal gave it rather than at the arc distance it lands on. Every other
  // stroke on this card is a claim about the plan drawn before anything is built,
  // and that is the whole of what the card is.
  for (const [cond, col] of [[RUN, '#b08f5c'], [CLIMB, '#7d746a'], [FLY, '#c2a15a'], [PUSH, '#a97c3f'], [BOWER, '#6d7a3a']]) {
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
  if (t.bowers) s += `<span class="chip bower">bower ×${t.bowers}</span>`;
  return s;
}

/**
 * One rival, wherever a rival is listed: the field card, a season card, and the
 * ladder. **One builder for all of them, because the rank went into all of them
 * and two copies of a row is two copies of a mistake** - the picker had its own
 * five lines of it and a rank added to one and not the other is a screen that
 * agrees with itself and not with the stable.
 *
 * The player's row is **not** a special case. `state.pool` is the same 64 snails
 * for everybody, so `rankOf(state.rating)` is the player's own rank by exactly
 * the definition that gives the rivals theirs, and a row that had to be told it
 * was the player would be a second answer to the same question.
 */
function rivalRow(sn, cls) {
  const d = document.createElement('div');
  d.className = 'rival' + (cls ? ' ' + cls : '');
  // **and the face cell, between the colour and the name.** There is no canvas in a
  // `<div>`, so a face glyph is a class and not a drawing - which means a face with no
  // rule in the stylesheet draws nothing at all, silently and without an error. That is
  // the one thing about this row worth watching, and it is why `FACE_SET` in `core.js`
  // and the `.f-*` rules in `snail-race.css` are two lists of the same ten names and
  // one of them has to be kept in step with the other.
  d.innerHTML = '<span class="rk"></span><span class="dot"></span><i class="f-' + (sn.face || 'plain')
    + '" title="' + (sn.face || 'plain') + ' face"></i><span class="nm"></span><span class="rt"></span>';
  d.querySelector('.rk').textContent = rankOf(sn.rating);
  d.querySelector('.dot').style.background = '#' + sn.body.toString(16).padStart(6, '0');
  d.querySelector('.nm').textContent = sn.name;
  d.querySelector('.rt').textContent = sn.rating;
  return d;
}

/**
 * The season you are in and the seven in it with you, shown before you have
 * raced any of it. The player is listed with them and their rating marked, so
 * the ladder is legible: the number under the rivals is what you are trying
 * to get past, and a win is worth about a thousand points of it.
 */
function renderField() {
  const tier = seasonDef(state.tier);
  const mine = rankOf(state.rating);
  $('tierName').textContent = tier.name;
  $('tierRating').textContent = `you · ${state.rating} · ${ordinal(mine)}`;
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
  const rivals = seasonRivals();
  for (const p of rivals) wrap.appendChild(rivalRow(p));
  wrap.appendChild(rivalRow({ name: state.name, body: state.body, rating: state.rating, face: state.face }, 'me'));

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
  $('openLadder').textContent = `the ladder · ${ordinal(mine)} of ${state.pool.length + 1}`;
  /**
   * **The Adversary's button, and there is one from the first frame.**
   *
   * Not "when you are ready" - a goal that is not on screen is not a goal, and the
   * whole ladder means nothing while the top of it is a number with no face on it.
   * So they are always named, and what changes is the one sentence underneath: you are
   * told how far away they are and told nothing about how to close it.
   *
   * **The button goes to a duel, not to a season and not to the season card.** A duel
   * is one course and two snails and it does not move the season on at all, so it is
   * not on the card where four courses are listed - it is here, under the ladder it
   * belongs to.
   */
  const adv = adversary();
  const gap = adv.rating - state.rating;
  $('openAdversary').textContent = state.beatAdversary ? 'the Adversary · beaten' : 'the Adversary';
  // **two lines and not four**, because this card is `position: absolute` under the
  // snail card and the options bar is `position: fixed` in the corner: a third line
  // here is a third line over the settings button on a 800-pixel window, and the
  // ladder modal is where the long version of this sentence belongs.
  $('adversaryNote').textContent = state.beatAdversary
    ? 'You have had them once. They do not move, and the ladder does not remember.'
    : `They rate ${adv.rating} and are not in the pool — the ladder counts you two apart.`
      + (gap > 0 ? ` ${gap} above you.` : ' Level with you.');
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
    `rating ${state.rating} · ${ordinal(rankOf(state.rating))} of ${state.pool.length + 1}`
    + ` · ${eligibleSeasons(state.rating).length} of ${TIERS.length} open to you`
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
    for (const p of rivals) list.appendChild(rivalRow(p));
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

let ladderOpen = false;
// **and the wardrobe's own flag, for the same reason the ladder has one**: the
// Escape chain at the bottom of this file is an `else if` over four screens in
// order, and a modal with no flag cannot be in it.
let wardrobeOpen = false;

/**
 * The county ladder: the five nearest above you, you, and the five nearest
 * below, out of the whole 64-strong pool. **Rendered on every open, so it is a
 * read of the present and never a copy of it** - a rating moves on every race,
 * and a modal that held the ladder as it was when it was last opened would be
 * the one screen in the county quietly disagreeing with the stable.
 *
 * The note underneath is where the two awkward facts live. A fresh snail is
 * 65th of 65 with nothing below it and nine identical club snails above, because
 * `makePool()` puts the same modest snail on 150 for the first `CLUB_SNAILS` of
 * them and the player's own 10 is below that - which is what the foot of a
 * ladder looks like from the inside, and **the fix for a first game that reads
 * like a wall is a sentence and not a rung**, because `tools/e2e/baseline.json`
 * holds four races' finishing order and times to six decimals against this pool.
 * And a snail level with you shares your number, so it is in neither list.
 */
function renderLadder() {
  const L = ladderAt(state.rating);
  const mine = new Set(seasonRivals().map((p) => p.id));
  $('ladderSub').textContent = `you · ${state.rating} · ${ordinal(L.rank)} of ${L.of}`
    + (L.tied ? ` · level with ${L.tied} other${L.tied === 1 ? '' : 's'}` : '');

  // **The same row builder the field card and the picker use**, because this is
  // the same question answered on a third screen: where does this snail stand,
  // and what is it rated. Each row reads its own rank off the snail it is handed,
  // so five rivals on one rating read as five and not as five consecutive slots.
  const wrap = $('ladderRows');
  wrap.innerHTML = '';
  for (const p of L.above) wrap.appendChild(rivalRow(p, mine.has(p.id) ? 'here' : ''));
  wrap.appendChild(rivalRow({ name: state.name, body: state.body, rating: state.rating, face: state.face }, 'me'));
  for (const p of L.below) wrap.appendChild(rivalRow(p, mine.has(p.id) ? 'here' : ''));

  // **One order and not two, and the note is where the two ways it can repeat
  // live.** The count is one more than how many of the other 64 rate above, and
  // you are one of the 65 - so your row and the row under it can never show the
  // same number on different ratings. What can share a number is a snail on your
  // own rating, which is counted separately and appears in neither list, and the
  // `CLUB_SNAILS` club snails at the foot, all of them on one rating and every
  // one of them the same snail.
  //
  // **And that last number is computed rather than written down**, out of the
  // same curve the pool's ratings came out of. It said `150` literally, because
  // that is what `total * RATING_PER_ATTR` gave for three of five traits - and
  // the rating is now `total ^ RATING_POW * RATING_SCALE`, so the literal was
  // wrong the day that changed and would have been wrong quietly. The nine are
  // `ratingOf(CLUB_ATTR * five traits)`, which is 175, and asking is the only
  // way that number cannot go stale.
  /**
   * **The Adversary's rating is asked for and not written down**, and that is the
   * whole of what the `+ 1` was: `adversary()` already ran nine lines below this
   * one to build the row, and their rating is the pool's best plus the duel entry's
   * `ratingOver`. **Two copies of a number in two files is how the ladder's one
   * unanswerable question came to have two answers** - the stable says "1st of 65"
   * with no rival above it, and the ladder's note has to agree with that.
   */
  const adv = adversary();
  $('ladderNote').textContent =
    `one more than how many of the other ${L.of - 1} rate above you, and you are one of the ${L.of}`
    + ' · two snails share a number only when they are on one rating: a snail level with you stands in neither list,'
    + ` and ${CLUB_SNAILS} club snails share ${ratingOf(CLUB_ATTR * ATTRS.length)} outright`
    + ' · a gold rule down the left is one of your seven'
    + (state.beatAdversary
      ? ' · the devil’s face and horns are yours'
      : ` · The Adversary holds ${adv.rating} and is not on this list, and they are not in it because the ladder counts`
        + ' the pool and them — you meet them on the road');
  /**
   * **The Adversary's own row, and it is not optional.**
   *
   * After a win `rankOf(state.rating)` is 1 and the stable says "1st of 65" with
   * **no rival anywhere above it** — and the ladder has just told the player the
   * count is one more than how many of the other 64 rate above them. Two screens
   * would then be saying different things about the same fact, and the one saying
   * it quietly is the field card.
   *
   * **So they are a row, they are marked `here` when they are above you, and they are not in
   * the ladder's own counts.** They are in `state.pool` for nobody: `adversary()` builds
   * them off the top rival rather than out of the pool, so `L.above`, `L.below` and
   * `rankOf()` are all unchanged and the row is decoration on top of them — which is
   * why it can come and go without touching a single number the ladder depends on.
   *
   * `adv` is the one `adversary()` above the note, and that is the point of it:
   * two `adversary()` calls in one function build two rows off two readings of a
   * pool and two sets of faces, and the only thing that says they cannot disagree
   * is that `adversary()` is pure - which is a thing worth arranging for rather
   * than a thing to rely on.
   */
  const you = document.createElement('div');
  you.className = 'rival adversary';
  you.innerHTML = '<span class="rk">—</span><span class="dot" style="background:#'
    + adv.body.toString(16).padStart(6, '0') + '"></span>'
    + '<i class="f-devil" title="devil face"></i>'
    + '<span class="nm">The Adversary</span><span class="rt">' + adv.rating + '</span>';
  const top = document.createElement('div');
  top.className = 'rival adversary here';
  top.innerHTML = you.innerHTML;
  if (adv.rating > state.rating) wrap.insertBefore(top, wrap.children[0] || null);
  else wrap.appendChild(you);
}
function openLadder() {
  renderLadder();
  ladderOpen = true;
  $('ladder').classList.add('on');
}
function closeLadder() {
  ladderOpen = false;
  $('ladder').classList.remove('on');
}

/* ================================================================== *
 * The wardrobe.
 *
 * **It is a shop and not a settings panel, and the difference is the price on
 * every button.** A panel with a price on it has to be read together with the
 * gold counter, or neither number means anything - and that is why the counter is
 * in the modal's own subtitle rather than left on the snail card behind it.
 *
 * **Everything is a re-render of the same two grids**, not an incremental
 * update. Sixteen buttons and a row of prices: a `renderWardrobe()` that builds
 * them from `FACE_SET` and `HAT_SET` on every open is shorter than any scheme
 * that would keep them up to date, and the table it reads is the same one the
 * rival derivation and the loader's `MESH_SETS` are checked against.
 *
 * **A purchase is gold out and a name in, in that order**, and the save is
 * written once afterwards rather than on every button - so a player who buys four
 * things writes the save once and not four times.
 * ================================================================== */
const ownedHas = (n) => state.owned.indexOf(n) >= 0;
/** What pressing one of these buttons should do, and it is a function so the
 *  buy, the wear, the too-poor and the locked are one `switch` rather than four
 *  `if`s fighting over the same node. */
function wardrobePress(kind, item) {
  if (item.locked) return;                      // the Adversary's; a duel hands them over
  const slot = kind === 'face' ? 'face' : 'hat';
  const worn = state[slot];
  if (ownedHas(item.name)) {
    // **Wearing something you already own costs nothing**, so pressing a worn
    // swatch is a no-op rather than a purchase of itself
    if (worn === item.name) return;
    state[slot] = item.name;
    save();
    applyLook();
    return;
  }
  if (state.gold < item.price) return;
  state.gold -= item.price;
  state.owned.push(item.name);
  state[slot] = item.name;
  save();
  applyLook();
}
function wardrobeNote() {
  const held = state.owned.filter((n) => FACE_BY_NAME[n] || HAT_BY_NAME[n]).length;
  const locked = state.beatAdversary ? 0 : 2;
  $('wdNote').textContent = state.beatAdversary
    ? 'The Adversary’s face and horns are yours, and they are the only two in the county you did not buy.'
    : `you are wearing ${held + 2} of ${FACE_SET.length + HAT_SET.length}`
      + (locked ? `, and ${locked} more are theirs` : '')
      + ' · a face is the whole face and a hat is a silhouette, so the hats are what you read at race distance';
}
function renderWardrobe() {
  $('wdGold').textContent = state.gold;
  const build = (host, kind, set) => {
    host.textContent = '';
    for (const item of set) {
      const b = document.createElement('button');
      // **the class is the glyph and the swatch, and there is no `src`:** the
      // stylesheet draws ten faces and six hats out of gradients and box-shadows,
      // which is the same trick the shell picker's swatches used
      b.className = (kind === 'face' ? 'f-' : 'h-') + item.name
        + (state[kind] === item.name ? ' sel' : '');
      b.title = item.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = item.locked ? (state.beatAdversary ? 'won' : '—')
        : ownedHas(item.name) ? '' : item.price;
      b.append(price);
      // **dimmed is three things and not one**: too poor, or not yours yet, or
      // their. A single `disabled` would take the click away from a thing the player
      // should be told about, and the note at the foot is where the telling is.
      b.disabled = !item.locked && !ownedHas(item.name) && state.gold < item.price;
      b.onclick = () => { wardrobePress(kind, item); renderWardrobe(); };
      host.append(b);
    }
  };
  build($('wdFaces'), 'face', FACE_SET);
  build($('wdHats'), 'hat', HAT_SET);
  wardrobeNote();
}
function openWardrobe() {
  renderWardrobe();
  wardrobeOpen = true;
  $('wardrobe').classList.add('on');
}
function closeWardrobe() {
  wardrobeOpen = false;
  $('wardrobe').classList.remove('on');
}

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
  /**
   * **And the face and the hat, and they have to be in here and nowhere else.**
   *
   * The plinth snail on the stable is built once and lives for the whole session, so
   * a wardrobe change reaches it through this function or not at all: the shop can
   * fill `state.face` and `state.hat`, save them and redraw the swatches, and the
   * snail on the plinth goes on wearing what it had.
   *
   * `mats[0..3]` are still the body, shell, foot and stalk and were left by
   * position on purpose - the face and the hat materials are at `4` and `5`, and a
   * `mats.indexOf` here would be a way to change four working lines.
   *
   * **No `syncGlow()` and no `applyShadows()` on this path, and both were tried.**
   * The glow belongs to the lamps and the shadows row stamps what casts, and the
   * face and the hat stamp their own `gfxCast` where they are built (`makeSnail()`),
   * so both calls were doing nothing for a costume and one of them threw - bare
   * `syncGlow()` is `e.lampGlow` on `undefined`, which is a `TypeError` on the
   * first frame the player presses a shop button.
   */
  st.snail.setFace(state.face);
  st.snail.setHat(state.hat);
  $('bodyColor').value = '#' + state.body.toString(16).padStart(6, '0');
  $('shellColor').value = '#' + state.shell.toString(16).padStart(6, '0');
}

function renderStable() {
  const races = seasonLength();
  $('goldOut').textContent = state.gold;
  $('snailName').value = state.name;
  $('seasonTag').textContent = `season ${state.season} · ${seasonDef(state.tier).name} · rating ${state.rating} · ${ordinal(rankOf(state.rating))} of ${state.pool.length + 1} · ${Math.min(races, state.results.length)} of ${races} raced · ${state.pts} pts`;
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
      (rec ? ` · finished ${ordinal(rec.place)}${rec.points ? ' · +' + rec.points + ' pts' : ''}` : '') + `</div>` +
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
      (rec ? ` · finished ${ordinal(rec.place)} · +${rec.points} pts` : ' · runs last, whatever order you pick') + `</div>` +
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
/**
 * The duel, and it is **one call and one course entry**.
 *
 * `startRace(duelCatId())` is a race with two racers in it, and the course is
 * whichever entry in `races.json` carries a `duel` - which is its own entry in
 * the data rather than a constant here, because the whole of a duel used to be six
 * literals spread over two files and now is one object: the size of the field, the
 * lane share each racer holds, the crates, the countdown, their `attrBonus`, `skill`
 * and `greed`, the two locked wardrobe names, the purse, the rating a win is
 * worth, and the hour it is raced at. **And the course it is raced on is a course
 * in `races.json` like any other**, so it has a name, a shape, a biome and a
 * half-way tower, and the inspector will walk it.
 *
 * **It does not go through `startSeason()` and it does not touch `state.order`.**
 * A duel is not a round, so it must not consume the season's next race: a player who
 * beat the Adversary has still got four courses to run, and a `startSeason()` here
 * would have taken the first of them and put it back at the end.
 */
function challengeAdversary() {
  startRace(duelCatId());
  showRace();
}
$('openAdversary').addEventListener('click', challengeAdversary);

/**
 * An ordinal, whole: 1st, 2nd, 3rd, 4th, and the 21st and the 12th and the 65th.
 * `placeWord()` was the last-digit test and nothing more, which is right for a
 * **place** - they run 1 to 8 and there is no 21st race in the county - and wrong
 * the moment the number beside it is a rank: a ladder to 65 puts the 21st in at
 * 21nd and the 12th at 12nd, on the one screen whose whole argument is that the
 * number can be trusted. So it reads the last digit and the last two, and the
 * places keep the bytes they had.
 */
function ordinal(n) {
  const one = n % 10, two = n % 100;
  const suf = one === 1 && two !== 11 ? 'st' : one === 2 && two !== 12 ? 'nd' : one === 3 && two !== 13 ? 'rd' : 'th';
  return n + suf;
}
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
  applyHourMaterials(TOD);
  renderer.toneMappingExposure = TOD.exposure;
  // **And the lanterns near the eye are not lit here.** This was the second copy of
  // the same block `updateTimeOfDay()` had - the same nearest-sixteen-by-rank, the
  // same tie-break that did not tie - over `freeCam.pos` rather than over the
  // snail, which made a course you were walking light differently from the same
  // course you were racing. It is `litLamps()` in the frame loop, once, and this
  // function's only job with the eye is to move it.
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
  // **The hour is pinned in here and asked for unforced, and the `true` it used
  // to carry was costing a probe a frame.** `openInspector()` clears the cache
  // on the way in, so the first unforced call settles the hour and every call
  // after it returns at the top - which is the guard `force` defeats, and it
  // defeats a second one below it: force also walks the repaint threshold, so
  // the dome, the environment and **every pool's cube probe** were rebuilt on
  // every frame of a walk round a course whose light had not moved a degree.
  // `queueProbes()` puts `probeLast` back to `-1e9` so the first probe after a
  // tier change goes at once, so the pump's 260 ms gate stood open the whole
  // time and `pumpProbes()` spent one per frame - six scene renders and a PMREM
  // each, which on four pools is every pool's cube map four times a second.
  // The general form: **force is for a caller that has changed something the
  // cache cannot see**, and an hour nobody has touched is not that.
  updateTimeOfDay();
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
      `<td><span class="dot" style="background:#${(f.player ? state.body : (state.pool.find((p) => p.name === f.name) || adversary()).body).toString(16).padStart(6, '0')}"></span> ${f.name}</td>` +
      `<td class="tm">${f.time ? f.time.toFixed(1) + 's' : '—'}</td>` +
      `<td class="pts">${f.points || '—'}</td>` +
      // **The rank sits beside the rating and not in the strip**, because the
      // two are the same statement and a screen that showed one without the
      // other is the one place a player would ask where the number came from.
      // `finishRace()` has already rewritten every rating in the pool by the time
      // this runs, so these are the ranks the stable will show for these same
      // ratings - the two screens cannot come to different answers.
      `<td class="rk">${rankOf(f.rating)}</td>` +
      `<td class="rt ${up}" title="${f.wasRating} → ${f.rating} (${move})">` +
      `<span class="was">${f.wasRating}</span> → ${f.rating}</td>`;
    body.appendChild(tr);
  }
  const strip = $('resStrip');
  strip.innerHTML = '';
  const finale = seasonFinaleId(state.tier);
  // **a duel is not a round and is not in the season's strip.** The strip is the
  // season's progress - the four pips and then the marathon - and a duel in it would
  // be a fifth round that the ledger below did not record. It is emptied instead, so
  // the gap says "this was not a season race" rather than showing somebody else's.
  if (!rec.duel) {
    for (const r of state.results.slice(-6)) {
      const el = document.createElement('i');
      el.className = r.place <= 4 ? 'p' + r.place : (r.catId === finale ? 'm' : '');
      el.textContent = ordinal(r.place);
      el.title = CAT_BY_ID[r.catId].name;
      strip.appendChild(el);
    }
  }
  $('resTitle').textContent = rec.duel
    ? (rec.won ? 'The Adversary is beaten' : 'They are still there')
    : (rec.place <= 3 ? ['Winner!', 'Second place', 'Third place'][rec.place - 1] : 'Result');
  $('resSub').textContent = `${CAT_BY_ID[rec.catId].name} · ${Math.round(rec.length)} m · `
    + (rec.duel
      ? `${rec.won ? 'beaten' : 'lost to'} The Adversary · ${clockText(rec.hour == null ? 12 : rec.hour)}`
      : `finished ${ordinal(rec.place)} of ${FIELD} · ${clockText(rec.hour == null ? 12 : rec.hour)}`);
  /**
   * **And the five boxes are a duel's three, not a race's five.**
   *
   * A duel writes no season ledger at all - no `state.pts`, no `state.races`, no
   * season total - so a "season total" and a "points" row on the same screen as a
   * hundred gold would be two numbers for one thing. What a duel has is a purse, a
   * rating and what it unlocked, and the third is the only one of the three the
   * player did not have a number for.
   */
  $('resTot').innerHTML = rec.duel
    ? `<div><div class="k">gold</div><div class="v">+${rec.points}</div></div>` +
      `<div><div class="k">rating</div><div class="v">${state.rating}</div></div>` +
      `<div><div class="k">rank</div><div class="v">${ordinal(rankOf(state.rating))}</div></div>` +
      `<div><div class="k">${rec.won ? 'unlocked' : 'next time'}</div>` +
      `<div class="v" style="font-size:13px">${rec.won ? 'their face, their horns' : 'they do not move'}</div></div>`
    : `<div><div class="k">points</div><div class="v">+${rec.points}</div></div>` +
      `<div><div class="k">gold</div><div class="v">+${rec.points}</div></div>` +
      `<div><div class="k">season total</div><div class="v">${state.pts}</div></div>` +
      `<div><div class="k">rank</div><div class="v">${ordinal(rankOf(state.rating))}</div></div>` +
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
      `<td class="tm">${ordinal(r.place)}</td>` +
      `<td class="pts">${r.points}</td>`;
    body.appendChild(tr);
  }
  const champ = state.pool.slice().sort((a, b) => b.wins - a.wins || b.rating - a.rating)[0];
  $('sumTitle').textContent = state.wins >= 3 ? 'A fine season' : 'Season complete';
  $('sumSub').textContent = `${seasonWord(seasonLength())} races · ${state.wins} win${state.wins === 1 ? '' : 's'} · final rating ${state.rating} · ${ordinal(rankOf(state.rating))} of ${state.pool.length + 1}`;
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
  // **and `duel: null` is on that line** because this function hand-lists every
  // field it is clearing and a field that is not on the list survives a delete -
  // the same argument as the wardrobe two lines below. It was the third thing
  // `race.duel` was wrong about; the other two were fixed by reading it off the
  // course rather than off this object.
  Object.assign(race, { catId: null, tr: null, racers: [], player: null, t: 0, phase: 'idle', result: null, waitAll: false, duel: null });
  $('results').classList.remove('on');
  $('summary').classList.remove('on');
  closeSeasons();
  forgetSeasonFields();
  state.season = 1;
  state.name = 'Wilma';
  state.gold = START_GOLD;
  state.body = 0xe0b183; state.shell = 0xc8a05a;
  // **And the wardrobe**, which is here for the reason the two colour lines are:
  // this function hand-lists every appearance field the game owns, and a field
  // that is not on the list survives a delete. A fresh game would come up with
  // the previous player's horns still unlocked and still on the plinth.
  state.face = 'plain'; state.hat = 'none'; state.owned = []; state.beatAdversary = false;
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
// and Escape closes a modal, which nothing else did: it is only handled in
// the two free-camera modes, so no modal on this page has ever closed on it.
// **Two of them now and not one**, and the test is the order - the options
// answers it, the ladder answers it, and whichever opened last is the one you
// meant to leave.
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (optionsOpen) { e.preventDefault(); closeOptions(); }
  else if (wardrobeOpen) { e.preventDefault(); closeWardrobe(); }
  else if (ladderOpen) { e.preventDefault(); closeLadder(); }
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
$('newSeason').addEventListener('click', openSeasons);
$('pickSeason').addEventListener('click', openSeasons);
$('seasClose').addEventListener('click', closeSeasons);
$('sumNew').addEventListener('click', openSeasons);
$('openLadder').addEventListener('click', openLadder);
$('ladderClose').addEventListener('click', closeLadder);
$('openWardrobe').addEventListener('click', openWardrobe);
$('wdClose').addEventListener('click', closeWardrobe);
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
  // **And the queue beside the count**, because the count alone cannot see a probe
  // being rebuilt every frame: a queue that is refilled above the pump and never
  // empties has the same four probes standing as one that has finished. The
  // inspector's readout is the other end of the same question - `pProbe` prints
  // `probes/queued` off these two numbers.
  get gfx() {
    return { ...gfx, composerUp: chainUp(), needsComposer: needsComposer(),
      probes: courseProbes.length, queued: probeQueue.length };
  },
  setGfx: (k, n) => { setRow(k, n); gfxSave(); markStageDirty(k); renderOptions(); return applyGraphics(); },
  // **The six switches, on their own setter.** `setGfx` reaches them by accident -
  // `setRow()` clamps against a row it cannot find, so an FX key lands on 6 steps
  // instead of the row's own count and every value between 0 and 6 is accepted - and
  // an accidental route to a setting is not a route to ship in a test hook. **The
  // bloom is half of what puts the compositor up**, so a spec that cannot switch it
  // cannot check the border on the one term that is a pass rather than a resample.
  setFx: (k, n) => { setToggle(k, n); gfxSave(); renderOptions(); return applyGraphics(); },
  // **The modal, opened from the test hook rather than by clicking the opt bar.** The
  // compositor border is the only part of the settings panel with a visible state that
  // is not a lit cell, so it is the only part a browser can be asked about - and a
  // `renderOptions()` that quietly stopped drawing the frame would leave every other
  // spec green.
  openOptions,
  
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
    // `msaa` saying x4 and this saying 4 is the row landing, and **the two
    // disagreeing with no chain up is not a fault** - it is the row naming a
    // buffer the frame never had. See `aa` below for what happens on that path.
    samples: composer ? composer.renderTarget1.samples : 0,
    // **The context's own anti-aliasing flag, and the only thing in the frame that
    // says whether the default framebuffer is multisampled.** `getContextAttributes()`
    // reads the attributes the context was *created* with, which is the whole point:
    // this is a boolean no call can change afterwards, and it is why the anti-aliasing
    // row cannot promise a count for the direct path. **It is a flag and not a count
    // because WebGL does not expose the count** - the driver picked it and there is
    // no call that asks. A spec asserting `aa` is the one mechanism a restart is
    // needed to change, and asserting it does *not* move when the row does.
    aa: renderer.getContext().getContextAttributes().antialias,
    // **The chain's own buffer beside the canvas's**, because they are two
    // resolutions that are *meant* to differ and are not allowed to: the canvas is
    // native and the chain is a share of it, and the ratio between them is the
    // render row. Read them against each other, not against the setting.
    rt: composer ? [composer.renderTarget1.width, composer.renderTarget1.height] : null,
    canvas: [renderer.domElement.width, renderer.domElement.height],
    // **How many point lights the renderer is being handed this frame**, counted
    // off the scene it is about to draw and not off `env.lamps`, which is sixteen
    // whatever it is bound to. This is the number three writes `NUM_POINT_LIGHTS`
    // out of and puts in the key of every program in the county, so **the one
    // thing a walk may not change is this one** - and it is here rather than in
    // `lamps()` because a light the camera cannot see is still in the scene's
    // list, so the count a test can see is the count a shader is compiled with and
    // the number of slots with a lamp on them is not.
    pointLights: (() => {
      let n = 0;
      renderScene().traverseVisible((o) => { if (o.isPointLight) n++; });
      return n;
    })(),
    // **A black frame has two causes and they need opposite fixes** - a scene that
    // is genuinely black, or a program that did not compile - and only the second is
    // silent about it. three keeps the log on the program wrapper when
    // `checkShaderErrors` is on, so this is the line that tells them apart, and the
    // `glError` is the flag that says a draw was dropped rather than done. The tell
    // that this is worth having: `gl_FragColor : syntax error` at a tone-map line,
    // with every line above it correct, because the fragment closed `main()` a line
    // early and put the tail at global scope.
    glError: renderer.getContext().getError(),
    // **The program count, and it is here because it is the one counter that can
    // catch a material's leak and `targets` cannot.** `renderer.info.memory.textures`
    // goes up when a render target's texture is first bound and never comes back
    // down: `deallocateRenderTarget()` deletes the GL object and removes it from
    // three's property map, and decrements nothing. So a buffer that outlives its
    // reader is invisible in it. **A program is released by `material.dispose()`**,
    // so a material that outlives its pass is a number that only climbs - and the
    // county's own override material, with two injections on it, is exactly the
    // thing a settings row builds and drops.
    programs: (renderer.info.programs || []).length,
    badProgram: (renderer.info.programs || [])
      .filter((p) => p.diagnostics && !p.diagnostics.runnable)
      .map((p) => `${p.name}: ${(p.diagnostics.fragmentShader || {}).log || p.diagnostics.programLog}`.trim())
      .slice(0, 3),
  }),
  /**
   * **Every buffer in the chain that is not the window's size**, read off the
   * resources themselves and not off the row: the G-buffer, the bounce's flat
   * colour and the reflection mask, beside the county's own resolution.
   *
   * This is the assertion the occlusion ladder change rests on. The ladder used
   * to have a half-resolution cell on it, so the answer was `half` or `not half`
   * depending on which step was set, and a **traced reflection marched against
   * half-res depth breaks against silhouettes** - on a pool the silhouette that
   * matters is the shoreline. A test that asked "is the chain up" would have
   * stayed green through the whole of that. So the question is now a number per
   * buffer, read off the target, and **every cell of the row has to answer the
   * same one**: the first structural regression test in the suite.
   */
  gbuffers: () => {
    const [w, h] = gbuffers();
    const one = (t) => (t ? [t.width, t.height] : null);
    return {
      pixels: [w, h],
      gtao: gtaoPass ? one(gtaoPass.normalRenderTarget) : null,
      flat: flatSize(), mask: maskSize(), maskDepth: maskDepthSize(),
    };
  },
  /**
   * What is reflecting on the standing course - **the register and not a
   * derivation**: `reflectKinds()` is the set the pool builder adds to, so a dry
   * course answers "no water on this course" and a wet one says `pools`. The
   * menu's tooltip prints exactly this string, so a spec can assert the report
   * and the panel from one answer.
   */
  reflect: () => reflectReport(),
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
  /**
   * The sixteen real lights, and the course's lamps they may be standing on, as
   * **the binding and not a re-derivation of it**: `bound` is read off each lamp's
   * own record, which is where `litLamps()` wrote the slot it was given, so a test
   * that watches a lamp across a walk is watching the state and not a second
   * sorting of the same list arriving at the same answer.
   *
   * `at` is `null` on a slot that is off rather than the place it last stood, and
   * that is the whole of why it is `null`: a light that has given its lamp up keeps
   * its last position, so the number is exactly the stale one the glow was drawn
   * at.
   *
   * `on` is the **binding** and `power` is the **light**, and they are two fields
   * because they are two facts: a lamp keeps its slot under a dark hour and stands
   * dark, so a slot can read `on` with a `power` of `0` and that is the hour, not
   * a broken binding. What may not happen is a glow without either - `syncGlow()`
   * asks for both.
   *
   * `posts` is the register's length and it is here because "is every light
   * standing on a lamp" is unanswerable without it - and because the answer was
   * once no: the always-dark spare was one more record at `(0, -999, 0)` and the
   * ranking could not see the nine hundred and ninety-nine metres, so it took a
   * real light slot and stood a kilometre under the county with a glow on it.
   */
  lamps: () => ({
    posts: lampPosts.length,
    bound: lampPosts.filter((l) => l.slot !== undefined)
      .map((l) => ({ slot: l.slot, colour: l.colour, at: l.p.toArray().map((v) => +v.toFixed(2)) })),
    slots: env.lamps.map((l, i) => ({
      i, on: !!env.lampOn[i], glow: env.lampGlow[i].visible,
      at: env.lampOn[i] ? l.position.toArray().map((v) => +v.toFixed(2)) : null,
      colour: l.color.getHexString(), reach: l.distance,
      power: +l.intensity.toFixed(3),
    })),
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
  /**
   * What the green bower put on the last course built, and `null` when there was
   * none. **A bower is a section and not a register entry**, so it does not move
   * `standing()` and would otherwise have no observable at all - and a feature
   * with no observable is a feature with no gate. `tools/e2e/biome.spec.js` asks
   * this for a bower on the two courses that build one and for `null` on the
   * other eight, **and the eight are the half worth having**: `null` there is the
   * assertion that says the biome is doing the work and not the pool.
   */
  bower: bowerReport,
  /**
   * The condition table, read off the page, **and that is the whole reason it is
   * here.** `COND[cond].attr` goes straight into `r.sn.eff[attr]` at `race.js`
   * with nothing between them, so a condition whose `attr` is not a stat gives
   * `NaN` on the first frame of its section and every snail on the course stops
   * dead in the same place with nothing in the console - and **a gate cannot
   * import `src/core.js` to ask about it**, because Playwright's own loader reads
   * a project with no `"type": "module"` as CommonJS and `core.js` has a
   * top-level `await` in it. `tools/plan-test.mjs` can, because node runs it.
   *
   * So the table comes off the page a second way, which is also the better way:
   * **the game is the subject and `core.js` is the thing under test.** One name,
   * beside `bower` and `setsOf`, both of which are the same kind of question.
   */
  cond: () => COND.map((c) => ({ key: c.key, name: c.name, attr: c.attr, base: +c.base.toFixed(3) })),
  /**
   * The set names a set-wearing material is actually running, in order.
   *
   * **`triplanarSets()` drops a set whose map file is missing** - `sets.filter((s)
   * => s && s.map)` - so a surface that declares four sets and gets three files
   * comes up as a three-set material, and `customProgramCacheKey` answers with a
   * key **another material in the county already owns**: `mat.road` losing its
   * third set answers `triplanarSets2Uv`, which is `mat.ledge`'s key, and the
   * road draws with the flank's program, no setts, and nothing anywhere red. The
   * warning the loader now prints is the first half; this is the assertion, and
   * **a set of two on the road is the whole failure in one number.**
   *
   * **It reads the material and not the biome's table**, because the table is
   * what was asked for and this is what was built.
   */
  setsOf: (which) => setsOf(which),
  setHeightsOf: (which) => setHeightsOf(which),

  /**
   * **The biome that is standing, and the four things that went into standing
   * it.** It is here and not on `race` because it is not a race's: a course built
   * for the inspector never set a race, and the biome is whatever was built last.
   *
   * `sets` is the one worth having, because **the whole of a biome's effect on a
   * surface is which program three built and not the one it had cached** - and the
   * failure that causes is a wrong picture rather than a broken one: the key is
   * `triplanarSets3Uv:ashlands`, so a cache that ignored the biome would hand the
   * meadow's program to the ashlands ground and it would come back with the
   * meadow's grain at the meadow's gain. Reading the three keys is the only way a
   * test can tell that apart from a surface that is simply grey.
   */
  biome: () => {
    const b = biomeNow();
    return {
      name: b.name,
      roles: Object.keys(b.surface).map((r) => `${r}=${b.surface[r].key}`),
      // **The sixteen as the object itself and not as a list of `key=name`
      //  strings.** The first version of this hook reported them that way, and a
      //  spec that asked "what colour is `grassA` in the ashlands" got the string
      //  `'grassA=grassA'` and passed it straight into `hex()` — which is the
      //  quiet failure with a stack trace on it, and the reason this is a map.
      pal: b.pal,
      props: b.props,
      far: b.far,
      fog: b.fog,
      barren: !!b.barren,
      sets: {
        course: mat.course.customProgramCacheKey(),
        road: mat.road.customProgramCacheKey(),
        ledge: mat.ledge.customProgramCacheKey(),
      },
      // **and the sixteen, as the numbers the surfaces are actually baking**, which
      // is the only way to catch a `pal` entry naming a colour that is not there:
      // the key would be `undefined` and a warn would have fired at boot, and a
      // missing name is a sixteenth key still holding the last biome's value.
      palNow: Object.keys(PAL_FOR_TEST).reduce((o, k) => {
        o[k] = PAL_FOR_TEST[k].getHexString();
        return o;
      }, {}),
      // and the fog the race env is actually wearing, which is `TOD.fog` times the
      // biome's haze and is the only place in the county a fog is tinted
      fogNow: env.scene.fog.color.getHexString(),
      hills: { near: mat.hillNear.color.getHexString(), far: mat.hillFar.color.getHexString() },
    };
  },
  /** And the hour key a course is raced in, so a test can ask what a duel reads
   *  rather than reading the clock and guessing. */
  raceHourKey: (catId) => raceHourKeyOf(catId),

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
  /**
   * A course, opened to be walked, and **the same entry point the season card's
   * button uses** - so a test walks it the way a player does, off the same
   * `openInspector()`, and a shortcut that only set `mode` would sit a frame
   * short of the code that costs the probes.
   */
  inspect: (catId) => openInspector(catId),
  start: (id) => { startRace(id || nextRaceId() || seasonFinaleId(state.tier)); showRace(); },
  /**
   * A duel, and **the whole of it is the two calls below**: the same entry point
   * the field card's button uses, so a test and a player run the identical path
   * rather than a test-only shortcut that would pass while the button is broken.
   */
  challenge: () => challengeAdversary(),
  /**
   * The wardrobe, opened: `openWardrobe()` and not `renderWardrobe()`, because the
   * test wants the buttons in the document the way a player finds them and a
   * `#wdFaces button` that was never appended is not the shop.
   */
  openWardrobe: () => openWardrobe(),
  /**
   * What the plinth snail is wearing, read off its own face mesh rather than off
   * `state.face` — which is the half of the wardrobe that can be wrong without
   * anything throwing: the state is right, the save is right, and the snail on the
   * plinth is wearing last season's hat.
   */
  plinth: () => {
    const st = stageOf();
    return st && st.snail ? (st.snail.def.face || null) : null;
  },
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
