/* ================================================================== *
 * The biome table: what a course looks like, and nothing else.
 *
 * A biome is the answer to **three questions**: which surface key is my turf,
 * which is my cliff, which is my shore and which is my track; which county
 * colour is each of the sixteen the surfaces are painted from; and which props
 * are standing in the country. Everything else about a course - its length, its
 * obstacles, its shape, its pool of features - is the planner's and stays
 * exactly where it is, which is why `plan.js` never reads one of these.
 *
 * **It is beside `maps.js` and `palette.js` and not inside either** because
 * those two carry no three.js import, so the game reads them, all four builder
 * pages read them, and `tools/plan-test.mjs` reads them from node with no
 * browser. This is the third file of that kind, and a file in `meshes/` that
 * is not one of the three allowed source modules is a file nothing can
 * regenerate and no gate can read: the ignore is a deny with exceptions, so
 * `.gitignore`'s `!/meshes/biomes.js` is the only place this file's right to
 * exist is written down, and `tools/check.sh`'s graph line is the other.
 *
 * **It is a table and not a branch, and the reason is the registry the whole
 * project is written against.** There are seven set entries across three
 * `triplanarSets()` calls, sixteen palette keys and one prop list, so a branch
 * at each of those sites is twenty-four `if (biome === 'ashlands')` lines in
 * three files, none of which can be checked against a list - and the first one
 * somebody forgets is a meadow with the cliff's tile on it, which is not an
 * error and not a crash and looks like a decision. A table is one object per
 * biome and `tools/plan-test.mjs --biomes` can walk it.
 *
 * `.kilo/skills/biomes/SKILL.md` is this file and `meshes/maps.js` written out
 * as a working document, and the two are mirrors of each other.
 * ================================================================== */

/**
 * The sixteen `PAL` keys the course surfaces are painted from, and **the list
 * is here and not in `surfaces.js`** because it is a fact about the biome table
 * rather than about the one module that reads it. `surfaces.js` reaches sixteen
 * of the twenty keys in `PAL` at thirty-six sites, and those sixteen are these;
 * the other four - `dirtA`, `dirtB`, `dirtEdge` and `earth` - belong to the
 * farmsteads and the stable's own stonework and are the stable's biome's alone.
 *
 * **Sixteen is the whole number and naming fifteen is a quiet failure**, because
 * the sixteenth would keep the value it had on load, which is `temperate`'s, and
 * that is the quiet answer with a plausible value written all over it. So
 * `useBiome()` warns on a name it cannot find and `plan-test.mjs --biomes` fails
 * on a `pal` that is not sixteen long.
 */
export const PAL_KEYS = [
  'grassA', 'grassB', 'deep', 'dry',
  'stoneA', 'stoneB', 'earthDeep',
  'sand', 'dirtLight',
  'clay', 'clayDeep', 'clayDust',
  'waterA', 'waterB',
  'trackLine', 'trackLineWorn',
];

/**
 * Which roles each of the three set-wearing materials carries, in order, and
 * which of each is drawn in the lane's own frame rather than projected.
 *
 * **The order and the count are load-bearing on both sides.** `mat.road` and
 * `mat.ledge` carry two and three sets and `mat.course` three, and the weight a
 * vertex gives a set is the set's *letter* - `X`, `Y`, `Z` - so a biome that
 * left one out would change what the remaining weights multiply and three would
 * find a different program under one material name. **Every biome has the same
 * seven entries in the same order** and `plan-test.mjs --biomes` says so, which
 * is the invariant `customProgramCacheKey` rests on.
 *
 * The third field is which **gain** the set is built at, because the road's
 * cliff set is the ramp's gain and the ledge's is the face's: `mat.road` stops
 * at `FACE_SLOPE`, so everything it draws in rock is a ramp of at most
 * fifty-eight degrees, and a ramp stands up to the light where a face stands
 * across it.
 */
export const SET_ROLES = {
  /** **Three sets and not two, and the third is the bower's setts.** It goes
   *  last, which puts it on **Z** and puts the cliff's on Y and the track's on X
   *  exactly as they were - a set added to the *front* of this list would move
   *  every weight every mesh carries, and `buildRoad()` writes `1 - sh - st`
   *  rather than `1 - sh - st - wb` precisely so the two of them never got
   *  renumbered.
   *
   *  **`uv: true`, and on the slot's own rule**: `track` is `uv` everywhere and
   *  `shore` is `uv` on the flank and not on the ground, and **the setts are `uv`
   *  for exactly the reason the track is** - a sett is a laid thing, in courses,
   *  with the bedding running with the road, and a world-projected map stamps the
   *  same sett at the same place in space whatever the lane is doing there, so on
   *  a corner the courses run across the racing line.
   *
   *  **And `gain` and not `rampGain`**: the ramp's gain is the cliff map with
   *  some of its weathering taken back off, and the setts are no part of that -
   *  they are a map **built about a grey whose mean is one**, so it is gained at
   *  one. Which is also the one place in the county where the gain is *not* the
   *  map's mean being put back, and the reason is in `meshes/maps.js`: this is
   *  the only detail albedo that carries hue, and a hue map's mean is grey and
   *  gaining it would move every stone's chroma off what the reference has.
   */
  road: [['track', 'gain', true], ['cliff', 'rampGain', false], ['bowerSetts', 'gain', true]],
  ledge: [['track', 'gain', true], ['cliff', 'gain', false], ['shore', 'gain', true]],
  course: [['turf', 'gain', false], ['cliff', 'gain', false], ['shore', 'gain', false]],
};

/**
 * The roles, and which material each is worn by. A biome must name all of them.
 *
 * **`bowerSetts` is a fifth and not a fourth**, and the distinction is the whole
 * of where a surface's maps live: the first four are **worn by the country** -
 * every course of a biome draws its turf, its cliff, its shore and its track, and
 * a biome that named three of them has a meadow with no ground under it. The
 * setts are **worn by one feature**, and only on the two courses whose plan deals
 * a bower; every other course pays the weight width and draws nothing.
 */
export const ROLE_KEYS = ['turf', 'cliff', 'shore', 'track', 'bowerSetts'];

export const BIOMES = {
  /**
   * The county as it has always been, and **the entry that has to be written out
   * rather than defaulted** for the same reason `makeEnv()`'s third argument is
   * written out at both call sites: a field with a plausible default is a quiet
   * answer. The five gains below are the county's own rule
   * (*a map built under one is bought back with a gain*) read off the material
   * block it used to live in, and they have not moved.
   *
   * `far` carries **two jar names and not two hexes**, and that is a rule the
   * biome work exposes rather than one it invents: the two backdrop base colours
   * were written into the app's own hour routine as `0xb2c8c6` and `0x8cae94` and
   * they were the only course-facing colour in the county that was not out of
   * `meshes/palette.js`. A biome wants a second value for them, so `hillNear` and
   * `hillFar` are in the jar and are named here.
   */
  temperate: {
    name: 'temperate',
    label: 'the hedgerows',
    surface: {
      // five metres a tile, which is the number that answers "this map reads at a
      // hundred paces and then stops"; the gain is the map's own mean put back,
      // because it is built under one
      turf: { key: 'grass', gain: 1.20, scale: 0.20, strength: 0.30, thickness: 0.001 },
      // a little under two metres so a slab is about the size of a slab, and the
      // gain at 1 because a face is weathered a long way below its top of it and
      // `rampGain` is the same map with some of that weathering taken back off
      cliff: { key: 'cliff', gain: 1.00, rampGain: 1.30, scale: 0.55, strength: 1.00, thickness: 0.10 },
      // nine tenths of a metre, so a crest is about a hand's width
      shore: { key: 'sand', gain: 1.35, scale: 1.10, strength: 0.90, thickness: 0.03 },
      // the map's mean, not a taste: the albedo's field is put under one on
      // purpose so its highlight half survives the eight-bit canvas
      track: { key: 'track', gain: 1.41, scale: 0.85, strength: 0.70, thickness: 0.06 },
      /** **The bower's setts, and both of its numbers are the reference's own.**
       *  **And the scale is 1.82, which is a frequency and not a tile.** The
       *  fetch is `texture2D(map, uv * dS)`, so **`1 / scale` is the tile's
       *  length in metres** - the course's turf at 0.20 is five metres a tile and
       *  the road's track at 0.85 is 1.18. Five stones of a drawer's 5 x 5 want
       *  **110 mm**, so the tile is 0.55 m and the scale is `1 / 0.55 = 1.82`.
       *
       *  **And that is the county's own rule said out loud** - *the frequency and
       *  the tile move together* - and it is what the first cut got wrong: the
       *  scale was written as `0.55` on the reasonable reading that a small number
       *  is a small tile, which is a tile of **1.82 m** and a sett of **364 mm**.
       *  A sett that size is a paving slab, and the road came out as a terrace of
       *  them with eight across a lane, which is a picture no gate can call wrong
       *  and no reference survives either. `plan-test.mjs --biomes` prints the
       *  **reciprocal** now for exactly this reason.
       *  The strength is **0.62** against a sett's crown rather than a road's
       *  grain: the relief that has to read at thirty metres is the pillowed top
       *  of each stone, and the joints are a *value* the albedo already carries.
       *  The gain is **2.11** and it is the map's own measured mean, not a
       *  judgement - see below.
       *
       *  **And that is the one number in this table that is not a judgement, which is the one number in this table that is
       *  not a judgement, and it is the only role whose map is not built about a
       *  linear mean of one.** `bowerSetts-albedo` carries its own value structure
       *  *and* its own hue, so it cannot be a multiply about white: a field whose
       *  mean already spends the whole range has nothing left above one for its
       *  highlights, and the pale half of the floor piles up against the knee. So
       *  the file holds the peak just under it and **the level lives here**.
       *
       *  **2.11 is measured, off the written PNG, and not derived**: the albedo
       *  came out at a linear mean of **0.439**, a median of 0.491, p05 0.221,
       *  p95 0.624, saturation 0.133 and **no clipped texel at all**, and this is
       *  1 / 0.439. **A comment is not a measurement**, and this one was wrong by
       *  a factor of two for three draws before it was read off the file.
       */
      bowerSetts: { key: 'bowerSetts', gain: 2.28, scale: 1.82, strength: 0.62, thickness: 0.05 },
    },
    /** The sixteen, naming **the same county colour** in both biomes where the
     *  colour is the same colour: a chalk line is a chalk line. */
    pal: {
      grassA: 'grassA', grassB: 'grassB', deep: 'deep', dry: 'dry',
      stoneA: 'stoneA', stoneB: 'stoneB', earthDeep: 'earthDeep',
      sand: 'sand', dirtLight: 'dirtLight',
      clay: 'clay', clayDeep: 'clayDeep', clayDust: 'clayDust',
      waterA: 'waterA', waterB: 'waterB',
      trackLine: 'trackLine', trackLineWorn: 'trackLineWorn',
    },
    /** And the props this biome stands in its country. A prop it has not named is
     *  counted and not placed - `standingReport()` gains a `declined` for it.
     *
     *  **And the three large mushrooms are not in this list and are in the
     *  other's** - `mushroom-giant`, `mushroom-pale` and `mushroom-rooted`, which
     *  are five and a half to six metres and three-metre caps and were the
     *  meadow's entire skyline. Two reasons, and the second is the one that
     *  decided it:
     *
     *  a burnt country grows its mushrooms, because that is what follows a burn -
     *  their whole ecology is *on* the dead wood, not in it - so a dead valley
     *  with no giant mushrooms in it is a dead valley that has missed the only
     *  thing that happens next;
     *  **and the ashlands had no skyline at all.** Its tallest things were a
     *  five-metre snag and a five-metre basalt column, both thin, both standing
     *  in ranks - a horizon of poles. A six-metre cap three metres across is a
     *  different shape from anything else the biome owns, and putting it here
     *  gives the horizon something to be that is not a mast.
     *
     *  **What it costs is the temperate meadow's skyline**, and that is a real
     *  loss: `Hedgerow Dash` had eleven giants, six pale and six rooted standing
     *  in it, and they are the county's most recognisable picture. The meadow
     *  keeps `mushroom-red` and `mushroom-brown`, which are ten centimetres, so
     *  what it has left at that scale is a mat of small ones. */
      props: [
      'conifer', 'evergreen', 'broadleaf', 'pine', 'cherry-tree', 'bush', 'cactus', 'cactus-barrel',
      'rock', 'mossy-rock',
      'tuft', 'flower', 'mushroom-red', 'mushroom-brown', 'marker',
      'lantern-pole', 'lantern-arch',
      // **The green bower, and it is load-bearing in a way nothing else on this
      // list is.** The two temperate courses that *build* a bower are Hedgerow
      // Dash and Grand Marathon, and a bower is a planner section with nothing on
      // it unless something stands there - so a biome that quietly stopped naming
      // these two would stop the feature in the middle third of a race, with the
      // plan dealing a bower and no foliage standing on it, and nothing anywhere
      // throwing. `plan-test.mjs --biomes` requires both names in `MESH_FILES` and
      // both files in `meshes/`, and `biome.spec.js` reads the count off
      // `__snail.standing()`.
      //
      // **And the ashlands decline all three, which is the right answer rather than
      // an omission**: a bower of living green in a dead valley is the one prop the
      // `noGreens` rule is about, and its dead leaves on the ground with it. The gate prints the declined list by name, so
      // the omission is stated rather than inferred.
      'bower-arch', 'bower-foliage', 'bower-litter',
      'lily', 'lily-pad', 'reeds', 'seashell',
    ],
    /** A farmstead is a place the country was cleared for, so it is the first
     *  thing down and a biome says whether there is one. */
    farms: true,
    /** And the far country's two base colours, by jar name. */
    far: { near: 'hillNear', far: 'hillFar' },
    /** A multiply on the **race env's** fog and not a colour in its own right,
     *  and `null` for the biome the fog was already right for. The stable's fog
     *  never takes it - the stable is always temperate. */
    fog: null,
    /** And whether the horizon is barren, which is the one thing a backdrop has
     *  to be **rebuilt** for rather than tinted: a low ridgeline a long way off
     *  is mostly silhouette, and the silhouette is geometry. */
    barren: false,
  },

  /**
   * The second biome, and it is a **table with the same shape as the first and
   * not a variant of it**: same four roles, same seven set entries in the same
   * order, same sixteen keys, and every one of the gains its own.
   *
   * The four gains are the point of the table. An ash basalt is built dark and
   * meant to darken, which wants a different number from a turf built pale and
   * meant not to - and a biome cannot ask for a different map at a different
   * gain if the gain is in the material block, which is where all five of them
   * used to be. `colourGain` is a GLSL string literal rather than a uniform
   * because it is a multiplier on a per-set sum, so moving it is a recompile
   * rather than a write, and the recompile is only safe because the biome's name
   * goes into `customProgramCacheKey` - see `useBiome()`.
   */
  ashlands: {
    name: 'ashlands',
    label: 'the ashlands',
    surface: {
      // **Fine grey ash over a broad crust**: a stem's width in the relief and a
      // meter's in the value, on the ground's own five-metre tile. Built near
      // one and gained near one, which is the county's rule for a map that is
      // meant neither to darken nor to bleach.
      turf: { key: 'ashGrass', gain: 1.05, scale: 0.20, strength: 0.32, thickness: 0.02 },
      // **Columnar, and the columns are the whole of it** - see the `basalt`
      // entry in `meshes/maps.js` for why a cellular lattice is the cobbled road
      // under a new name. Built dark on purpose and gained at its own mean, with
      // the ramp's gain above it so the climbing strip stands out of the face.
      cliff: { key: 'basalt', gain: 1.02, rampGain: 1.26, scale: 0.55, strength: 1.05, thickness: 0.05 },
      // **Coarse gravel, a hand's width of a crest and nothing finer**, and it
      // sits between the turf and the cliff in value because ash falls on
      // things.
      shore: { key: 'cinder', gain: 1.20, scale: 1.10, strength: 0.95, thickness: 0.04 },
      // **Packed ash and grit, swept, and the sweep is the thing you read**: the
      // road has to say where the lane is at four hundred metres the way the
      // clay did, and a pale line on a pale road does not.
      track: { key: 'ashTrack', gain: 1.30, scale: 0.85, strength: 0.75, thickness: 0.05 },
      /** **The same setts at the same tile, and the ashlands decline the bower.**
       *  The weight is zero on all five ashlands courses - `bowerRanges()` finds
       *  no `BOWER` section and `mat.road`'s third set is guarded by
       *  `if (vDetailW.z > 0.002)`, so **not one fetch happens** - but the entry
       *  is here rather than omitted, because **a role the table has not named is
       *  a set silently missing from the material**, which is `triplanarSets()`'s
       *  `sets.filter()` making a quiet answer out of a missing line. `plan-test
       *  .mjs --biomes` fails on a `surface` that is not five long.
       *
       *  **Live setts in a dead valley would be wrong even if a bower reached
       *  one**, and it does not: `PLAN`'s pools put no bower in an ashlands
       *  course and the biome declines both of the bower's props by name. What
       *  this entry buys is that if a course ever did deal one, it would come out
       *  as stone rather than as ash, which is a decision rather than a
       *  coincidence.
       *
       *  **And the gain is the number the temperate biome writes**, which is the
       *  point of having it in this table twice rather than defaulting it: the
       *  map's own measured mean is a fact about the file and not about the
       *  country it is worn in, and a role whose number is a property of its map
       *  is a role every biome has to be told the same number.
       */
      bowerSetts: { key: 'bowerSetts', gain: 2.28, scale: 1.82, strength: 0.62, thickness: 0.05 },
    },
    pal: {
      grassA: 'ashMid', grassB: 'ashDeep', deep: 'ashDark', dry: 'ashPale',
      stoneA: 'basaltLight', stoneB: 'basaltDark', earthDeep: 'basaltDeep',
      sand: 'cinder', dirtLight: 'cinderPale',
      clay: 'ashTrack', clayDeep: 'ashTrackDeep', clayDust: 'ashTrackDust',
      waterA: 'ashWaterDeep', waterB: 'ashWaterEdge',
      // **The only two the ashlands do not change**, and there is a reason: a
      // chalk line is a chalk line. It is also the reason the ashlands road is
      // dark, because a pale line only tells a snail where the lane is if the
      // road under it is not pale.
      trackLine: 'trackLine', trackLineWorn: 'trackLineWorn',
    },
    /** And the props this biome stands in its country, **in the order `PLACE` walks
     *  them**, because that is what the two lists are and a biome that reads as a
     *  set of names in a different order is a list nobody can check against the
     *  arrangement. A prop it has not named is counted and not placed -
     *  `standingReport()` gains a `declined` for it.
     *
     *  **The first three are the large mushrooms and they are here for the reason
     *  the temperate block says they left**: a burnt country grows them, and the
     *  biome had no skyline of its own. `mushroom-giant` and `mushroom-pale` are
     *  also the **first two entries in `PLACE`**, so they go down before the
     *  snags and the columns on exactly the meadow's own argument - a six-metre
     *  cap claiming its metre before a five-metre mast has said anything - which
     *  is the reason `PLACE` puts them first and not the fifth.
     *
     *  **And `paleTop` is the one thing to look at in the result.** The pale
     *  mushroom's cap is `[0.62, 0.63, 0.57]`, which is green by a hundredth on
     *  red and six hundredths on blue, and on a green meadow that is invisible.
     *  `noGreens` **cannot catch it**, because the flag reads the sixteen surface
     *  keys and a prop's vertex colours are not one of them - so a green cap in a
     *  biome whose one hard rule is no greens is exactly the kind of quiet answer
     *  the flag was written to stop and cannot reach. If it reads green on the
     *  course, the fix is one number in the jar and not a gate.
     *
     *  **And `cherry-tree` is the one name in this list that is not a burnt thing,
     *  and it is here on purpose.** A weeping cherry in a dead valley is a survivor
     *  and not a meadow, and it is worth on the same terms as the county's `vent`
     *  two lines down - the one hue out here is something to walk towards. **Which
     *  is why `PLACE` puts it on a third of the meadow's count**: a course with
     *  three cherries in it has three survivors in it, and a course with eleven has
     *  an orchard, and an orchard in a burnt valley is a meadow with the colour
     *  left out. **And `noGreens` cannot see any of this** - it reads the sixteen
     *  surface keys and a prop's vertex colours are not one of them - so whether
     *  three is the right number is a thing a person has to look at on a course and
     *  not a thing a gate can settle.
     */
    props: [
      'mushroom-giant', 'mushroom-pale', 'mushroom-rooted',
      'ash-tree', 'snag', 'basalt-column', 'ash-fallen', 'ash-scrub', 'ash-tuft',
      'cherry-tree',
      'rock', 'vent', 'obsidian-shard', 'marker',
      'lantern-pole', 'lantern-arch',
    ],
    /** No farms. A farmstead is a place somebody cleared and planted, and the
     *  one thing this biome does not have is somebody. */
    farms: false,
    far: { near: 'ashHillNear', far: 'ashHillFar' },
    fog: 'ashHaze',
    barren: true,
    /** **And no greens, which is the one hard rule on this block.** It is a
     *  flag and not a comment because `plan-test.mjs --biomes` can ask it and
     *  cannot ask a comment: a single green in a palette group is a course with
     *  a meadow in it, and the first one anybody adds is going to be deliberate
     *  - a moss, a reed, "just a touch of green in the water" - which is exactly
     *  why it wants a gate rather than an intention. */
    noGreens: true,
  },
};

/** Every prop any biome names, and the set the per-course reports count against. */
export const COUNTY_PROPS = [...new Set(Object.values(BIOMES).flatMap((b) => b.props))].sort();