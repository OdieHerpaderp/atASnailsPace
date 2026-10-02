/* ================================================================== *
 * race.js
 *
 * The snail, the field of seven, the race itself and the save. Everything that
 * *happens*: a plan becomes a course, a course becomes eight racers, eight
 * racers become a result, and a result becomes a rating.
 *
 * **It owns `state`, and that is what makes it the only module that had to keep
 * something to itself.** Everything in the game reads the save - the season
 * picker, the field, the HUD, the shop - and every other module gets what it
 * needs from `core.js` and `graphics.js` instead, because a file about the race
 * reaching up to the ninth file to ask what the player's rating is would be a
 * cycle drawn by a question. The two things that could not be hoisted are
 * `seasonLength()` and `world.seasonOf()`, both of which are *about* the season
 * and were both written down where they landed.
 *
 * **`buildCourse()` is the ordered argument and it is in this file because the
 * race is the thing that needs it all in one order**: clear the register, put
 * the lamps down, stand the tower, scatter, build the crates, and only then let
 * a snail onto it. `placeLamps()` before `populate()` because the scattered
 * lantern poles read `lampWalk`; the register cleared *before* the tower, which
 * claims its clearing by name; and `buildCrates()` after the scatter because a
 * crate hole is cut by hand into a road that already exists.
 *
* **It fills five fields of `world`, and that is not a favour to the post chain** -
 * it is the shape the graph has. `post.js` is upstream of this file and needs the
 * scene the course is built in, the pools to hang probes off, the course's root
 * and the field's eight for the shadows row; the registry is what both ends can
 * write. `world.shadowRoots()` is the union and lives in `graphics.js` rather than
 * here, because the other half of it is the stable's and a field one module fills
 * is a field the other one clobbers.
 *
 * **And it asks the app for seven things** - the frame clock, the surge button, the
 * hour, and the four screens - because the app is downstream of everything here.
 * `clock` and `surging` are the two that come up in a comment here and nowhere
 * else, and both are reads of a `let` the frame loop owns.
 * ================================================================== */
import {
  THREE,
  TAU,
  clamp,
  lerp,
  $,
  RUN,
  CLIMB,
  SWIM,
  FLY,
  PUSH,
  CLIMB_GRADE,
  LANE_HW,
  CRATE_S,
  CRATE_GAP,
  CRATE_HW,
  HOURS_PER_SECOND,
  COND,
  ATTRS,
  STAT_MAX,
  START_GOLD,
  START_RATING,
  POINTS,
  FIELD,
  POOL_SIZE,
  CLUB_SNAILS,
  CLUB_ATTR,
  ATTR_MAX,
  RATING_PER_ATTR,
  RATING_EASE,
  RATING_STEP,
  RATING_PER_WIN,
  SURGE_MULT,
  SURGE_DRAIN,
  PASSIVE_DRAIN,
  TIRED_MULT,
  SWIM_Y,
  REGEN,
  STEP,
  START_S,
  freshSnail,
  TIERS,
  seasonFor,
  seasonScale,
  seasonPicks,
  seasonFinaleId,
  effTraits,
  trackSeed,
  makeRng,
  rand,
  CAT_BY_ID,
  TIER_BY_ID,
} from './core.js';
// **The hour is not read from here.** It is written by `updateTimeOfDay()` in the
// app, which owns the mode, the camera and the stable's own light, and this file
// asks for it through `world.forceTimeOfDay()` rather than importing a function
// that lives in the one module that imports this one.
import { world, makeEnv, raceHour } from './graphics.js';
import { props, snailTemplate, matFor, partMat, mat } from './materials.js';
import { syncProbes, dropReflections } from './post.js';
import { buildTrack, trackAt, newFrame } from './course.js';
import {
  buildRoad, buildSkirt, buildWater, buildGround,
} from './surfaces.js';
import {
  placeMidway,
  placeLamps,
  lampPosts,
  lampWalk,
  backdrop,
  gateGroup,
  clearRegister,
  fans,
  populate,
} from './scenery.js';/* ================================================================== *
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
// **Three of the registry's fields, filled here and now rather than by a module
//  further down**, because the post chain asks for all three before anything has
//  built a course. `world.env` and `world.scene` are the other two.
world.env = env;
world.scene = scene;
scene.add(backdrop);

const race = {
  catId: null, tr: null, group: null, racers: [], player: null,
  t: 0, phase: 'idle', cd: 3.0, result: null, ripples: null, autoSurge: false,
};
const waterMeshes = [];
// **And the three that ask for the pools, the field and the course's root** -
// what the reflection probes walk and what the shadows row stamps. `world.water`
// is the array itself rather than a copy of it, because `dropCourse()` empties
// and `buildCourse()` refills this one list in place and a copy would be the
// meshes of whichever course happened to be running when it was taken. The two
// arrows read `race` when they are called and so may sit above it; the array
// cannot, which is why these three are here and not with the two above.
world.water = waterMeshes;
world.racers = () => race.racers;
world.raceGroup = () => race.group;

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
  // the hour starts at the beginning of the course's stretch of the day, and
  // the two assignments that used to stand in front of that call are the app's
  // to make - the cache they clear is the hour's, and the hour is written here
  world.forceTimeOfDay();

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
  world.syncHUD();
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
    const age = world.clock() - p.birth;
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
      p.birth = world.clock();
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
      p.birth = world.clock();
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
  ring.birth = world.clock();
  ring.power = power || 1;
  ring.mesh.position.set(fr.p.x + fr.right.x * r.lane, y + 0.02, fr.p.z + fr.right.z * r.lane);
  ring.mesh.visible = true;
}
function updateRipples() {
  if (!race.ripples) return;
  for (const r of race.ripples) {
    const age = world.clock() - r.birth;
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
    if (r.state === 'swim') r.y = r.fr.water - SWIM_Y + 0.05 * Math.sin(world.clock() * 3 + r.wob);
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
  // **and the button is the app's** - the space bar and the on-screen one are
  // wired up in `app.js`, which owns the listeners, and the racer only ever asks
  // whether it is down. `race.autoSurge` is the same question asked by the debug
  // runner, which is why the two are read together.
  if (r.isPlayer) r.surging = (world.surging() || race.autoSurge === true) && !r.spent && r.stam > r.stamMax * 0.08;
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
  r.lane = clamp(r.laneF * (r.fr.w - 0.5) + 0.12 * (1 - open) * Math.sin(world.clock() * 0.5 + r.wob),
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
    if (race.cd <= 0) { race.phase = 'running'; race.t = 0; world.flashGo(); }
    return;
  }
  if (race.phase !== 'running') return;
  race.t += dt;
  markLiveOrder();
  for (const r of race.racers) stepRacer(r, dt);
  placeAll();
  // the race is over when the field is in; you get to watch the rest come in
  if (race.racers.every((r) => r.finished) || race.t > 300) finishRace();
  // ten times a second, which is why it is the app's half that is asked for and
  // not the whole of the HUD: the bar, the speed and the order are screen
  // things, and what decides when to draw them is the clock
  else if (race.t % 0.1 < dt) world.updateHUD();
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
  world.showResults(rec);
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
// ------------------------------------------------------------------
// The race, the field and the save. `race` is the whole object - the
// racers, the crates, the ripples and the effects are all inside it -
// because a race in the county is one thing and it is read as one.
// ------------------------------------------------------------------
export {
  state, race, waterMeshes, env, scene,
  makePool, ratingFor, inTier,
  buildCrates, buildCourse, dropCourse, startRace,
  makeFxPool, buildSurgeFx, takeFx, updateFx, surgeFx,
  buildRipples, spawnRipple, updateRipples, leapShot, flightY, flightPitch,
  markLiveOrder, leapAt, touchDown, stepCrate, standCrate, placeAll,
  stepRacer, stepRace, finishRace, save, load, SAVE_KEY, crateSpanS,
  makeSnail, SNAIL_SCALE, shellFor, NAMES, HUES, STYLES, rndColor, BODY_Y,
  poolByIds, seasonField, forgetSeasonFields, seasonRivals, pickField, drawSeasonField,
  lastSeasonField, crateTopAt, crateMeshY, laneYAt,
};
