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
import { CONVERTED, MAPS, SURFACE, allMaps, allParts, mapSlots, mapsFor, slotFor } from './meshes/maps.js';
// The planner is in `src/plan.js` and the courses it plans are `CATS` out of
// `core.js`, so the two things a course needs before anything can be drawn are
// one import apart and not eleven thousand lines.
import { planTrack, MID_CROWN } from './src/plan.js';
// The things standing next to the lane: the half-way tower, the lamps, the
// scatter, the farms, and the backdrop both screens share. The register is
// emptied and read through functions - see `src/scenery.js`'s footer.
import {
  placeMidway, placeLamps, knoll, lampPosts, lampWalk, makeBackdrop, backdrop, gateGroup,
  clearRegister, standingReport, spinFans, fans, mills,
  scatter, propName, partList, populate, populateFarms, farmstead,
  standIt, reserveIt, clearOf, FARM_STEP, FARM_FOOT,
} from './src/scenery.js';

// The lane, the frames and the ground either side of it. `NEST` rides along
// because the surfaces' `groundColumns()` is reading the same twelve metres
// the ground function is.
import {
  buildTrack, trackAt, newFrame, bankRadius, vergeBand, wallProfile,
  groundYAt, groundEdge, farCountry, lanePoint,
  BEND_BASIS, gfxBendReach, NEST, NEST_FRACTION, EDGE_THIRD,
} from './src/course.js';

// The four surfaces, the rows they are laid on, and the half-way mark. The
// ribbon, the skirt, the water and the ground all read the lane through
// `course.js`; the scenery reads all four back out of here.
import {
  laneVertex, roadRows, rowFrame, rampShare, isRock, isFace,
  buildRoad, buildSkirt, buildWater, buildGround,
  groundColumns, groundHalfAt, groundDrawnAt, lineMarks, midwayOf,
  MID_CLEAR, TOWER_FOOT, MID_FLAT, MID_PERCH, WATER_TILE, _fr,
} from './src/surfaces.js';

// The post chain, the settings panel, the readback, the glows and the probes.
// It reads its scenes through `world` and builds none of them - the course and
// the stable that this chain draws are both built further down the graph.
import {
  renderScene, scenePixels, needsComposer, applyGraphics,
  composer, renderPass, applyChainSize, dropComposer, syncComposer,
  setChainScene, chainUp, chainScene,
  drawOverlay, grabWanted, grabPixels, doGrab,
  addGlows, syncGlow, courseProbes, probeQueue,
  dropProbe, dropReflections, queueProbes, pumpProbes, syncProbes,
  STAGE_ROWS, markStageDirty, clearStageDirty, applyRenderScale, gfxCastApplied, applyShadows,
  renderOptions, optionsOpen, openOptions, closeOptions,
} from './src/post.js';

// The jar, the loader and the four injections. One import for all of them,
// because the county has one palette and one set of shaders and a file that
// gave you half of either would be a file to cross-reference.
import {
  props, propMat, propMatFor, snailTemplate, matFor, partMat, loadMeshes,
  mat, detailOf, mapTex, poolWaterMat,
  triplanarDetail, triplanarSets, rippleU,
  colour, PAL, GREEN, STONE, FLOWER_COLORS, BARK, MUSHROOM_RED, MUSHROOM_BROWN,
  gfxU, gfxSurfaceTargets, gtaoWind, windMark, waterFresnel,
} from './src/materials.js';

// The ladder, the renderer, the dome and the hour. The renderer appends its
// canvas here rather than in that module's body, because a module body runs
// before `DOMContentLoaded` and the canvas wants to land after the panels.
import {
  world, gfx, gfxScale, setPreset, setDefaults, setRow, setToggle, gfxSave, gfxLoad,
  RENDER_SCALE, RENDER_SCALE_CAP, SCALE_NAMES, SCALE_TAPS, GFX_STEPS, GFX_ROWS,
  nativePixelRatio, canvasRatio, sceneRatio, needsResample,
  FOG_LADDER, EDGE_LADDER, SHADOW_MAP, SHADOW_RADIUS, SHADOW_CAST,
  PROP_DENSITY, GRASS_DENSITY, SKY_LADDER, AO_LADDER, GI_RADIUS, GI_INNER, GI_THICK,
  REFL_LADDER, REFL_FRESNEL, MSAA_LADDER, MSAA_NAMES, MSAA_PRESET, PRESET_NAMES,
  FX_TOGGLES, FX_KEYS, FOG_MATCH,
  gfxMsaa, gfxEdge, gfxGroundFloor, gfxWideRows, gfxPropDensity, gfxGrassDensity, grassCount,
  gfxSsao, gfxReflSize, gfxReflOn, triesBoost,
  renderer, buildSkyGeo, setSkyGeo, skyGeo, matSky, paintSky, domeToneFix, timeOfDay,
  envPmrem, makeEnv, refreshEnvironment,
  LAMP_LIGHTS, LAMP_SPACING, LAMP_COLOUR,
  raceClock, raceHour, clockText, TOD, WHITE, _todSky,
} from './src/graphics.js';
document.body.appendChild(renderer.domElement);


// The leaf: three.js, the numbers, the tuning and the county's own data. It is
// imported here and not in ten places because every module needs it, and one
// edge is one edge.
import {
  THREE, $, TAU, clamp, lerp, smoothstep, easeInOut,
  CATS, CAT_BY_ID,
  RUN, CLIMB, SWIM, FLY, WALK, PUSH, CLIMB_GRADE, LANE_HW,
  CRATE_S, CRATE_X, CRATE_BACK, CRATE_GAP, CRATE_LANE, CRATE_HW, CRATE_FLARE, CRATE_WALL,
  HOURS_PER_SECOND, LEVEL_Y, POOL_BANK, POOL_SPREAD, POOL_BERM, COND, ATTRS, ELEMENTS,
  STAT_MAX, STAT_MIN, GOLD_PER_FRUIT, START_GOLD, START_RATING, POINTS, FIELD, POOL_SIZE,
  CLUB_SNAILS, CLUB_ATTR, ATTR_MAX, RATING_PER_ATTR, RATING_EASE, RATING_STEP, RATING_PER_WIN,
  SURGE_MULT, SURGE_DRAIN, PASSIVE_DRAIN, TIRED_MULT, SWIM_Y, REGEN, STEP, START_S, freshSnail,
  seasonWord, TIERS, TIER_BY_ID, eligibleSeasons, canEnter, seasonFor, seasonDef,
  seasonScale, seasonPicks, seasonFinaleId, seasonRoster, effFor, effTraits,
  trackSeed, makeRng, rand, vnoise, fbm, hills,
  bake, M, colored,
} from './src/core.js';

/** How many races the season runs, and the one function of the season ladder
 *  that reads `state` - so it did not go with the ladder. All three of its
 *  callers are labels on a HUD element, and `state` is the race's, and a leaf
 *  module that imports the thing nine modules up the graph is not a leaf. */
const seasonLength = (id) => seasonRoster(id === undefined ? state.tier : id).length;


// How many of each, and how big. `grassCount()` went to `src/graphics.js`

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
let _colFor = null, _colCache = null;
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

/* ================================================================== *
 * The race
 * ================================================================== */
const env = makeEnv(78, 300);
const scene = env.scene;
// **Two of the registry's fields, filled here and now rather than by a module
//  further down**, because the chain needs a scene to draw before anything has
//  built a course. They move to `surfaces.js` and `stage.js` with the code that
//  uses them; the writes stay in the same place either way.
world.env = env;
world.scene = scene;
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
  const tr = buildTrack(catId, trackSeed(catId, state.season), seasonScale(state.tier));
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
  // **emptied through a function and not assigned**, because the register is
  // the scenery's and a module's live bindings are read-only from outside -
  // `clearRegister()` is where the two assignments were, and the order below it
  // is unchanged and load-bearing.
  clearRegister();
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
world.stageEnv = stageEnv;
world.stageScene = stageScene;
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
 *  follows it, and `let` rather than `const` for that reason and no other.
 *
 *  `world.stage` is this, and **it is not optional**. `renderScene()` decides
 *  which of the county's two scenes a frame is about by asking whether the
 *  stable is up - and a registry with a null in it answers "no", so a stable that
 *  was never written into it draws the *county's* scene and shows an empty
 *  county: 32 draw calls and 2,750 triangles on the first frame, against 68 and
 *  a full plinth. Every field of `world` that a predicate reads has to be filled
 *  before the first frame, which is the whole condition `app.js`'s import order
 *  exists to provide. */
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
  world.stage = null;
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
    clearStageDirty();
  }, 150);
}
function restage() {
  dropStage();
  stage = buildStage();
  world.stage = stage;
  stageScene.add(stage.group);
  // the snail's colours are not a build parameter - they are a save - so a
  // rebuild has to be handed them again, and `applyLook()` also refreshes the two
  // colour inputs and the style buttons, which is exactly what a rebuild wants
  applyLook();
  gfxCastApplied = null;
  applyShadows();
  syncProbes();
}

/** Set by whichever row changes need a stage rebuild to be visible. The flag
 *  itself is in `src/post.js` with the row that sets it, and `requestRestage()`
 *  clears it through a function rather than an assignment - a module's live
 *  bindings are read-only from outside. */
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
world.stage = stage;    // the frame loop's `renderScene()` reads it, and it is
                        // read on the very first frame
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
