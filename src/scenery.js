/* ================================================================== *
 * scenery.js
 *
 * Everything on the course that is a *thing standing next to the lane*: the
 * half-way tower and its knoll, the lamps, the scatter, the farms, and the
 * backdrop the two screens share.
 *
 * **`scatter()` is the placement system and this file is its home**, and the
 * reason it moved out of the world-builder is the reason it is worth its own
 * file: it is the only place in the county that reads *two* files at once - the
 * surfaces for the ground the thing will stand on, and the lane for where
 * beside it is - and **a placement system that lives inside the mesh builder has
 * a mesh builder's idea of what is at a position**. Its `opts` are the contract,
 * and the two that bite are in the header of each option below: `clear` is a
 * minimum distance *out past the waterline* rather than a tolerance inside it,
 * and `tries` is a draw count rather than a placement count.
 *
 * **The register is emptied through a function and read through a function, and
 * neither is because of taste.** `STANDING` and `RESERVED` are `let`s that
 * `buildCourse()` empties before the tower is placed, and a module's live
 * bindings are read-only from outside: an exported `let` cannot be assigned by
 * the module that imports it. So `clearRegister()` empties it - called at the top
 * of `buildCourse()`, which is where the two assignments were - and
 * `standingReport()` reads it, which is what `window.__snail.standing()` now
 * asks. **The order is unchanged and that is the part that matters**: the
 * register is emptied *before* the tower claims its clearing, so the first tree
 * placed sees a clearing already spoken for.
 *
 * `placeLamps()` runs before `populate()` because the scattered lantern poles
 * read `lampWalk` to keep clear of the lamps, and swapping the two puts lanterns
 * double up on the verge. That is a two-line order and it is the whole of what
 * this file's sequence is.
 * ================================================================== */
import {
  THREE, TAU, clamp, lerp, smoothstep, STEP, START_S, makeRng, rand, vnoise, fbm,
  bake, M, trackSeed, BOWER,
} from './core.js';
import {
  world, gfxPropDensity, grassCount, triesBoost, LAMP_SPACING, LAMP_COLOUR, WHITE,
} from './graphics.js';
import { COUNTY as C } from '../meshes/palette.js';
import {
  props, propMat, propMatFor, matFor, partMat, mat, colour, FLOWER_COLORS, windMark,
  biomeNow,
} from './materials.js';
import { trackAt, newFrame, bankRadius, groundYAt } from './course.js';
import {
  laneVertex,
  groundHalfAt,
  groundDrawnAt,
  midwayOf,
  bowerRanges,
  MID_CLEAR,
  TOWER_FOOT,
} from './surfaces.js';/* ------------------------------------------------------------------ *
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
 * because the sixteen lamps that cast real light are bound to from where these
 * are, and a lamp no record in this register stands for is not a lamp.
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
/**
 * The colours a candle lantern is painted, and it is **a different table from
 * the paper lanterns' and the difference is the point of having one**. A paper
 * lantern is a warm cream most of the time because warm cream is what paper is,
 * and the two exceptions on it are read as exceptions. A candle lantern is four
 * panes of clear glass with a flame in the middle: there is no colour in the
 * object at all until somebody chooses one, so a walk of them in five creams is
 * a walk of street lamps in five shirts, and the whole reason to put glass on a
 * stake beside a course is that the verge goes **red, cyan, magenta, green,
 * orange** every twenty metres and the snail is running down the middle of it.
 *
 * They are **sRGB hexes and not names out of the jar**, for the reason the
 * flowers' are: a colour here arrives as an `instanceColor` tint, which
 * multiplies the vertex colours of the glass and the wax underneath it, so it
 * wants the number the lantern is painted in rather than a linear triple that
 * wants converting twice. `LAMP_COLOUR` is the same argument and the same
 * exception - it is a hex for the same reason and it is the colour every
 * *street* lamp is, which is the whole of how the two sorts are told apart at
 * forty metres: one of them is cream and does not change.
 *
 * **And the two creams are not white**, on the county's standing rule: a candle
 * lantern is a hand's width across at race distance and a white one reads as a
 * stone on a stick. They are also two of the seven entries rather than one of
 * five, because a walk of seven different colours is a **fairground** and a walk
 * of five with two ordinary ones in it is a lane somebody lights.
 */
const CANDLE_COLOURS = [
  0xff3a24, 0x2fe0ff, 0xff3fb0, 0x4ce08c, 0xffa32e, 0xfff0c4, 0xfff0c4,
];
function placeLamps(tr, group) {
  const postGeo = props['lamp-post'], glassGeo = props['lamp-glass'];
  const lpostGeo = props['lantern-post'], lglassGeo = props['lantern-glass'];
  const lampHead = glassMid(glassGeo), lanternHead = glassMid(lglassGeo);
  const count = Math.max(2, Math.floor((tr.finish - START_S) / LAMP_SPACING));
  const posts = new THREE.InstancedMesh(postGeo, matFor('lamp-post', mat.rock), count);
  const glass = new THREE.InstancedMesh(glassGeo, matFor('lamp-glass', mat.lampGlass), count);
  const lposts = new THREE.InstancedMesh(lpostGeo, matFor('lantern-post', mat.rock), count * 2);
  const lglass = new THREE.InstancedMesh(lglassGeo, matFor('lantern-glass', mat.lampGlass), count * 2);
  /* ---- the candle lanterns, and they are four meshes and not one ------ *
   * **Four, because the piece is four surfaces and only the first of them is
   * metal.** The frame is converted and wears `metal-albedo`/`metal-n`/
   * `metal-rgh` out of its own file, so it wants `matFor()` - the converted path,
   * which hands back the material the file declared, metalness of one and all.
   * The wax and the flame are `mat.paper` and the panes are `mat.lanternPane`,
   * and all three are named here because the game owns them: the hour drives
   * `mat.paper`'s emissive **by name**, so a wax drawn in the material out of
   * its own file is a grey cylinder that never lights, and a pane is drawn in the
   * game's because glass with nothing of its own to give out is not a material,
   * it is an absence.
   *
   * **Which is also why the light in this one is read off a part that is not the
   * first tinted one**, and it is the only lamp in the county for which that is
   * true. `lampHeadOf()` - the rule for a scattered piece - takes the *first*
   * part that takes the tint, and for this piece that would be the wax: a box
   * from the foot of the candle to the tip of the flame whose middle is forty per
   * cent of the way up fifteen centimetres of wax, so the light lands **inside
   * the candle**. A point light inside a closed lathe gives it nothing at all,
   * because every one of its faces has its normal turned away from it, and the
   * wax is then lit by the moon alone - a red lantern's candle comes out grey.
   * So the light is read off the **flame**, whose own box *is* the flame, and
   * the wax is lit from above by it: the top of the candle hot, the sides
   * barely, the foot dark, which is what a photograph of a lit candle is.
   * `glassMid(cand.flame)` is the local convention the two lines above it
   * already follow, and the four numbers say which part it chose - the flame's
   * box is **1.072 to 1.130 and the wax's is 0.896 to 1.070**, so the light sits
   * fifty-five millimetres above the top of the wax rather than inside it. */
  const cand = props['candle-lantern.parts'];
  const flameHead = glassMid(cand.flame);
  const cframe = new THREE.InstancedMesh(cand.frame, matFor('candle-lantern', mat.metal), count);
  const cwax = new THREE.InstancedMesh(cand.candle, mat.candleWax, count);
  const cpane = new THREE.InstancedMesh(cand.pane, mat.lanternPane, count);
  const cflame = new THREE.InstancedMesh(cand.flame, mat.paper, count);
  for (const m of [posts, glass, lposts, lglass, cframe]) {
    m.castShadow = true; m.frustumCulled = true;
    group.add(m);
  }
  /* **And the other three cast nothing, and each for its own reason.** The wax
   * is a lit object and a shadow off a five-centimetre candle forty metres away
   * is worth nothing while the draw is not; the flame is three centimetres of
   * emissive with no business casting anything at all. The panes are the one
   * that would actually be seen wrong, because a glass box with `castShadow` on
   * it puts **a hard black box the width of the lantern on the verge** - the
   * same class of failure as the chequered band the start line used to be, a
   * rectangle that is a rectangle in *screen* space and is only there because
   * something opaque was drawn where nothing opaque is. The four metres of wire
   * that are genuinely opaque are the frame's, and it casts. */
  for (const m of [cwax, cpane, cflame]) {
    m.castShadow = false; m.frustumCulled = true;
    group.add(m);
  }
  const o = new THREE.Object3D();
  const r = makeRng(trackSeed(tr.catId, world.seasonOf()) ^ 0x5eed);
  const white = new THREE.Color(1, 1, 1);
  const candleCol = new THREE.Color();
  let n = 0, nl = 0, nc = 0;
  /* ---- a lamp stands on the ground and not on the lane's own level ------ *
   * Every lamp here used to be put down at `sm.y`, which is the height of the
   * **centre of the lane** and not the height of the verge two metres out from
   * it, and the two are the same number only where the ground is flat. They are
   * not: measured round the four courses at the offsets the walk actually uses,
   * the difference has a **median of 30 to 60 millimetres and a worst of 630**,
   * and on Lily Deep the 95th percentile is the whole of it - the pools' berms
   * put the verge half a metre above the water while the lane runs along the
   * bottom of it. A lamp post with its foot 63 cm in the air is a lamp post
   * hovering over a pond, and a paper lantern on a pole with 63 cm of its pole
   * underground is a lantern growing out of a bank.
   *
   * `groundYAt(fr, d)` is the number that says where the ground is, and it is
   * the same function the surfaces are built off, so a lamp now stands on the
   * ground that is drawn there rather than on a number that happens to be near
   * it. **It is asked per lamp and not once per station**, because the three kinds
   * in the walk stand at three different offsets - `w + 0.9` and `+ 1.9` for a
   * post, `w + 0.7` and `+ 1.6` for the two lanterns - and on a berm the answer
   * changes by 20 centimetres across that half metre. */
  const standY = (fr, d) => groundYAt(fr, d);
  // one frame for the whole walk, because `groundYAt()` is a function of the
  // frame it is handed and the walk asks it four times a station
  const lampFrame = newFrame();
  // the walk alternates from one side of the lane to the other, so two posts
  // are never standing side by side on the same verge
  let lastSide = r() < 0.5 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const s = START_S + 6 + (i + r() * 0.5) * LAMP_SPACING;
    if (s > tr.finish - 4) break;
    const sm = trackAt(tr, s, lampFrame);
    const side = lastSide;
    lastSide = -side;
    // a post wants its feet on the ground: out past the wet sand, or not at all
    const d = side * Math.max(sm.w + 0.9, bankRadius(sm) + 1.9);
    if (Math.abs(d) > 26) continue;
    o.position.set(sm.p.x + sm.right.x * d, standY(sm, d), sm.p.z + sm.right.z * d);
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
      const sm2 = trackAt(tr, s2, lampFrame);
      const side2 = lastSide;
      lastSide = -side2;
      const d2 = side2 * Math.max(sm2.w + 0.7, bankRadius(sm2) + 1.6);
      o.position.set(sm2.p.x + sm2.right.x * d2, standY(sm2, d2), sm2.p.z + sm2.right.z * d2);
      o.rotation.set(0, Math.atan2(sm2.right.x * side2, sm2.right.z * side2) + (side2 < 0 ? Math.PI : 0), 0);
      o.scale.setScalar(0.9 + r() * 0.25);
      o.updateMatrix();
      lposts.setMatrixAt(nl, o.matrix);
      lglass.setMatrixAt(nl, o.matrix);
      lampPosts.push({ p: lanternHead.clone().applyMatrix4(o.matrix), post: false, colour: LAMP_COLOUR, power: 9, reach: 15 });
      lampWalk.push(s2);
      nl++;
    }
    /* ---- and a candle lantern, further along still ------------------------ *
     * A third of the way along the walk from the paper lantern and **on the
     * other side again**, which is the alternation the walk has run on since the
     * first post: over thirty metres a verge gets one of each and no two of the
     * same. The distance is **13 to 23 metres and not the paper lantern's 8 to
     * 21**, and that is arithmetic rather than taste. The paper lantern stands 8
     * to 21 metres past its post and this one 13 to 23 past *that*, so the two
     * can be as little as 21 metres apart and as much as 44 - and at the 8 the
     * pair came out four metres from the next station's post, which is not three
     * lanterns on a verge, it is one thicket with a gap in it.
     *
     * It goes in at **0.62, the paper lantern's own number and not a higher
     * one**, for the reason 0.62 is there: a verge with three lanterns in twenty
     * metres is a fence of them, and the number that buys three in twenty is not
     * much above 0.6. What puts more lamps on the course than before is not this
     * number - it is that there are now *two* kinds drawing on one slot and only
     * one of them can win it. So a candle lantern stands beside every paper
     * lantern the walk already had, and the density it lands on is **2.24 lamps
     * a station** against the 1.62 it was. */
    if (r() < 0.62) {
      const s3 = Math.min(tr.finish - 4, s + 13 + r() * 10);
      const sm3 = trackAt(tr, s3, lampFrame);
      const side3 = lastSide;
      lastSide = -side3;
      const d3 = side3 * Math.max(sm3.w + 0.7, bankRadius(sm3) + 1.6);
      o.position.set(sm3.p.x + sm3.right.x * d3, standY(sm3, d3), sm3.p.z + sm3.right.z * d3);
      // **and it is turned with its face to the lane**, which nothing else in the
      // walk asks for. This lantern is four panes of glass in a square frame and
      // there is nothing to read it from behind, so the half turn that puts its
      // open side towards the lane is the difference between a lantern lighting
      // the verge and a lantern lighting the field.
      o.rotation.set(0, Math.atan2(sm3.right.x * side3, sm3.right.z * side3) + (side3 < 0 ? Math.PI : 0), 0);
      o.scale.setScalar(0.94 + r() * 0.22);
      o.updateMatrix();
      cframe.setMatrixAt(nc, o.matrix);
      cwax.setMatrixAt(nc, o.matrix);
      cpane.setMatrixAt(nc, o.matrix);
      cflame.setMatrixAt(nc, o.matrix);
      // The frame keeps its own colour and the other three take the tint, which
      // is the split `lanternParts()` makes for a paper lantern and for the same
      // reason: a red lantern would otherwise come with a red stake.
      const hex = CANDLE_COLOURS[(r() * CANDLE_COLOURS.length) | 0];
      cframe.setColorAt(nc, white);
      candleCol.setHex(hex);
      cwax.setColorAt(nc, candleCol);
      cpane.setColorAt(nc, candleCol);
      cflame.setColorAt(nc, candleCol);
      lampPosts.push({
        p: flameHead.clone().applyMatrix4(o.matrix), post: false,
        // **and 3, where the two kinds of lamp in the walk are on 9 and 7.** A
        // point light on a wick is **six centimetres** from the top of the wax
        // and **a metre and a tenth** from the grass it lights, and `decay` of
        // 1.6 puts those **ninety times** apart - so the number is not a
        // brightness, it is a choice about which of the two the lantern is for.
        // At 6 the wax came out five stops over white and the meadow within four
        // metres went the colour of the lamp: a cyan lantern standing in a cyan
        // field, which is the reference's *photograph* and not its object. At 3
        // the glass is still a lit box with the frame showing through it - which
        // is the thing the piece has to be - and the pool on the grass is a pool
        // rather than a flood. The glow sprite carries the halo, as it does for
        // every lamp in the county.
        colour: hex, power: 3, reach: 11,
      });
      lampWalk.push(s3);
      nc++;
    }
  }
  for (const [m, used] of [[posts, n], [glass, n], [lposts, nl], [lglass, nl],
    [cframe, nc], [cwax, nc], [cpane, nc], [cflame, nc]]) {
    o.scale.setScalar(0);
    o.updateMatrix();
    for (let i = used; i < m.count; i++) m.setMatrixAt(i, o.matrix);
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }
  // **And no always-dark spare at the bottom of the list**, which used to be one
  // more record at `(0, -999, 0)` so the nearest-sixteen sort could never come up
  // short. It was ranked by horizontal distance like every other lamp and the
  // ranking does not know about the nine hundred and ninety-nine metres, so a
  // course that came near the world origin gave a real light slot to a lamp
  // parked a kilometre under the county - measured at intensity 1.67 on Hedgerow
  // Dash, ranked third nearest from a camera twenty metres from the start. With
  // the binding held rather than ranked it is worse than useless: a slot that has
  // taken it *keeps* it, so it would hold one for as long as you stood near the
  // origin and no lamp there would ever get a light. It also pushed `o.position`
  // itself rather than a copy of it, so the record's place was the scatter's own
  // scratch vector. A course with three lamps has three lamps, and `litLamps()`
  // asks for a count rather than assuming one.
}

/** Scatter instances along the lane, skipping the water and the running surface. */
/**
 * Scatter a piece along the course. Most pieces are one geometry, but a piece
 * can be made of parts - the paper of a lantern and the frame it hangs on - and
 * then every part is drawn as its own instanced mesh, sharing one set of
 * transforms, so a piece is still placed once and costs one matrix to place.
 * `opts.lamps` is handed back every piece that carries a light, so the few
 * real lights in the world can be bound to, and the binding is held rather than
 * ranked - so a piece placed here has to be told the colour, the power and the
 * reach it wants lit, because those three are read off the record when the light
 * is given and never looked up again.
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

/** Empty the register, and this is a function and not an exported `let` being
 *  assigned because **a module's live bindings are read-only from outside**.
 *  `buildCourse()` opens with it, which is where the two assignments were, and
 *  the order is the whole of it: the register is emptied *before* the tower
 * claims its clearing, so the first tree placed finds a clearing already spoken
 * for. **Four** of these in this split, after `skyGeo`, `gfxStageDirty` and
 * `BOWERS`. */
const clearRegister = () => { STANDING = []; RESERVED = []; DECLINED = 0; BOWERS = null; };
/**
 * What the green bower put on this course, and **why it is here when
 * `standingReport()` is the thing that counts standing pieces.**
 *
 * A bower is a **section** - thirty metres of lane the planner laid down - so it
 * takes no part in the register and moves nothing in the arrangement report.
 * Which means that without this the feature has **no observable at all**, and a
 * gate is an observable: `tools/e2e/biome.spec.js` asks for a bower on `dash` and
 * `marathon`, for `null` on the other three temperate courses and for `null` on
 * all five ashlands - and the last of those is the negative worth having most,
 * because it is the assertion that says the biome is doing the work.
 *
 * `null` is the answer when the biome declined the props or the plan dealt no
 * bower, and **both of those are the same answer to a test**: a course with no
 * bower in it is correct, not broken.
 *
 * A module `let` for the same reason `DECLINED` is one: written by `standBower()`
 * and read by `bowerReport()`, both inside this file, emptied by
 * `clearRegister()`. **Never assigned from outside** - that throws, and quietly.
 */
let BOWERS = null;
/**
 * How many pieces of the arrangement the standing biome **declined** to place.
 *
 * It is a count and not an absence, and that is the whole of it: `populate()`
 * walks a table of every prop the county knows how to scatter and skips the ones
 * this biome has not named, and a skip that is silent is a biome that has quietly
 * stopped declining anything - or one that has started declining everything, which
 * is the failure a user actually sees and which reads as an empty course rather
 * than as a bug. `standingReport()` hands it out beside `pieces`, and
 * `tools/plan-test.mjs --biomes` prints the same two numbers per course so the
 * gate says it rather than a screen nobody opens.
 *
 * It is a module `let` for the same reason `STANDING` is: it is written from
 * `populate()` and read from `standingReport()`, both inside this file, and
 * emptying it is `clearRegister()`'s third job.
 */
let DECLINED = 0;
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

/**
 * A lantern's two surfaces, and **it is a function and not a value** because the
 * parts are per course and the table that places them is built per course: the
 * paper is `mat.paper` and the frame is the material out of the lantern's own
 * file. See the entry in `PLACE` for why the frame is not `mat.vcol` like the
 * piece itself.
 */
function lanternParts(name) {
  const p = props[name + '.parts'];
  return p
    ? [{ geo: p.paper, material: mat.paper, tint: true },
      { geo: p.frame, material: propMat[name] || mat.vcol, tint: false }]
    : [{ geo: props[name], material: mat.vcol, tint: true }];
}

function populate(tr, group) {
  // The register was emptied by `buildCourse()`, before the tower went down,
  // and the order of the rest of this function *is* the order of the arrangement:
  // whatever goes down first is what everything after it has to arrange itself
  // around. The farms therefore go first - a farmstead is a place the country
  // was cleared for and it is not something you drop a giant mushroom into
  // afterwards - and a biome says whether there is one.
  const biome = biomeNow();
  if (biome.farms) populateFarms(tr, group);
  // a chasm is not meadow: nothing roots in the bottom of one
  const offRock = { skip: (sm) => sm.rock };
  /** The band the three giant mushrooms stand in, kept well back out of the lane
   *  and clear of each other and of everything else big - which is not a figure
   *  in these entries but the register in `STANDING`, read off each cap's own
   *  geometry; a mushroom that cannot find room is left out rather than put on
   *  top of something. */
  const mushroomAt = (r) => 26 + r() * 30;
  const LANTERN_COLOURS = [0xffe6bd, 0xffe6bd, 0xffe6bd, 0xf7d7a4, 0xffb9a0, 0xe89ec0, 0xa8e0cf];
  const lanternTint = (r) => LANTERN_COLOURS[(r() * LANTERN_COLOURS.length) | 0];
  /**
   * The arches are found first, as points on the course rather than as anything
   * standing on it, because the poles hung with lanterns have to be kept clear of
   * them as well as of the lamp walk: an arch is a landmark, and a pole standing in
   * front of one hides the thing it is standing in front of.
   */
  let archS = null;
  const archSpots = () => {
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
  };
  /** The arches themselves, which go across the lane square to it, and that you
   *  race under. */
  const standArches = () => {
    const archParts = lanternParts('lantern-arch');
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
  };

  /**
   * The bower's five numbers, and **the arch's own span is one of them** rather
   * than something read off the model: the placement has to know where the feet
   * are to ask the ground under them, and a number read out of a `.glb` at
   * placement time would be a number the model could change under.
   *
   * `BOWER_PITCH` is metres of arc between hoops, which is the scale the density
   * field below is band-limited to. `BOWER_SKIRT` is where the curtain stops over
   * the middle of the road, and §`standBower` says why it has to.
   */
  const BOWER_PITCH = 2.05;    // metres of arc between hoops
  /** **And the span is 5.9 and not the lane's own 5.6**, which is the whole of the
   *  third change: the hoop's feet stand at ±2.95 and the ribbon's edge is at
   *  `sm.w` = 2.8, so **the feet are a hand's width outside the cobbles and not
   *  on them.** They used to stand at ±2.3, which is half a metre *inside* the
   *  road's own edge, and the first picture of that was a green tunnel whose iron
   *  came up through the setts. */
  const BOWER_SPAN = 5.9;      // the hoop's own span; the feet sit at ±2.95
  const BOWER_H = 4.3;         // the crown, and never lower
  /* **And the two counts came down while the leaf got its shape back**, which is
   *  the whole of how this piece was bought. The canopy's leaf was cut from six
   *  outline points to four, and **1.6 M triangles a frame off the course bought
   *  1.0 fps** - a triangle count predicts work and not time, and the bower's
   *  remaining cost is fill. So the outline went back to **five points, which is
   *  the original's own table with one row deleted and nothing moved**, and **the
   *  clusters came down to pay for it**: fewer, fuller leaves spread over both
   *  flanks rather than more of a thinner one crowded onto one.
   *
   *  **Twenty and seven, and the arithmetic that picked them.** At five points the
   *  `mass` is 1620 triangles against the four-point leaf's 1344, so twenty clusters
   *  a rib is `526 * 1620` against `628 * 1344` on `dash` at High - **852 k unique
   *  triangles against 844 k**, level with the four-point build and **28% under the
   *  original's 1.34 M**. Measured: 67.2 fps with the six-point leaf and 628
   *  clusters, 68.2 with the four-point leaf, **68.6 with this** - so the whole of
   *  the decimation is worth about a frame and a half and the canopy is worth
   *  about sixteen times that. */
  const BOWER_MASS = 20;       // leaf clusters per rib, before the density field
  const BOWER_SPRAY = 7;       // hanging sprays per rib, before the density field
  const BOWER_SKIRT = 2.30;    // the curtain stops here, over the middle of the lane
  /** And how wide the clear corridor over the lane is, in metres from the centre
   *  line. **It is 1.85 and not the arch's own half-span, and that was the bug that
   *  kept the whole canopy off the ground.** The guard used to be `|x| < 2.6`,
   *  which is wider than the arch's own 2.3 - so *every* cluster on the bower was
   *  pushed up to the skirt height and **not one leaf came below two and a third
   *  metres anywhere**, which is a pergola. 1.85 is the lane's own 1.4 plus a
   *  snail's height, and the growth comes down outside it to the ground. */
  const BOWER_CLEAR = 1.85;

  /**
   * How thick the canopy is on rib `i`, and **this is a field along the run and
   * not a number**, because the whole of the reference is that its leaves are
   * thick in some places and open in others and the sun comes down through the
   * open places. **Uniform density is a green pipe**: a canopy with no thin place
   * in it blocks everything, and a bower that blocks everything is a tunnel and
   * not a setpiece.
   *
   * Three properties, and each of them is the point:
   *
   * - **A floor of 50% and a ceiling of 125%, and the floor is the number this
   *   got wrong twice.** It was 12% - a number chosen to be safely thick, on the
   *   argument that the opposite failure was a green pipe - and **the opposite
   *   failure is not a green pipe, it is a bald patch**: at 12% a rib carried two
   *   clusters and its neighbour carried twenty, and the canopy came out in
   *   stripes of growth and gaps with bare frame showing through between them.
   *   From above, which is where the eye reads a bower's evenness, it was a bed of
   *   green with holes cut in it.
   *
   *   **The reference is an even cover with places it is thinner, not places it is
   *   absent**, and that is a different shape for the same number: a hundred per
   *   cent of the ribs are roofed and a few of them are thin. **So the field's job
   *   is modulation and not presence**, and the floor is half and the band is a
   *   sixth of a rib rather than a quarter - so neighbouring ribs agree and the
   *   variation shows at the scale of four or five hoops, which is what a mile of
   *   hedge actually looks like. **If a course ever does come out with a gap wider
   *   than about three ribs, raise the floor again rather than reaching for the
   *   mouth taper.**
   * - **On the rib index, and not on `s`.** Two bowers on one course get two
   *   *different* fields rather than one field sampled twice, and two sections of
   *   different lengths do not get the same tunnel twice.
   * - **Three octaves at a sixth of a rib**, so a set is every four or five hoops
   *   rather than a per-rib coin toss and rather than a stripe every second rib.
   *
   * `fbm` is already imported and already used by the country's own ground, so
   * this is four lines and no new edge.
   */
  const bowerDens = (i) => clamp(0.55 + 0.62 * fbm(i * 0.16, 0.5, 3), 0.50, 1.25);

  /**
   * `bowerRanges()` is **`surfaces.js`'s**, and this used to be a second copy of
   * it - forty lines that hunted `tr.sm` for the stretch of plain lane and scored
   * the candidates, which was the right answer by heuristic and the wrong answer
   * by construction: **the planner already guarantees the stretch.** It is twenty-six
   * to thirty-two metres of `BOWER` at the course's own level and width, laid there
   * deliberately, with a footpath either side of it and no hole in it.
   *
   * Two properties come free from the condition list and are worth naming rather
   * than discovering: **the tower and the half-way line already refuse a bower**,
   * because `midwayOf()`'s clear test asks `cond === RUN`; and **a crate cannot be
   * inside one**, because `lay()` separates features with a footpath and the
   * crate's own approach is `PUSH`.
   *
   * **One definition and not three**, and the place it lives is the graph's
   * answer rather than a preference: `buildRoad()` wants it for the setts'
   * weight and `settsShareOf()` is right beside it, and `scenery.js` already
   * imports `surfaces.js`, so a copy here would have been a third list of the same
   * fact - and the kind that falls out of step silently, because a bower standing
   * on a road with no setts under it is a picture nobody can call wrong.
   */
  const ranges = bowerRanges(tr);
  /**
   * The tunnel itself: **one `InstancedMesh` set per range**, because a course may
   * deal two and one mesh spanning both would draw its foliage through the
   * footpath between them.
   *
   * Everything here is modelled line for line on `standArches()` above, and the
   * three lines worth naming are:
   *
   * - **`groundDrawnAt` and not `groundYAt`**, on the lamp paragraph's grounds:
   *   the surface is a polyline and the two agree to a millimetre on the meadow
   *   and not at all out on a berm - and a hoop's feet are four and a half metres
   *   apart, which is exactly the distance a berm is measured over.
   * - **The two feet are asked separately and the instance takes the lower**, so
   *   the high foot's leg sinks into the ground rather than the whole arch lifting
   *   off the ground it is drawn on. The two differ by up to 630 mm.
   * - **The rib count does not scale with the props row and the leaf counts do.**
   *   A bower of eight ribs is not a bower; a bower of eight ribs and four leaves
   *   a rib is the same bower in a thinner hedge. Leaving the multiply off the ribs
   *   would make the props row a lie on every course with a bower in it.
   */
  const standBower = (ranges) => {
    if (!ranges.length) return;
    const archGeo = props['bower-arch'];
    const leafParts = props['bower-foliage.parts'];
    if (!archGeo || !leafParts || !leafParts.mass || !leafParts.spray) return;
    BOWERS = { ranges: ranges.length, ribs: 0, mass: 0, spray: 0, litter: 0, drifts: 0, s: [] };
    const o = new THREE.Object3D();
    const zero = new THREE.Object3D();
    const local = new THREE.Object3D();
    /* **And the five scratch vectors the orientation below needs**, which are
     * module-call scratches rather than per-cluster allocations because a bower
     * places five hundred of them and the frame loop is the one place in the
     * county where an allocation per instance shows up in the average. */
    const UP = new THREE.Vector3(0, 1, 0);
    const radial = new THREE.Vector3();
    const tangentV = new THREE.Vector3();
    const inward = new THREE.Vector3();
    const arcPt = (a, out) => out.set(
      -Math.cos(a) * (BOWER_SPAN / 2),
      BOWER_H * Math.pow(Math.max(0, Math.sin(a)), 0.82),
      0);
    const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
    const away = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    const drape = new THREE.Vector3();
    const spin = new THREE.Quaternion(), tilt = new THREE.Quaternion();
    const basis = new THREE.Matrix4();
    const xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3(), zAxis = new THREE.Vector3();
    const AXIS_X = new THREE.Vector3(1, 0, 0);
    /** The arch's outward normal at angle `a`, taken **numerically** off the curve
     *  the hoop was built from and with its **sign chosen by the point** rather
     *  than by the cross product's order - a curve that turns one way at the
     *  crown and the other at the springing gives a cross product of the wrong
     *  sign on one of them, and half the canopy ends up growing into the road. */
    const outwardAt = (a) => {
      arcPt(a - 0.02, pA); arcPt(a, pB); arcPt(a + 0.02, pC);
      tangentV.subVectors(pC, pA).normalize();
      // both perpendiculars, and the one that points away from the arch's middle
      away.set(pB.x, pB.y - BOWER_H * 0.30, 0);
      n1.set(tangentV.y, -tangentV.x, 0);
      n2.set(-tangentV.y, tangentV.x, 0);
      radial.copy(n1.dot(away) >= n2.dot(away) ? n1 : n2).normalize();
      return radial;
    };
    const ribM = new THREE.Matrix4();
    const leafM = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const range of ranges) {
      const s0 = range.s0 + 1.2;
      const ribs = Math.max(3, Math.round(Math.max(0, range.s1 - s0) / BOWER_PITCH) + 1);
      const arch = new THREE.InstancedMesh(archGeo, propMat['bower-arch'] || mat.rock, ribs);
      arch.castShadow = true; arch.frustumCulled = true;
      // one mesh per density, so the mass is the canopy and the spray is the fringe
      const mass = windMark(new THREE.InstancedMesh(leafParts.mass, mat.foliage, ribs * BOWER_MASS + 4));
      const spray = windMark(new THREE.InstancedMesh(leafParts.spray, mat.foliage, ribs * BOWER_SPRAY + 4));
      mass.castShadow = true; mass.frustumCulled = true;
      /* **And the spray does not cast, which is the one asymmetry in this block
       * and it is the whole of what the two meshes are for.** The mass is the body
       * of the growth: it lies against the arch and against the road, and its
       * shadow is two of the readable things about a bower - the hoop's own shadow
       * across the setts and the shaded underside that says the tunnel goes over
       * you rather than in front of you. The spray is **the long danglers hanging
       * free of the frame**, three clusters to a rib, out in the air a metre or
       * more off anything: **what they lit was nothing**. A three-centimetre leaf
       * 30 m from the nearest surface it can shadow, in a 3072-wide map covering
       * the whole draw distance, is a sub-texel dither on the road - and the pass
       * that draws it is a fourth full rasterisation of the canopy.
       *
       *  **So the spray leaves the shadow map and the mass stays in it**, which is
       *  the half of this worth being careful about: dropping both would take the
       *  tunnel's own shading with it and leave a green pipe lit from every side.
       *
       *  (The litter below is off for the same reason and a different one: it is
       *  lying *on* the ground, so its shadow is inside its own footprint.) */
      spray.castShadow = false; spray.frustumCulled = true;
      let massN = 0, sprayN = 0;
      for (let i = 0; i < ribs; i++) {
        const s = s0 + i * BOWER_PITCH;
        const sm = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
        // **the density is a field along the run and not a number** - see below
        const dens = bowerDens(i);
        // **and the mouths taper**, so the canopy thins and drops away over the
        // last three ribs instead of stopping on a hard edge
        const mouth = i >= ribs - 3 ? 1 - (i - (ribs - 3)) / 3 : 1;
        laneVertex(sm, 0, o.position);
        // the lower of the two feet, so the high one sinks rather than the arch lifting
        o.position.y = Math.min(groundDrawnAt(sm, -BOWER_SPAN / 2), groundDrawnAt(sm, BOWER_SPAN / 2)) - 0.15;
        // square to the lane, so the hoop stands across the road
        o.rotation.set(0, Math.atan2(sm.fwd.x, sm.fwd.z), 0);
        // **and the crown's undulation follows the density**, because a thin place
        // is a taller hoop: the plant has grown over it rather than under it. A
        // canopy whose high points are its gaps is the shape in all three of the
        // references.
        o.scale.set(1, (0.90 + rand() * 0.24) * (0.94 + 0.14 * dens) * (0.62 + 0.38 * mouth), 1);
        o.updateMatrix();
        ribM.copy(o.matrix);
        arch.setMatrixAt(i, o.matrix);
        /* **And the floors are three and one, which are `Math.max` over a field
         *  whose own floor is half** - so on the thinnest rib and at the props row
         *  at its lowest there are still three clusters and a dangler, and **a rib
         *  is never bare.** The first cut's floors of two and one sat under a
         *  density floor of 12% and put a hoop with four leaves on it every fourth
         *  hoop. */
        const nMass = Math.max(3, Math.round(BOWER_MASS * dens * mouth * gfxPropDensity()));
        const nSpray = Math.max(1, Math.round(BOWER_SPRAY * dens * mouth * gfxPropDensity()));
        /* **The rib's own frame, and the cluster is built in it rather than in the
         * world**, which is the whole of §7.8's third change and the reason the
         * growth follows the tunnel instead of hanging off it.
         *
         * `bower-foliage`'s strands run along its own **local -Y**, and the first
         * cut rotated nothing: every cluster on every hoop hung straight down out
         * of the world's sky, so the crown's growth pointed at the ground and the
         * flanks' pointed sideways into the road. `references/tunnel4.jpeg` has
         * runners running **along the surface of the frame** and off it, and a
         * bower whose strands all point at the earth is a weeping willow hung
         * upside down over a road.
         *
         * **So each cluster is placed at its own angle on the arch with its local
         * up turned to the arch's inward normal**, which makes its strands run out
         * of the surface at whatever angle the surface is at: up over the crown,
         * sideways down the flanks, and out and a little down where the arch
         * meets the ground. The tangent is taken **numerically off the same
         * `sin^0.82` curve the hoop was built from**, because a normal from the
         * curve's formula and a normal from the built tube differ by the
         * flattening and the difference is visible at the crown. */
        for (let k = 0; k < nMass + nSpray; k++) {
          const fringe = k >= nMass;
          /* **The crown and both flanks, and the flanks are most of it.** The
           * three references are not a canopy with an arch under it - they are a
           * **tube of green with a frame inside it**, and in `tunnel.jpg` the growth
           * comes down the outside of the tunnel to the edge of the road and the
           * road is a channel cut through it. A bower whose foliage is only on the
           * crown is a pergola, which is the other thing entirely: the first cut
           * reached no lower than a metre and a half, and twenty-six frames stood
           * over an open road like a cattle grid.
           *
* **The angle's exponent and the height's exponent are the whole of it,
           * and they pull in opposite directions.** The angle crowds the roots
           * towards the springing, where the flanks are; the height's `sin^0.62`
           * lifts them as they come, so a flank cluster sits lower on the arch than
           * a crown one at the same angle. Get either of them the wrong way and the
           * growth is all in one place.
           *
           * **Over one crowds the leaves towards the springing**, which is where the
           * flanks are and where `tunnel.jpg` has them: the growth comes down the
           * outside of the tunnel to the edge of the road and the road is a channel
           * cut through it. */
          /* **And "towards the springing" means both of them, which is the one thing
           * a single `pow` on one uniform draw cannot say.** `pow(rand(), 1.7)` puts
           * the mass at small `th`, and `th` is measured from **one** foot, so it
* dealt the crowding to the near flank and spent nothing on the far one:
           *  the tunnel came out **thick on one shoulder and thin on the other**,
           *  and there was an earlier version of the same complaint in this file's
           *  own history - one flank reading as thinner "because the camera was
           *  looking down the inside of the near one", which was the camera being
           *  blamed for the deal.
           *
           *  **So the draw is mirrored before it is bent.** `2u - 1` is uniform over
           *  `-1..1` and `sign(t) * |t|^0.75` pushes it away from the crown towards
           *  *both* ends at once; the exponent is under one, which is the same
           *  direction `1.7` was and the same argument for it.
           *
           *  **And this one is argued from the code and not from a measurement,
           *  because the measurement could not be built.** A plan-view and an
           *  elevation contrast profile of the canopy read 1.13 : 1 and 1.02 : 1
           *  left against right, which put about 5% between the two flanks - and
           *  re-running it with the mirroring reverted gave **the same two numbers
           *  to a tenth**, which is what a metric measuring the scene's own
           *  contrast does when the scene under it barely moves. Luminance
           *  variance down a column of a frame that is mostly road, sky and
           *  meadow is not a measurement of a canopy, and there is no scene handle
           *  on the debug hook to take the canopy's own difference image. **So this
           *  stands on the deal: the old draw put its crowding on one flank and
           *  spent nothing on the other, which is visible in the picture and
           *  arithmetically certain.** */
          const tu = rand() * 2 - 1;
          const th = Math.PI * (0.5 + 0.5 * Math.sign(tu) * Math.pow(Math.abs(tu), 0.75));
          const lx = -Math.cos(th) * (BOWER_SPAN / 2) * (1 - 0.18 * Math.sin(th)) * (0.94 + rand() * 0.18);
          let ly = BOWER_H * 0.96 * Math.pow(Math.sin(th), 0.62) + (rand() - 0.5) * 0.42;
          // **The curtain stops at `BOWER_SKIRT` inside `|x| < 2.6`.** The racing
          // camera's eye is about `g.y + 2.4` and its lateral offset is two to
          // four and a half metres through the middle of a race, so the camera is
          // outside the bower and never inside it - and a canopy that comes down to
          // lane height across the middle of the road is a green tube with a snail
          // inside it and no way to see the tunnel. The gap is the shape.
          // **and the corridor is `BOWER_CLEAR` and not the arch's half-span**, which
          // is the difference between a bower and a pergola - see its note. The
          // skirt also **fades** rather than steps, because a hard line at two
          // metres is a cut edge across the middle of the tunnel and the growth's
          // whole point is that it has no edges.
          if (Math.abs(lx) < BOWER_CLEAR && ly < BOWER_SKIRT) {
            const inRoad = clamp((BOWER_CLEAR - Math.abs(lx)) / BOWER_CLEAR, 0, 1);
            ly = lerp(ly, BOWER_SKIRT, inRoad);
          }
          local.position.set(
            lx,
            ly,
            // **uniform over the whole depth of the run, not a jitter about zero**:
            // a cluster in the plane of its own hoop makes the hoops read as
            // discrete rings marching down the road, and the whole thing reads as
            // arches with leaves on them
            (rand() - 0.5) * 1.9,
          );
          /* **and the cluster is turned so its own up is the arch's inward
           * normal**, which is the number that makes the strands run out of the
           * surface instead of out of the sky. Its strands run along local `-Y`
           * and its root sits at local `+0.46`, so aligning `+Y` with the *inward*
           * normal puts the root just under the surface and the strands out of it
           * - up over the crown, sideways down the flanks, out and a little down
           * where the arch meets the ground.
           *
           * **Then a spin about the normal**, which is what stops a canopy reading
           * as a comb: two clusters on the same hoop at the same angle differ only
           * by which way round they face. And **then a small tilt about the
           * tangent**, because a growth that leaves a frame at a perfect right
           * angle every time is a machine. */
          outwardAt(th);
          /** **The direction a strand leaves this part of the frame, and it is a
           *  blend of the surface's own normal and straight down.**
           *
           *  **Neither half is right on its own, and both cuts were one of them.**
           *  Straight down gave a canopy that is a fringe hanging off the top of
           *  the arch with nothing on its flanks - a pergola, and the first thing
           *  anybody looks at. Straight out along the normal gave the opposite: the
           *  crown's growth shot up into the sky and the flanks' went sideways out
           *  into the meadow, and the whole of it piled into a blob beside the road
           *  with the tunnel open under it.
           *
           *  **The reference drapes.** A runner that grows out of a frame does not
           *  stand out of it: it goes up and over and then falls back, so its
           *  direction is the normal bent towards the ground by gravity and the
           *  bend is bigger the further out it has already got. `w` is that bend -
           *  **and it is scaled by `sin(th)`, which is the whole of it**: a third
           *  of the normal over the crown and none of it down the flanks, so the
           *  crown's growth lifts and then falls in over the road and the flanks'
           *  simply hangs down the outside of the tunnel to the verge.
           */
          drape.set(0, -1, 0).lerp(radial, 0.62 * Math.pow(Math.sin(th), 1.3)).normalize();
          /** **And the basis is built by hand**, because the cluster's local `-Y`
           *  is its strands' direction and `setFromUnitVectors` on an antiparallel
           *  pair picks an arbitrary axis - which is where the first version's
           *  ninety-degree twist came from, three resolves `UP` onto `-UP` by
           *  picking whichever perpendicular it likes and every cluster on every
           *  hoop got a different one. A basis cannot be ambiguous.
           *
           *  `+X` is completed off the tangent, so a strand's own fanning is about
           *  the tunnel's axis and the spin is about local Y after that, which is
           *  the tunnel's axis of symmetry. */
          yAxis.copy(drape).negate();
          xAxis.crossVectors(tangentV, yAxis);
          if (xAxis.lengthSq() < 1e-8) xAxis.crossVectors(radial, yAxis);
          if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
          xAxis.normalize();
          zAxis.crossVectors(xAxis, yAxis).normalize();
          const bend = (rand() - 0.5) * 0.8;
          local.quaternion.setFromRotationMatrix(basis.makeBasis(xAxis, yAxis, zAxis))
            .multiply(tilt.setFromAxisAngle(AXIS_X, bend))
            .multiply(spin.setFromAxisAngle(UP, rand() * TAU));
          local.scale.setScalar((0.85 + rand() * 0.5) * (fringe ? 0.8 : 1));
          local.updateMatrix();
          leafM.multiplyMatrices(ribM, local.matrix);
          const im = fringe ? spray : mass;
          const at = fringe ? sprayN : massN;
          im.setMatrixAt(at, leafM);
          const t = 0.82 + rand() * 0.34;
          c.setRGB(t, t, t);
          im.setColorAt(at, c);
          if (fringe) sprayN++; else massN++;
        }
      }
      for (const im of [arch, mass, spray]) {
        const used = im === arch ? ribs : im === mass ? massN : sprayN;
        for (let i = used; i < im.count; i++) { zero.scale.setScalar(0); zero.updateMatrix(); im.setMatrixAt(i, zero.matrix); }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        group.add(im);
      }
      /* **And the drift**, and it is the floor of the tunnel.
       *
       * `references/tunnel.jpg` has a thick band of brown leaves along both
       * verges and almost none in the middle of the road, and **a bower with green
       * hanging over it and bare ground under it is a pergola over a path.** The
       * drift is also the one thing in the picture that says the growth is old.
       *
       * **It goes on the ground and not on the road**, because a snail runs on the
       * road and a lane half covered in a texture has a condition's worth of speed
       * that the picture does not account for. So every clump is placed outside
       * the lane's own half-width, at `groundDrawnAt()`'s answer for the offset it
       * is actually at - **a berm puts one verge half a metre above the other and
       * the two are asked separately.**
       *
       * **And it is not in `WIND_MATS` and so takes no `windMark()`**, which is the
       * whole of why it is a file of its own rather than a third mesh of the
       * foliage: a dead leaf on the ground that sways is a leaf in the air.
       */
      const litterGeo = props['bower-litter'];
      let litterCount = 0;
      if (litterGeo) {
        const LIT = Math.max(3, Math.round((ribs * 2 * 1.6) * gfxPropDensity()));
        const litter = new THREE.InstancedMesh(litterGeo, mat.vcol, LIT);
        litter.castShadow = false; litter.frustumCulled = true;
        let ln = 0;
        for (let k = 0; k < LIT; k++) {
          // **both sides, and not by a coin toss per clump** - a drift on one side
          // of a lane and bare ground on the other is wind, and this is not wind
          const side = k % 2 ? 1 : -1;
          const s = s0 + rand() * Math.max(1, range.s1 - s0);
          const sm2 = tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
          // **out past the lane's own edge and by a share of nothing at all**, and
          // the share grows with the density field so a thin part of the bower has
          // a thin drift under it
          // **the same density field, read at the rib the clump lands on** - so a
          // thin place in the bower has a thin drift under it and the two halves of
          // the picture agree about where the growth is
          const rib = Math.round((s - s0) / BOWER_PITCH);
          /* **And it laps onto the road, which is the reference.** The drift starts
           * a third of a metre *inside* the ribbon's own edge and runs out to a
           * metre beyond it, so the leaves are on the cobbles' shoulder and on the
           * verge and never in the middle - and `references/tunnel.jpg`'s drift
           * does exactly that, its inner edge cutting across the setts.
           *
           * The snail still runs on bare stone in the middle, which is the point:
           * the litter is a picture and the speed comes off `COND[6]`, and a lane
           * whose whole width is covered in a texture has a handicap the picture
           * cannot account for. */
          const off = sm2.w - 0.34 + rand() * (0.5 + 1.0 * bowerDens(rib));
          const j = new THREE.Object3D();
          laneVertex(sm2, side * off, j.position);
          j.position.y = groundDrawnAt(sm2, side * off) + 0.02;
          j.rotation.set((rand() - 0.5) * 0.2, rand() * TAU, (rand() - 0.5) * 0.2);
          j.scale.setScalar(0.75 + rand() * 0.6);
          j.updateMatrix();
          litter.setMatrixAt(ln++, j.matrix);
        }
        for (let i = ln; i < LIT; i++) {
          j.scale.setScalar(0); j.updateMatrix(); litter.setMatrixAt(i, j.matrix);
        }
        litter.instanceMatrix.needsUpdate = true;
        litter.computeBoundingSphere();
        group.add(litter);
        litterCount = LIT;
      }
      BOWERS.ribs += ribs;
      BOWERS.mass += massN;
      BOWERS.spray += sprayN;
      BOWERS.litter += range.s1 - range.s0;
      if (litterCount) BOWERS.drifts += litterCount;
      // **`.push` and not `+=`.** `arr += [a, b]` on an array coerces it to a
      // string and *appends* it, so two bower sections came back as
      // `"69,94.597.5,123"` — one field, six numbers in it, and the join so
      // accidental that the two spans read as four. `e2e/biome.spec.js` asks for
      // two of them and got one.
      for (const v of [range.s0, range.s1]) BOWERS.s.push(Number(v.toFixed(1)));
    }
  };

  /**
   * The arrangement, as a table, and **the order of the keys is the order of the
   * arrangement and it does not move.** Whatever goes down first is what
   * everything after it has to arrange itself around: the three giant mushrooms
   * go before the trees because a conifer a metre across was claiming its metre
   * before a mushroom six metres across had said anything - twenty-three asked
   * for and five fit is what that cost. `Object.keys()` on string keys is
   * insertion order, so a temperate course's standing is the standing
   * `golden.spec.js` compares against a file captured off the pre-split game.
   *
   * **Twenty-two straight-line `scatter()` calls with no table is what a biome
   * has nothing to hook into**, and this table is the one refactor in that job
   * which is load-bearing for the feature rather than tidied up beside it. A
   * biome wants to say *these props and not those*; with the calls written out,
   * the only way to say that is twenty-two `if`s in one function, which is a list
   * of things not to do wearing the shape of a rule and cannot be checked against
   * a list because there is no list.
   *
   * Five fields an entry carries, and **only five**: `prop` is the name the biome
   * names, `count` is what `scatter()` is asked for, `mat` is the material it is
   * drawn in, `opts` is everything else, and `geo` replaces `prop` for the one
   * piece that is not out of a file. `parts` is derived from `prop` rather than
   * written, because a prop of several surfaces has to be handed over as all of
   * them and `partList()` is the one place that knows how - **and it is a mistake
   * worth naming**: `scatter()` hands back **an array** for a prop that has been
   * given parts, one `InstancedMesh` per part, all of them through the same
   * instance matrix, and `Group.add()` takes an object - so the array has to be
   * spread. Handed over whole it throws a warning and adds nothing at all, and a
   * mushroom that is nowhere in the country is a hard thing to see from the
   * finish line.
   *
   * **Three entries are not scatters, and two of them are one feature split in
   * half.** `arch-plan` and `arch` are the lantern arches, and they are two
   * because the arches' *positions* have to be drawn from the rng **before** the
   * lantern poles are placed - the poles keep clear of them - and the arches
   * themselves are placed after the poles. One table cannot express "in the
   * middle of that", so it says `arch-plan` here and `arch` there, and `archS` is
   * the number in between. **`bower` is the third and needs no such split**: it
   * draws no `rand()` to plan with - the planner laid the section down and
   * `bowerRanges()` reads it back off the samples - so one slot is the whole of
   * it, and it goes last.
   */
  const PLACE = {
    // And the ones the whole valley is named for: giant mushrooms, and they go
    // down **first** of anything that grows, because they are the biggest things
    // in the country by a long way. Three kinds of them: the broad brown one, the
    // pale one of the wet ground with its strands hanging off the rim, and the
    // rooted one with the crown of knobs under its cap. They are the skyline.
    //
    // All three are three surfaces - the stalk, the outside of the cap and the
    // inside of it - so three meshes, each of which is worn by the maps out of its
    // own file's material, because the manifest can only hand a map to a material.
    'mushroom-giant': {
      prop: 'mushroom-giant', mat: 'foliage', count: 16,
      opts: { at: (sm, r) => mushroomAt(r), scale: (r) => 0.8 + r() * 0.8, tilt: 0.05, tint: (r) => 0.84 + r() * 0.3, skip: offRock.skip },
    },
    'mushroom-pale': {
      prop: 'mushroom-pale', mat: 'foliage', count: 9,
      opts: { at: (sm, r) => mushroomAt(r), scale: (r) => 0.85 + r() * 0.75, tilt: 0.05, tint: (r) => 0.86 + r() * 0.26, skip: offRock.skip },
    },
    'mushroom-rooted': {
      prop: 'mushroom-rooted', mat: 'foliage', count: 9,
      opts: { at: (sm, r) => mushroomAt(r), scale: (r) => 0.8 + r() * 0.8, tilt: 0.05, tint: (r) => 0.86 + r() * 0.26, skip: offRock.skip },
    },
    conifer: {
      prop: 'conifer', mat: 'foliage', count: 46,
      opts: Object.assign({ at: (sm, r) => 13 + r() * 30, scale: (r) => 0.8 + r() * 0.8, tint: (r) => 0.82 + r() * 0.34 }, offRock),
    },
    evergreen: {
      prop: 'evergreen', mat: 'foliage', count: 32,
      opts: Object.assign({ at: (sm, r) => 12 + r() * 28, scale: (r) => 0.75 + r() * 0.7, tint: (r) => 0.84 + r() * 0.32 }, offRock),
    },
    broadleaf: {
      prop: 'broadleaf', mat: 'foliage', count: 38,
      opts: Object.assign({ at: (sm, r) => 14 + r() * 26, scale: (r) => 0.75 + r() * 0.7, tint: (r) => 0.85 + r() * 0.3 }, offRock),
    },
    pine: {
      prop: 'pine', mat: 'foliage', count: 40,
      opts: Object.assign({ at: (sm, r) => 12 + r() * 28, scale: (r) => 0.8 + r() * 0.8, tint: (r) => 0.82 + r() * 0.34 }, offRock),
    },
    bush: {
      prop: 'bush', mat: 'foliage', count: 70,
      opts: Object.assign({ at: (sm, r) => 3.2 + r() * 22, scale: (r) => 0.55 + r() * 0.55, tint: (r) => 0.85 + r() * 0.3 }, offRock),
    },
    cactus: {
      prop: 'cactus', mat: 'vcol', count: 18,
      // cacti on the sand shore - they grow where the water meets the land
      opts: Object.assign({
        at: (sm, r) => bankRadius(sm) * (0.9 + r() * 0.6),
        scale: (r) => 0.7 + r() * 0.6, tint: (r) => 0.8 + r() * 0.3,
        shore: true, offLane: 0.5, lift: () => 0.01,
        skip: (sm) => sm.basin <= 0.05, tries: 40,
      }, offRock),
    },
    'cactus-barrel': {
      prop: 'cactus-barrel', mat: 'vcol', count: 12,
      // barrel cacti on the sand shore - round ones that stand in the sand
      opts: Object.assign({
        at: (sm, r) => bankRadius(sm) * (0.9 + r() * 0.6),
        scale: (r) => 0.7 + r() * 0.5, tint: (r) => 0.8 + r() * 0.3,
        shore: true, offLane: 0.5, lift: () => 0.01,
        skip: (sm) => sm.basin <= 0.05, tries: 40,
      }, offRock),
    },
    rock: {
      prop: 'rock', mat: 'rock', count: 64,
      // three draws in ten land against the verge rather than out in the country,
      // which is what a loose stone at the edge of a road actually does
      opts: Object.assign({
        at: (sm, r) => (r() < 0.3 ? sm.w + 0.5 + r() * 1.2 : 3.5 + r() * 24),
        scale: (r) => ROCK_SCALE + r() * 0.34, tint: (r) => 0.85 + r() * 0.3,
      }, offRock),
    },
    // and the mossy ones, which are stones of the wet ground: they stand in the
    // band the pools reach, out in the shallows and on the wet sand, and they are
    // not put in the meadow at all, because a dry mossy stone is a green one. A
    // mossy stone is two pieces of geometry and two materials, so it goes out as
    // both: the frame and the moss share one set of transforms, so it is placed
    // once and costs one matrix to place.
    'mossy-rock': {
      prop: 'mossy-rock', mat: 'rock', count: 30,
      opts: Object.assign({
        at: (sm, r) => bankRadius(sm) * (0.88 + r() * 0.28),
        scale: (r) => ROCK_SCALE * 1.15 + r() * 0.3, tint: (r) => 0.88 + r() * 0.28,
        shore: true, inWater: true, offLane: 1.0, lift: () => 0.01,
        skip: (sm) => sm.basin <= 0.05, tries: 30,
      }, offRock),
    },
    // and the bottom of one is where the loose stone collects: broken rock strewn
    // about the floor, including out in the middle of it. **It is the one entry
    // that keys off something other than its own prop**, because it is a second
    // band of the same stone in the same biome and the biome says "rock", not
    // "rock, twice".
    'rock-chasm': {
      prop: 'rock', mat: 'rock', count: 40,
      opts: {
        at: (sm, r) => 0.3 + r() * (sm.w + 2.4), scale: (r) => ROCK_SCALE * 0.8 + r() * 0.34, tilt: 0.6,
        keep: (sm) => sm.rock, tint: (r) => 0.80 + r() * 0.34,
      },
    },
    // and the grass is thick: it is the ground the whole country is made of
    tuft: {
      prop: 'tuft', mat: 'grass', count: grassCount(),
      opts: Object.assign({
        at: (sm, r) => sm.w + 0.25 + r() * 13, scale: (r) => 0.5 + r() * 0.8, shadow: false, tilt: 0.14,
      }, offRock),
    },
    // **The one entry with no `prop`**, and it is a `geo` thunk rather than a
    // shared geometry on purpose: `dropCourse()` disposes the geometry of every
    // mesh it tears down that is not marked shared, so a module-level icosahedron
    // would be a disposed buffer the second course tried to draw with. Every
    // `props.*` geometry is marked shared by the loader; this one is made here and
    // so it belongs here.
    flower: {
      geo: () => new THREE.IcosahedronGeometry(0.075, 0), mat: 'flower', count: 120, prop: 'flower',
      opts: Object.assign({
        at: (sm, r) => sm.w + 0.5 + r() * 11, scale: (r) => 0.7 + r() * 0.8, shadow: false,
        tint: (r) => FLOWER_COLORS[(r() * FLOWER_COLORS.length) | 0],
      }, offRock),
    },
    // Mushrooms, in the grass at the side of the lane: the red ones in a clump
    // where they turn up, the brown ones scattered through, which is how both of
    // them actually grow.
    'mushroom-red': {
      prop: 'mushroom-red', mat: 'foliage', count: MUSHROOM_COUNT,
      opts: Object.assign({
        at: (sm, r) => sm.w + 0.5 + r() * 5.5, scale: (r) => 0.7 + r() * 0.6, shadow: false, tilt: 0.18,
        tint: (r) => 0.88 + r() * 0.22,
      }, offRock),
    },
    'mushroom-brown': {
      prop: 'mushroom-brown', mat: 'foliage', count: MUSHROOM_COUNT,
      opts: Object.assign({
        at: (sm, r) => sm.w + 0.4 + r() * 7, scale: (r) => 0.75 + r() * 0.7, shadow: false, tilt: 0.14,
        tint: (r) => 0.86 + r() * 0.26,
      }, offRock),
    },
    marker: {
      prop: 'marker', mat: 'rock', count: 34,
      opts: { at: (sm, r) => sm.w + 0.95 + r() * 0.5, scale: (r) => 0.62 + r() * 0.26, tilt: 0.1 },
    },

    // Paper lanterns, hung on poles beside the lane and on a few arches thrown
    // over it. They are dark by day and burn from within once the hour asks for
    // them, each in the colour it is painted - the warm cream of most, a red one
    // or two, and now and then a pink or a green. The few of them near the snail
    // are the ones that cast real light, so the verge goes the colour of whatever
    // lantern is closest to it.
    //
    // The paper of a lantern is `mat.paper` and always will be: the hour drives
    // that material's emissive by name, and a paper drawn in the material out of
    // its own file has no emissive for the hour to touch, so it is a paper lantern
    // that is dark at midnight. The frame is a different matter - nothing lights
    // it by name - so the frame is drawn in the material out of its own file and
    // wears its own grain.
    //
    // The order of the two arches is the file's: paper first, and the first part
    // is the one the loader names `props[name]`, which is what a prop of one part
    // falls back to. And `lanternParts()` is a function rather than a value
    // because the table is built once per course and the parts are per course -
    // they are the same, but building them here says so.
    'arch-plan': { prop: 'lantern-arch', kind: 'arch-plan' },
    'lantern-pole': {
      prop: 'lantern-pole', mat: 'vcol', count: 26,
      parts: () => lanternParts('lantern-pole'),
      /**
       * **`opts` is a thunk here and a value in every other entry, and that is the
       * one place the table cannot hold its own answer.**
       *
       * The poles keep clear of the arches, and the arches' places are drawn from
       * the rng by the `arch-plan` entry *above* - so an options object written out
       * as a value here would be built when the table is built, before that entry
       * has run, and `avoid: lampWalk.concat(archS)` would concatenate **`null`**
       * instead of the arches: a pole list one entry longer, none of it an arch.
       * **And that is a number of poles and not a wrong picture**, which is the
       * whole of the hazard - three of the five baseline courses came back with
       * fewer lantern poles than the pre-split capture had, the two without water
       * did not, and there was no error anywhere in the county. `golden.spec.js`
       * found it and nothing else could have.
       *
       * So the walker resolves a thunk at the point it places, and by then the
       * arches are known. The general form is **one table cannot express "in the
       * middle of that"**, and the two half-entries either side of this are what it
       * costs.
       */
      opts: () => ({
        at: (sm, r) => sm.w + 0.7 + r() * 3.4,
        scale: (r) => 0.85 + r() * 0.5, tilt: 0.03, tint: lanternTint,
        lamps: lampPosts, lampPower: 7, lampReach: 12,
        // a pole wants ground to stand on: no rock face, and no standing in a pool
        skip: (sm) => sm.rock || sm.basin > 0.05,
        // and a pole wants room: a lantern is a landmark, and two of them within
        // sight of each other stop being landmarks and start being a row. The walk
        // of lamps is only held at arm's length rather than kept well clear, or a
        // course that is mostly water has nowhere left to put a pole at all.
        minGap: 13, avoidGap: 5, avoid: lampWalk.concat(archS), tries: 160,
        // and the arrangement is told a pole's real size, which is the thickness
        // of a post. Left to its own geometry it is measured by the reach of its
        // lantern arm - two and a half metres - and a pole is two and a half metres
        // of air with a post in the middle of it. Its spacing is the `minGap`
        // above, which is the number that matters: thirteen metres, because a
        // lantern is a landmark and two of them in sight of each other are a row.
        r: 0.8,
      }),
    },
    'arch': { prop: 'lantern-arch', kind: 'arch' },

    // and the flowers themselves, standing out of the same water on their own
    // short stems. A plant that grows in a pool is given `inWater`, like the pads:
    // without it the `clear` rule asks for a berth out past the waterline, and a
    // range offered inside the pool is thrown away every time.
    lily: {
      prop: 'lily', mat: 'foliage', count: 56,
      opts: {
        at: (sm, r) => sm.w + 0.6 + r() * Math.max(0.2, sm.basin - sm.w - 1.2), scale: (r) => 0.7 + r() * 0.9,
        shadow: false, onWater: true, inWater: true, offLane: 0.6, shore: true, tint: (r) => 0.9 + r() * 0.2,
        tries: 40,
      },
    },
    // and the pads floating on the same water: a flower's own leaf, with the
    // notch in it and another flower open on it, lying flat on the surface. They
    // sit a little proud of it, or the water draws over them, and they are given
    // right out into the open water, so a pool reads as planted rather than bare.
    'lily-pad': {
      prop: 'lily-pad', mat: 'foliage', count: 76,
      opts: {
        at: (sm, r) => sm.w + 0.9 + r() * Math.max(0.2, sm.basin - sm.w - 1.6), scale: (r) => 0.7 + r() * 0.9,
        shadow: false, onWater: true, inWater: true, offLane: 0.9, shore: true, lift: () => 0.022,
        tint: (r) => 0.88 + r() * 0.24, tries: 40,
      },
    },
    // The wet band is its own small world: sugar cane in the shallows and on the
    // wet sand, and shells left on the sand. Both only ever appear where there is
    // water, and nothing else does.
    reeds: {
      prop: 'reeds', mat: 'foliage', count: 54,
      opts: {
        at: (sm, r) => bankRadius(sm) * (0.74 + r() * 0.34), scale: (r) => 0.9 + r() * 0.8,
        tilt: 0.05, shadow: false, shore: true, inWater: true, offLane: 0.8,
        lift: () => 0.03, skip: (sm) => sm.basin <= 0.05, tint: (r) => 0.88 + r() * 0.26, tries: 40,
      },
    },
    seashell: {
      prop: 'seashell', mat: 'vcol', count: 34,
      opts: {
        at: (sm, r) => bankRadius(sm) * (0.9 + r() * 0.5), scale: (r) => 1.1 + r() * 0.9,
        tilt: 0.5, shadow: false, shore: true, inWater: true, offLane: 0.8,
        lift: () => 0.02, skip: (sm) => sm.basin <= 0.05, tint: (r) => 0.9 + r() * 0.2,
      },
    },

    /* ---- the ashlands, and the same table walked by a second biome ------- *
     * A biome says *these props and not those*, so the entries below only have to
     * say what a piece is and where it stands. **They do not say what a biome they
     * belong to**: a prop is in the ashlands because `meshes/biomes.js` names it,
     * which is what makes `plan-test.mjs --biomes` able to fail on a name that
     * resolves to nothing instead of twenty-two `if`s nobody can walk.
     *
     * The five big ones come first for the same reason the mushrooms do in the
     * meadow: whatever goes down first is what everything after has to arrange
     * itself around. An `ash-tree` is four to seven metres, a `snag` is five, a
     * `basalt-column` is up to five and an `ash-fallen` is four lying down, and a
     * tuft that lays down first in the metre a column wants is a tuft that had
     * nowhere to go.
     *
     * **And there is no `rock` entry here, and there was one, and it was the worst
     * mistake in this table.** A second band of the county's own stone, drawn at
     * the ashlands' count and out of the same place as the first, reads in a
     * biome's `props` list as though it were a *different* prop - and it is not:
     * `rock` is one name and a biome that names it gets **every slot that prop
     * fills**. So the second band ran on the meadow as well, drew sixty times
     * further down the shared rng than it should have, and the next thing to read
     * that rng - the lantern poles' keep-clear list - came out two poles short on
     * the three courses with water in them and exactly right on the two without.
     * `golden.spec.js` found it; nothing in the county would have, because a few
     * lamp posts is not a visible difference.
     *
     * **A barren place is not a bare one, and scree collects at the foot of
     * anything that stands up - but the scree is the `rock` the meadow already
     * has.** The same prop, the same count, the same reason, from the shared slot.
     *
     * `vent` is a fumarole - a cracked cone with a dark throat - and it is the one
     * piece in the biome that is not grey, which is why it is placed where it is:
     * out on its own in the country with room round it, where the one hue in the
     * ashlands is something to walk towards. **It is not placed on the lane's own
     * shoulder**, because a place that smells of sulphur at two metres reads as a
     * hazard the player is being asked to race past.
     *
     * `obsidian-shard` is the reason a barren biome is worth standing in: it is
     * the one shiny thing in the county, and it is placed low and against the
     * bigger rock so the shards cluster at the foot of something rather than
     * standing about on their own like ornaments.
     *
     * **And the three that came after them are what a `declined` looks like when
     * nobody counts it.** `bush` was declined here with nothing standing in its
     * place, and the tell is not a picture: `PLACE`'s shape is the same and the
     * biome's is the same, and what an ashlands course was short of was a whole
     * band of country between the tufts and the trees. **A prop a biome declines
     * and a band nothing else fills are the same gap**, and only one of them says
     * so out loud - which is why the declined count is a number on a screen and
     * not a thing somebody is supposed to notice.
     */
    'ash-tree': {
      prop: 'ash-tree', mat: 'foliage', count: 22,
      opts: Object.assign({
        at: (sm, r) => 16 + r() * 32, scale: (r) => 0.7 + r() * 0.7, tilt: 0.09,
        tint: (r) => 0.86 + r() * 0.26,
      }, offRock),
    },
    /** `snag` goes **second, and before the columns, and for the only reason the
     *  order of this table is an argument at all**: it is five metres of mast and
     *  it is the biggest thing in the country that a snail can see the whole of, so
     *  it claims its ground before a column lays down the one it wants. It is
     *  placed at the `ash-tree`'s own distance and radius because it is the same
     *  tree - **and it is placed at a smaller `r` than its height would suggest,
     *  because `r` is the radius of a clearing and a snag is thirty centimetres
     *  across**: a mast that reserves five metres of ground for itself is a mast
     *  in a wood of its own, and the whole of what the piece is for is that the
     *  ash-trees and the snags stand close enough to read as one burnt wood. */
    snag: {
      prop: 'snag', mat: 'foliage', count: 14,
      opts: Object.assign({
        at: (sm, r) => 13 + r() * 30, scale: (r) => 0.75 + r() * 0.65, tilt: 0.07,
        tint: (r) => 0.84 + r() * 0.28, r: 0.55, tries: 40,
      }, offRock),
    },
    'basalt-column': {
      prop: 'basalt-column', mat: 'rock', count: 34,
      // **A column is a thing you can walk round, and it wants more room than its
      // own footprint asks for**: `r` is the radius of the clearing it claims, and
      // a group of them standing shoulder to shoulder is what columnar basalt
      // looks like, so it is held at a hand's width beyond its own reach.
      opts: Object.assign({
        at: (sm, r) => 4.5 + r() * 26, scale: (r) => 0.7 + r() * 0.8, tilt: 0.07,
        tint: (r) => 0.88 + r() * 0.22, r: 1.5, tries: 40,
      }, offRock),
    },
    /** `ash-fallen` is a **four-metre log lying down**, and the two numbers that
     *  make it work are both about lying down rather than standing. It is nearer
     *  the lane than anything else in the biome, because a trunk on its side is
     *  the one piece here a snail can walk round - and it claims **`r: 2.2`**,
     *  which is its own *length* and not a clearing: a log placed at the columns'
     *  `r` has other logs growing out of its middle, and a log with another log
     *  across it stops being a tree that came down. */
    'ash-fallen': {
      prop: 'ash-fallen', mat: 'rock', count: 12,
      // **`mat.rock` and not `mat.foliage`, and the reason is the wind list rather
      //  than the vertex colours**: both carry `vertexColors` and both are on it,
      // and the wind bends on `max(transformed.y, 0)`, which for a scattered piece
      //  is the height above its own origin. A trunk lying flat has its whole
      //  silhouette under a metre and would breathe; an `ash-tree` stands five
      //  metres up and wants to. `mat.rock` is the county's other vertex-coloured
      //  dielectric and it is off the wind list.
      opts: Object.assign({
        at: (sm, r) => 6 + r() * 26, scale: (r) => 0.8 + r() * 0.5, tilt: 0.04,
        tint: (r) => 0.86 + r() * 0.24, r: 2.2, tries: 50,
      }, offRock),
    },
    /** **`ash-scrub` is the biome's `bush`**, and `bush` is declined here, which
     *  had left an ashlands course with nothing at all between the ankle-high tufts
     *  and the five-metre trees - nine metres of bare ground, which reads as an
     *  oversight rather than as a decision. It is placed at the `bush`'s own
     *  distance band (3.2 to 25.2) and its own count (70), because a scrub is a
     *  scrub. */
    'ash-scrub': {
      prop: 'ash-scrub', mat: 'foliage', count: 70,
      opts: Object.assign({
        at: (sm, r) => 3.2 + r() * 22, scale: (r) => 0.55 + r() * 0.6, tilt: 0.12,
        tint: (r) => 0.86 + r() * 0.26, r: 0.6,
      }, offRock),
    },
    'ash-tuft': {
      prop: 'ash-tuft', mat: 'ashFoliage', count: grassCount(),
      opts: Object.assign({
        at: (sm, r) => sm.w + 0.25 + r() * 13, scale: (r) => 0.5 + r() * 0.8, shadow: false, tilt: 0.14,
        tint: (r) => 0.84 + r() * 0.28,
      }, offRock),
    },
    vent: {
      prop: 'vent', mat: 'rock', count: 9,
      // **Well out and well clear.** A fumarole is a place somebody would put a
      // warning board, so it is at least eight metres off the verge and it claims
      // its own radius: two of them together is one wide crack and the pair of
      // them read as a mistake.
      opts: Object.assign({
        at: (sm, r) => 9 + r() * 24, scale: (r) => 0.7 + r() * 0.6, tilt: 0.05,
        tint: (r) => 0.9 + r() * 0.2, r: 1.9, minGap: 22, tries: 50,
      }, offRock),
    },
    'obsidian-shard': {
      prop: 'obsidian-shard', mat: 'rock', count: 26,
      // **Low, and against something.** A shard standing alone in the open is an
      // ornament; a shard at the foot of a column is a piece of the thing the
      // column broke off. The band is the same one the ash scree uses and the
      // `r` is smaller, because a shard is small enough to crowd with its
      // neighbours - which is the arrangement.
      opts: Object.assign({
        at: (sm, r) => sm.w + 0.8 + r() * 9, scale: (r) => 0.5 + r() * 0.9, tilt: 0.3,
        tint: (r) => 0.92 + r() * 0.16, r: 0.9, tries: 40,
      }, offRock),
    },

    /**
     * **And the cherry, one slot in from the end, and where it sits is a decision
     * with a cost in it.**
     *
     * **Not with the other trees**, which is where the arrangement would put it on
     * the biome skill's own argument - a conifer a metre across claims its metre
     * before a six-metre mushroom has said anything. The argument does not carry
     * here, because **the gate is `golden.spec.js` and a prop that joins the middle
     * of the walk moves every `rand()` drawn after it**: conifer, evergreen and
     * broadleaf would all be re-dealt on five of the five baseline courses, and the
     * standing report would come back a different set of counts for no reason
     * anybody could name. So this slot is **last but one**, which moves the bower's
     * own leaf draws and nothing else - and the bower touches no register, its
     * positions come out of the plan rather than out of `rand()`, and its litter
     * length is a plan number too, so the half of the gate that compares the
     * standing and the half that compares the sim are both untouched. **A new prop
     * in this table is a `rand()`-stream event and the cheap place for it is the
     * end**, and the cost of that is one tree's neighbours being decided after it.
     *
     * **Eight in the meadow and four in the ashlands, read off `noGreens`**,
     * which is the biome's own statement that nothing green is alive in it. A pink
     * tree in a burnt valley is a survivor: eight of them on a course is a stand
     * and four is four things that lived. It is a proxy rather than a name, and
     * **the day a third biome arrives this is the first number it has to be told**,
     * because nothing else in the county will ask it.
     *
     * **Four and not two, and `scatter()`'s own floor is why**: `want` is
     * `Math.max(4, ...)` of the count, so nothing in the county is ever asked for
     * fewer than four and a `count: 2` here would place four. The four is written
     * down so that the number in this table is the number that happens.
     *
     * **And `scale` is a function of the biome too, and it is doing the half of the
     * contrast the count cannot.** Four in the ashlands and four in the meadow
     * would be the same statement made twice, so the ashlands' four are **half the
     * size**: three to four and a half metres of a young survivor rather than a
     * five-metre specimen. A burnt valley with a stand of full-grown cherries in it
     * is a meadow with the colour left out, and the thing that says *survivor* is
     * the height and not the number.
     *
     * **And the eight is a ceiling and not a target.** This prop was at eleven when
     * it was written, and eleven of it put the county's lamp walk in
     * `tools/e2e/smoke.spec.js` **over its five-minute ceiling** - a spec with two
     * circles of the inspector's eye in 121 steps each, on a software rasteriser,
     * and with a two per cent margin between a pass and a timeout measured here.
     * The model's own vertex count is in `meshes/build-scenery.html`'s `cherryTree()`
     * note, and it is smaller than the broadleaf's; **what this slot's `count` and
     * the piece's tessellation have to hold between them is the county's whole
     * per-course vertex budget**, and the count is the number that is easy to move.
     *
     * **And it is the only tree in the county with `minGap` and `r` written down.**
     * Every other one takes what it can get, and on the four temperate courses a
     * cherry came back on **five of the eleven asked for** at a 26-metre spacing:
     * eleven gaps of twenty-six metres is two hundred and eighty-six metres of
     * course and the longest of them is two hundred and one, so the arrangement was
     * being throttled by a number rather than by the ground. `r` is on the register
     * for the other half of the same problem - the register reads a piece's radius
     * off its own geometry, which on a weeping crown is the width of the widest
     * pair of limbs *plus* the fringe hanging off the far side of them, so the
     * ground it claims is about a metre more than the ground it stands on and on a
     * narrow course it never places at all. Two and a third is the crown's
     * half-width at the top of this slot's scale range and not a number about a box.
     */
    'cherry-tree': {
      prop: 'cherry-tree', mat: 'foliage', count: biome.noGreens ? 4 : 8,
      opts: {
        at: (sm, r) => 13 + r() * 26,
        scale: (r) => (biome.noGreens ? 0.52 + r() * 0.34 : 0.72 + r() * 0.62),
        tint: (r) => 0.88 + r() * 0.24, tilt: 0.05, r: 2.35, minGap: 12, tries: 70,
      },
    },

    /**
     * **And the green bower, last in the table**, and both of those are the point.
     *
     * **Last**, so the `rand()` its leaves draw cannot shift any other prop's
     * placement: `golden.spec.js` compares the standing half of `dash` and
     * `marathon` against a capture taken off the pre-split game, and an
     * arrangement that moved because a new feature joined the middle of the walk
     * would have cost that gate a false failure. `arch-plan` has to sit first
     * because the lantern poles read it; **the bower has no such constraint**, so
     * putting it anywhere but last would move the whole arrangement for nothing.
     *
     * **And one slot rather than two**, because `DECLINED` counts slots and `rock`
     * is already two bands under one prop name: a course that declines the bower
     * is one declined slot, and the prop-level list is `plan-test.mjs --biomes`'s
     * job.
     *
     * **It touches no register at all**, which is worth stating because the
     * obvious move is `reserveIt()` at each foot and it is not needed:
     * `scatter()`'s own floor is `ad < sm.w + 1.0`, two and three-quarter metres
     * from the centre line, and everything big enough to be on the register is far
     * out - trees at twelve to forty-two, mushrooms at twenty-six to fifty-six. A
     * bower's footprint is two and a half metres of canopy about the lane, so it
     * is **inside the arrangement's floor** and reserving ground nothing was ever
     * going to stand on would move the report and nothing else.
     */
    bower: { prop: 'bower-arch', kind: 'bower' },
  };

  /**
   * **And the walk**, which is the one loop in this function. Three jobs: place a
   * prop the biome named, decline one it did not, and count the declining so that
   * *this biome placed some things and declined the rest* is a number on a screen
   * (`standingReport()`) rather than an absence somebody has to notice.
   *
   * **A prop the biome did not name is counted, and a prop the biome named that is
   * not in `PLACE` stops the boot** - the second is the same rule as the rest of
   * this project: a name that resolves to nothing is a quiet answer, and the gate
   * for it is `plan-test.mjs --biomes` rather than a branch anybody can forget.
   * The first is a count, and a biome that quietly stopped declining anything says
   * so in that count rather than by looking the same as it always did.
   *
   * **The counts are of slots and not of props**, because `rock` is two bands of
   * the same stone and the biome says "rock" once.
   */
  const named = (prop) => biome.props.indexOf(prop) >= 0;
  for (const entry of Object.values(PLACE)) {
    if (entry.kind === 'arch-plan') {
      if (!named(entry.prop)) { DECLINED += 1; continue; }
      archS = archSpots();
      continue;
    }
    if (entry.kind === 'arch') {
      if (!named(entry.prop) || !archS) { DECLINED += 1; continue; }
      standArches();
      continue;
    }
    if (entry.kind === 'bower') {
      // **both names, and not one.** The slot in `PLACE` carries the arch because
      // the arch is the piece a bower is, but the canopy is half of it and a
      // biome that named one and not the other would get a colonnade with no
      // leaves on it - which is not an error anywhere and reads as a ruin rather
      // than as a missing prop.
      const want = ['bower-arch', 'bower-foliage', 'bower-litter'];
      if (!want.every(named) || !ranges.length) { DECLINED += 1; continue; }
      standBower(ranges);
      continue;
    }
    if (!named(entry.prop)) { DECLINED += 1; continue; }
    const material = mat[entry.mat];
    // **and `opts` is resolved here rather than at the table**, because one entry's
    // options cannot be written down until an entry above it has run - see
    // `lantern-pole`. It is a thunk or it is a value and there is no third case.
    const opts = typeof entry.opts === 'function' ? entry.opts() : Object.assign({}, entry.opts);
    // **the parts, from the prop's own name** - and `flower` is the one entry with
    // no prop, so it has no parts and none is looked for.
    if (entry.prop && props[entry.prop]) {
      const parts = partList(entry.prop, material);
      if (parts) opts.parts = parts;
    }
    if (entry.parts) opts.parts = entry.parts();
    const geo = entry.geo ? entry.geo() : props[entry.prop];
    for (const im of [].concat(scatter(tr, geo, material, entry.count, opts))) group.add(im);
  }
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
/** How many of each, and how big. These are the scatter's own numbers and they
 *  came here with it; `grassCount()` went the other way, to `src/graphics.js`,
 *  because the settings panel's caption reads that one too. */
const MUSHROOM_COUNT = 64;      // each kind, in total, along the course
const ROCK_SCALE = 0.30;        // stones are for looking at, not climbing over

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
function spinFans(dt, clock) {
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
  const r = makeRng(trackSeed(tr.catId, world.seasonOf()) ^ 0xfa12);
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
/**
 * **The three materials below are marked `userData.painted`, and that is how the
 * occlusion buffer knows to leave them out.** It used to name them - `mm === mat.
 * cloud || mm === mat.hillNear || mm === mat.hillFar` - inside `hideFromGBuffer()`
 * in the post chain, which is upstream of the jar that owns them, so the list had
 * to travel the other way and the answer was a cycle. Marking a material where it
 * is built is also the better answer: **a cloud and a hill are background because
 * they are painted as background**, and a piece of geometry that cannot occlude
 * anything says so on itself rather than being on a list somewhere.
 */
/**
 * **The signature is `makeBackdrop(seed, barren)` and the second argument is the
 * one that is not the same shape twice**, because a barren horizon is mostly
 * silhouette and a silhouette is geometry: **tinting** the group is free and
 * **reshaping** it is not, so a biome that wants a different skyline has to have
 * the group rebuilt rather than recoloured. That is `rebuildBackdrop()` below,
 * and it exists because two biomes are alive in one session - the stable is
 * temperate and the Adversary's duel is not, from the player's very first race.
 *
 * What "barren" changes is all silhouette and all of it is three numbers: fewer
 * clouds (six rather than fourteen, because there is less water up there to make
 * them), and hills that are **lower, wider and much further off**. That last is
 * the one that reads: a ridge a hundred and fifty metres away is a shape on the
 * skyline, and a ridge three hundred is a line. The near ones are pulled back
 * furthest of the two, which inverts the meadow's arrangement on purpose - in a
 * green valley the near hills are the ones that carry the distance, and in a dead
 * one they are the ones that would spoil it.
 */
function bakeBackdrop(into, seed, barren) {
  for (const m of [mat.cloud, mat.hillNear, mat.hillFar]) m.userData.painted = true;
  const R = makeRng(seed);
  for (let i = 0; i < (barren ? 6 : 14); i++) {
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
    cloud.position.set(-300 + i * 44 + R() * 26, barren ? 13 + R() * 9 : 17 + R() * 15,
      -175 + R() * 205);
    cloud.scale.setScalar((barren ? 2.6 : 1.8) + R() * 2.2);
    cloud.frustumCulled = false;
    into.add(cloud);
  }
  for (let i = 0; i < 16; i++) {
    const near = i % 3 === 0;
    const h = barren ? 5 + R() * 5 : (near ? 8 : 12) + R() * (near ? 7 : 12);
    const r = barren ? 48 + R() * 26 : (near ? 26 : 40) + R() * (near ? 18 : 34);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), near ? mat.hillNear : mat.hillFar);
    hill.scale.set(r, h, r * 0.8);
    hill.position.set(-520 + i * 68 + R() * 60, -h * 0.55,
      (R() < 0.6 ? -1 : 1) * (barren ? (near ? 240 + R() * 60 : 300 + R() * 80) : (near ? 105 + R() * 40 : 150 + R() * 70)));
    hill.rotation.y = R() * TAU;
    hill.frustumCulled = false;
    into.add(hill);
  }
  return into;
}
function makeBackdrop(seed, barren) {
  return bakeBackdrop(new THREE.Group(), seed, !!barren);
}
/**
 * The course's own backdrop, and **it is one module-scope `const` that is rebuilt
 * in place**, which is what lets the frame loop and `dropCourse()` carry on not
 * knowing anything about it: `race.js` adds this group to the race scene once and
 * repositions it every frame to follow the snail, and neither of those moves.
 *
 * **The disposal is inside this function and that is the whole of why it is here.**
 * A module-scope group whose children are replaced on every course change is the
 * one place in this file where a geometry outlives the thing that asked for it:
 * fourteen clouds of three to five merged icosahedra and sixteen
 * `SphereGeometry(1, 9, 6)` hills, once per course, and `renderer.info.memory.
 * geometries` after four duels is the number that says so. `dropCourse()`
 * cannot help - it is handed the *course* group and this is not in it.
 */
const backdrop = makeBackdrop(77, false);
function rebuildBackdrop(biome) {
  for (const child of [...backdrop.children]) {
    backdrop.remove(child);
    if (child.geometry) child.geometry.dispose();
  }
  return bakeBackdrop(backdrop, 77, !!biome.barren);
}

/**
 * What is standing on the last course built, and whether any of it is
   * standing inside any of the rest. `tightest` names the two pieces, because
   * "two things are too close" is a report nobody can act on.
   */
const standingReport = () => {
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
    // **and the two a biome adds**, beside the count rather than after it: which
    // biome placed this, and how many of the arrangement it declined to place.
    // *This biome placed some things and declined the rest* is a number on a
    // screen; without it a biome that declined everything is an empty course and
    // a biome that declined nothing is a meadow wearing a dead valley's name, and
    // neither is visible in `pieces`. **They are stripped off before the golden
    // spec compares this object**, because `tools/e2e/baseline.json` is the
    // pre-split capture and may never be regenerated - `biome.spec.js` is where
    // these two are asserted instead.
    biome: biomeNow().name,
    declined: DECLINED,
  };
};

/**
 * What the green bower put on this course: `{ ranges, ribs, mass, spray, litter, s }`.
 *
 * **How many sections, how many hoops, how much foliage, and the arc length of
 * each.** `litter` is the total length of `BOWER` lane in metres and **it is the
 * number the sim's answer hangs off** - a bower is slow because there are leaves
 * on the road, and leaves that were never painted make a tunnel over a road that
 * gives no reason to be slow, which is the failure where the picture and the
 * simulation stop being the same fact.
 *
 * `null` when the biome declined the props or the plan dealt no bower, and both of
 * those are the same answer to a test. **A copy and not the register itself**,
 * because `BOWERS` is a module `let` whose live binding is read-only from outside
 * - and `tools/e2e/biome.spec.js` holds this object across a `page.evaluate()`
 * boundary where a live binding would not survive.
 */
const bowerReport = () => (BOWERS ? { ...BOWERS } : null);

/**
 * Where the windmills on this course are, and how far round each fan has got.
 * A mill is the one thing on a course that is not a prop the register knows
 * about - it is a group with a pivot in it - so it is the one thing that has to
 * be asked for separately, and being told where it is and what it is doing is
 * how you check the fans turned at all.
 */
const mills = () => fans.map((f) => ({
  at: f.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)),
  turned: +f.rotation.z.toFixed(2),
}));

// ------------------------------------------------------------------
// The register's two functions and the placement system. `STANDING` and
// `RESERVED` are not exported: a module's live bindings are read-only
// from outside, and the two things outside this file need from them -
// emptying one and reading one - are a call each. So are `fans` and
// `millReport`'s answer, for the same reason.
// ------------------------------------------------------------------
export {
  placeMidway, placeLamps, knoll, lampPosts, lampWalk, makeBackdrop, rebuildBackdrop, backdrop, gateGroup,
  clearRegister, standingReport, bowerReport, spinFans, fans, mills,
  scatter, propName, partList, populate, populateFarms, farmstead, standIt, reserveIt, clearOf,
  FARM_STEP, FARM_FOOT, MUSHROOM_COUNT, ROCK_SCALE,
};
