/* ================================================================== *
 * materials.js
 *
 * Everything that decides what a surface looks like: the glb loader and the map
 * manifest behind it, the material jar, the palette adapter, and the four
 * injections that put the weather on a thing - cloud shade and wind on the
 * county's own five surfaces, the wind again on the material the occlusion
 * buffer is built out of, and the water's own Fresnel.
 *
 * **The four injections belong here and not in the settings module, and that is
 * the one placement in this file that was not obvious.** They read only `gfxU`
 * and the material, they write uniforms and nothing else, and the settings
 * module's whole business is the ladder - so a file about how the county is
 * *drawn* asking a file about how deep the *fog* goes for `uCloudAmt` was the
 * wrong way round. It is also what puts them upstream of everything: `post.js`
 * needs `gtaoWind` for a material three.js wrote itself, `scenery.js` needs
 * `windMark` on six thousand instances, and `surfaces.js` needs `mat`, so this
 * file is a leaf every one of them hangs a shader off.
 *
 * **The injections chain and never replace.** Four of the county's materials
 * already carry an `onBeforeCompile` of their own, given to them by
 * `triplanarDetail()` and `triplanarSets()`, and a second `onBeforeCompile` is a
 * replacement - so putting this one behind would silently take the surface's own
 * detail map off it, which is the whole reason those two exist. `afterCompile()`
 * is the chain, and `gfxSurface()` is the only caller of it that decides what a
 * surface gets.
 *
 * `BARK`, `MUSHROOM_RED` and `MUSHROOM_BROWN` are in the palette adapter below
 * and nothing reads them: the mushrooms are coloured by their own glb and the
 * bark is baked into the tree files' vertex colours. They came out of the game
 * whole and they are staying that way through a move.
 * ================================================================== */
import { COUNTY as C, FLOWER_COLORS as FLOWER_HEX, GREEN as GREEN_T, STONE as STONE_T } from '../meshes/palette.js';
import { CONVERTED, MAPS, SURFACE, allMaps, allParts, mapSlots, mapsFor, slotFor } from '../meshes/maps.js';
import { BIOMES, SET_ROLES } from '../meshes/biomes.js';
import { THREE, $, clamp, smoothstep } from './core.js';
import { LAMP_COLOUR } from './graphics.js';/* ================================================================== *
 * The meshes live in meshes/ as .glb files: a prop is written once and
 * drawn a thousand times, and a snail is one file that is cloned per racer
 * and recoloured. Only the course itself is still built here, because it is
 * built out of the numbers in races.json - the ground, the bed, the skirt,
 * the water and the start and finish furniture all come from the track.
 * ================================================================== */
const MESH_FILES = [
  'conifer', 'evergreen', 'broadleaf', 'cherry-tree', 'bush', 'cactus', 'cactus-barrel', 'rock', 'mossy-rock', 'tuft', 'marker', 'lily', 'lily-pad', 'reeds', 'seashell',
  'lamp-post', 'lamp-glass', 'lantern-post', 'lantern-glass',
  'mushroom-red', 'mushroom-brown',
  'mushroom-giant', 'mushroom-pale', 'mushroom-rooted',
  'lantern-pole', 'lantern-arch', 'candle-lantern',
  // **And the bower's two**, beside the lantern arches and not in a block of
  // their own: a piece in the county is not in a biome, and the table says so
  // where the ashlands' eight are listed. `bower-arch` is one mesh and wears
  // `metal-*`; `bower-foliage` is two meshes in one file, because it is two
  // densities of one plant.
  'bower-arch', 'bower-foliage', 'bower-litter',
  'hut', 'windmill', 'barn', 'well', 'scarecrow', 'crate', 'push-crate', 'fence',
  'corn-plot', 'sprout-plot',
  'palm', 'fountain',
  'watchtower',
  // **And one shell, and there is no `shell-` prefix to it.** The snail wore three
  // whorls - `shell-bands`, `shell-swirl`, `shell-spots` - cut here from three numbers,
  // and the shop had a row of three buttons that chose between them. The shell is now
  // the reference model's own coil, cut out of `references/snailRef.glb` by
  // `meshes/build-shell.html` and **one file**, so the key is the bare name: a key that
  // is built by concatenation is a place where the file could be called something the
  // loader never fetched, and `props['shell-' + style]` was exactly that shape.
  'shell',
  // **And the ashlands' eight**, and they are on this list rather than behind a
  // branch: a file that is not named here is not loaded at all, so a biome that
  // named a prop the loader never heard of would place nothing and say nothing -
  // `scatter()` filters a null geometry out and the arrangement comes up a piece
  // light. `tools/plan-test.mjs --biomes` is the gate that says so before a
  // browser is ever asked, and `tools/e2e/biome.spec.js` is what checks the count
  // in one.
  'ash-tree', 'basalt-column', 'ash-tuft', 'vent', 'obsidian-shard',
  'ash-scrub', 'ash-fallen', 'snag', 'pine',
  'snail',
];
/**
 * **The wardrobe is the same library in two folders, and `MESH_FILES` does not
 * become a list of paths.** The part-key logic below decides a prop's parts by
 * slicing `name + '-'` off each mesh's own name, so a name has to be the file's
 * bare name for that to work at all - and it is also the name `mapsFor()`,
 * `propMatFor`, `matFor()` and `allParts()` are keyed by. So a set carries the
 * folder it lives in and the prefix its names share, and the loader fetches
 * `meshes/<dir>/<file>.glb`, validates it against `prefix + '-' + file`, and
 * registers it under **the flat `'face-' + file`**. **The flat key is the whole
 * of it**: nothing downstream learns that a second namespace exists, a face is
 * looked up exactly the way a shell is, and `makeSnail()`'s `faceFor`/`hatFor`
 * are one concatenation.
 *
 * Nothing here is scattered, so nothing here needs a placement call, and every
 * geometry is marked `userData.shared` as usual - sixty-five racers and one
 * plinth snail share sixteen buffers, and `dropCourse()` cannot free a
 * face's geometry out from under a snail on the stable.
 */
const MESH_SETS = [
  {
    dir: 'faces', prefix: 'face',
    files: ['plain', 'cheer', 'dollar', 'keen', 'smug', 'grim', 'tidal', 'winged', 'wild',
      'googly', 'fangs', 'grin', 'crest', 'devil'],
  },
  {
    dir: 'hats', prefix: 'hat',
    files: ['straw', 'top-hat', 'propeller', 'sunglasses', 'bonnet', 'wizard', 'devil-horns'],
  },
];
const props = {};
const propMat = {};
/**
 * A geometry to the material its own file declared, and only for the props that
 * have been converted. `scatter()` looks a part up here, so a prop that has
 * maps is drawn with them without a call site having to say so, and a prop that
 * has none is drawn with the material the call site asked for - which is what
 * makes the migration one prop at a time.
 */
const propMatFor = new Map();
const CONVERTED_SET = new Set(CONVERTED);
let snailTemplate = null;
/** The material a prop is drawn with: its own file's once it has maps, the
 *  call site's otherwise. One answer, so every site in the game agrees. */
function matFor(name, fallback) {
  if (!CONVERTED_SET.has(name)) return fallback;
  return propMatFor.get(props[name]) || propMat[name] || fallback;
}
/**
 * The material one **part** of a prop is drawn in, which is not the same
 * question as `matFor` and cannot be asked through it: `props[name]` is the
 * piece itself, and a piece of three parts has two of them the loader has
 * already registered materials for under its own geometry. A windmill's sails
 * are the case that needs it - they are the only part of any prop in the county
 * that is drawn in a material the game never named.
 */
const partMat = (geo, fallback) => propMatFor.get(geo) || fallback;
/**
 * Pull in the mesh library. Every file is one mesh; the snail is one tree.
 *
 * The material in the file is kept, not thrown away. That is the change that
 * makes maps possible at all: the game used to take the geometry and hand the
 * prop one of its own `mat.*`, so a `map` or a `normalMap` written into a glb
 * had nowhere to survive. The material GLTFLoader hands back already has the
 * right name, the right roughness and `vertexColors` set the way the file asked,
 * and the name matters: `makeSnail()` buckets a racer's meshes by
 * `o.material.name` and repaints four of them, leaving `eye` alone.
 *
 * The glb carries no images, so the maps come from `meshes/tex/` by name, out
 * of the one manifest in `meshes/maps.js`. A prop whose maps have not been
 * written yet simply has none, and draws as it always did.
 */
async function loadMeshes() {
  const { GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const tex = await loadMapTextures();
  const live = CONVERTED_SET;
  // **Every file the county draws, as `{ name, path }` pairs.** The flat list and
  // the two wardrobe sets are the same shape here, which is the point: the fetch
  // asks for `path`, and everything below - the part slicing, the maps, the
  // registry keys, the `foot` figure - sees only `name`, which is the bare file
  // name for a prop and `'face-' + file` for a wardrobe piece. One loop over one
  // list is why a face needs no special case anywhere in this function.
  const jobs = MESH_FILES.map((name) => ({ name, path: 'meshes/' + name + '.glb' }));
  for (const set of MESH_SETS) {
    for (const file of set.files) {
      jobs.push({ name: set.prefix + '-' + file, path: `meshes/${set.dir}/${file}.glb` });
    }
  }
  const loaded = await Promise.all(jobs.map(async (job) => {
    $('boot').textContent = 'loading the meshes…';
    return [job.name, job.path, await loader.loadAsync(job.path)];
  }));
  for (const [name, path, gltf] of loaded) {
    const root = gltf.scene.getObjectByName(name) || gltf.scene.children[0];
    if (name === 'snail') { snailTemplate = root; continue; }
    // Most of these are one mesh. A lantern is two, because its paper is the
    // part that lights up and the frame it hangs on is not: so everything the
    // file holds is kept, keyed by the part each mesh is named after, and the
    // first is the piece itself. The part name follows the file name with a
    // dash - a dot would not survive the trip through the glb, and then a
    // lantern would quietly draw as its frame and nothing else.
    const parts = {}, mats = {};
    let strays = 0;
    // the whole scene, not the node the name matched: a piece made of parts has
    // a node for each of them and none of them carries the bare name
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // one geometry for every racer and every track that draws it, so it is
      // marked shared and survives a course being torn down
      o.geometry.userData.shared = true;
      const key = o.name.startsWith(name + '-') ? o.name.slice(name.length + 1) : '';
      if (key) { if (!parts[key]) { parts[key] = o.geometry; mats[key] = o.material; } return; }
      if (parts['']) { strays++; return; }
      parts[''] = o.geometry; mats[''] = o.material;
    });
    const keys = Object.keys(parts);
    if (!keys.length) throw new Error('no mesh in ' + path);
    // a piece with parts and a mesh that is not one of them would draw as half
    // of itself, which is worse than not drawing at all
    if (strays) throw new Error(`${path}: ${strays} mesh(es) not named "${name}-part"`);
    // every part of a piece draws in the first part's material unless its own
    // says otherwise, so a file with one material is one material and a file
    // with two gets two. The maps are named in the manifest, not embedded, and
    // a prop split into parts is named per part, because the moss on a stone
    // is not granite.
    const fileMat = mats[keys[0]];
    for (const key of keys) {
      const m = mats[key] || fileMat;
      applyMaps(m, mapsFor(name, key), tex);
      if (live.has(name)) propMatFor.set(parts[key], m);
    }
    props[name] = parts[keys[0]];
    propMat[name] = fileMat;
    if (keys.length > 1) { props[name + '.parts'] = parts; propMat[name + '.parts'] = mats; }
    // How much ground the piece stands on, in metres: the furthest it reaches
    // from the axis of its own origin in the horizontal plane. A bounding
    // sphere is no use here - a mushroom is as tall as it is wide and a
    // windmill is twice as tall as it is wide, and a sphere would have the
    // windmill reserving twice the clearing it needs. This is the number the
    // arrangement below uses to keep two big things off each other, so it is
    // the piece's own geometry answering and not a figure in a table.
    for (const key of keys) {
      const p = parts[key].attributes.position;
      let foot = 0;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i), p.getZ(i));
        if (d > foot) foot = d;
      }
      parts[key].userData.foot = foot;
    }
    // And the **whole** piece's figure onto the first part, because the first
    // part is what `props[name]` is and it is the geometry a caller who did not
    // ask for the parts passes to `scatter()`, and `crowdOf()` reads that one.
    // A prop that has been split into parts is split by **surface** - a cap from
    // its stalk, a sail from its tower - and the surface is not the piece: the
    // pale mushroom's stem reaches a metre and a half and its cap reaches four,
    // and taking the stem's figure would let two of them stand with their caps
    // inside each other, which is the one thing `crowdOf()` exists to stop. The
    // largest of them is the piece's, so the largest is what the piece reserves.
    if (keys.length > 1) {
      parts[keys[0]].userData.foot = Math.max(...keys.map((k) => parts[k].userData.foot));
    }
  }
  // the maps a prop declares but has no file for are a hole in the migration,
  // and a hole nobody can see is how a library ends up half converted
  for (const name of Object.keys(MAPS)) {
    for (const part of allParts(name)) {
      const gone = mapsFor(name, part).filter((m) => !tex.has(m));
      if (gone.length) console.warn(`meshes/${name}.glb${part ? '-' + part : ''} declares ${gone.join(', ')} but meshes/tex/ has none`);
    }
  }
  return tex;
}
/** The one map table the whole load shares, so the course surface can reach it. */
let MAPS_TEX = null;

/**
 * Every map in the manifest, as a texture, skipping the ones with no file
 * beside them. One fetch for the whole library rather than one per prop, and a
 * missing PNG is a warning and not a boot failure: the library is converted a
 * prop at a time and the game runs the whole way through.
 */
async function loadMapTextures() {
  const loader = new THREE.TextureLoader();
  const want = allMaps();
  const got = new Map();
  await Promise.all(want.map((name) => new Promise((res) => {
    loader.load('meshes/tex/' + name + '.png', (t) => {
      // a colour map is read as sRGB; a normal, a roughness or an occlusion is
      // data and reading it as colour is what makes a normal map come out flat
      t.colorSpace = slotIsColour(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      got.set(name, t);
      res();
    }, undefined, () => res());
  })));
  return got;
}
/** A map whose suffix names a colour channel is read as sRGB; the rest are data. */
function slotIsColour(name) {
  const slot = slotFor(name);
  return !slot || slot === 'map' || slot === 'emissiveMap';
}
/** Hand a material the maps the manifest names for its prop. */
function applyMaps(m, list, tex) {
  for (const name of list) {
    // `mapSlots()` and not `slotFor()`: a `-rgh` is the glTF packing and fills
    // **two** fields, because three reads roughness out of `roughnessMap.g` and
    // metalness out of `metalnessMap.b`. That is what makes the crate's iron an
    // iron.
    for (const slot of mapSlots(name)) {
      if (tex.has(name)) m[slot] = tex.get(name);
    }
  }
  // nothing to do if the file is not there: an absent map is a prop that has
  // not been converted yet, and the loader takes both
}
try {
  MAPS_TEX = await loadMeshes();
} catch (err) {
  const total = MESH_FILES.length + MESH_SETS.reduce((n, s) => n + s.files.length, 0);
  $('boot').textContent = `Could not load the meshes from meshes/ (${total} files) — is the folder being served with the page?`;
  throw err;
}
/* ------------------------------------------------------------------ *
 * Cloud shadows and wind
 *
 * Both are **uniform-driven injections**, not shader variants: a value is
 * written onto a shared uniform object and every surface wearing it follows.
 * The alternative - recompiling a program per tier - is what makes a settings
 * menu feel like a stutter, and neither effect is worth a recompile when a
 * multiply of zero is an honest off.
 *
 * `gfxSurface()` chains behind whatever `onBeforeCompile` is already on the
 * material. Four of the county's materials are given theirs by
 * `triplanarDetail()`/`triplanarSets()`, and replacing one rather than adding to
 * it would silently take the surface's own detail map off it.
 * ------------------------------------------------------------------ */
const gfxU = {
  uCloudAmt: { value: 0 }, uCloudTime: { value: 0 },
  uWindAmp: { value: 0 }, uWindTime: { value: 0 },
  // The parallax march on the course surface's own -h map. One shared uniform
  // object rather than one per material, because the march is fragment-bound
  // and lives in the material's own program - the bottom tier gets it on the
  // direct path and `needsComposer()` is unchanged. `uPomSteps` is 0 on the
  // off and two-sided cells (the two-sided path takes two samples and not a
  // loop), and the step count on the march cells. `uPomTwoSided` is 1 only on
  // the two-sided cell, because the two-sided sample count and the march step
  // count are different questions and one cell writes both.
  //
  // **And `uPomBisect` is its own uniform, and it could not be anything else.**
  // The first cut derived it from the step count - `uPomSteps > 4.0` - on the
  // argument that the bisection is on exactly the parallax cells and the cells
  // are the only place it is decided. **Two cells are parallax and relief with
  // the same step count**: relief 8 and parallax 8 both write 8, so a flag read
  // off the number cannot tell them apart and relief 8 was silently drawing
  // the parallax picture. It is the same sentence this county keeps arriving
  // at - *the value that decides whether a resource is wanted is the setting*,
  // and a setting two buttons share is a setting that cannot say which button
  // is pressed.
  //
  // All three are written in `applyEffects()` in `post.js` the same
  // one-line-per-effect shape as `uCloudAmt`, so a cell press is a uniform
  // write and not a recompile, and the off path
  // (`uPomSteps == 0.0 && uPomTwoSided == 0.0`) is byte-identical to today's
  // d computation - a multiply-by-zero off is the answer, the same bargain
  // `uCloudAmt` and `uWindAmp` make.
  uPomSteps: { value: 0 }, uPomTwoSided: { value: 0 }, uPomBisect: { value: 0 },
};
const GLSL_NOISE = `
  float gfxHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float gfxNoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( gfxHash( i ), gfxHash( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( gfxHash( i + vec2( 0.0, 1.0 ) ), gfxHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }`;

/** The wind's three lines, and they are held here **once**, because there are
 * now two programs that have to agree on them exactly: the surface's own, and
 * the occlusion buffer's - see `gtaoWind()`. A second copy would be a second
 * set of numbers, and the two are not allowed to differ: one number in the
 * colour and another in the AO is a tree wearing a shadow of itself. */
const GLSL_WIND = `
        // A gust and a slower sway, both keyed off world position so the
        // field travels across the county instead of pulsing in place
        float bend = max( transformed.y, 0.0 );
        transformed.x += ( sin( uWindTime * 1.7 + vGfxW.x * 0.55 + vGfxW.z * 0.31 )
                         + 0.45 * sin( uWindTime * 4.3 - vGfxW.z * 0.9 ) ) * uWindAmp * bend;
        transformed.z += ( cos( uWindTime * 1.3 + vGfxW.z * 0.47 - vGfxW.x * 0.22 ) ) * uWindAmp * 0.55 * bend;`;

/**
 * **Whether the wind is compiled in at all**, and it is a compile-time decision
 * and not a uniform - which is the whole of the change, and it is the third time
 * this file has had to answer the same question about a gate.
 *
 * `uWindAmp` is written to zero by `applyEffects()` on every preset but the top
 * two, and for a long time **the three lines above were in the program the whole
 * time**: two `sin`, one `cos`, a `max` and three multiplies, run on every vertex
 * of every wind-marked vertex in the county, multiplied by nothing. **Six thousand
 * course tufts, the stable's own five thousand one hundred, and every foliage
 * instance on the course** - and on a bower, whose foliage is the densest
 * wind-marked geometry the county has. **A multiply by zero is an honest off for a
 * value and it is not an honest off for a shader**: a uniform of zero leaves the
 * instructions in and the work still done, which is the sentence `gfxU`'s own note
 * above writes as a bargain and this is the case it does not hold for.
 *
 * **So the flag goes in `customProgramCacheKey` and the GLSL is omitted when it
 * is off**, and the key is not optional. A `MeshStandardMaterial` and three's own
 * `MeshNormalMaterial` both carry a `shaderID`, and three's program cache key is
 * built from **that** plus the parameter booleans plus `customProgramCacheKey()` -
 * **never from the injected source**. So two variants of one material with
 * different wind in them are the same key, and the second `onBeforeCompile` to run
 * would find the first one's program already in the cache and be handed it: **the
 * meadow's grass would bend while the AO said it did not**, which is the ghost
 * `gtaoWind()` was written to remove, arriving through the cache instead of
 * through a hook. This is `useBiome()`'s own bug - the biome name in the key for
 * exactly this reason - and it is the third time this file has had to answer it.
 *
 * **What it costs is one recompile when a player presses the wind cell**, on the
 * three wind materials and the two occlusion ones - and the bargain is the one
 * `app.js` already states for the lamp count: **a count that decides what gets
 * compiled may not be a count the camera moves, and this one is a setting.** Both
 * variants stay in three's cache afterwards, so pressing it back is a lookup.
 */
let windOn = 0;
/** The materials whose program carries the wind, so a press of the cell recompiles
 *  them and nothing else. Populated by `gfxSurface()` and `gtaoWind()` at the two
 *  places the injection is put on. */
const WIND_PROGRAMS = new Set();

/**
 * The wind cell's whole effect on the county's programs. **`0` at boot**, which is
 * right: `GFX_DEFAULTS` has `fxWind: 0` and only Very high and Ultra switch it on,
 * so a fresh install and four presets of six draw no wind at all - and the
 * injection reads this at compile time, so the first frame is already the right
 * shape.
 */
function setWindEnabled(on) {
  const v = on ? 1 : 0;
  if (v === windOn) return false;
  windOn = v;
  for (const m of WIND_PROGRAMS) m.needsUpdate = true;
  return true;
}

/** The materials the wind is actually on, so a piece can be asked whether it
 * sways rather than the shader deciding it - see `windMark()`. */
const WIND_MATS = new Set();

function afterCompile(m, fn) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (sh, renderer2) {
    if (prev) prev.call(this, sh, renderer2);
    fn(sh, renderer2);
  };
  return m;
}

/**
 * Wind, and the cloud shadows, on one surface, and **only the wind is optional**.
 *
 * **Wind is gated by the vertex's own height**, `max(transformed.y, 0)`, so a
 * tuft bends and its root does not. Gating it on the instance matrix instead -
 * moving the whole tuft - is the same trick as animating a shadow without the
 * caster, and it reads as the lawn sliding rather than as grass.
 *
 * That gate is the whole of why the wind cannot go on the ground. It is the
 * vertex's height in **world** space, because `transformed` is, and there is no
 * per-object origin to subtract on a surface a hundred metres across:
 * `mat.course`, `mat.road` and `mat.ledge` are one mesh each, and the top of
 * Crag Ascent's lane stands **35.9 m** over the meadow at its foot. Every vertex
 * up there carries a bend of 35.9, and at an amplitude of `0.055` that is
 * **1.98 m of displacement on the terrain itself** - the county waving, the
 * clay ribbon shearing out of its own flank, and the flank left standing where
 * the ground used to be. It looked like a wave crossing the whole stage because
 * that is what it was: one sine keyed off world position, applied to a hillside
 * by its altitude, and the further up the hill you went the more it moved.
 *
 * So the ground, the road and the flank take the **cloud** and not the wind, and
 * the tufts and the foliage take both. Nothing here loses the cloud shade, and
 * the thing that bends is now only the thing that is standing up.
 *
 * The hook is `project_vertex` and not `begin_vertex` because `begin_vertex` is
 * the line the county's own triplanar injection has already replaced; going in
 * after it means this works whether or not the material had one, and it is still
 * before the model-view matrix is built.
 *
 * **And it is put on once and put back on after, rather than added to.** That is
 * `useBiome()`'s doing: it re-runs `triplanarSets()` on this same material, and
 * `triplanarSets()` **assigns** `onBeforeCompile` where this function chains
 * behind whatever is there - so the wind and the cloud shade have to be re-chained
 * after every course change or they are gone, and *chaining them a second time*
 * puts a second `varying vec3 vGfxW;` and a second `uniform float uCloudAmt` in
 * one shader. That is a redeclaration and not a warning: the material loses its
 * program and draws wrong with nothing in the console but a compile error about
 * something else entirely. So what the material carried before the injection is
 * kept on it in `gfxBase` and the chain is rebuilt from that, which is the same
 * bargain `waterFresnel()` strikes with its uniform and for the same reason.
 */
function gfxSurface(m, wind) {
  // **Registered here and not in the injection below.** `onBeforeCompile` runs at
  // the material's first render, and a piece planted before that - which is every
  // piece in the first county built - would ask an empty set and go unmarked,
  // which is a wind that comes and goes with the density row.
  if (wind) WIND_MATS.add(m);
  if (m.userData.gfxBase === undefined) m.userData.gfxBase = m.onBeforeCompile || null;
  const base = m.userData.gfxBase;
  m.onBeforeCompile = function (sh, renderer2) {
    if (base) base.call(this, sh, renderer2);
    gfxInject(sh, wind);
  };
  // **And the wind flag goes into the cache key**, chained behind whatever key the
  // material already carries rather than replacing it - the same bargain
  // `gfxBase` strikes for `onBeforeCompile`, for the same reason: `useBiome()`
  // writes a fresh key over these materials on every course build, and a key this
  // function owned outright would be overwritten by the next biome and take the
  // wind flag with it.
  if (wind && !m.userData.gfxWindKeyed) {
    m.userData.gfxWindKeyed = true;
    WIND_PROGRAMS.add(m);
    const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => prevKey() + ':wind' + windOn;
  }
  return m;
}
/** The wind and the cloud shade on their own, so the chain above can be rebuilt
 *  round them without keeping a second copy of them - and so `gfxSurface()` still
 *  reads as one call at its four call sites. */
function gfxInject(sh, wind) {
  sh.uniforms.uCloudAmt = gfxU.uCloudAmt;
  sh.uniforms.uCloudTime = gfxU.uCloudTime;
  /* **The two wind uniforms are declared and assigned whatever the cell says, and
   *  only the three lines of GLSL are gated** - and that split is the whole of a
   *  bug that cost an evening.
   *
   *  Gating the uniforms on the same flag as the GLSL looks tidier and is wrong,
   *  because of **what a cache hit does**: three builds the program cache key from
   *  `customProgramCacheKey()` and, when the key it wants is already in
   *  `materialProperties.programs`, it takes it **without calling
   *  `onBeforeCompile` at all**. So the injection does not run, nothing is assigned,
   *  and the material keeps whatever uniform set its *previous* build left on it.
   *
   *  And the previous build is the one that has just replaced it: three does
   *  `materialProperties.uniforms = parameters.uniforms` on every fresh program, so
   *  the no-wind build had just installed a uniform set with **no `uWindAmp` in it**.
   *  The wind-on program came back out of the cache carrying three lines that read
   *  a uniform which was no longer bound, an unbound uniform reads **0**, and the
   *  canopy stood perfectly still with the cell lit: `uWindAmp * bend` with no
   *  `uWindAmp`. **Pressing the wind cell a second time did nothing at all**, and
   *  there was no GL error, no warning and no console line anywhere - which is the
   *  whole of this project's complaint about quiet failures, arrived at from the
   *  other direction.
   *
   *  So the uniforms are unconditional. **A uniform nobody references is stripped
   *  by the compiler and costs nothing**, and an unconditional assignment is the
   *  one that cannot be stale: whichever program three hands back, the two wind
   *  uniforms are bound to the shared objects, and a program with the wind in it
   *  moves and one without it does not. */
  sh.uniforms.uWindAmp = gfxU.uWindAmp;
  sh.uniforms.uWindTime = gfxU.uWindTime;
  // **and the three lines themselves, which are the vertex work this is all about,
  // are left out of the program entirely when the cell is off.** The cloud is a
  // *fragment* cost behind a branch on one uniform, which is the bargain `gfxU` is
  // written for and which holds; the wind is per-vertex work with no branch, so a
  // uniform of zero leaves the instructions in and the work being done.
  const bend = (wind && windOn) ? GLSL_WIND : '';
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
        varying vec3 vGfxW;
        uniform float uCloudAmt, uCloudTime, uWindAmp, uWindTime;`)
    .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vGfxW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vGfxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif${bend}
        #include <project_vertex>`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
        varying vec3 vGfxW;
        uniform float uCloudAmt, uCloudTime;
        ${GLSL_NOISE}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
        if ( uCloudAmt > 0.0 ) {
          vec2 cp = vGfxW.xz * 0.014 + vec2( uCloudTime * 0.008, uCloudTime * 0.004 );
          float c = gfxNoise( cp ) * 0.62 + gfxNoise( cp * 2.7 ) * 0.28 + gfxNoise( cp * 6.1 ) * 0.10;
          // a threshold rather than a smooth ramp, because a cloud edge is an
          // edge: a soft multiply over the whole ground is a dirty lens
          diffuseColor.rgb *= mix( 1.0, 0.52, uCloudAmt * smoothstep( 0.46, 0.72, c ) );
        }`);
}

/**
 * The surfaces the cloud shades and the wind are injected into, and the one
 * place they are injected. The county's ground is `mat.course` (turf, cliff and
 * shore), its road and ramp are `mat.road` and `mat.ledge`, the tufts are
 * `mat.grass` and everything that grows is `mat.foliage`. That is five
 * materials, all of them long-lived, all of them already carrying an
 * `onBeforeCompile` of their own from `triplanarDetail()`/`triplanarSets()` in
 * three cases out of five - so this is `afterCompile()`, chained, never
 * replacing.
 *
 * **The wind goes on the last two and not on the first three**, and see
 * `gfxSurface()` for the measurement of what it does when it goes on all five.
 *
 * **And `mat.ashFoliage` is on the wind list beside `mat.grass`, and that is the
 * whole of why it is a separate material at all.** The obvious move for a biome
 * is to swap the turf set on `mat.grass` with the rest of them - and `mat.grass`
 * is used in exactly two places: the course tufts `populate()` scatters, and the
 * stable's own lawn, which plants five thousand one hundred more of them. So a
 * biome swap on `mat.grass` is a lush green meadow rebuilt with an ash tuft's
 * grain, on the stable, in the lobby, at the plinth - and the tell is a grey lawn
 * that the course inspector does not have. **A material in this county is
 * per-surface for the life of the page**: `dropCourse()` disposes geometry and
 * instanced meshes and has never disposed a material, and a standing material
 * nothing wears costs nothing. So the jar grows rather than mutates, which is the
 * same call that made `mat.ramp` a second material instead of a flag on
 * `mat.road`.
 *
 * Called once at material setup and never again: the uniforms are shared, so
 * nothing about the program changes when a tier moves.
 */
let gfxSurfacesDone = false;
function gfxSurfaceTargets() {
  if (gfxSurfacesDone) return;
  gfxSurfacesDone = true;
  // **and the biome first, before anything else on this list.** `useBiome()` writes
  // `PAL` - the sixteen colours the surfaces are about to bake into their vertex
  // colours - and it rebuilds the four `triplanarSets()` programs off the biome's
  // four roles. It is here and not at the foot of the module **because `PAL` is
  // declared below the module's own setup block**, and reading a `let` above its
  // own declaration is a temporal dead zone: a `ReferenceError` on the module's
  // first line, at boot, with nothing else wrong anywhere. This function is already
  // "the only thing in this file that has to run exactly once and in one order -
  // after the jar is built and before a frame is drawn", and standing the biome is
  // exactly such a thing, because it needs the jar.
  useBiome('temperate');
  // the three surfaces of the ground, and the three that grow
  for (const m of [mat.course, mat.road, mat.ledge]) gfxSurface(m, false);
  for (const m of [mat.grass, mat.foliage, mat.ashFoliage]) gfxSurface(m, true);
}

/**
 * The wind, and only the wind, on **the material the occlusion buffer is built
 * out of**, which is a material the county never wrote: `GTAOPass` renders its
 * normal-and-depth pass by setting `scene.overrideMaterial` to three's own
 * `MeshNormalMaterial` and drawing the whole scene through it. So a tree sways in
 * the colour pass and stands perfectly still in the AO - a ghost of its own
 * canopy hanging under it, which reads as a shadow and is the one thing in the
 * frame that is not in the frame. At an amplitude of `0.055` and a canopy four
 * metres up that ghost is **22 cm** of the county's own shape doing nothing.
 *
 * The bend is the same `GLSL_WIND` the surfaces wear, off the same two shared
 * uniforms, so the two programs cannot disagree about where the field is.
 *
 * **Which pieces bend is an attribute and not a uniform**, because a uniform is
 * the one thing that cannot carry it. `WebGLRenderer.setProgram()` uploads a
 * material's own uniforms inside `if ( refreshMaterial )`, and `refreshMaterial`
 * is raised by `material.id !== _currentMaterialId` - *the material changing*.
 * The occlusion buffer is one material for the whole county, because the
 * override is set once and `renderer.render()` is called once with it, and
 * `_currentMaterialId` is cleared once per `render()` and nowhere else. So a
 * uniform written from `object.onBeforeRender` reached the GPU **once per pass**,
 * carrying whichever piece happened to be first in the render list: either the
 * entire county bent in the AO - the ground with it, and the top of Crag
 * Ascent's lane carries a bend of 35.9, which at an amplitude of `0.055` is
 * **1.98 m of the terrain itself**, the exact failure `gfxSurfaceTargets()`
 * splits the wind off three materials to prevent - or nothing bent at all, which
 * is the ghost this function was written to remove. **It was never a shader and
 * never a hook**: the injection was right, the hook was right, and the hook had
 * nowhere to write that the frame would read back.
 *
 * An attribute is the one thing a vertex shader can be told per piece that three
 * really does re-read per piece, because the vertex array is bound on every draw.
 * So the answer is **one float per vertex**, stamped on the geometry - which is
 * the coarsest thing a piece has and the right one: a geometry wears one material
 * in this county, `matFor()` and `partMat()` make a converted prop's material a
 * function of its own geometry, and the seven unconverted props that wear a wind
 * material are planted in one material each. It is also why `USE_INSTANCING` was
 * never the gate it looked like - a stone is instanced too, and a stone that
 * sways in the occlusion buffer and not in the colour is the same ghost a hand
 * smaller.
 *
 * **The zero is a default and not an omission.** The county's own pieces carry
 * the attribute; the ground, the road, a stone, the snail and three.js's own
 * geometry do not, and `material.defaultAttributeValues` is how three says *this
 * program reads a float the geometry may not carry*. It is the same fact
 * `triplanarDetail()` lives with on the other side of this file: a missing
 * attribute is not an error in WebGL, it is the value nobody wrote.
 */
function gtaoWind(m) {
  // the material's own defaults are kept and not replaced, on the same terms
  // `waterFresnel()` keeps a material's uniform: a material outlives a pass
  m.defaultAttributeValues = Object.assign({ gfxWind: [0] }, m.defaultAttributeValues);
  // **Same registration and the same cache key as `gfxSurface()`**, and it has to
  // be the same: this is the one material that makes the county's wind and its
  // occlusion agree, so a press of the cell that recompiled the three surfaces and
  // left this one would put the two back out of step - which is the ghost this
  // function exists to remove, arriving because half the fix was applied.
  if (!m.userData.gfxWindKeyed) {
    m.userData.gfxWindKeyed = true;
    WIND_PROGRAMS.add(m);
    const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => prevKey() + ':wind' + windOn;
  }
  return afterCompile(m, (sh) => {
    // **And the two uniforms are assigned in both states, for the reason
    // `gfxInject()` sets out at length: three does not call `onBeforeCompile` when
    // it takes a program from its cache, and the build before it replaced the
    // material's uniform set with one that had no wind in it.** Here it is the
    // occlusion buffer that would go stiff rather than the colour pass, and it is
    // the worse of the two because the whole point of this function is that the
    // two cannot disagree.
    sh.uniforms.uWindAmp = gfxU.uWindAmp;
    sh.uniforms.uWindTime = gfxU.uWindTime;
    // **The attribute, the varying and the three lines are injected only when the
    // wind is on**, so with the cell off the occlusion pass's vertex shader is
    // three's own and the county's six thousand tufts cost it nothing. Without
    // the key above this material's two variants would be one program - three's
    // `MeshNormalMaterial` carries a `shaderID`, so the key is built from that and
    // never from the injected source - and the tufts would bend in the colour and
    // stand still in the occlusion, which is the ghost, from the cache.
    if (!windOn) return;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float gfxWind;
        varying vec3 vGfxW;
        uniform float uWindAmp, uWindTime;`)
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vGfxW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vGfxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif
        if ( gfxWind > 0.5 ) {${GLSL_WIND} }
        #include <project_vertex>`);
  });
}
/** The stamp itself, put on at the two places a piece is planted - `scatter()`
 *  for a course and `planted()` for the stable - beside the shadows row's flag
 *  and for the same reason: a flag applied by walking has to be reapplied every
 *  time the county is rebuilt, and a flag applied at the build is simply there.
 *
 *  One float per vertex for a whole InstancedMesh is wasteful and it is the
 *  right trade: the geometry is shared by every racer and every course that draws
 *  it, so a stamp on the mesh would have to be seven geometries instead of one,
 *  and `dropCourse()` disposes geometry and would then have to know which of them
 *  were clones. `userData.gfxWind` is the memory of the stamp, which is what makes
 *  a second call free - `planted('conifer', ...)` runs twice on the stable, and a
 *  `Float32Array` refilled over the whole vertex list each time is a buffer
 *  upload for an answer that did not change. */
function windGeom(geo) {
  if (geo.userData.gfxWind !== undefined) return;
  geo.userData.gfxWind = 1;
  geo.setAttribute('gfxWind', new THREE.BufferAttribute(
    new Float32Array(geo.attributes.position.count).fill(1), 1));
}
function windMark(im) {
  if (!WIND_MATS.has(im.material)) return im;
  windGeom(im.geometry);
  return im;
}
/**
 * The reflection mask, and it is the same bargain as the wind's attribute one
 * call lower: **one float per vertex, stamped where a piece is planted, read by
 * the override material through the alpha of the buffer that render draws into.**
 *
 * **The number is the surface's reflectance looking straight into it - F0 - and
 * not a strength, and that is the whole difference between a reflection and a
 * mirror.** A dielectric reflects two to four per cent head-on, so a mark that
 * meant "one, and reflect all of it" on a painted crate would be a lie the
 * Fresnel term then undoes; with F0 in the mark, the crate's 0.04 and a mirror's
 * 0.92 are the same shader and one number apart, and the thing being reflected is
 * weighted by the surface's own physics rather than by a taste. **Water's is 0.02
 * and that is the index of 1.33**, which is a constant and not a choice.
 *
 * **And it is the same number the material's own albedo carries for a metal**,
 * because a metal's albedo *is* its reflectance - which is why the test cube on
 * the stable is a polished metal and not a shiny ball, and why its mark and its
 * colour are one number written twice. A mark that disagreed with the material
 * would be a reflection the frame does not believe.
 *
 * **The sign is a flag.** A negative mark is a surface this pass has no normal
 * for in the G-buffer - the water, which is `transparent` and writes no depth and
 * is hidden out of that buffer on purpose - and it takes the world's up instead.
 * The alternative was a second attribute and a second vertex buffer binding for
 * one bit that is decided by *what kind of thing it is*, which is fixed at the
 * plant site and written once per vertex like the value.
 *
 * **And the kind goes on the geometry rather than into a register**, which is the
 * half that took two attempts. A `Set` of kinds, emptied at the top of each course
 * build, cannot describe two screens that both stand at once: the lobby's pool and
 * a course's are in different scenes and only one is drawn, so the register was
 * either emptied below the thing that filled it (the tooltip said "no water on
 * this course" on every course in the county) or accurate for one screen and
 * about the other. **The report walks the scene that is being drawn** and asks each
 * piece in it, so there is nothing to keep in step and nothing to clear.
 */
function reflectMark(geo, f0, kind) {
  if (geo.userData.gfxReflect !== undefined) return geo;
  const n = geo.attributes.position.count;
  geo.userData.gfxReflect = f0;
  geo.userData.gfxKind = kind;
  geo.setAttribute('gfxReflect', new THREE.BufferAttribute(
    new Float32Array(n).fill(f0), 1));
  return geo;
}

/**
 * The mark, read by the override material the county renders its flat colour
 * buffer with, **and written into the alpha** - which is free and the beauty
 * buffer's alpha is not, for a reason worth recording because it looks free:
 * `GTAOPass`'s `blendMaterial` in `OUTPUT.Default` is `CustomBlending` with
 * `blendSrcAlpha: DstAlphaFactor` and `blendDstAlpha: ZeroFactor`, so destination
 * alpha is multiplied by itself every frame the pass runs and decays to nothing.
 *
 * **The geometry's own vertex colours are what the render writes to the colour
 * channels**, so a piece with no `color` attribute comes out white - which is
 * true of the bounce's buffer today and is not a mask's business.
 *
 * **The zero is a default and not an omission**, for the reason `gtaoWind()` gives
 * at length: the ground, the road, a stone, the snail and three.js's own geometry
 * carry no attribute, and the same program reads every one of them. A missing
 * attribute in WebGL is not an error, it is the value nobody wrote - so a mark
 * defaults to *nothing reflects*, which is the answer a county of opaque things
 * wants.
 */
function gtaoReflect(m) {
  m.defaultAttributeValues = Object.assign({ gfxReflect: [0] }, m.defaultAttributeValues);
  return afterCompile(m, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float gfxReflect;
        varying float vGfxReflect;`)
      .replace('#include <project_vertex>', `
        vGfxReflect = gfxReflect;
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vGfxReflect;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        gl_FragColor.a = abs( vGfxReflect );`);
  });
}
/** Once per material, and a material is longer-lived than a probe. The
 *  reflection row makes a probe and takes it away again, and this injection has
 *  to survive that: `onBeforeCompile` chains, so a second call would put a
 *  second `uniform float uWaterFresnel;` in the same shader and the water would
 *  stop compiling - a redefinition, not a warning, and the surface that lost its
 *  program is whichever pool happened to be built last. The uniform is the
 *  material's, not the probe's, and that is what makes the row free to change. */
function waterFresnel(m) {
  if (m.userData.fresnelU) return m.userData.fresnelU;
  m.userData.fresnelU = { value: -1 };
  return afterCompile(m, (sh) => {
    sh.uniforms.uWaterFresnel = m.userData.fresnelU;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if ( uWaterFresnel >= 0.0 ) {
          float facing = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
          roughnessFactor = mix( uWaterFresnel, roughnessFactor, pow( 1.0 - facing, 3.0 ) );
        }`)
      .replace('#include <common>', '#include <common>\nuniform float uWaterFresnel;');
  });
}

/* ================================================================== *
 * Materials
 *
 * Smooth everywhere. Nothing is flat shaded any more, so a face reads as a
 * face because the geometry says so and not because the shader is averaging
 * away the corner - which means the geometry has to hold up on its own. The
 * course surface keeps its vertex colour as the low-frequency driver and gains
 * a triplanar detail normal on top of it; the water gains two of those, one
 * going each way, because a pool with one direction of ripple in it reads as
 * wallpaper.
 * ================================================================== */
/**
 * A detail normal, and optionally a detail colour, projected from the world
 * position on all three planes and blended by the world normal. The ground and
 * the bed are built along a spline and have no UVs at all - their colour is
 * sampled in world XZ at four frequencies - so this is the same answer they
 * already had, with a normal map under it.
 *
 * It needs no uv on the geometry, which is what lets the same detail go on a
 * flat green disc and on six thousand instanced tufts: neither has anywhere to
 * put a uv, and a scattered prop cannot have one put there per instance.
 *
 * The colour is the second half of the same answer, and it is the only other
 * slot a surface without a uv can honestly fill. A `map` is read by uv and a
 * missing attribute is (0,0), so a map hung on one of these materials gives it
 * a single texel - which is why the ground and the bed carry no roughness map
 * either. But the *detail* in a colour, multiplied into a colour the surface
 * already has, is worth having: a vertex every two metres holds a course
 * verge's colour perfectly well and a forty-segment fan with one vertex in the
 * middle of it holds nothing at all finer than the eight metres across it, and
 * a lawn seen from a metre away is all finer than that. The maps are built
 * about white for exactly this reason - the surface keeps its own hue and the
 * map only supplies the grain - and `colourAmount` is how much of it to lay on.
 *
 * The instance matrix is the part that is easy to miss. `modelMatrix` is the
 * mesh's, and for an `InstancedMesh` every one of the six thousand is placed by
 * a matrix in the geometry's own attribute buffer - so projecting from
 * `modelMatrix` alone would give every tuft the identical patch of the map,
 * rotated and scaled into place, which reads as one grass blade stamped
 * six thousand times. So the projection is taken from the transformed vertex,
 * the way `worldpos_vertex` takes it, and the plane comes from the instance
 * matrix's own axes.
 */
function triplanarDetail(m, map, scale, strength, colour, colourScale, colourAmount, colourGain, splitOk) {
  if (!map) return m;
  // The two halves of a pair have to be on the **same tile**, and this is where
  // that gets enforced rather than remembered. `scale` and `colourScale` are both
  // tiles per metre, so a colour asked for at a different number is projected
  // through a different world size: its pale plate is not the plate the normal
  // has raised, and the surface is two textures laid over each other rather than
  // one rock. It is an easy slip - one number in a long list of numbers, and
  // nothing about it looks wrong until you are looking for it. The cliff's colour
  // sat at 0.7 against a normal at 0.55 for a long while, under a comment that
  // said the two were in agreement about scale.
  //
  // So the colour takes the normal's scale unless it is told otherwise, and a
  // caller that tells it otherwise says so out loud. There is exactly one place
  // in the county that wants two scales - the stable's lawn, which takes the
  // coarser grain in its normal and the finer in its colour - and it passes
  // `splitOk` so this is a decision on the record rather than a warning that
  // fires on every boot and is then learned to ignore.
  if (colour && !splitOk && colourScale !== undefined && colourScale !== scale) {
    console.warn(`triplanarDetail: colour scale ${colourScale} is not the normal's ${scale}`
      + ' on the same material - the two halves of a pair have to be on one tile');
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailN = { value: map };
    sh.uniforms.detailScale = { value: scale };
    sh.uniforms.detailStrength = { value: strength };
    sh.uniforms.detailC = { value: colour || null };
    // the normal's own scale unless one is named, and not `colourScale || scale`:
    // a scale of zero is a legal tile (one the size of the county) and `||` would
    // have quietly thrown it away
    sh.uniforms.detailCScale = { value: colour && colourScale !== undefined ? colourScale : scale };
    sh.uniforms.detailCAmount = { value: colourAmount === undefined ? 1 : colourAmount };
    sh.uniforms.detailCGain = { value: colourGain === undefined ? 1 : colourGain };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriW;\nvarying vec3 vTriWN;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        #ifdef USE_INSTANCING
          vTriWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vTriWN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vTriW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vTriW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${colour ? '#define USE_DETAIL_COLOUR' : ''}
        varying vec3 vTriW;
        varying vec3 vTriWN;
        uniform sampler2D detailN;
        uniform float detailScale;
        uniform float detailStrength;
        uniform sampler2D detailC;
        uniform float detailCScale;
        uniform float detailCAmount;
        uniform float detailCGain;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          // A normal map is a tangent-space direction packed into 0..1 with 0.5
          // meaning "no slope", so the half comes off and the rest is doubled
          // before it is treated as a slope. Handing the packed channels
          // straight to a vector leaves the half in there, which tilts the whole
          // surface a constant amount and keeps only the variation - so the
          // surface looks faintly wrong and the map looks like it is doing
          // almost nothing, and both of those are this line's fault.
          vec2 d = vec2(0.0);
          d += (texture2D(detailN, vTriW.zy * detailScale).xy * 2.0 - 1.0) * an.x;
          d += (texture2D(detailN, vTriW.xz * detailScale).xy * 2.0 - 1.0) * an.y;
          d += (texture2D(detailN, vTriW.xy * detailScale).xy * 2.0 - 1.0) * an.z;
          vec3 wn = normalize(normalize(vTriWN) + vec3(d * detailStrength, 0.0));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      // The same three projections again, for the colour. A surface with no uv
      // can have a colour detail on it and no more: a `map` is read by uv, and a
      // missing attribute is (0,0), so a map hung on one of these materials
      // gives it one texel and no variation. This is the one slot a surface
      // without a uv can honestly fill after the normal, and it is a multiply -
      // the detail is drawn *over* a colour the surface already has, so the
      // piece keeps the hue it was painted with and the map only supplies the
      // grain. It goes in after `<color_fragment>`, so what it multiplies is the
      // vertex colour as well.
      //
      // `detailCGain` is the other half of a multiply map. An eight-bit canvas
      // clamps at one, so a detail built symmetrically about white loses its
      // whole highlight half to the clamp and arrives as a flat average: the map
      // looks blank and the surface looks untextured. So the map is built under
      // one and the mean is put back here, and the value a caller wants is the
      // gain rather than the map.
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_DETAIL_COLOUR
        {
          vec3 ac = abs(normalize(vTriWN));
          ac /= (ac.x + ac.y + ac.z);
          vec3 dc = vec3(0.0);
          dc += texture2D(detailC, vTriW.zy * detailCScale).rgb * ac.x;
          dc += texture2D(detailC, vTriW.xz * detailCScale).rgb * ac.y;
          dc += texture2D(detailC, vTriW.xy * detailCScale).rgb * ac.z;
          diffuseColor.rgb *= mix(vec3(1.0), dc * detailCGain, detailCAmount);
        }
        #endif`);
  };
  return m;
}

/**
 * Two ripple normals on the water, one scrolling out along the pool and one
 * across it, sampled into one perturbation so there is one tangent frame to
 * think about rather than two. The frame itself comes from screen-space
 * derivatives, because nothing in this project writes a `tangent` attribute and
 * three derives one when a normal map is present.
 *
 * **The drift vector is one object, shared by every water surface in the
 * county.** It used to be a single material's own uniform, reached through the
 * shader `onBeforeCompile` handed back, which is only possible while there is
 * one water material - and there is not any more: `poolWaterMat()` gives each
 * pool its own so that a pool can carry its own reflection probe, and a
 * four-pool course is four materials. Four drifts would be four pools whose
 * ripples did not agree with each other, which is the one thing water must not
 * do. So the uniform is shared and the animation is written straight onto it.
 */
const rippleU = { tRipple: { value: new THREE.Vector2() }, uRipple: { value: 0.42 } };
function rippleWater(m, one, two) {
  m.normalMap = one || null;
  if (!one) return m;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.ripple2 = { value: two || one };
    sh.uniforms.tRipple = rippleU.tRipple;
    sh.uniforms.uRipple = rippleU.uRipple;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_pars_fragment>',
        '#include <normal_pars_fragment>\nuniform sampler2D ripple2;\nuniform vec2 tRipple;\nuniform float uRipple;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nA = texture2D(normalMap, vNormalMapUv + tRipple).xyz * 2.0 - 1.0;
          vec3 nB = texture2D(ripple2, vNormalMapUv * 1.63 - tRipple * 0.47).xyz * 2.0 - 1.0;
          vec2 d = (nA.xy + nB.xy * 0.85) * uRipple;
          normal = normalize(tbn * normalize(vec3(d, nA.z)));
        }`);
  };
  return m;
}

/**
 * Two or three detail sets in **one** material, cross-faded per fragment by a
 * per-vertex weight, so two surfaces can meet in a gradient instead of a seam.
 *
 * This is the answer to the one thing `triplanarDetail()` above cannot do. A
 * course surface is a single mesh of shared vertices with an index split into
 * groups, and each group wears its own material — so a turf-to-stone edge is a
 * **material** boundary, and a material boundary is one quad wide however
 * carefully the vertex colour was faded across it. The colour can be blended to
 * the halfway point; the maps cannot, because grass blades on one side of the
 * join and rock joints on the other is a full-strength change in the row of
 * pixels where the index splits, and that row draws a line.
 *
 * So the split goes and the blending comes with it. Each set is a normal, a
 * scale and a strength, and optionally a colour, a scale, an amount and a gain —
 * exactly the arguments `triplanarDetail()` takes, one set's worth each. The
 * geometry carries a `detailW` attribute, a `vec3` of weights that sum to one at
 * every vertex, and the shader sums the sets' slopes and averages the sets'
 * colours by those weights. One set at full weight is exactly the single-set
 * case, which is what makes the guards below safe.
 *
 * The weights are per **vertex**, so the gradient is a linear ramp across
 * whatever a quad is, and a quad out on the open country is two to six metres.
 * That is the band the transition happens in and there is no way to make it
 * narrower without finer geometry — but it is a gradient and not a step, and
 * that is the whole of the difference between a line and a blend.
 *
 * Each set is guarded on its own weight, so open meadow pays for one set of
 * three projections and a terrace pays for two, and the course surface costs
 * about what it did before everywhere except the seams.
 *
 * A set may also be drawn in **the lane's frame** rather than the world's, with
 * `uv: true`, and that is not a variant of the same idea - it is a different
 * projection and it is right for exactly one surface in the county. A triplanar
 * set is sampled three times and blended by the surface's axes, which is the
 * correct answer for something that is metres across and was built out of a
 * height field: there is no direction in the ground to prefer. The track is a
 * strip that bends, and everything about a track is directional - the grain is
 * laid along it, the sweep is along it, the snail runs along it. Projected in
 * world space the map is a pattern fixed to the county, so the same chip of
 * brick is at the same place on every straight and the racing line is the only
 * thing on it that knows which way it is going. The geometry for a uv set
 * carries a `trackUv` attribute instead of relying on the projection:
 * **arc length along the lane in `x`, metres out from the centre line in `y`**,
 * both in metres and both run through the set's own `scale`, so a tile is the
 * same length whichever way it is drawn. `mat.road` and `mat.ledge` are the two
 * meshes that have one; everything else is left triplanar.
 */
function triplanarSets(m, sets) {
  const live = sets.filter((s) => s && s.map);
  /**
   * **A set that named a map and did not get one is a quiet answer, and this is
   * the branch that makes it quiet.** The filter above is what silently drops it:
   * a surface that declares four sets and gets three files on disk comes up as a
   * three-set material, `n` is one smaller, and `customProgramCacheKey` answers
   * with a key **another material in the county already owns** - a `mat.road` that
   * lost its third set answers `triplanarSets2Uv`, which is `mat.ledge`'s key. So
   * the road draws with the flank's program, the setts never appear, and nothing
   * anywhere is red: `meshes/maps.js` declared the names correctly and
   * `plan-test.mjs --biomes` resolves them.
   *
   * **This is not hypothetical** - it is exactly what happens when a `SURFACE`
   * entry is declared before the drawer that writes its PNGs has run. The warning
   * is the noise it makes in a browser and `__snail.setsOf('mat.road')` is the
   * assertion, because **a set list of two where three were declared is the whole
   * failure in one number.**
   */
  sets.forEach((s, i) => {
    if (s && s.name && !s.map) console.warn(`triplanarSets: set ${i} '${s.name}' has no map`);
  });
  /** The set names actually running, in order, for `__snail.setsOf()`. A test asks
   *  the material and not the biome's table, because the table is what was asked
   *  for and this is what was built. */
  m.userData.setNames = live.map((s) => s.name || '?');
  /** And whether each set actually got a height map, in the same order, for
   *  `__snail.setHeightsOf()`. A set that declared a `-h` and got none - the
   *  loader's quiet-failure path, where `detailOf` answers `null` and
   *  `triplanarSets()` filters the set's height out and keeps its normal -
   *  shows up here as a `false` in the register rather than in a picture: a
   *  surface that marched on the normal alone is the same as a surface that
   *  never had a `-h` at all, and the material's own register is the one
   *  place that says so. */
  m.userData.setHeights = live.map((s) => !!s.height);
  if (!live.length) return m;
  const n = live.length;
  for (let i = 0; i < n; i++) {
    const s = live[i];
    // the two halves of a pair have to be on the **same tile**, exactly as they
    // do for the single-set version, and for the same reason: a colour asked for
    // at a different tile is a pale patch raised somewhere else
    if (s.colour && s.colourScale !== undefined && s.colourScale !== s.scale) {
      console.warn(`triplanarSets: set ${i} colour scale ${s.colourScale} is not the normal's ${s.scale}`);
    }
  }
  /** The weight a vertex gives a set is the set's **letter**, and there are four
   *  letters now. **`'W'` is not the fourth axis** - `detailW` is a *weight*, not
   *  a vector, and the `w` of `vDetailW` is the fourth set's share of this
   *  vertex and nothing to do with world space. */
  const K = ['X', 'Y', 'Z', 'W'];
  /** Whether a set is projected by the lane's own frame rather than triplanar. */
  const byUv = (s) => !!s.uv;
  const anyUv = live.some(byUv);
  // **GLSL has no int-to-float promotion in a multiply**, so a whole number here
  // has to be written with a decimal on it or the shader will not compile, and
  // the error it gives is about operand types and says nothing about the number
  // that caused it. Every default in `triplanarSets()` is a whole number.
  const g1 = (v, d) => {
    const s = v === undefined ? String(d) : String(v);
    return /[.eE]/.test(s) ? s : s + '.0';
  };
/**
   * The POM march, written out once per material and shared by every set that
   * carries a `-h` map. It is a helper rather than inline so that the off path
   * is byte-identical to today's `d` computation: a set with no height map,
   * or the whole branch off (`uPomSteps == 0.0 && uPomTwoSided == 0.0`),
   * answers `vec2(0.0)` and the normal map is sampled at its current uv.
   *
   * **A march that does not know where the eye is is not a parallax march.**
   * It is a hill-climb along a fixed diagonal: the same offset from every
   * angle, which is a bias in the normal lookup rather than depth, and it is
   * why the first cut of this read as lacklustre with every cell measurably
   * different from every other and none of them standing up off the surface.
   * So the two things below are the whole of the fix, and they are the two
   * halves of one question - **which way the eye's ray runs across the tile,
   * and how far along it the ray travels before it leaves the relief.**
   *
   * `ray` answers the first: the view ray in the set's own two axes. It is the
   * world ray from `cameraPosition` less the part of it that runs *into* the
   * surface, which is the surface's own frame the march then reads - the
   * dominant world plane's axes for a triplanar set, and **the lane's own**
   * (`fwd`, `right`) for a uv set, which is what `trackR` carries and is the
   * reason the ribbon and the flank grew the attribute.
   *
   * `walk` answers the second: `tl / vn` is the tangent of the angle between
   * the ray and the surface normal, so it is 0 looking straight down and grows
   * without bound at a grazing angle. **Which is why it is capped**: a march
   * that walks off its own tile is a seam, and the cap is the same bargain the
   * SSR pass strikes with its `uThick`.
   */
  const POM_STEPS_MAX = 12;
  const pomHelperGLSL = (i, s) => {
    const k = K[i];
    if (!s.height) return `vec2 pomO${i}( vec3 an ) { return vec2( 0.0 ); }`;
    const T = g1(s.thickness, 0.05);
    const S = g1(s.scale, 1);
    // **The eye's ray, in the set's own two axes.** `cameraPosition` is three's
    // own uniform and `vTriW` is this material's world position, so the ray is
    // exact rather than reconstructed; `vTriWN` is the surface's own world
    // normal, which is what takes the into-the-surface part out of it.
    const ray = s.uv ? `
      vec3 pw = normalize( cameraPosition - vTriW );
      vec3 nw = normalize( vTriWN );
      vec3 vt = pw - nw * dot( pw, nw );
      float rl = length( vTrackR );
      if ( rl < 0.0001 ) return vec2( 0.0 );
      vec3 rg = vTrackR / rl;
      // course.js builds right as cross(fwd, up), so fwd is the other way round
      // the same cross and a uv set's x is arc length along the lane
      vec3 fw = cross( vec3( 0.0, 1.0, 0.0 ), rg );
      vec2 dir = vec2( dot( vt, fw ), dot( vt, rg ) );`
      : `
      vec3 pw = normalize( cameraPosition - vTriW );
      vec3 nw = normalize( vTriWN );
      vec3 vt = pw - nw * dot( pw, nw );
      vec2 dir = vt.zy;
      if ( an.y > an.x && an.y > an.z ) dir = vt.xz;
      if ( an.z > an.x && an.z > an.y ) dir = vt.xy;`;
// **The unit direction and the uv distance the ray covers across the whole
      // thickness.** `tl / vn` is the **tangent** of the angle between the ray
      // and the surface normal - not its cotangent, which is the half of this
      // that is easy to get backwards and the half that makes the effect look
      // like nothing: a ray straight down the normal runs no distance across
      // the surface at all, so a floor seen from directly above has **no**
      // parallax, and a ray along the floor crosses the whole thickness many
      // times over. `vn / tl` is the other way round and gives a floor its
      // largest displacement from directly overhead, which is the exact
      // inverse of what a relief is.
      //
      // Both guards are `return` rather than a divide: a ray that runs down
      // the normal has no tangential part, and the honest answer there is no
      // offset - which is what a flat-looking surface seen from above is
      // supposed to look like.
    const walk = `
      float vn = abs( dot( pw, nw ) );
      float tl = length( dir );
      if ( tl < 0.0001 || vn < 0.0001 ) return vec2( 0.0 );
      vec2 dn = dir / tl;
      float mx = min( ${T} * tl / vn, ${T} * 8.0 );`;
    // The two-sided cell: two samples and the ray's own line between them, so
    // the crossing is where `h0 + (h1 - h0) * f` meets `1 - f` - one division,
    // no loop, no bisection. It breaks down at an oblique angle, which is why
    // it is the floor and not the ceiling.
    const twoSided = `
      vec2 pomTwoSided${i}( vec2 uv, vec3 an ) {
        if ( uPomTwoSided <= 0.0 ) return vec2( 0.0 );
        ${ray}
        ${walk}
        float h0 = texture2D( dH${k}, uv ).r;
        float h1 = texture2D( dH${k}, uv + dn * mx ).r;
        return dn * ( mx * clamp( ( 1.0 - h0 ) / max( 0.0001, h1 - h0 + 1.0 ), 0.0, 1.0 ) );
      }`;
    // The coarse walk, and the bisection on the parallax cells only. The walk
    // steps `mx` across in `uPomSteps` pieces, testing each against **the ray's
    // own height at that step** (`1 - t`) rather than against the previous
    // sample - a march that compares samples with each other is a hill-climb
    // and finds a local maximum, not the place the ray goes under the surface.
    // The bisection then halves the last interval four times, which is what a
    // parallax map buys over a relief one: the crown resolves to a fraction of
    // a step rather than to half of one.
    const march = `
      vec2 pomMarch${i}( vec2 uv, vec3 an ) {
        if ( uPomSteps <= 0.0 ) return vec2( 0.0 );
        ${ray}
        ${walk}
        float dt = 1.0 / uPomSteps;
        float t = 0.0;
        vec2 hit = uv;
        bool found = false;
        for ( int i = 0; i < ${POM_STEPS_MAX}; i ++ ) {
          if ( float( i ) >= uPomSteps ) break;
          t = dt * ( float( i ) + 1.0 );
          vec2 suv = uv + dn * ( mx * t );
          if ( texture2D( dH${k}, suv ).r >= 1.0 - t ) { hit = suv; found = true; break; }
        }
        // **A ray that never goes under the relief within the thickness has no
        // intersection**, and the honest answer is no offset rather than the
        // far end of the walk - a march that always returns something is a
        // smear with a uniform tint rather than a surface with depth on it.
        if ( !found ) return vec2( 0.0 );
        if ( uPomBisect > 0.5 ) {
          float lo = max( 0.0, t - dt ), hi = t;
          for ( int j = 0; j < 4; j ++ ) {
            float md = 0.5 * ( lo + hi );
            if ( texture2D( dH${k}, uv + dn * ( mx * md ) ).r >= 1.0 - md ) hi = md; else lo = md;
          }
          hit = uv + dn * ( mx * hi );
        }
        return hit - uv;
      }`;
    // The dominant plane of a triplanar set, and the march on it: the two
    // non-dominant projections keep the plain normal-map offset, which is the
    // whole of what a triplanar set's march is. A uv set marches in the lane's
    // own frame - one uv, one march, no dominance question.
    // `an` is the normalised absolute world normal, **a parameter and not a
    // global**, because a triplanar set's ray is read on whichever of the three
    // planes is dominant and that is a question only the caller's `an` answers;
    // a helper that reached out for it would be reaching for a local that is
    // not in scope in every block that asks for a march.
    const dominant = s.uv
      ? `return pomTwoSided${i}( vTrackUv * ${S}, an ) + pomMarch${i}( vTrackUv * ${S}, an );`
      : `
        vec2 uv = vTriW.zy * ${S};
        if ( an.y > an.x && an.y > an.z ) uv = vTriW.xz * ${S};
        if ( an.z > an.x && an.z > an.y ) uv = vTriW.xy * ${S};
        // The triplanar sets march the dominant plane only: the two
        // non-dominant projections keep the plain normal-map offset, which is
        // the whole of what a triplanar set's march is. The march runs on the
        // dominant plane's uv - the one that is the surface's own frame - and
        // the two other projections are plain.
        return pomTwoSided${i}( uv, an ) + pomMarch${i}( uv, an );`;
    return twoSided + '\n' + march + `
      vec2 pomO${i}( vec3 an ) {
        if ( uPomSteps <= 0.0 && uPomTwoSided <= 0.0 ) return vec2( 0.0 );
        ${dominant}
      }`;
  };
  const slope = (i) => {
    if (i >= n) return '';
    const s = live[i], k = K[i];
      // **A set with a `uv` is sampled once, in the lane's frame.** A triplanar set
      // is sampled three times and blended by the surface's three axes, which is
      // the right thing for a surface that is metres across and was built out of a
      // height field: there is no direction in it to prefer. A track has one. It is
      // a strip that bends, and a track's grain, its sweep and the direction a
      // snail runs all lie along it, so a world-projected map stamps the same
      // pattern at the same place in space whatever the lane is doing there, and
      // on a corner the grain runs across the racing line.
      //
      // So the road and its flank carry `trackUv` - **arc length along the lane in
      // `x` and metres out from the centre line in `y`**, both in metres and both
      // fed through the same `scale` as a projected coordinate, so a set's tile is
      // the same length whichever way it is drawn - and a uv set is one fetch
      // instead of three, taken in a frame that turns with the track.
      //
      // **When the set carries a `-h` map and the march is wanted**, the normal's
      // uv is offset by the POM walk on that set, and the two-sided path offsets
      // it by the crossing between two samples instead. The `pOff` half is that
      // offset: zero when the set has no height map or the march is off, and the
      // march's answer otherwise. The non-dominant projections keep the plain
      // offset - the march runs on the dominant plane only, which is the whole
      // of what a triplanar set's march is, and a uv set marches in the lane's
      // own frame.
      if (byUv(s)) return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            d += (texture2D(dN${k}, vTrackUv * dS${k} + pOff${i}).xy * 2.0 - 1.0)
               * (vDetailW.${k.toLowerCase()} * dK${k});
          }`;
      return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            vec2 t = vec2(0.0);
            t += (texture2D(dN${k}, vTriW.zy * dS${k} + pOff${i}).xy * 2.0 - 1.0) * an.x;
            t += (texture2D(dN${k}, vTriW.xz * dS${k} + pOff${i}).xy * 2.0 - 1.0) * an.y;
            t += (texture2D(dN${k}, vTriW.xy * dS${k} + pOff${i}).xy * 2.0 - 1.0) * an.z;
            d += t * (vDetailW.${k.toLowerCase()} * dK${k});
          }`;
    };
  const tint = (i) => {
    if (i >= n) return '';
    const s = live[i], k = K[i];
    if (!s.colour) return '';
    if (byUv(s)) return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            float f = vDetailW.${k.toLowerCase()} * ${g1(s.colourAmount, 1)};
            dc += texture2D(dC${k}, vTrackUv * dS${k} + pOff${i}).rgb * (f * ${g1(s.colourGain, 1)});
            dsum += f;
          }`;
    return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            vec3 t = vec3(0.0);
            t += texture2D(dC${k}, vTriW.zy * dS${k} + pOff${i}).rgb * an.x;
            t += texture2D(dC${k}, vTriW.xz * dS${k} + pOff${i}).rgb * an.y;
            t += texture2D(dC${k}, vTriW.xy * dS${k} + pOff${i}).rgb * an.z;
            float f = vDetailW.${k.toLowerCase()} * ${g1(s.colourAmount, 1)};
            dc += t * (f * ${g1(s.colourGain, 1)});
            dsum += f;
          }`;
  };
  const decls = live.map((s, i) => {
    const k = K[i];
    const d = [`uniform sampler2D dN${k};`, `uniform float dS${k};`, `uniform float dK${k};`];
    if (s.colour) d.push(`uniform sampler2D dC${k};`);
    if (s.height) d.push(`uniform sampler2D dH${k};`);
    return d.join('\n        ');
  }).join('\n        ');
  m.onBeforeCompile = (sh) => {
    live.forEach((s, i) => {
      const k = K[i];
      sh.uniforms['dN' + k] = { value: s.map };
      sh.uniforms['dS' + k] = { value: s.scale };
      sh.uniforms['dK' + k] = { value: s.strength === undefined ? 1 : s.strength };
      if (s.colour) sh.uniforms['dC' + k] = { value: s.colour };
      if (s.height) {
        sh.uniforms['dH' + k] = { value: s.height };
        // **The thickness is a GLSL literal and not a uniform**, the way
        // `colourGain` is: it is a property of the map - the biome's own
        // measured crown-to-joint distance in tile fractions - and a march
        // whose depth is a number the machine can change is a march whose
        // depth is no longer the map's. So there is no `dT` uniform to write,
        // and that is the whole of why there is not one.
      }
    });
    // The march's three shared uniforms, written onto every course-surface
    // program the same way `gfxInject()` writes `uCloudAmt`: one call at
    // both chain sites, so the off path (`uPomSteps == 0.0 && uPomTwoSided ==
    // 0.0`) is byte-identical to today's `d` computation and a cell press is
    // a uniform write and not a recompile.
    sh.uniforms.uPomSteps = gfxU.uPomSteps;
    sh.uniforms.uPomTwoSided = gfxU.uPomTwoSided;
    // **And the third of the three**, which is the one a first cut leaves out:
    // a uniform the shader declares and nobody hands it reads zero forever, so
    // the bisection is silently off on every cell and relief 8 and parallax 8
    // come back **byte-identical** - a wrong picture with no error anywhere,
    // and the only thing that can see it is two cells measured against each
    // other rather than against the row's off cell.
    sh.uniforms.uPomBisect = gfxU.uPomBisect;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 detailW;
        ${anyUv ? 'attribute vec2 trackUv;\nattribute vec3 trackR;\nvarying vec2 vTrackUv;\nvarying vec3 vTrackR;' : ''}
        varying vec4 vDetailW;
        varying vec3 vTriW;
        varying vec3 vTriWN;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vDetailW = detailW;
        ${anyUv ? 'vTrackUv = trackUv;\nvTrackR = trackR;' : ''}
        #ifdef USE_INSTANCING
          vTriWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vTriWN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vTriW = (modelMatrix * mat3(instanceMatrix) * vec4(transformed, 1.0)).xyz;
        #else
          vTriW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vDetailW;
        ${anyUv ? 'varying vec2 vTrackUv;\nvarying vec3 vTrackR;' : ''}
        varying vec3 vTriW;
        varying vec3 vTriWN;
uniform float uPomSteps, uPomTwoSided, uPomBisect;
         ${decls}
         // **And the marches themselves, held in globals rather than in a local.**
         // They are worked out in the colour include and read again in the
         // normal's, because three runs the colour include first
         // and a value a local cannot outlive is a value one of the two has to
         // march for itself - **and a march per fragment is a march whose
         // colour and whose normal can disagree**, which is the one thing the
         // displacement must not do: a sett's crown is pale and its joint is
         // dark, so displacing the normal alone paints the relief of one stone
         // onto the colour of another and reads as a smear rather than as a
         // floor. One march, two reads.
         ${live.map((_, i) => `vec2 pOff${i};`).join('\n         ')}
         // The POM march, one helper for every set that carries a -h map. It is
         // gated by the two shared uniforms so that the off path
         // (uPomSteps == 0.0 && uPomTwoSided == 0.0) returns vec2(0.0) and the
         // normal map is sampled at its current uv - byte-identical to today's
         // d. pomMarch is the coarse walk and bisection on the parallax cells
         // only, and uPomBisect is what says which those are rather than the
         // step count doing it; pomTwoSided is two samples and a crossing on
         // the two-sided cell.
         // The triplanar sets march the dominant plane only - the two
         // non-dominant projections keep the plain normal-map offset - and a
         // uv set marches in the lane's own frame: one uv, one march, no
         // dominance question.
         ${live.map((s, i) => pomHelperGLSL(i, s)).join('\n        ')}
       `)
       .replace('#include <normal_fragment_maps>', `
         {
           vec3 an = abs(normalize(vTriWN));
           an /= (an.x + an.y + an.z);
           // The POM branch, gated by the two shared uniforms so that the off
           // path (uPomSteps == 0.0 && uPomTwoSided == 0.0) samples the normal
           // at its current uv and is byte-identical to today's d. When a
           // march is wanted, each set's normal uv is shifted by its own
           // pOff, which the colour include has already worked out; the two-sided
           // path shifts it by one crossing instead, and the parallax cells add
           // the bisection. The triplanar sets march the dominant plane
           // only - the two non-dominant projections keep the plain
           // normal-map offset - and a uv set marches in the lane's own
           // frame. The pOff for a set with no -h map is zero and its
           // slope is the plain normal-map one, so the off path is today's
           // d and not a second copy of it.
          vec2 d = vec2(0.0);${live.map((_, i) => slope(i)).join('')}
          vec3 wn = normalize(normalize(vTriWN) + vec3(d, 0.0));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          // **The marches, here rather than in the normal's block**, because
          // three puts the colour first and both halves of a set's surface have
          // to be displaced by the same amount - see the globals' note above.
          ${live.map((s, i) => `pOff${i} = ${s.height ? `pomO${i}( an )` : 'vec2(0.0)'};`).join('\n          ')}
          vec3 dc = vec3(0.0);
          float dsum = 0.0;${live.map((_, i) => tint(i)).join('')}
          // and the same for the colour: a weighted mean of the sets' detail
          // rather than a chain of multiplies, so a surface that is half turf and
          // half stone is half of each map and not one map laid over the other
          if (dsum > 0.002) diffuseColor.rgb *= dc / dsum;
        }`);
  };
  // two different shaders under one material name breaks three's program cache
  // in a way that is very hard to read off a stack trace, so this one is named
  // `triplanarSets` + the set count + **whether any of them is a uv set**. The
  // last of those is the one that was nearly missed: `mat.course` and `mat.ledge`
  // both carry three sets, one is drawn in the world and the other in the lane,
  // and a cache key that named only the count would hand the meadow a shader
  // with a `trackUv` attribute in it - which is not an error, it is a varying
  // reading garbage, and it is a wrong picture rather than a broken one.
  m.customProgramCacheKey = () => 'triplanarSets' + n + (anyUv ? 'Uv' : '');
  return m;
}

/**
 * The biome that is standing. **It is declared here rather than beside the four
 * functions that write it**, because the module-scope block at the foot of this
 * file calls `useBiome()` to establish `temperate`, and **a `let` read above its
 * own declaration is a temporal dead zone**: a `ReferenceError` on the module's
 * first line, at boot, with nothing else wrong anywhere. The functions live where
 * they do because they are only ever called from here and from `race.js`; the
 * variable has to be above the first caller.
 *
 * It is a `let` and a getter and not an exported pair of assignable bindings
 * because **a module's live bindings are read-only from outside** - see
 * `clearRegister()`/`standingReport()` and `stageOf()`/`buildStable()` for the rest
 * of this rule in this county.
 */
let standingBiome = null;
/** And the biome that is standing, read. */
const biomeNow = () => standingBiome || BIOMES.temperate;

const mat = {
  /**
   * The meadow, the road and the flank: **one material each, no index groups.**
   *
   * These three were four materials and three index splits, and the split is what
   * drew the lines. A course surface is a single mesh of shared vertices wearing
   * different materials per group, so a turf-to-stone edge was a material
   * boundary — one quad wide, and one row of pixels where the index changes from
   * grass blades to rock joints. The vertex colour could be faded to the halfway
   * point, and it was, and the line was still there, because the colour is only
   * half of what a material is.
   *
   * So each of these hosts its sets in one material and cross-fades them by a
   * per-vertex weight. `mat.course` carries all three surfaces of the
   * countryside — turf, cliff and shore — and `mat.road` and `mat.ledge` carry
   * two each. The set numbers, the tiles, the strengths and the gains are the
   * ones the old single materials used, unchanged; what changed is that there is
   * no longer a row of pixels where the surface changes.
   *
   * All three need a `detailW` attribute on their geometry and are not hung on
   * anything that has not got one — the stable's lawn and the six thousand tufts
   * are on `triplanarDetail()`'s single-set path and are untouched.
   */
  course: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }),
  road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }),
  ledge: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }),


  /**
   * The rock a snail **climbs**, which is the cliff's grain and none of its
   * weather.
   *
   * `cliff-albedo` is a darkening map and it is darkening on purpose: a face is
   * weathered a long way below the top of it, and that is most of what makes a
   * cut read as a cut. But the ribbon is not a face. `buildRoad()` stops at
   * FACE_SLOPE, so everything drawn in this material is a **ramp** of at most
   * fifty-eight degrees - and a ramp stands up to the light where a face stands
   * across it, and at a low sun the difference is the whole picture. In the one
   * material the climbing road came out as a black wedge on a green hillside at
   * half past four in the afternoon, which is not a road and not a face and not
   * anything in the county.
   *
   * So this is `mat.cliff` with the **weather** left off and the **grain** kept -
   * and the two are not the same map, which is the whole of it. The face takes
   * `cliff-albedo` as it stands, at a gain of 1, and comes out dark. This takes
   * the *same file* with some of the mean put back, which is what `detailCGain`
   * is for and what that map was built under one to allow: the map averages 0.57
   * linear, and a gain of **1.3** lands it around 0.74, so the ramp stands up
   * out of the face as a worn road without going pale beside it. The plates, the
   * cracks and the bedding are still in it because the range is stretched rather
   * than flattened.
   *
   * Not 1.75, which is the map's mean put back exactly, and which was this
   * first. That is arithmetic with no judgement in it and the picture has plenty
   * of judgement in it: at 1.75 the mean lands on one and the *top* of the range
   * goes to 1.45, the pale plates clip, and the climbing road came out as pale
   * limestone lying on top of a dark basalt cliff - which is a different county.
   * The gain is how much of the weathering to take off, and "all of it" is not an
   * answer to that any more than "none of it" is.
   *
   * Left with the normal and no colour at all - which is where this started - the
   * ramp was a black hole in the middle of the course with the cliff's own texture
   * showing at its edges where a grazing light caught the relief. A normal is
   * shape and not value: it can only ever subtract from what a surface already
   * has, and a face turned away from a nine-degree sun has nothing to subtract
   * from. The rock has to be *in* it.
   *
   * All of which is now a **set** rather than a material of its own: this is the
   * road's second set, the cliff's map at a gain of 1.3, and it is a set rather
   * than a material so that the strip of road and the strip of ramp meet in a
   * gradient. The weight that chooses between them is the same `isRock()` the two
   * groups used, carried per vertex and interpolated across the quad.
   */

  water: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.22, metalness: 0.08,
    transparent: true, opacity: 0.80, depthWrite: false, side: THREE.DoubleSide,
  }),
  foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  // the glass in a lamp: dark by day, and the thing that carries the light
  // once the hour asks for it
  // the paper of a lantern: warm, thin, and lit from within once the hour
  // asks for it, which is the whole point of a paper lantern
  paper: new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.9,
    emissive: LAMP_COLOUR, emissiveIntensity: 0,
  }),
  lampGlass: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.35,
    emissive: LAMP_COLOUR, emissiveIntensity: 0, transparent: true, opacity: 0.9,
  }),
  /* ---- the four panes of a candle lantern, and they are the only surface
   * in the county that is drawn at a third of itself ------------------------ *
   * `lampGlass` above is a lamp's **globe** and this is a lantern's **window**,
   * and the difference is 0.9 against 0.34 and not a taste. A globe is a solid
   * of blown glass with a burner inside it and you are meant to read the light
   * off it; a pane is four millimetres of flat glass with a candle behind it, and
   * at 0.9 the candle is behind two panes of tint and the lantern is a coloured
   * box with something you half expect to see and cannot.
   *
   * **`depthWrite` is off and that is what makes four of them work.** The panes
   * are unwelded - welded into one box, the far pane draws behind the near one -
   * so each one is drawn in buffer order against a depth buffer that holds only
   * the frame and the wax. A pane writes no depth, so all four test against the
   * *solid* parts of the lantern and blend over each other, and looking through
   * a corner of the lantern is two panes of tint, which is what looking through
   * a corner of a lantern is. Switch the depth write on and the fourth pane
   * drawn wins the whole box: the lantern turns inside out and shows you its own
   * back wall from the inside.
   *
   * And **it has no emissive and no emissive map, which is the second half of
   * what this material is for.** `mat.paper` and `mat.lampGlass` both burn in
   * `LAMP_COLOUR`, which is the warm cream every street lamp in the county is -
   * and an emissive is *not* multiplied by the vertex colour, so a pane carrying
   * one would glow cream on a cyan lantern and the tint would only be on the
   * glass's own surface. The reference's cyan lantern is cyan all the way out to
   * its corners because the light behind it is cyan, and the light is coloured by
   * name off `lampPosts[].colour`; so a pane needs no light of its own, it needs
   * to be lit by the one in the middle of it, and the only thing that costs is
   * the transparent pass. This is the same rule the county's grass is on from the
   * other end: **a surface either gives out light or is given it, and never
   * both.** */
  /* ---- the wax in a candle lantern, and it is `mat.paper` with one line
   * taken out of it ------------------------------------------------------- *
   * **A material's emissive is not multiplied by its vertex colour**, which is a
   * fact about three's fragment shader and not a matter of taste: `vec3
   * totalEmissiveRadiance = emissive;` and `emissiveColor` are the only two
   * things that touch it, and `vColor` is not one of them. `vColor` reaches
   * `diffuseColor` and stops there. So every lit thing in the county that wears
   * an instance tint - a paper lantern, a lamp globe - takes its colour in the
   * *diffuse* and burns warm cream out of the *emissive*, and it has been fine
   * until now because a paper lantern's own glow is a small warm lift on a
   * surface the hour is already lighting.
   *
   * A candle's wax is the one surface in the county where that stops working, and
   * the numbers are why. The point light in a candle lantern sits on the wick,
   * **on the axis of the wax and above it**, and a light on the axis of a closed
   * cylinder gives that cylinder nothing on its sides: the surface normal points
   * outwards and the light is inwards of it, so `N · L` is negative over the
   * whole of the flank however bright the lamp is. Raised the flame does not help
   * and lowering it into the wax does not either - the dot product is negative
   * either way, and inside the wax it is negative for the top as well. So the
   * one surface the reference photographs as the brightest thing in the lantern -
   * a glowing pillar of coloured wax - is the one surface the engine cannot
   * light, and it came out **a dark cylinder standing in a lit glass box**.
   *
   * A wax is translucent and the light that lights it goes *into* it at the top
   * and comes out of the flank, and that is a second bounce three does not have.
   * So it is written down instead: `totalEmissiveRadiance *= vColor` under
   * `emissivemap_fragment`, which puts the instance tint back into the glow the
   * one place it was missing, and the wax is a **tinted emitter** - a red
   * lantern's candle really is red and a cyan one really is cyan.
   *
   * **The flame does not get it**, and that is the other half of the reference.
   * A candle's core is paler than everything around it whatever colour the wax
   * is, so the flame stays in `mat.paper` and burns its own untinted cream: hot
   * core, coloured body. And it is the reason this is a separate material rather
   * than a flag on `mat.paper` - `mat.paper` is on every paper lantern in the
   * county and turning its glow into its tint would repaint all of them. */
  candleWax: afterCompile(new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.9,
    emissive: LAMP_COLOUR, emissiveIntensity: 0,
  }), (sh) => {
    if (!/emissivemap_fragment/.test(sh.fragmentShader)) return;
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n'
      + '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n'
      + '\ttotalEmissiveRadiance *= vColor;\n'
      + '#endif'
    );
  }),
  lanternPane: new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.12,
    transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide,
  }),
  wood: new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.85 }),
  vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  // Iron, and it is the county's only metal and **the fallback and not the answer**
  // for the crate's brackets: `meshes/push-crate.glb` declares its own material
  // with a metalness of one, and this is what a caller gets if that file ever
  // stops declaring one. A metalness of zero here is deliberate - a bracket drawn
  // with it is grey plastic, and that is the picture the setting is here to catch.
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 1.0 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x7c9a4a, roughness: 1.0, side: THREE.DoubleSide }),
  /**
   * The ashlands' tuft, and **it is a second material and not a swap of the
   * first** because `mat.grass` is the stable's as well as the courses' - see
   * `gfxSurfaceTargets()`, which is where the wind goes on it, and the whole
   * argument for not moving `mat.grass` at all.
   *
   * **Its colour is a dark grey and not a pale one, and the number is the
   * meadow's own ratio rather than a taste.** A tuft wears its instance tint
   * *multiplied* over its own vertex colours, and the blades run `ashStem` to
   * `ashStemTip` - mean about 0.44 linear, the ashlands' own mean. The meadow's
   * arithmetic says where the material's colour has to sit: the meadow's ground is
   * `grassA` (0.238) times `grass-albedo` (0.544) times its gain of 1.20, which is
   * **0.156 linear**, and the meadow's tufts are `mat.grass` (0.19-0.30) times a
   * blade mean of 0.17 times the same albedo and gain, which is **0.034** - so a
   * meadow tuft is **a fifth of its own ground**, and that is why a meadow reads as
   * a mat with a dark fringe on it rather than as a field of bright wire. **The ash
   * ground is 0.324 linear, and `ashDark` at 0.145 puts the ash tuft at 0.047 -
   * a seventh of it.** An ash tuft brighter than the ash it stands in is a meadow
   * in a dead valley's clothes, and this is the one place in the biome where the
   * second biome's failure is a *value* rather than a hue.
   *
   * `6a6867` is `ashDark` out of the jar, decoded; it is written as a literal
   * because a material literal cannot read the palette.
   */
ashFoliage: new THREE.MeshStandardMaterial({ color: 0x6a6867, roughness: 1.0, side: THREE.DoubleSide }),
  flower: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
  cloud: new THREE.MeshStandardMaterial({
    color: 0xf6f9fc, emissive: 0xdde8f2, emissiveIntensity: 0.6,
    flatShading: true, roughness: 1.0, fog: false,
  }),
  // The backdrop keeps its flat shading, and this is the one place in the
  // project that does. A hill is a nine-by-six sphere: smooth-shaded, the
  // normals bend away from the light over most of it and a hill at a low sun is
  // a black shape against a bright sky, because there is no facet left facing
  // the sun. Flat-shaded, one of them always does. Nothing here is meant to be
  // looked at closely enough for the facets to read as a mistake, and the
  // backdrop is out of scope for the PBR work for exactly that reason.
  hillFar: new THREE.MeshStandardMaterial({ color: 0xb2c8c6, flatShading: true, roughness: 1.0, fog: false }),
  hillNear: new THREE.MeshStandardMaterial({ color: 0x8cae94, flatShading: true, roughness: 1.0, fog: false }),
  shellDark: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }),
};
// The sky, the clouds and the hills are out of scope for the PBR work and stay
// exactly as they were lit, so the environment map is taken off them: they are
// painted by hand to match the hour, and an image-based light on top of a
// hand-painted colour is how a backdrop goes chalky.
for (const m of [mat.cloud, mat.hillFar, mat.hillNear]) m.envMapIntensity = 0;
/** One of the course surface's maps, by slot, or null if it was never drawn. */
const detailOf = (which, slot) => {
  const name = SURFACE[which].find((n) => slotFor(n) === slot);
  return name && MAPS_TEX && MAPS_TEX.has(name) ? MAPS_TEX.get(name) : null;
};
/**
 * Any map in the jar, by name, or null. For the maps a surface projects rather
 * than samples: the marble is declared against the fountain, which has uvs and
 * wears it the ordinary way, and it is wanted on the plinth and the basin as
 * well, which are built here and have no uvs to sample it with.
 */
const mapTex = (name) => (MAPS_TEX && MAPS_TEX.has(name) ? MAPS_TEX.get(name) : null);

/**
 * **One water material per pool**, and the reason is `envMap`: it is a property
 * of the material, so a pool that reflects its own bank - which is the whole of
 * what the reflections row is for - cannot share one with three other pools
 * three hundred metres away. So `mat.water` stays as the county's single
 * reference water, and every surface that needs a probe of its own is a copy of
 * it: same colours, same two ripple normals, and the *same* ripple uniform
 * object, so four pools are still one body of water that happens to be in four
 * places. Four materials of identical code is four materials, and three's
 * program cache makes that four uniform sets rather than four shaders.
 *
 * `mat.water` is untouched, so anything that still asks for it directly - and
 * anything that reads a property off it - still gets exactly the water it has
 * always got.
 */
function poolWaterMat() {
  return rippleWater(mat.water.clone(),
    detailOf('water', 'normalMap'), detailOf('water', 'ripple2'));
}
{
  // one tile of detail is about two metres across on the ground, and the same
  // grain repeated smaller on the track, which is a narrower ribbon
  //
  // And the track now wears a **colour** as well, off the same tile and the same
  // field in the builder, so the dust swept pale down the middle of it is the
  // patch the normal has raised. The gain is **1**: the map is built close to
  // one on purpose - narrow tones, centred high, a hollow or two down at 0.6 -
  // because a track is the colour its vertex colours already say it is and what
  // it was short of was grain. The cliff's colour is a gain of 1 too and sits
  // well under one instead, and that difference is the point of both: a face is
  // weathered a long way below its top and a track is not, so the one map is
  // built to darken and this one is not.
  //
  // And it is worth saying what the map does **not** do, because the track is
  // the one surface in the county that could not have it any other way: it
  // carries no hue at all. The red is `PAL.clay` in the ribbon's vertex colours
  // and this is a multiply about one, so the track is the most saturated colour
  // in the jar without a single texel of the map adding any chroma of its own.
  //
  // The track. Two sets in one material — the track's own grain, and the cliff's
  // at a gain that puts its mean back — so the strip of clay and the strip of
  // ramp on the climbing half of it meet in a **gradient** across a quad rather
  // than in a material boundary. The tile is **0.85 metres** and the map moved to
  // 1024 underneath it, so the grain it carries is the grain the three references
  // this field was drawn from carry: two to six millimetre chips at eight texels
  // each, where the old map at 512 put the same chip in one and a half. See the
  // `mat.ramp` block below for why the ramp is the cliff's map with the weather
  // left off, and the cliff's set here for why the face is not.
  //
  // And the track's set is **`uv: true`** while the cliff's is not, and that is
  // the difference between a map that follows the lane and a map that does not.
  // The ribbon is a strip that bends; its grain, the sweep the broom leaves and
  // the direction a snail runs all lie along it, and a triplanar projection
  // stamps the same pattern at the same place in world space whatever the lane
  // happens to be doing there — so on a corner the clay's grain runs across the
  // racing line and the sweep has no direction at all. The cliff's set stays
  // projected, because a face has no lane to follow: its bedding is level in the
  // world and it should stay that way whichever way the cliff is cutting.
  // And so the three materials that wear the sets. **The two sets on the ribbon,
  // the flank's three and the countryside's three are written down here in prose
  // and built by `useBiome()` below**, because a biome's whole contribution to
  // them is which `SURFACE` key and which number each slot is given, and a
  // literal in the material block is a literal a biome cannot reach:
  //
  //   - **road**, two sets. The **track's own grain** at a tile of 0.85 m,
  //     `uv: true`, on a gain that is the map's mean rather than a taste - the
  //     albedo's weighted field is put under one on purpose so its highlight half
  //     survives the eight-bit canvas, and at 1.0 the road arrives a third of a
  //     stop dark and reads as a brown card. And the **cliff's**, projected rather
  //     than in the lane's frame, at the ramp's gain. So the strip of clay and the
  //     strip of ramp on the climbing half of it meet in a **gradient** across a
  //     quad rather than in a material boundary; see `mat.ramp`'s block for why
  //     the ramp is the cliff's map with the weather left off and the cliff's set
  //     here for why the face is not.
  //
  //     `uv: true` is the difference between a map that follows the lane and one
  //     that does not. The ribbon is a strip that bends; its grain, the sweep the
  //     broom leaves and the direction a snail runs all lie along it, and a
  //     triplanar projection stamps the same pattern at the same place in world
  //     space whatever the lane happens to be doing there - so on a corner the
  //     clay's grain runs across the racing line and the sweep has no direction at
  //     all. The cliff's set stays projected, because a face has no lane to
  //     follow: its bedding is level in the world and it should stay that way
  //     whichever way the cliff is cutting.
  //
  //   - **ledge**, the same two again plus the **shore's**, with the cliff at its
  //     own gain rather than the ramp's: a flank is a face and takes the weather as
  //     it stands. The third set is why the flank of a track is not more clay - it
  //     is the edge of a built surface, and the county's edge for that is sand, at
  //     the same tile and the same gain. Where the ribbon is a ramp the flank is a
  //     face and the cliff's set takes the weight, so the third set's share is
  //     `1 - rampShare()` and the two cross-fade on the same numbers the ribbon's
  //     do. Without it the flank was the road's colour at 0.78 and read as a band
  //     of wet earth round every course, and a painted line with a trench under it
  //     is not a court. The shore is `uv` as well, so the flank's grain turns with
  //     the lane exactly as the ribbon's does and the corner between the two is a
  //     corner between two surfaces rather than a corner between two frames.
  //
  //   - **course**, **three** sets - turf, cliff and shore - and this is the one
  //     that removed the seams the ground mesh used to be split into three groups
  //     for. The turf is five metres a tile, and that is the number that answers
  //     "this map reads at a hundred paces and then stops": a course verge is two
  //     hundred and forty metres across, so a two-metre tile went past a hundred
  //     times in a single row and the stems lined up into corduroy visible from the
  //     start line. The strength is 0.3 and the map is at 1024 with the relief in
  //     thin lines rather than in lobes, so those two are one change: the old
  //     numbers together gave two and a half degrees of slope across a whole county
  //     of grass, which is nothing, because two degrees of tilt is a value change
  //     and a vertex colour already has one. **A detail map's strength is a
  //     function of its tile.** The cliff's tile is a little under two metres so a
  //     slab is about the size of a slab, and its strength is well above the
  //     bed's because the point of it is the **edges**. The shore's is nine tenths
  //     of a metre, so a crest is about a hand's width, and its strength is well
  //     under the cliff's because that is a *strength* question on a fine grain:
  //     sand that stands up like a rock face is not a shore. Each colour is on its
  //     normal's own tile, because each field is one function feeding both maps and
  //     a pale plate in the colour has to be the plate the normal has raised.
  //
  // Every one of those numbers is now a field in `meshes/biomes.js`, and the
  // **set count and the order do not move**: the weight a vertex gives a set is
  // the set's *letter*, so a biome that left one out would change what the rest
  // multiply and three would find a different program under one material name.
  //
  // **And the biome itself is `useBiome('temperate')`, and the call is not here.**
  // It is the first act of `gfxSurfaceTargets()` above, because `useBiome()` writes
  // `PAL` - the sixteen colours these surfaces are about to bake into their vertex
  // colours - and **`PAL` is declared below this block**, so a call here would read
  // a `let` above its own declaration, which is a temporal dead zone and a
  // `ReferenceError` on the module's first line at boot with nothing else wrong
  // anywhere. That function is already "the only thing in this file that has to run
  // exactly once and in one order - after the jar is built and before a frame is
  // drawn", and standing the biome is exactly such a thing: it needs the jar.

  rippleWater(mat.water, detailOf('water', 'normalMap'), detailOf('water', 'ripple2'));

  // The roughness halves of those pairs are drawn and shipped but are not hung
  // on anything here, and that is deliberate rather than an oversight. The
  // ground, the bed, the cliff and the shore are all built along the spline and
  // have no uv, and a `roughnessMap` is the one slot that can only ever be read
  // by uv - so putting one on any of them does not give the surface a texture,
  // it gives it a single texel: the shader samples (0,0) for every fragment, the
  // map is uploaded and bound to be read once, and the surface's roughness
  // quietly stops being the 1.0 it was authored at. The maps stay in
  // `meshes/tex/` because they are the roughness half of a pair and the tools can
  // show them, but a surface that wants one has to have a uv first.
  // `grass-rgh` is not drawn at all, and that is the same rule: grass is
  // uniformly rough, so the half of the pair that would have done nothing is
  // better off not existing than in the folder.

  // The grass, which is `mat.grass` and is a flat colour in a material with no
  // vertex colours - and a tuft has no uv either, and there is nowhere to put
  // one on six thousand of them. So the detail is projected the same way the
  // course surface's is, and it is the one surface in the county that needs it
  // more than the ground does, because a tuft is what a race actually sees:
  // the ground between two tufts is three metres off and mostly behind them.
  //
  // And it takes **both halves of the pair**, not just the normal, which is the
  // thing this missed for a long time. There are three green surfaces in the
  // county - the ground, the lawn disc and the tuft - and the first two wore
  // `grass-albedo` while the tufts wore nothing at all, so the piece of grass
  // a snail is racing past was a flat `#7c9a4a` cone with a normal on it. It is
  // a multiply, exactly as it is on the other two, so a stem is a shade greener
  // or a shade yellower than the mat and the mat keeps the colour it was given.
  //
  // The tile is **a metre and a half**, which is not the ground's five and not
  // the old fourteen centimetres, and all three of those numbers are the same
  // number: a tuft is a third of a metre across and a stem in this map is a
  // hundredth of the tile, so the tile that puts a centimetre-and-a-half stem
  // on a tuft is one and a half metres. The old 0.14 was chosen against the old
  // map, whose lattice was 53 and put a two-and-a-half-millimetre stem on the
  // ground; on the new map, whose lattice is 125, that same 0.14 puts a
  // millimetre of stem on a tuft and the map is a fifth of a texel. The
  // resolution and the tile moved together, which is the whole of why they have
  // to.
  //
  // The strength is 0.5 against a map that tilts 22, so about eleven degrees -
  // more than the ground's 0.3 does, and on purpose: a tuft is a third of a metre
  // across and a third of a metre of turf three metres off is four pixels.
  triplanarDetail(mat.grass, detailOf('grass', 'normalMap'), 0.7, 0.5,
    detailOf('grass', 'map'), 0.7, 1, 1.20);

  /**
   * And the ashlands' tuft, which is **the same call on `mat.ashFoliage`** and
   * for the same three reasons: a tuft has no uv, so the detail is projected the
   * way the course surface's is; it takes both halves of the pair, because a stem
   * a shade paler than the mat is what makes it a clump and not a cone; and the
   * tile is **a metre and a half for the county's own reason** - a tuft is a third
   * of a metre across and a stem in the map is a hundredth of the tile, so the
   * tile that puts a centimetre-and-a-half stem on a tuft is one and a half
   * metres.
   *
   * The ash map's stems are **finer than the meadow's**, because ash is not
   * blades: the field behind it is fine grey grit over a broad crust, so the
   * relief at a stem's width is a crust breaking up rather than a blade, and the
   * strength is a shade over the meadow's for the reason the meadow's is at all -
   * a third of a metre of it three metres off is four pixels.
   *
   * **And it is the wind's, which is why it is a material of its own rather than
   * a tint**: see `gfxSurfaceTargets()`, which puts it on `WIND_MATS`, and
   * `windMark()`, which stamps the geometry an `InstancedMesh` of it carries.
   */
  triplanarDetail(mat.ashFoliage, detailOf('ashGrass', 'normalMap'), 0.7, 0.55,
    detailOf('ashGrass', 'map'), 0.7, 1, 1.05);

// The maps the game hands out by hand, because the hour - or the glass - can
  // only reach them from here. **The two things that give out light** are the
  // pair in the project that cannot be drawn in the material out of their own
  // file, because the hour drives their emissive by material name - and a
  // material the hour does not know about stays dark at midnight. So the maps go
  // to `mat.paper` and `mat.lampGlass` here, where the hour can see them, and
  // `GAME_MATERIAL` in the manifest keeps `scatter()` from swapping them back
  // out. The third row is the one that gives out nothing and is still here.
  //
  // An emissive map is read as a colour and multiplied into the emissive, so it
  // is not a mask - it is what the lit thing looks like. The paper's is warm and
  // ribbed, and the ribs being *brighter* than the paper either side of them is
  // the whole trick - a rib is paper seen edge-on, so it is thinner, so it gives
  // out more. Without it a paper lantern is a glowing ball.
  //
// **And the candle lantern's two lit parts take the same two maps, and one of
   // them is the wax and not the flame** - which is the fourth prop on this list
   // and the only one whose game materials are not a paper and a globe. A candle
   // is wax and a flame, and both burn: the wax in `mat.candleWax`, which is
   // `mat.paper` with the instance tint put back into the glow, and the flame in
   // `mat.paper` itself, because a flame's core is paler than everything around
   // it whatever colour the wax is and so it does not want the tint. The pane
   // takes `glass-n` and **no emissive at all**, for the reason
   // `mat.lanternPane` carries none: a pane is lit by the flame in the middle of
   // it, and giving out light of its own would put a cream box around a cyan
   // lantern.
  for (const [m, prop, part] of [
    [mat.paper, 'lantern-pole', 'paper'],
    [mat.lampGlass, 'lamp-glass', ''],
    [mat.candleWax, 'candle-lantern', 'candle'],
    [mat.lanternPane, 'candle-lantern', 'pane'],
  ]) {
    for (const name of mapsFor(prop, part)) {
      if (!MAPS_TEX || !MAPS_TEX.has(name)) continue;
      for (const slot of mapSlots(name)) m[slot] = MAPS_TEX.get(name);
    }
  }
}

/**
 * The colours, out of the jar the builders and the texture builder share. The
 * jar holds linear triples, which is what a vertex colour is written in, so
 * these are the same numbers with the same values as before - nothing here
 * repaints the county, it only stops it being written down four times.
 */
const colour = (name) => new THREE.Color().setRGB(name[0], name[1], name[2], THREE.LinearSRGBColorSpace);
const PAL = {
  dirtA: colour(C.dirtA), dirtB: colour(C.dirtB), dirtEdge: colour(C.dirtEdge), dirtLight: colour(C.dirtLight),
  stoneA: colour(C.stoneA), stoneB: colour(C.stoneB),
  grassA: colour(C.grassA), grassB: colour(C.grassB), deep: colour(C.deep),
  dry: colour(C.dry), earth: colour(C.earth), earthDeep: colour(C.earthDeep),
  sand: colour(C.sand), waterA: colour(C.waterA), waterB: colour(C.waterB),
  // The track, and it is the only group here that is not a soil or a stone: see
  // the note on them in the jar.
  clay: colour(C.clay), clayDeep: colour(C.clayDeep), clayDust: colour(C.clayDust),
  trackLine: colour(C.trackLine), trackLineWorn: colour(C.trackLineWorn),
};
const GREEN = GREEN_T.map(colour);
const BARK = colour(C.bark);
const STONE = STONE_T.map(colour);
// No pure white in the flowers: at ten centimetres across a white speck in the
// grass reads as a stone, and there are enough of them to notice.
const FLOWER_COLORS = FLOWER_HEX;
const MUSHROOM_RED = colour(C.mushroomRed);
const MUSHROOM_BROWN = colour(C.mushroomBrown);

/* ================================================================== *
 * The standing biome
 *
 * **A biome is standing state, and standing state in this county comes out as a
 * pair**, for the same reason `clearRegister()`/`standingReport()` are a pair and
 * `stageOf()`/`buildStable()` are a pair: an exported `let` cannot be assigned
 * from another file, and it cannot be emptied either, which is the worse half,
 * because `standingBiome = null` reads as ordinary code and throws for everybody
 * who draws it. So the module keeps the `let` and the two other modules get a
 * call each.
 *
 * **`materials.js` is the right home for it on two counts that are not
 * tidiness.** It already owns `PAL`, which `surfaces.js` and `stage.js` both
 * import, so one call writes the sixteen colours and the four roles and there is
 * no second module holding half of a biome. And it already owns
 * `triplanarSets()`, so the swap is a call on the machinery that is standing
 * rather than a set of writes into it from outside.
 *
 * **And it is not a member of the `world` registry**, which is the registry's
 * own argument rather than a preference: every one of its fifteen functions is a
 * function because it reads something reassigned after boot, and its eight data
 * fields are the four scenes and the two cameras and the two water lists. A biome
 * is none of those - it is a fact about the course being built, known at
 * `buildCourse()` time from `cat.biome`, with every consumer downstream of that
 * one call. A registry member for it would be a field written once and read four
 * times, which is the shape the graph cannot see for itself and
 * `tools/wired.mjs`'s third direction exists to catch.
 *
 * Two callers, and they are the only two, and each of them says which biome it
 * is building rather than leaving it standing:
 *
 *     src/race.js   buildCourse(catId)   useBiome(CAT_BY_ID[catId].biome)
 *     src/stage.js  buildStable()        useBiome('temperate')
 *
 * **`buildStable()` is the one that is not obvious, and skipping it is what a
 * stale biome looks like.** The stable's lawn and plinth are built on fresh
 * materials with `PAL` read at build time, so a stable rebuilt while an ashlands
 * course is standing comes up with ash in its own vertex colours and no map that
 * goes with it - and `restage()` rebuilds the stable on a density change, so the
 * two are not "a race and then never again". Vertex colours are baked, so a stable
 * already standing is untouched by a later `useBiome()`, which is the one thing
 * that makes this safe and also the thing that hides the bug until somebody
 * presses the density row.
 * ================================================================== */

/** The four `PAL` keys' standing values, written into the live colours. **A name
 *  the jar has never heard of is a warning and not a throw**, because this runs
 *  inside a course build and a thrown error there is a black screen with a course
 *  half-built - and a `pal` of fifteen is the quiet answer with a plausible value
 *  written all over it, so the sixteenth would silently keep temperate's colour.
 *  The gate for it is `tools/plan-test.mjs --biomes`; this is the noise it makes
 *  in a browser. */
function applyPal(pal) {
  for (const key of Object.keys(PAL)) {
    const name = pal[key];
    if (name === undefined) continue;
    if (!C[name]) { console.warn(`biome ${standingBiome.name}: no colour called ${name} in the jar for ${key}`); continue; }
    PAL[key].copy(colour(C[name]));
  }
}
/** One set per role, in the order `SET_ROLES` gives, and the gain is the role's own
 *  number rather than a literal - which is the whole reason the gains moved out of
 *  the material block and into the biome table. */
function setsFor(biome, which) {
  return SET_ROLES[which].map(([role, gain, uv]) => {
    const r = biome.surface[role];
    return {
      // **the `SURFACE` key, and it is the only way a test can name a set** - the
      // warning above cannot fire without it, and `__snail.setsOf()` cannot say
      // which one is missing without it
      name: r.key,
      map: detailOf(r.key, 'normalMap'),
      // **The height map and its own thickness, and that is the whole of the
      // POM branch.** `height` is the set's `-h` texture, read off the same
      // `SURFACE` entry as the normal and the colour, and `thickness` is the
      // map's own measured crown-to-joint distance in tile fractions, written
      // into the biome table the way `scale` and `strength` are. The march is
      // gated by two shared uniforms rather than the height map being present
      // or not, so a set whose height map never got drawn keeps its normal
      // and the branch simply has no `-h` to march on - the same quiet path
      // a missing normal map has today, and `__snail.setsOf()` and
      // `tools/inspect.html`'s declared-versus-present column are what say
      // so.
      height: detailOf(r.key, 'heightMap'),
      thickness: r.thickness,
      scale: r.scale,
      strength: r.strength,
      colour: detailOf(r.key, 'map'),
      colourGain: r[gain],
      uv,
    };
  });
}

/**
 * Stand a biome, and **re-run the four sets rather than write into them**.
 *
 * `triplanarSets()` takes a list and builds a program: the tile is a
 * `uniform float dS` and the strength a `uniform float dK` and both textures are
 * `uniform sampler2D`, all four written fresh inside `onBeforeCompile` - **and
 * the colour gain is not one of them.** `colourGain` is interpolated into the
 * GLSL string as a literal, because it is a multiplier on a sum and the sum is
 * per-set. So a biome cannot change a gain by writing to a uniform, and the
 * honest answer is that it does not try: it builds the program again.
 *
 * Two of the four lines below are there because of a failure this project has
 * already had, **and the second is the one that is easy to leave out.**
 * `triplanarSets()` **assigns** `m.onBeforeCompile` rather than chaining behind
 * what is there, and `gfxSurface()` chains - it saves what the material carried
 * and wraps it. So calling `triplanarSets()` again at course-build time silently
 * throws away the cloud shade and the wind on that material, which is not a crash
 * and not a warning: the meadow stops leaning and the ground goes flat under a
 * moving light. `gfxSurface()` has to be called again behind it, every time, and
 * it is a one-line omission that reads as tidiness.
 *
 * **And the cache key has to name the biome, because the key is what stops three
 * handing back the program it already built.** `triplanarSets()`'s own key is
 * `'triplanarSets' + n + (anyUv ? 'Uv' : '')`, and its comment is explicit that
 * two shaders under one material name break three's cache in a way that is very
 * hard to read off a stack trace. Put the biome in and it is honest. Leave it out
 * and `needsUpdate` recompiles `mat.course`, three finds `triplanarSets3` in its
 * cache, hands back **the meadow's program**, and the ashlands ground is drawn
 * with the turf's grain and the cliff's gain at the meadow's tile - a wrong
 * picture rather than a broken one, which is the same failure the `anyUv` half of
 * that key was written against.
 *
 * So: one program per biome per material, six for the three materials, built once
 * each and cached by three thereafter, and the cost is on the course-change frame
 * rather than on the frame loop.
 */
function useBiome(id) {
  const biome = BIOMES[id] || BIOMES.temperate;
  standingBiome = biome;
  for (const which of ['road', 'ledge', 'course']) {
    const m = mat[which];
    triplanarSets(m, setsFor(biome, which));
    // **and the injection behind it again** - see the note above
    gfxSurface(m, false);
    m.customProgramCacheKey = () => 'triplanarSets' + SET_ROLES[which].length
      + (SET_ROLES[which].some((r) => r[2]) ? 'Uv' : '') + ':' + biome.name;
    m.needsUpdate = true;
  }
  applyPal(biome.pal);
  return biome;
}

// ------------------------------------------------------------------
// The jar, the loader's tables and the four injections. `gfxSurfaceTargets()`
// is here rather than at the boot call site because it is the only thing in
// this file that has to run exactly once and in one order - after the jar is
// built and before a frame is drawn - and a function that can only be called
// once is worth owning rather than calling.
// ------------------------------------------------------------------
export {
  props, propMat, propMatFor, snailTemplate, matFor, partMat, loadMeshes,
  mat, detailOf, mapTex, poolWaterMat,
  triplanarDetail, triplanarSets, rippleU,
  colour, PAL, GREEN, STONE, FLOWER_COLORS, BARK, MUSHROOM_RED, MUSHROOM_BROWN,
  gfxU, gfxSurfaceTargets, gtaoWind, windMark, waterFresnel, setWindEnabled,
  reflectMark, gtaoReflect,
  useBiome, biomeNow,
};