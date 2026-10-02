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
   * before they can be converted.                                            */
  bush: ['leaf-n', 'leaf-rgh'],
  lily: ['leaf-n', 'leaf-rgh'],
  'lily-pad': ['leaf-n', 'leaf-rgh'],
  reeds: ['leaf-n', 'leaf-rgh'],
  'corn-plot': ['leaf-n', 'leaf-rgh'],
  'sprout-plot': ['leaf-n', 'leaf-rgh'],

  /* ---- the mushrooms -------------------------------------------------- *
   * All three are three surfaces wearing three pairs, and the shape of the
   * argument is in the pale one below. `mushroom-n` and `mushroom-rgh` stay on
   * disk for nothing and are no longer declared: they were one isotropic noise
   * drawn across a cap and a stem and a set of gills, and an isotropic noise can
   * only draw a scratch. A cap made of them came out as a dusty disc.
   *
   * The `-tone` on each is not a colour and is the reason there is a `map` slot
   * on any of them at all - see `SLOT_OF`. All three mushrooms wear all three.
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
   * `mushroom-pale-cap` and `mushroom-pale-gills`. The other two are written out
   * at their alphabetic places above and are the same three keys.
   */
  'mushroom-pale': {
    '': ['mushroom-stem-n', 'mushroom-stem-rgh', 'mushroom-stem-tone'],
    cap: ['mushroom-cap-n', 'mushroom-cap-rgh', 'mushroom-cap-tone'],
    gills: ['mushroom-gill-n', 'mushroom-gill-rgh', 'mushroom-gill-tone'],
  },

  /* ---- the lanterns ---------------------------------------------------- *
   * These are the two props that cannot be drawn with the material out of
   * their own file, and the reason is in the game: `mat.paper` and
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


  /* ---- no uv, no map --------------------------------------------------- *
   * Ten props that are committed glbs with no builder in this repository.
   * A tiling map is sampled by uv, and a binary nobody can open cannot be
   * given one, so these draw in their vertex colours and are ready for a
   * builder. Listing them here rather than leaving them out is the point: the
   * audit should be able to say "these ten are not done and here is why". */
  conifer: [], evergreen: [], broadleaf: [], tuft: [], marker: [],
  'lamp-post': [], 'lantern-post': [], 'lantern-glass': [],
  'mushroom-red': [], 'mushroom-brown': [],

  /* ---- the tintable three: low-chroma, hue left to the game ------------- *
   * The snail and the three shells are recoloured by the editor, so they get
   * detail and no colour: a map under `applyLook()` turns the tint into a hue
   * shift, and the whorl patterns stay in the vertex colours, which multiply
   * the tint.                                                                */
  'shell-bands': ['shell-n', 'shell-rgh'],
  'shell-swirl': ['shell-n', 'shell-rgh'],
  'shell-spots': ['shell-n', 'shell-rgh'],
  snail: ['snail-n', 'snail-rgh'],
};

/**
 * The props drawn with the material out of their own file rather than one of
 * the game's own. A prop is on this list when the game has something to say
 * about how it is lit that the file cannot say - which today means the paper
 * and the glass of a lantern, because the hour drives those by material name.
 * They are excluded from `CONVERTED`, so `scatter()` leaves their materials
 * alone, and the maps are attached by hand where the hour can see them.
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
  ground: ['ground-n', 'ground-rgh', 'grass-albedo'],
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
  track: ['track-n', 'track-rgh', 'track-albedo'],
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
  cliff: ['cliff-n', 'cliff-rgh', 'cliff-albedo'],
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
  sand: ['sand-n', 'sand-albedo'],
  water: ['water-n', 'water-n2'],
  grass: ['grass-n', 'grass-albedo'],
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
