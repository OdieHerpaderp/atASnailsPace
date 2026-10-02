/* ================================================================== *
 * stage.js
 *
 * The stable: your snail on a plinth, slowly turning, in a lawn with a pool
 * and a grove round it. `buildStage()` and `dropStage()`, and the three things
 * that only exist while one of those is standing.
 *
 * **The seed stays at 1177 and the plan says so twice**, because the lawn is an
 * arrangement and re-dealing it on every settings click would shuffle the whole
 * county under the modal. The densities multiply the counts and never the draws,
 * so the same seed at a different count is the same lawn with more or fewer
 * things in it - and that is what makes `geometries` coming back to the same
 * number after four rebuilds a leak test rather than a coincidence.
 *
 * **`stage` is a `let` and only this file reassigns it**, which is the whole
 * reason the rebuild moved in with the build: `buildCourse()` has the same shape,
 * and a `let` handed to another module is a `const` there. So there is
 * `stageOf()` for the two frames and for the snail's colours, and there is
 * `buildStable()` for the boot, which fills `world.stage` and puts the group on
 * the scene itself - **the app asks for a stable and does not assemble one**,
 * because an assembly is three statements and two of them are this file's.
 *
 * It fills three fields of `world`: `stage`, `stageScene` and `stageEnv`. The
 * first is a predicate - `renderScene()` asks whether the stable is up, and a
 * registry with a null in it answers "no" and draws the *county's* scene instead,
 * which is 32 draw calls and 2,750 triangles where there should be 68 and a whole
 * plinth. **Every field of `world` that a predicate reads has to be filled before
 * the first frame**, which is the whole condition the app's import order exists to
 * provide: this file is imported by the app, so its body has run by the time the
 * app's does.
 *
 * `restage()` asks the app for one thing - `world.applyLook()` - and it is a
 * screen, not a rebuild: the two colour inputs and the style buttons are the
 * player's, and so is the half of `applyLook()` that writes them.
 * ================================================================== */
import {
  THREE, TAU, clamp, lerp, bake, M, colored, fbm, vnoise, makeRng,
} from './core.js';
import { world, makeEnv, gfxPropDensity, gfxGrassDensity, WHITE } from './graphics.js';
import {
  props,
  mat,
  matFor,
  partMat,
  detailOf,
  poolWaterMat,
  mapTex,
  triplanarDetail,
  windMark,
  PAL,
} from './materials.js';
import {
  addGlows, applyShadows, forgetCastApplied, clearStageDirty, syncProbes, dropProbe,
} from './post.js';
import { makeBackdrop } from './scenery.js';
import { makeSnail, state, env, SNAIL_SCALE } from './race.js';

/* ================================================================== *
 * The lobby: a lawn, a stone rim, a plinth with a snail on it, a pool with a
 * fountain in it, grass, stones, a grove, palms and a fence
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

/** The stable, and null between a drop and the rebuild that follows it. A
 *  function and not an export, because a `let` handed to another module is a
 *  `const` there and this one is reassigned on every settings row and every boot.
 *  The two frames and `applyLook()` are what ask. */
function stageOf() {
  return stage;
}

/** Put one up. **The whole of the boot in this file is one call to this**, because
 *  a stage is three statements - build it, tell the registry, add the group - and
 *  two of the three were the app reaching into a `let` that is not its to
 *  reassign. The order matters: `world.stage` before the group goes on the scene,
 *  because a frame that lands in between draws the county instead of the hub. */
function buildStable() {
  stage = buildStage();
  world.stage = stage;
  stageScene.add(stage.group);
  return stage;
}

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
  buildStable();
  // the snail's colours are not a build parameter - they are a save - so a
  // rebuild has to be handed them again, and `applyLook()` also refreshes the two
  // colour inputs and the style buttons, which is exactly what a rebuild wants -
  // and it is the app's, because two of those three things are screens
  world.applyLook();
  forgetCastApplied();
  applyShadows();
  syncProbes();
}
// ------------------------------------------------------------------
// The stable's public face. `stageEnv` and `stageBackdrop` are `const` objects
// that are never reassigned, so they are exported as they are; `stage` is a `let`
// and so is a function, and that is the whole of the difference between this
// file and the app's import of it.
//
// The registry's three fields are written where each is built and not here,
// because a field written at the foot of a file is a field whose filling order
// nobody can read - and one of the three is a predicate the first frame asks.
// ------------------------------------------------------------------
export {
  stageEnv, stageBackdrop,
  stageOf, buildStable, dropStage, requestRestage, restage,
};
