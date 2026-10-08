/* ================================================================== *
 * The map manifest: which piece declares which maps, and what each
 * slot in a material is for.
 *
 * This is the one list. `MESH_FILES` in src/materials.js says which files are
 * loaded, `PIECES` in build-scenery.html says which pieces that file can
 * build, and before this file a `TEX` table in the game was a fourth copy
 * of the same question written by hand - which is how a prop ends up
 * declared here and named in one place and missing in another, and nothing
 * says so. So the game, the three builders and the texture builder all read
 * this one, and tools/inspect.html reads it too and prints a
 * declared-versus-present column for every file: a name here with no PNG
 * beside it is a hole, and that column is how you see it.
 *
 * The same table, with the channel packing written out under it, is
 * .kilo/skills/snail-assets/SKILL.md. The two are mirrors of each other and
 * have to be changed together.
 * ================================================================== */

/** The slots a material can have, and how the game reads each of them. */
export const SLOTS = {
  map: { srgb: true, note: 'base colour. Full colour only if nothing recolours the prop at runtime' },
  normalMap: { srgb: false, note: 'tangent-space normal, packed 0.5,0.5,1' },
  roughnessMap: { srgb: false, note: 'roughness in green; metalness in blue, if you want the two in one file' },
  // The blue half of that packing, and it is a **separate field on the material**
  // rather than a second reading of the first one: three.js reads roughness out
  // of `roughnessMap.g` and metalness out of `metalnessMap.b`, so a file that
  // carries both is handed to both - see `mapSlots()`, which is the one place that
  // knows it. It was dead for the whole of the library's life because nothing in
  // the county was metal.
  metalnessMap: { srgb: false, note: 'metalness in blue. The same file as the roughness, glTF packing' },
  aoMap: { srgb: false, note: 'occlusion in red, multiplied into the indirect light' },
  emissiveMap: { srgb: true, note: 'what a lit thing gives out. A tinted emissive with no map tints to nothing' },
  // not a material slot: a second normal the water shader samples itself, for
  // a second ripple going the other way. Handed to the shader, not the material
  ripple2: { srgb: false, note: 'a second normal, for a surface that layers two' },
};
/** The subset of `SLOTS` that is a real `MeshStandardMaterial` field. */
export const MATERIAL_SLOTS = new Set(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']);

/**
 * One entry per prop, naming the maps its material is expected to have. An
 * empty array is a prop that has not been converted yet, which is the state
 * every prop is in before its phase: the loader takes a prop with maps and a
 * prop without, so the library converts one at a time and the game is never
 * broken in between.
 *
 * A prop made of two surfaces - the moss on a stone, the paper in a lantern -
 * is an object keyed by part, with `''` for a mesh the file names after the
 * prop itself, because a list on both parts would put granite on the moss. A
 * prop made of one is an array, and the array means "the same on every part".
 * The keys are the part names the loader builds, which is the bit after the
 * dash: `''` for `mossy-rock`, `frame` and `paper` for `lantern-pole-frame`
 * and `lantern-pole-paper`.
 *
 * The names here are the file names in meshes/tex/, minus the extension, and
 * are shared: `rock` naming `rock-n` also gets `rock-albedo`.
 */
export const MAPS = {
  /* ---- the stones ---------------------------------------------------- *
   * The only props with a full-colour albedo, and the reason is that a stone
   * is one surface and the map is better at granite than a 512-triangle
   * icosahedron is. Everywhere else in this table the colour stays in the
   * vertex colours, because they are doing deliberate per-part work - a leaf
   * is a different green from the twig it is on, and a map that multiplies a
   * colour onto both takes the choice away. A base-colour map *multiplies*;
   * it cannot add, and an sRGB one cannot come near 1.0 and stay a colour, so
   * putting one under a coloured vertex palette darkens the county rather than
   * detailing it.                                                     */
  rock: ['rock-albedo', 'rock-n', 'rock-rgh'],
  cobblestone: ['cobblestone-albedo', 'cobblestone-n', 'cobblestone-rgh'],
  // the stone and the moss are two surfaces, so a stone in the wet ground is
  // two maps: granite under, moss over, and the moss takes the stone's own uvs
  // so the grain cannot slide against the rock it grows out of
  'mossy-rock': {
    '': ['rock-albedo', 'rock-n', 'rock-rgh'],
    moss: ['moss-albedo', 'moss-n'],
  },
  // a shell washed up on a bank is one surface and a pale one, and it wears
  // its own grain rather than the county's granite
  seashell: ['shell-n', 'shell-rgh'],

  /* ---- the ashlands ---------------------------------------------------- *
   * Eight pieces standing in the second biome, and **two of them want maps for
   * the same reason and not the same reason.** A `basalt-column` wears the
   * cliff's own three because it is the cliff's joint pattern in three
   * dimensions and it is the piece that proves the map is right - a thing you
   * can walk round and a thing you can only see edge-on have to agree. An
   * `obsidian-shard` wears two because **obsidian is the one thing in the county
   * that is shiny**: a roughness map is the only way a surface can vary its own
   * finish across its own face, the oxide skin and the conchoidal fracture inside
   * it are two finishes, and a bare material cannot say so. Its low value is in
   * its vertex colours rather than in a map, because a base-colour map on a
   * near-black prop can only make it blacker.
   *
   * `obsidian-n` is the only new *file* this biome brings, and `obsidian-rgh` is
   * half of a `-rgh` pair with an empty metalness channel like every other in the
   * library - obsidian is a glass, and three.js has no transmission here, so it is
   * a dielectric at 0.18 with a very low roughness and the sky is what makes it
   * read as glass. See the piece's own comment in `build-scenery.html`.
   */
  'basalt-column': ['basalt-albedo', 'basalt-n', 'basalt-rgh'],
  'obsidian-shard': ['obsidian-n', 'obsidian-rgh'],
  /** The other three are **in their vertex colours**, and each for a stated
   *  reason rather than as a default. An `ash-tree` has no bark left to grain
   *  and the cliff's map on a charred trunk is a stone grain standing on end.
   *  An `ash-tuft` is the meadow's `tuft` with a different material and no map on
   *  it for exactly the reason the meadow's has none: `mat.grass` and
   *  `mat.ashFoliage` are both `triplanarDetail()` and a tuft has no uv to
   *  sample with. And a `vent` is **the one piece in the biome that is not grey**
   *  - the only place a hue is allowed at all - so its colour is the point of it
   *  and a map over the top would be taking the choice away. */
  'ash-tree': [], 'ash-tuft': [], 'vent': [],
  /* **And the three that came after them, which are bare for the reason the
   * `ash-tree` is and not as a new decision**: `ash-scrub`, `ash-fallen` and
   * `snag` are charred wood standing in the same sixteen greys the ash-tree is,
   * and `snag` is built out of the ash-tree's own trunk lathe - so a map over any
   * of them is the cliff's grain on a burnt tree again, on a piece that has to
   * *agree* with the tree it is standing next to. **A map is also the only way a
   * surface gets its grain, so this is a decision rather than an omission**, and
   * the reason it is the right one here is the reason the ash-tree's is: these
   * are four-centimetre read surfaces at most, and what has to read is a
   * silhouette. */
  'ash-scrub': [], 'ash-fallen': [], 'snag': [],

  // The half-way tower, and it is here beside the stones rather than beside the
  // farmstead because that is what it is wearing: a full-colour albedo, a normal
  // and a roughness, for the same reason `rock` has all three - one surface, and
  // the map is better at a bedded limestone than a few hundred triangles are.
  //
  // It is the one prop in the library that is **not scattered**. Every course
  // has one, it stands at the half-way mark in the middle of the ground the road
  // sweeps round, and `buildCourse()` puts it down by name - so the file is in
  // `MESH_FILES`, but the prop is never handed to `scatter()` and the manifest
  // entry is what gives it its own material rather than the caller's.
  //
  // Three parts, because three surfaces. The masonry is the limestone, the
  // lantern hangs on timber, and the **paper is a part of its own for the same
  // reason a lantern pole's is**: the hour drives `mat.paper`'s emissive by name
  // and a paper drawn in the material out of its own file is dark at midnight.
  // So the tower is a piece with parts, declared per part the way the windmill's
  // cap and sails are, and the paper declares the lantern maps for the audit's
  // sake - the game attaches them to `mat.paper` by hand, where the hour sees
  // them, and the tower is not in `GAME_MATERIAL` because its masonry is drawn in
  // the material out of the file like any other converted prop.
  watchtower: {
    '': ['limestone-albedo', 'limestone-n', 'limestone-rgh'],
    hanging: ['timber-albedo', 'timber-n', 'timber-rgh'],
    paper: ['lantern-em', 'glass-n'],
  },

  /* ---- the stable's pool ---------------------------------------------- *
   * A fountain is cut stone, not a stone that was found, so it does not wear
   * the county's granite: the jar has no marble in it and neither has anything
   * else in the game, so the map is its own - a veined, nearly flat, faintly
   * polished one. The albedo multiplies the pale greys the piece is built in,
   * so it is about white and what it carries is the veining. A palm wears
   * nothing at all, for the same reason the conifer and the broadleaf wear
   * nothing: a frond is a hundred small leaflets in four greens, and one grain
   * across both the trunk and the crown would be a lie about both.           */
  fountain: ['marble-albedo', 'marble-n', 'marble-rgh'],
  palm: [],

  /* ---- the plants ----------------------------------------------------- *
   * A normal and a roughness, and no colour. A normal map has no average
   * brightness to get wrong, so it can be put under any palette: this is the
   * map that turns a flat green cone into a leaf with a rib up it.
   *
   * `conifer`, `broadleaf` and `tuft` are here in name only. They are
   * committed glbs from an earlier pipeline and there is no builder for them in
   * this repository, and a committed binary cannot be given a uv by anybody:
   * without one there is nothing for a tiling map to be sampled with. They
   * draw in their vertex colours, as they always have, and they need a builder
   * before they can be converted.
   *
   * **`cherry-tree` is the sixth and it is the same answer reached from the other
   * side** - it has a builder and it is still bare, and the reason is not that a
   * tree has no grain. A cherry is a near-black trunk and a pink crown, and one
   * isotropic normal tiled at the county's 34 cm across both of them says that
   * the blossom is ridged at four centimetres, which is the one thing the crown is
   * not. Its `cherryBarkPale` on the outer third of every limb is doing the work a
   * bark map would otherwise do: **a half-metre cloud of blossom and a two-centimetre
   * twig want two different grains and the county has no uv on either**, so the
   * decision here is that it gets none rather than one that is wrong about both.
   */
  'cherry-tree': [],
  bush: ['leaf-n', 'leaf-rgh'],

  lily: ['leaf-n', 'leaf-rgh'],
  'lily-pad': ['leaf-n', 'leaf-rgh'],
  reeds: ['leaf-n', 'leaf-rgh'],
  'corn-plot': ['leaf-n', 'leaf-rgh'],
  'sprout-plot': ['leaf-n', 'leaf-rgh'],

/* ---- the mushrooms -------------------------------------------------- *
   * All five are three surfaces wearing three pairs, and the shape of the
   * argument is in the pale one below. `mushroom-n` and `mushroom-rgh` stay on
   * disk for nothing and are no longer declared: they were one isotropic noise
   * drawn across a cap and a stem and a set of gills, and an isotropic noise can
   * only draw a scratch. A cap made of them came out as a dusty disc.
   *
   * The `-tone` on each is not a colour and is the reason there is a `map` slot
   * on any of them at all - see `SLOT_OF`. All five mushrooms wear all three.
   */
   'mushroom-giant': {
     '': ['mushroom-stem-n', 'mushroom-stem-rgh', 'mushroom-stem-tone'],
     cap: ['mushroom-cap-n', 'mushroom-cap-rgh', 'mushroom-cap-tone'],
     gills: ['mushroom-gill-n', 'mushroom-gill-rgh', 'mushroom-gill-tone'],
   },
   'mushroom-rooted': {
     '': ['mushroom-stem-n', 'mushroom-stem-rgh', 'mushroom-stem-tone'],
     cap: ['mushroom-cap-n', 'mushroom-cap-rgh', 'mushroom-cap-tone'],
     gills: ['mushroom-gill-n', 'mushroom-gill-rgh', 'mushroom-gill-tone'],
   },
   /**
    * The pale one is three surfaces and so three maps, and that is the only
   * reason it is worth the trouble: a surface of revolution is unwrapped with
   * the **angle** for its u, so a line of constant u in a map is a line of
   * constant angle on the model - and a gill, a fibre and a cap wrinkle are all
   * lines of constant angle. One map for all three cannot be any of them, and
   * the map these replaced was an isotropic noise, which draws a scratch.
   *
   * So the three parts are `''` (the stalk, which is the piece itself), `cap`
   * and `gills`, and each wears its own set. The keys are the part names the
   * loader builds out of the mesh names in the file: `mushroom-pale`,
   * `mushroom-pale-cap` and `mushroom-pale-gills`. The other four are written
   * out at their alphabetic places above and are the same three keys.
   */
'mushroom-pale': {
     '': ['mushroom-stem-n', 'mushroom-stem-rgh', 'mushroom-stem-tone'],
     cap: ['mushroom-cap-n', 'mushroom-cap-rgh', 'mushroom-cap-tone'],
     gills: ['mushroom-gill-n', 'mushroom-gill-rgh', 'mushroom-gill-tone'],
   },
   // And the two small ones, which are the same three surfaces at two sizes:
   // a cap that has been out in the weather is the same cap at ten centimetres
   // across as it is at six metres, which is the whole reason one map serves
   // all five mushrooms in the county. They are the only two in the library
   // that are one surface of revolution and nothing else - no skirt, no
   // flecks, no strands - and `mushroomCap()` builds their underside for them:
   // the dish the pale one has is the dome turned back to the rim at the same
   // zero it lands on, and the gills are the blades lying in it.
   'mushroom-red': {
     '': ['mushroom-stem-n', 'mushroom-stem-rgh', 'mushroom-stem-tone'],
     cap: ['mushroom-cap-n', 'mushroom-cap-rgh', 'mushroom-cap-tone'],
     gills: ['mushroom-gill-n', 'mushroom-gill-rgh', 'mushroom-gill-tone'],
   },
   'mushroom-brown': {
     '': ['mushroom-stem-n', 'mushroom-stem-rgh', 'mushroom-stem-tone'],
     cap: ['mushroom-cap-n', 'mushroom-cap-rgh', 'mushroom-cap-tone'],
     gills: ['mushroom-gill-n', 'mushroom-gill-rgh', 'mushroom-gill-tone'],
   },

  /* ---- the lanterns ---------------------------------------------------- *
   * These are the three props that cannot wholly be drawn with the material out
   * of their own file, and the reason is in the game: `mat.paper` and
   * `mat.lampGlass` are driven by the hour, by name, and a material the hour
   * does not know about cannot be lit. So the frame is drawn in the file's own
   * material and the paper and the glass are drawn in the game's, and the maps
   * are handed to those by hand - see the block after the `mat.*` table. The
   * declarations are still here, because this is where the audit reads them. */
  'lantern-pole': {
    frame: ['timber-albedo', 'timber-n', 'timber-rgh'],
    paper: ['lantern-em', 'glass-n'],
  },
  'lantern-arch': {
    frame: ['timber-albedo', 'timber-n', 'timber-rgh'],
    paper: ['lantern-em', 'glass-n'],
  },
  'lamp-glass': ['lamp-em'],

  /* ---- the candle lantern, which is the same argument with a part more --- *
   * A hurricane lantern is **three surfaces and not one**, and the three are not
   * a matter of taste. The frame is the county's only metal on a piece the
   * player walks past, so it is converted and wears `metal-*` like the crate's
   * brackets and for the same reason: a metalness of zero is a dark grey plastic
   * frame, and no amount of value in `ironBody` makes a frame read as wrought.
   *
   * The other two are drawn in the game's own materials and **cannot** be drawn
   * in the ones out of their own file, which is the whole reason the three props
   * above are declared at all. The wax burns, so it is `mat.paper` with the
   * lantern's emissive map, and the panes are `mat.lanternPane`, which the hour
   * does not touch - a pane has nothing of its own to give out, it is lit
   * through by the flame in the middle of it, which is the whole of why the
   * reference's cyan lantern is a cyan *box* and not a cyan bulb.
   *
   * The maps are therefore handed to all three by hand, where the hour and the
   * glass can see them, and they are declared here because this is where the
   * audit reads them. */
  'candle-lantern': {
    frame: ['metal-albedo', 'metal-n', 'metal-rgh'],
    candle: ['lantern-em'],
    pane: ['glass-n'],
    flame: ['lantern-em'],
  },

  /* ---- the timber, which four things share ----------------------------- *
   * `timber-albedo` is a **colour** and not a `-tone`, and the difference is
   * the knots. Everything the county's other near-white maps carry is dirt in a
   * crevice, and a tenth of the range is all dirt is - which is why
   * `mushroom-cap-tone` and the other two stay in sRGB 0.93 to 1.0 and call it
   * enough. A board wants a knot: three centimetres of near-dark in a field
   * that lifts by five per cent, with the growth rings bending round it and
   * closing again behind, is the single most legible thing wood has, and it is
   * the one thing a normal map cannot draw at all.
   *
   * **So the map keeps the mean high and spends the range on the features.**
   * `TIMBER_CAL` in the texture builder measures the written PNG and puts the
   * mean at sRGB 0.965, and everything but the knots is a tenth either way of
   * it. That is the whole trick, and it is the cliff's argument again: a
   * multiply whose mean is under one is the county a stop darker, but a
   * multiply with a mean of one has no room left for anything to be dark *in*.
   * Three knots to a tile at three per cent of the area each cost the mean
   * about one per cent, and the range is theirs.
   *
   * The hue is a twentieth and it is early wood warm against late wood grey,
   * which is the cliff's one touch of hue and for the cliff's reason: the wood
   * is in the jar - `timber`, `plank`, `post`, `capWood` - and this map is
   * detailing those colours, not repainting them.
   *
   * All three of its maps come out of **one** field in the texture builder, so
   * the dark band is under the ridge and the dirt is in the trough the relief
   * has already located. They are also all drawn at 256 whatever the file is
   * called, which is the one place the `-albedo` resolution rule is not
   * followed: the tile is a third of a metre and there is nothing in a board
   * finer than a knot.                                                     */
  /* ---- the farmstead --------------------------------------------------- *
   * One building is done and the rest are waiting, and the difference is the
   * number of materials rather than the size of the thing. A windmill is three
   * meshes - a stone tower, a timber cap with its tail, and the fan - and
   * because each is its own mesh each can have its own surface: the tower wears
   * the grain of every stone in the county, the cap wears the wood, and the
   * fan wears a canvas weave, which is the one map in the library that is cloth
   * and is here because the fan is the largest surface in the county that is
   * neither stone nor wood.
   *
   * The fan is a part for a second reason as well, which is the one that has
   * nothing to do with maps: it turns. A piece that is baked into one mesh
   * cannot have a quarter of itself moving, so the sails are hung on their own
   * origin and the game parents them to a pivot. The other four buildings are
   * plaster, timber and thatch in one mesh each, so they can only have one
   * normal map between them - and a thatch grain running over the walls is
   * worse than no grain at all. Splitting them is a change to the shape of the
   * files and not to their surfaces, and it wants doing as its own piece of
   * work with a look at each of them afterwards.                        */

   'windmill': {
     '': ['rock-n', 'rock-rgh'],
     cap: ['timber-albedo', 'timber-n', 'timber-rgh'],
     sails: ['canvas-n', 'canvas-rgh'],
   },

/* ---- the hut -------------------------------------------------------- *
     * The one building that is done and the one that is *not* split: it is a
     * single mesh, so it can only have one grain between the timber of the frame
     * and the thatch of the roof. The timber is the grain, because a
     * post-and-plank frame is what a house is and the thatch is what it wears -
     * the roof's grain is not the first thing a viewer reads, the timber is.
     *
     * The hut also has its own uv, which is the one that the manifest's old note
     * about "plaster, timber and thatch in one mesh" was waiting for: a grain
     * that runs over the walls is worse than no grain at all, and the answer is
     * not to split the hut into three meshes (that is the windmill's shape, not
     * the hut's) but to give it one grain that belongs to the surface that does
     * the most of the work.                                                        *
     *
     * And it takes the **colour** as well, which is the one thing here that is a
     * compromise and is said to be one. `timber-albedo` is built about white -
     * `TIMBER_CAL` in the texture builder puts its mean back at sRGB 0.965 -
     * so what it does to the thatch underneath is move its value by a tenth and
     * never touch its hue, which is exactly what `mushroom-cap-tone` is allowed
     * to do to six mushrooms in six colours. The one thing it cannot do quietly
     * is the **knot**: three centimetres of near-dark on a thatched roof is a
     * stain in the thatch, and it is there because a knot is the single most
     * legible thing wood has and it is invisible at race distance and only shows
     * if you stand under the eaves in the inspector. Splitting the hut into
     * `''`/`thatch` is what removes it, and that is a change to the shape of the
     * file, not to its surfaces.                                               */
    hut: ['timber-albedo', 'timber-n', 'timber-rgh'],

  /* ---- the crate a snail shoves across a gap ---------------------------- *
    * **Two surfaces and two sets, and it is the one prop in the county whose
    * reason for being split is a map rather than a material the game drives.**
    *
    * The boards are `plankChest-*` and not the county's `timber-*`, and the
    * difference is the wood: a fruit chest is planed softwood off a fresh tree -
    * warmer, paler and a good deal more saturated than a structural beam - and
    * `timber-*` is a weathered grey-brown face with a saw mark a tenth as fine on
    * it. The chest's three maps are read out of one field whose two largest terms
    * are the ones a height field cannot carry: a **knot** and a **check**, and a
    * check is a crack in the board rather than a thing on it.
    *
    * The brackets are `metal-*` and they are the county's **first metal**, which
    * is why they are a part of their own rather than a fifth colour in the wood's
    * vertices: a metalness is not a colour, it is a property of the surface, and
    * three.js will only read one out of a texture. So `metal-rgh` is handed to
    * `roughnessMap` **and** `metalnessMap` (see `mapSlots()`), the oxide takes
    * the metalness away to nothing because rust is not a metal, and the scuff
    * puts it back. The brass dome on a rivet head is the one warm thing on the
    * piece and it is a **vertex colour**, because a second map for one rivet is a
    * map nothing else in the county wears.
    *
    * And the crate's boards are its largest single face at race distance, which
    * is why it wears a colour at all: a plain board is a plain brown rectangle,
    * and there are eight of them across the road in front of every crate hole. */
  'push-crate': {
    '': ['plankChest-albedo', 'plankChest-n', 'plankChest-rgh'],
    metal: ['metal-albedo', 'metal-n', 'metal-rgh'],
  },
  /** The bower's hoop, and it is the county's only wrought-iron archway. `metal-*`
   * is the map pair `candle-lantern`'s frame and `push-crate`'s brackets already
   * wear, because it is one metal and a second file for it would be a map nothing
   * else wears. */
  'bower-arch': ['metal-albedo', 'metal-n', 'metal-rgh'],


  /* ---- no uv, no map --------------------------------------------------- *
   * Nine props that are committed glbs with no builder in this repository.
   * A tiling map is sampled by uv, and a binary nobody can open cannot be
   * given one, so these draw in their vertex colours and are ready for a
   * builder. Listing them here rather than leaving them out is the point: the
   * audit should be able to say "these nine are not done and here is why". */
  conifer: [], evergreen: [], broadleaf: [], tuft: [], marker: [], cactus: [], 'cactus-barrel': [],
  'lamp-post': [], 'lantern-post': [], 'lantern-glass': [],
  /** The pine, and it is in its own entry rather than on the list above because
   * **it is the one tree in the county with a builder and a map, and the list
   * above is a list of trees without either.** It was on that list with three
   * maps written into its empty array, which said two opposite things at once:
   * that it drew in its vertex colours, and that it did not.
   *
   * And the maps were on **both** of its parts, because an array entry answers
   * every part the same way - `mapsFor()` hands the whole list back whatever part
   * is asked for. So the trunk wore a needle map, and a needle map on a trunk is
   * a brown cylinder multiplied by a green, which is the argument the entry below
   * is written to close: the wood takes no map at all and the needles take all
   * three, **which is the same split `watchtower` and `push-crate` are drawn
   * with**, and for the same reason - a prop split into parts is split by surface,
   * and a needle is not bark. */
  pine: { '': [], leaves: ['pine-albedo', 'pine-n', 'pine-rgh'] },
  /* **And this one is not "no uv" - it has a uv and has chosen not to wear a map.**
   * The bower's canopy is two densities of one plant, so it is two meshes in one
   * file and `partList()` is the mechanism for that; the empty arrays are the
   * declaration and they are **load-bearing**. `converted()` is "does any part of
   * this prop name a map", so two empty arrays leave `bower-foliage` unconverted,
   * `propMatFor` has nothing for it, and the placement's material resolution falls
   * through to `mat.foliage` - which is on `WIND_MATS`, so the canopy bends.
   * **Omit the key entirely and the prop is not in `MAPS` at all**, which is a
   * different failure with the same symptom and nothing anywhere saying so. */
  'bower-foliage': { mass: [], spray: [] },
  /**
   * **And the litter, which is a file of its own and not a third part**, because it
   * takes a different material: dead leaves lie on the ground and **must not take
   * the wind**, and the wind is a property of the material, so a brown leaf in
   * `mat.foliage` is a leaf in the air. Green in `mat.foliage` and bending, brown
   * in `mat.vcol` and still - which is the whole of the split, and the reason it is
   * a model rather than a part.
   *
   * Empty for the same reason and under the same rule as the foliage above:
   * **empty means unconverted**, which means `propMatFor` has nothing for it and
   * the placement's own material argument is what draws it.
   */
  'bower-litter': [],

  /* ---- the tintable three: low-chroma, hue left to the game ------------- *
   * The snail and the three shells are recoloured by the editor, so they get
   * detail and no colour: a map under `applyLook()` turns the tint into a hue
   * shift, and the whorl patterns stay in the vertex colours, which multiply
   * the tint.
   *
   * **And the `-tone` is grey and near-white and not an `-albedo`, which is the
   * only way a base-colour slot is legal on a piece the editor recolours.** The
   * snail is sixty-five racers in sixty-five colours off one file, so anything a
   * map puts down here is put down on all of them: a hue in this pair is a hue
   * the player never chose, and a full-range one darkens every racer by a third.
   * A `-tone` moves the value of the tint by about a tenth and cannot touch its
   * hue, which buys the one thing a normal map cannot draw - **where the dirt
   * sits**, in the ring and in the pore, and in the suture. See `tone()` in the
   * texture builder for the window and the bound.
   *
   * **And the snail's entry is the one that used to be dead.** The loader skips
   * the snail file outright - `if (name === 'snail') { snailTemplate = root;
   * continue; }` - because the snail is a *tree* and every other file is one
   * mesh, so `applyMaps()` is never called on it and this entry bound to nothing
   * at all. `race.js` builds its four materials by hand and hands them the maps
   * itself now; the entry is here because it is the record of what a snail wears
   * and because `tools/inspect.html` audits it.                                        */
  'shell': ['shell-n', 'shell-rgh', 'shell-tone'],
  snail: ['snail-n', 'snail-rgh', 'snail-tone'],

  /* ---- the wardrobe: no maps at all, and that is a decision ------------- *
   * Sixteen empty entries, one per face and hat, and **an empty array is the
   * documented "not converted yet" state** - so they fetch no texture, they draw
   * in their vertex colours exactly as the unconverted props do, and
   * `allMaps()` is unchanged, which is what keeps `info.targets` at 23.
   *
   * A face is a four-centimetre object and a hat is a silhouette, so a tiling
   * map would be a map sampled at a scale nobody could see: the ear of a straw
   * is two millimetres of geometry and a normal map on it is a normal map on
   * one triangle. If any of these ever does want a map the answer is a whole
   * colour per hat in the vertex colours, out of `meshes/palette.js`, and not a
   * grain - and declaring it here is the only half of that change. */
  'face-plain': [], 'face-cheer': [], 'face-dollar': [], 'face-keen': [],
  'face-smug': [], 'face-grim': [], 'face-tidal': [], 'face-winged': [],
  'face-wild': [], 'face-googly': [], 'face-fangs': [], 'face-grin': [], 'face-crest': [],
  'face-devil': [],
  'hat-straw': [], 'hat-top-hat': [], 'hat-propeller': [], 'hat-sunglasses': [],
  'hat-bonnet': [], 'hat-wizard': [], 'hat-devil-horns': [],
};

/**
 * The props drawn with the material out of their own file rather than one of
 * the game's own. A prop is on this list when the game has something to say
 * about how it is lit that the file cannot say - which today means the paper
 * and the glass of a lantern, because the hour drives those by material name.
 * They are excluded from `CONVERTED`, so `scatter()` leaves their materials
 * alone, and the maps are attached by hand where the hour can see them.
 *
 * **`candle-lantern` is deliberately not on this list, and the reason is its
 * first part rather than its other three.** A prop here has *every* part drawn
 * in a material the game owns, because the exclusion is what stops the generic
 * path swapping them back - and the candle lantern's frame is none of the game's
 * business: it is the county's only metal on a piece the player walks past, it
 * wears `metal-albedo`/`metal-n`/`metal-rgh` like the crate's brackets, and it
 * wants its own file's material with a metalness of one on it. Put the prop here
 * and `matFor()` hands back `mat.rock` and the frame comes up a dark grey
 * plastic box with a lantern in it. So the candle lantern is converted like any
 * other piece of metal and **names its materials per part at the one call site
 * that places it**, which is `placeLamps()`, on the same argument the paper
 * lanterns name theirs in `lanternParts()`.
 */
export const GAME_MATERIAL = new Set(['lantern-pole', 'lantern-arch', 'lamp-glass']);

/**
 * The maps one part of one prop declares. A prop that is an array has the same
 * on every part; a prop that is an object has its own per part, and a part it
 * does not name gets none.
 */
export function mapsFor(prop, part = '') {
  const entry = MAPS[prop];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : (entry[part] || []);
}

/**
 * Which slot each map name is for. A file is a file: `rock-n.png` is read
 * once and handed to whatever slot the table says it is, so the same grain
 * can be the normal map of a stone and the normal map of the moss on it.
 *
 * **`-tone` is the odd one out and it is not a colour.** It lands in the same
 * `map` slot as `-albedo` and it is read as sRGB, so three.js multiplies it into
 * the diffuse - but it is drawn in **grey** (r = g = b) and never leaves the top
 * of the range, sRGB 0.93 to 1.0, so what it can do is move the **value** of
 * whatever is underneath it by about a tenth and never touch its hue. That is
 * the only way a base-colour slot is allowed on a prop whose colour is doing
 * per-part work in its vertices: an `-albedo` cannot come near 1.0 and still be
 * a colour, so it darkens the piece and flattens the palette underneath it,
 * where a near-white one is only ever a shadow in the right place. A `-tone` is
 * for the detail a normal map cannot draw - bruising, dirt in a crevice, the
 * bleaching on the weather side - and never for painting the piece.
 */
export const SLOT_OF = {
  '-albedo': 'map',
  '-tone': 'map',
  '-n': 'normalMap',
  '-n2': 'ripple2',
  // not a material slot: a height field the course surface's own POM injection
  // reads by name out of `MAPS_TEX`, the same shape as `ripple2` - the water's
  // second normal is handed to the shader rather than the material, and three
  // has no `heightMap` field, so a `-h` texture is fetched into the one map
  // table and read by `detailOf(r.key, 'heightMap')` only. `mapSlots()`
  // answers `['heightMap']`, which is not in `MATERIAL_SLOTS`, so the loader
  // never tries to assign a `m.heightMap` field.
  '-h': 'heightMap',
  '-rgh': 'roughnessMap',
  '-ao': 'aoMap',
  '-em': 'emissiveMap',
};

/** The slot a declared map name is for, or null if the name is not one. */
export function slotFor(mapName) {
  for (const [suffix, slot] of Object.entries(SLOT_OF)) {
    if (mapName.endsWith(suffix)) return slot;
  }
  return null;
}

/**
 * The material fields one map name fills, which is **one name and sometimes two
 * fields**, and the reason is three.js's rather than ours: `roughnessMap` reads
 * the green channel and `metalnessMap` reads the blue one, out of two separate
 * fields on the material. A `-rgh` is written in the glTF packing - roughness in
 * green, metalness in blue - so it goes to both, exactly as the glTF loader puts
 * one `metallicRoughnessTexture` on both.
 *
 * Every other slot is a list of one, so this is the one place a caller has to
 * know that a slot can be more than a field. It is a function and not a second
 * column in `SLOT_OF` because `slotFor()` answers a different question - which
 * *kind* of map this is, for the texture page's caption and for the surface's own
 * lookup - and that question has one answer.
 *
 * Assigning both to every `-rgh` in the library is harmless and is deliberate:
 * the blue channel of every other one in `meshes/tex/` is zero, and a metalness
 * multiplied by zero is the metalness it already had.
 */
export function mapSlots(mapName) {
  const slot = slotFor(mapName);
  if (slot === 'roughnessMap') return ['roughnessMap', 'metalnessMap'];
  return slot && MATERIAL_SLOTS.has(slot) ? [slot] : [];
}

/**
 * The course surface, which is not a prop and is not in `MAPS`: the ground, the
 * track and skirt, and the water. The ground and the track have no UVs - they are
 * built along a spline and their colour is sampled in world XZ at four
 * frequencies - so their detail normal is triplanar, projected from the world
 * position in the shader. The water is built row by row down each pool and
 * knows its own `s`, so it does get real UVs.
 *
 * `grass-albedo` is in this table but is not a `map` on anything: it is the
 * detail the vertex colours cannot hold, sampled triplanar by the same shader
 * and multiplied into the diffuse. A course verge does not need it - a vertex
 * every two metres carries that ground's colour perfectly well - but the
 * stable's lawn is a forty-segment fan with one vertex in the middle of it, and
 * a fan cannot draw anything finer than the eight metres across it.
 *
 * `grass` is the turf, and it is a surface in its own right and not an alias of
 * the ground. The ground and the track are built along the spline and are metres
 * across; a tuft is a third of a metre and there are six thousand of them, so the
 * same grain at the tile each one needs is a different tile for each, and the map
 * is the same map at two scales rather than two maps.
 *
 * It carries **both halves of the pair**, and the colour half is the one that was
 * missing for a long time: `grass-albedo` was listed under `ground` only, so
 * `detailOf('grass', 'map')` came back empty and every call that asked the turf
 * for its colour got nothing - silently, because `triplanarDetail()` returns
 * early on a null map. The ground and the tufts were a flat vertex colour with a
 * normal on it, and the stable's lawn, which asks `ground` for the same file, was
 * the only green surface in the county wearing the map. It is the same file, so
 * it is declared on both, and the two `detailOf` calls are the only places that
 * have to know which one a surface reads it off.
 *
 * The lawn disc is still on the **ground's** normal, and that is not an
 * oversight: it is metres across and lit by a camera a metre and a half off it,
 * and it wants a coarser grain in the normal and a finer one in the colour, which
 * is the one place in the county the two tiles disagree. The courses are not like
 * that - the ground and the tufts put both halves on one tile, so a pale stem in
 * the colour is the stem the light is coming off.
 */
export const SURFACE = {
  ground: ['ground-n', 'ground-rgh', 'grass-albedo', 'grass-h'],
  /**
   * The track, and it is `track-n` plus a **colour** and not a tint of the
   * cliff's.
   *
   * The ribbon is built along the spline and has no UVs, so its detail is
   * triplanar in both halves and both come out of one field in the texture
   * builder - the same bargain the cliff and the shore strike, and for the same
   * reason. A vertex every two metres holds the track's colour and nothing finer
   * than the patch it was sampled from, and a normal map is shape and not
   * value: without a colour the track came up as one flat brown card with a
   * bump on it, and the dust swept pale down the middle and the crushed brick
   * at the verges - the first thing a viewer reads as a course rather than as a
   * strip of ground - were nowhere in it.
   *
   * Its colour sits **close to** one where the cliff's sits well under it, and
   * the difference is deliberate rather than a matter of taste: the cliff's map
   * is *meant* to darken the face, because a face is weathered a long way below
   * its top, and the track's is not, because a track is the colour it is and
   * what it lacked was grain. The rock half of the same ribbon wears none of
   * this at all - see `mat.ramp`.
   *
   * And it carries **no hue of its own**: the red is in the ribbon's vertex
   * colours (`clay`, `clayDeep`, `clayDust` in the jar) and this is the multiply
   * that puts the grain on them, which is the arrangement every other surface
   * in the county uses and the only one a saturated colour can use. A detail map
   * painted about the clay's own red would multiply the clay by the clay and
   * the track would come up a stop and a half hot.
   */
  track: ['track-n', 'track-rgh', 'track-albedo', 'track-h'],
  /**
   * The cliff, and it is here rather than on `track` because a flank and a road
   * are two surfaces that happen to be drawn in strips of the same width a few
   * metres apart. This is **the face**: a bedded rock, which is a stack of beds
   * with near-vertical joints cutting across them, banded in value with the
   * bedding and streaked with what the rain runs down it. It is worn by
   * `mat.course`'s second set and by the flank in `mat.ledge` - by every surface
   * that is actually a cut in the ground.
   *
   * It was not always this. The face and the ramp wore **one** map for as long as
   * there was one, and it was a field whose plate dominated its bedding and whose
   * value was a hash per cell - so it came out as a packing of rounded stones,
   * and a wall wearing it read as a retaining wall of setts. That field is now
   * `cobble`, below, and it is worn by the ramp alone. The two share a tile, a
   * strength and a resolution, and the four terms that were re-weighted are the
   * whole of what they are not the same map.
   *
   * All three maps come out of **one** field in the texture builder, so the bump
   * is under the pale bed that made it pale. And the colour is here at all rather
   * than being baked into the mesh's vertex colours: a cliff's appearance should
   * not change when the lane's vertex colours are re-tuned for a race that is
   * not running.
   */
  cliff: ['cliff-n', 'cliff-rgh', 'cliff-albedo', 'cliff-h'],
  /**
   * The cobbled road, and **nothing in the county wears it.**
   *
   * This is the field that used to be `cliff`'s, unchanged and byte for byte,
   * renamed: a packing of rounded stones whose value is a hash per cell, which
   * is a setts surface and is not a bedded rock. It was on both the face and the
   * ramp, and on the face it came out as a retaining wall of setts - which is
   * what the new `cliff` above exists to answer.
   *
   * It is declared rather than deleted for two reasons. It is still drawn here,
   * so it can be regenerated and looked at without inventing a second drawer for
   * it; and it is a real surface the county could want - a kerb, a plaza, a yard
   * - and a map that is not in the manifest is one `tools/inspect.html` calls a
   * hole. It costs the loader one fetch per file, which is what it cost before
   * the rename: the game reads it out of `SURFACE` into its map table and no
   * material ever asks for it.
   *
   * So **do not point a `triplanarSets()` at this one** until a surface wants a
   * road. `mat.road`'s rock set is the cliff's map at a gain, and the gain is
   * what takes the weather off it.
   */
  cobble: ['cobblestone-n', 'cobblestone-rgh', 'cobblestone-albedo'],
  /**
   * The bower's setts, and **this is a second cobbled road and not a repair of the
   * first.** `cobble` above is a different surface the county declares and nothing
   * wears; `bowerSetts` exists because the bower's road is the one place in the
   * county whose detail albedo carries **hue** - the per-stone warm/cool spread
   * of `references/cobble.jpg` is the loudest thing in the reference, and
   * `materials.js`'s `diffuseColor.rgb *= dc / dsum` is a *multiply*, so a multiply
   * cannot widen the chroma of what is under it. Red clay under a blue-grey sett
   * is a dark desaturated red, and the spread collapses. `buildRoad()` therefore
   * desaturates the road's own vertex colour to its own **luminance** where the
   * setts are, so the map's hue passes through untouched - which is a vertex's
   * own value and not a seventeenth `PAL` key.
   *
   * **That is the whole reason this entry exists and it inverts `track`'s note
   * above** ("it carries no hue of its own", stated as an invariant), so it is
   * worth saying plainly which half of the pair is load-bearing: the map carries
   * the chroma **and** the colour underneath goes neutral, and neither alone is a
   * subtle degradation - one gives red stones, the other gives grey ones.
   *
   * **And it is deliberately a new name.** `cobblestone-albedo` is declared twice
   * in the drawer's one object literal and the second wins, so the file under that
   * name is a cracked limestone and not a road; pointing a `triplanarSets()` at
   * `cobble` would have meant inheriting it. **That is a real bug and it is not
   * fixed here** - fixing it changes what an existing texture means, on a surface
   * this one does not use. It is reported by the drawer gate in `tools/check.sh`,
   * which is left red on purpose, and the new name has nothing behind it, so the
   * collision cannot touch it.
   */
  bowerSetts: ['bowerSetts-n', 'bowerSetts-rgh', 'bowerSetts-albedo', 'bowerSetts-h'],
  /**
   * The dressed limestone, and it is **`limestoneBrick` and not `limestone`
   * because the name went to the other one.**
   *
   * This is a bedded cream that a claw has cut, coursed into blocks with a run
   * of tooling across them, and it is the tower's masonry. The county's own
   * limestone - the buff face with the soil weathered out of it, un-coursed,
   * flaky and pitted - now holds the plain name and the tower wears **that**
   * one, so this file is a working stone rather than the one in the picture,
   * and it is a *brick* in the sense that it is laid in courses.
   *
   * So this is declared as a **surface** and not as a prop, and nothing wears
   * it: the three maps are here so the audit does not call them a hole and so a
   * retaining wall, a kerb or a gatepost is one line away. Note the name is a
   * prefix of nothing - `limestone-` and `limestoneBrick-` cannot be confused by
   * `name.startsWith()`, because the dash is in the first one and not the
   * second.
   */
  limestoneBrick: ['limestoneBrick-n', 'limestoneBrick-rgh', 'limestoneBrick-albedo'],
  /**
   * The county's own limestone, and it is **worn: the tower is its prop.**
   *
   * This is the stone a course is cut through - a buff, iron-stained face taken
   * apart by weather and not put back, flaky in plates and pitted with solution
   * holes - and the reference it is drawn from is a ground surface, so it has no
   * courses and no tooling in it at all. It is the surface the county is made
   * of and the tower is what draws it, so unlike the two above it carries a
   * **roughness** as well as a colour and a normal: read by uv as a prop's
   * maps are, it can take one, and it does, because a bare face whose exposed
   * flakes are polished by weather and whose pockmarks hold dirt is the only
   * finish in the county that varies across its own face.
   */
  limestone: ['limestone-n', 'limestone-rgh', 'limestone-albedo'],
  /**
   * The shore, and it is a **fourth** surface and not a tint of the ground.
   *
   * The band of sand round every pool is the largest flat pale area in the
   * county, and it is a vertex colour every two metres laid down a spline - so
   * it is a flat pale area, with no grain in it at all, next to a meadow and a
   * cliff that both have one. It gets a normal and a colour of its own for the
   * same reason the cliff does, and out of `SAND()` in the texture builder
   * rather than `TURF()`: a shore is a long low ripple and a grass blade is
   * neither.
   *
   * It carries no roughness map, for the reason the ground and the track do not
   * either - the ground is built along the spline and has no uv, and a
   * `roughnessMap` is read by uv, so one hung here would be sampled at (0,0) for
   * every fragment and would be a single texel of it for ever.
   */
  sand: ['sand-n', 'sand-albedo', 'sand-h'],
  water: ['water-n', 'water-n2'],
  grass: ['grass-n', 'grass-albedo', 'grass-h'],

  /* ---- the ashlands --------------------------------------------------- *
   * The four roles the second biome names, and each is one field in the texture
   * builder feeding two or three maps, because a bump that is not under the pale
   * bed that made it pale is two textures laid over each other. All three of each
   * is the county's rule and not this block's: the course surface has no uv, so
   * `roughnessMap` cannot be hung on it (it is read by uv, and a missing
   * attribute is `(0,0)` - one texel, for ever) - and these are declared for the
   * audit and for the builder, not because anything reads them as a prop's.
   *
   * They are **declared rather than dropped in** because a biome's role has to
   * name a key this table has heard of, and `tools/plan-test.mjs --biomes` is
   * what checks it: a role pointing at nothing is a surface with no map on it and
   * nothing in the console, because `detailOf()` answers `null` and
   * `triplanarSets()` filters a null map out and keeps its other sets.            */
  /**
   * The ash turf, and it is **fine grey ash over a broad crust**: a stem's width
   * in the relief and a meter's in the value, because that is what a mat of ash
   * is - the crust is a value change across a metre and the ash on it is a
   * centimetre of relief, and a map that has only the second reads as a smooth
   * card and one that has only the first reads as a field of chips of stone.
   *
   * The tile is the meadow's five metres and the strength is a shade over its
   * 0.30, on the meadow's argument: a detail map's strength is a function of its
   * tile, and the tile is the one the ground's is.
   */
  ashGrass: ['ashGrass-n', 'ashGrass-albedo', 'ashGrass-h'],
  /**
   * The basalt, and it is **columnar, and the columns are the whole of it.**
   *
   * Columnar basalt's columns are the cliff's joint pattern in three
   * dimensions, and this is the face that carries it - and `basalt-column.glb`
   * is the prop that proves the map is right, because a thing you can walk round
   * and a thing you can only see edge-on have to agree.
   *
   * **It is drawn the way the cliff is drawn and not the way the cobbles are**,
   * and that is the one line in this file that will be got wrong by anybody
   * copying the nearest example: a cellular lattice closes every cell on all
   * four sides, so a face built out of one is a net of closed cells however good
   * the cells are, and a net of closed cells is the cobbled road under a new
   * name - the same word as crazing and the same failure, which is what made
   * `cliff` and `cobble` two files in the first place. So the joints here are a
   * **one-dimensional lattice of grooves**, six to the tile, each with its own
   * width and its own place inside its own cell, and each **thresholded shut over
   * part of its own length** so a joint dies and restarts and a good part of the
   * face carries no joint at all. The flat planes come from a coarse lattice used
   * the one way a cell can be used without becoming a net: every cell gets a flat
   * value of its own and the boundary between two of them is a change of plane,
   * with `plate` absent from `crack` and kept absent - a value discontinuity is an
   * edge and a *darkened* one is a joint.
   */
  basalt: ['basalt-n', 'basalt-rgh', 'basalt-albedo', 'basalt-h'],
  /**
   * The cinder, which is the ashlands' shore and is **coarse gravel, a hand's
   * width of a crest and nothing finer.** It sits between the turf and the cliff
   * in value, because ash falls on things and a shore is where it lands.
   *
   * It carries no roughness for the reason every other course surface does not:
   * the ground is built along the spline and has no uv.
   */
  cinder: ['cinder-n', 'cinder-albedo', 'cinder-h'],
  /**
   * The ashlands road, and it is **packed ash and grit, swept, and the sweep is
   * the thing you read.** A road's detail has to say where the lane is from four
   * hundred metres, and in the meadow that is `clay`'s red doing it with a
   * chalk line on top; out here the road is a dark grey and the *sweep* - the
   * paler grit raked down the middle of it and the packed, near-black ash either
   * side - is the only contrast the surface has. So it is `uv: true` on the same
   * argument as the clay's, at the same tile, and it carries a colour for the
   * same reason the clay's does.
   */
  ashTrack: ['ashTrack-n', 'ashTrack-rgh', 'ashTrack-albedo', 'ashTrack-h'],
};

/** Every map name the whole library declares, de-duplicated and in order. */
export function allMaps() {
  const seen = new Set();
  for (const entry of Object.values(MAPS)) {
    for (const m of (Array.isArray(entry) ? entry : Object.values(entry).flat())) seen.add(m);
  }
  for (const list of Object.values(SURFACE)) for (const m of list) seen.add(m);
  return [...seen];
}

/**
 * The props that have been converted: the ones with at least one map on them,
 * on any part. A prop is drawn with the material its own file declared once
 * and only once it is in here, so a library part-way through the migration
 * looks exactly as it did before for every prop still to be done.
 */
export function converted() {
  return Object.keys(MAPS).filter((name) => !GAME_MATERIAL.has(name)
    && allParts(name).some((k) => mapsFor(name, k).length));
}
/** The part names one prop is split into, `''` for a piece of one surface. */
export function allParts(name) {
  const entry = MAPS[name];
  return Array.isArray(entry) || !entry ? [''] : Object.keys(entry);
}
export const CONVERTED = converted();
