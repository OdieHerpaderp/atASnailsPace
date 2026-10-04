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
import { THREE, $, clamp, smoothstep } from './core.js';
import { LAMP_COLOUR } from './graphics.js';/* ================================================================== *
 * The meshes live in meshes/ as .glb files: a prop is written once and
 * drawn a thousand times, and a snail is one file that is cloned per racer
 * and recoloured. Only the course itself is still built here, because it is
 * built out of the numbers in races.json - the ground, the bed, the skirt,
 * the water and the start and finish furniture all come from the track.
 * ================================================================== */
const MESH_FILES = [
  'conifer', 'evergreen', 'broadleaf', 'bush', 'rock', 'mossy-rock', 'tuft', 'marker', 'lily', 'lily-pad', 'reeds', 'seashell',
  'lamp-post', 'lamp-glass', 'lantern-post', 'lantern-glass',
  'mushroom-red', 'mushroom-brown',
  'mushroom-giant', 'mushroom-pale', 'mushroom-rooted',
  'lantern-pole', 'lantern-arch',
  'hut', 'windmill', 'barn', 'well', 'scarecrow', 'crate', 'push-crate', 'fence',
  'corn-plot', 'sprout-plot',
  'palm', 'fountain',
  'watchtower',
  'shell-bands', 'shell-swirl', 'shell-spots',
  'snail',
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
  const loaded = await Promise.all(MESH_FILES.map(async (name) => {
    $('boot').textContent = 'loading the meshes…';
    return [name, await loader.loadAsync('meshes/' + name + '.glb')];
  }));
  for (const [name, gltf] of loaded) {
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
    if (!keys.length) throw new Error('no mesh in meshes/' + name + '.glb');
    // a piece with parts and a mesh that is not one of them would draw as half
    // of itself, which is worse than not drawing at all
    if (strays) throw new Error(`meshes/${name}.glb: ${strays} mesh(es) not named "${name}-part"`);
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
  $('boot').textContent = `Could not load the meshes from meshes/ (${MESH_FILES.length} files) — is the folder being served with the page?`;
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
 */
function gfxSurface(m, wind) {
  // **Registered here and not in the injection below.** `onBeforeCompile` runs at
  // the material's first render, and a piece planted before that - which is every
  // piece in the first county built - would ask an empty set and go unmarked,
  // which is a wind that comes and goes with the density row.
  if (wind) WIND_MATS.add(m);
  return afterCompile(m, (sh) => {
    sh.uniforms.uCloudAmt = gfxU.uCloudAmt;
    sh.uniforms.uCloudTime = gfxU.uCloudTime;
    sh.uniforms.uWindAmp = gfxU.uWindAmp;
    sh.uniforms.uWindTime = gfxU.uWindTime;
    // the wind's own three lines are rewritten only for a surface that has it,
    // so a ground material's program is not carrying a dead branch that reads a
    // uniform and multiplies by zero on every vertex of a hundred-metre mesh
    const bend = wind ? GLSL_WIND : '';
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
  });
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
 * Called once at material setup and never again: the uniforms are shared, so
 * nothing about the program changes when a tier moves.
 */
let gfxSurfacesDone = false;
function gfxSurfaceTargets() {
  if (gfxSurfacesDone) return;
  gfxSurfacesDone = true;
  // the three surfaces of the ground, and the two that grow
  for (const m of [mat.course, mat.road, mat.ledge]) gfxSurface(m, false);
  for (const m of [mat.grass, mat.foliage]) gfxSurface(m, true);
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
 * **What cannot be shared is which pieces bend**, because the override material
 * is on the entire scene: a stone is instanced too, and a stone that sways in
 * the occlusion buffer and not in the colour is the same ghost a hand smaller.
 * So `uWindObj` is a per-object uniform, and `onBeforeRender` is the only hook a
 * vertex shader has for one - hence `windMark()`, which marks the pieces from
 * the same answer the beauty pass is given: the material they were planted in is
 * one the wind was injected into.
 */
const gtaoWindU = { value: 0 };
function gtaoWind(m) {
  return afterCompile(m, (sh) => {
    sh.uniforms.uWindAmp = gfxU.uWindAmp;
    sh.uniforms.uWindTime = gfxU.uWindTime;
    sh.uniforms.uWindObj = gtaoWindU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGfxW;
        uniform float uWindObj, uWindAmp, uWindTime;`)
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vGfxW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vGfxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif
        if ( uWindObj > 0.5 ) {${GLSL_WIND} }
        #include <project_vertex>`);
  });
}
/** Set round the piece rather than on the program, so the uniform is read after
 *  `afterCompile` has run - the very first frame of a pass's life draws its G-buffer
 *  before the shader exists, and a hook that wrote a uniform it had not got would
 *  drop the wind for that frame and for no other. */
function gtaoWindOn() { gtaoWindU.value = 1; }
function gtaoWindOff() { gtaoWindU.value = 0; }
/** The mark itself, put on at the two places a piece is planted - `scatter()`
 *  for a course and `planted()` for the stable - beside the shadows row's flag
 *  and for the same reason: a flag applied by walking has to be reapplied every
 *  time the county is rebuilt, and a flag applied at the build is simply there. */
function windMark(im) {
  if (!WIND_MATS.has(im.material)) return im;
  im.onBeforeRender = gtaoWindOn;
  im.onAfterRender = gtaoWindOff;
  return im;
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
  const K = ['X', 'Y', 'Z'];
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
    if (byUv(s)) return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            d += (texture2D(dN${k}, vTrackUv * dS${k}).xy * 2.0 - 1.0)
               * (vDetailW.${k.toLowerCase()} * dK${k});
          }`;
    return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            vec2 t = vec2(0.0);
            t += (texture2D(dN${k}, vTriW.zy * dS${k}).xy * 2.0 - 1.0) * an.x;
            t += (texture2D(dN${k}, vTriW.xz * dS${k}).xy * 2.0 - 1.0) * an.y;
            t += (texture2D(dN${k}, vTriW.xy * dS${k}).xy * 2.0 - 1.0) * an.z;
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
            dc += texture2D(dC${k}, vTrackUv * dS${k}).rgb * (f * ${g1(s.colourGain, 1)});
            dsum += f;
          }`;
    return `
          if (vDetailW.${k.toLowerCase()} > 0.002) {
            vec3 t = vec3(0.0);
            t += texture2D(dC${k}, vTriW.zy * dS${k}).rgb * an.x;
            t += texture2D(dC${k}, vTriW.xz * dS${k}).rgb * an.y;
            t += texture2D(dC${k}, vTriW.xy * dS${k}).rgb * an.z;
            float f = vDetailW.${k.toLowerCase()} * ${g1(s.colourAmount, 1)};
            dc += t * (f * ${g1(s.colourGain, 1)});
            dsum += f;
          }`;
  };
  const decls = live.map((s, i) => {
    const k = K[i];
    const d = [`uniform sampler2D dN${k};`, `uniform float dS${k};`, `uniform float dK${k};`];
    if (s.colour) d.push(`uniform sampler2D dC${k};`);
    return d.join('\n        ');
  }).join('\n        ');
  m.onBeforeCompile = (sh) => {
    live.forEach((s, i) => {
      const k = K[i];
      sh.uniforms['dN' + k] = { value: s.map };
      sh.uniforms['dS' + k] = { value: s.scale };
      sh.uniforms['dK' + k] = { value: s.strength === undefined ? 1 : s.strength };
      if (s.colour) sh.uniforms['dC' + k] = { value: s.colour };
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 detailW;
        ${anyUv ? 'attribute vec2 trackUv;\nvarying vec2 vTrackUv;' : ''}
        varying vec3 vDetailW;
        varying vec3 vTriW;
        varying vec3 vTriWN;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vDetailW = detailW;
        ${anyUv ? 'vTrackUv = trackUv;' : ''}
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
        varying vec3 vDetailW;
        ${anyUv ? 'varying vec2 vTrackUv;' : ''}
        varying vec3 vTriW;
        varying vec3 vTriWN;
        ${decls}`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          // The same three projections, once per set, and each one weighted by
          // its share of the vertex. Weighting the **slope** rather than the
          // finished normal is what makes this a blend: two sets' slopes sum,
          // and a normal is taken of the sum at the end, so half a vein and half
          // a blade is a surface with half of each in it rather than two surfaces
          // averaged.
          vec2 d = vec2(0.0);${slope(0)}${slope(1)}${slope(2)}
          vec3 wn = normalize(normalize(vTriWN) + vec3(d, 0.0));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(normalize(vTriWN));
          an /= (an.x + an.y + an.z);
          vec3 dc = vec3(0.0);
          float dsum = 0.0;${tint(0)}${tint(1)}${tint(2)}
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
  wood: new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.85 }),
  vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  // Iron, and it is the county's only metal and **the fallback and not the answer**
  // for the crate's brackets: `meshes/push-crate.glb` declares its own material
  // with a metalness of one, and this is what a caller gets if that file ever
  // stops declaring one. A metalness of zero here is deliberate - a bracket drawn
  // with it is grey plastic, and that is the picture the setting is here to catch.
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 1.0 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x7c9a4a, roughness: 1.0, side: THREE.DoubleSide }),
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
  triplanarSets(mat.road, [
    // The track's gain is **1.41** and it is the map's mean, not a taste: the
    // albedo's weighted field is put under one on purpose (see `trackTone()` in
    // the builder) so its highlight half survives the eight-bit canvas, which
    // costs the whole of it above the clamp, and this puts the mean back. At 1.0
    // the road arrives a third of a stop dark and reads as a brown card.
    { map: detailOf('track', 'normalMap'), scale: 0.85, strength: 0.7, colour: detailOf('track', 'map'), colourGain: 1.41, uv: true },
    { map: detailOf('cliff', 'normalMap'), scale: 0.55, strength: 1.0, colour: detailOf('cliff', 'map'), colourGain: 1.3 },
  ]);

  // The flank hanging off the edge of the ribbon, which is the same two sets
  // again with the cliff at its own gain of **1** rather than the ramp's 1.3: a
  // flank is a face and takes the weather as it stands, and a ramp is not. Same
  // two sets, same two numbers but for the gain, and the reason it is a separate
  // material rather than the road's is that one gain.
  //
  // **And a third, which is the shore's pair.** The flank of a track is not more
  // clay: it is the edge of a built surface, and the county's edge for that is
  // sand - the same sand a pool has round it, at the same tile and the same
  // gain, which is why it is declared here rather than written out. Where the
  // ribbon is a ramp the flank is a face and the cliff's set takes the weight,
  // so the third set's share is `1 - rampShare()` and the two cross-fade on the
  // same numbers the ribbon's do. That is the whole of what it is for: without
  // it the flank was the road's colour at 0.78 and read as a band of wet earth
  // round every course, and a painted line with a trench under it is not a
  // court.
  //
  // The sand and the track's own set are both `uv`, so the flank's grain turns
  // with the lane exactly as the ribbon's does and the corner between the two
  // is a corner between two surfaces rather than a corner between two frames.
  triplanarSets(mat.ledge, [
    { map: detailOf('track', 'normalMap'), scale: 0.85, strength: 0.7, colour: detailOf('track', 'map'), colourGain: 1.41, uv: true },
    { map: detailOf('cliff', 'normalMap'), scale: 0.55, strength: 1.0, colour: detailOf('cliff', 'map'), colourGain: 1.0 },
    { map: detailOf('sand', 'normalMap'), scale: 1.1, strength: 0.9, colour: detailOf('sand', 'map'), colourGain: 1.35, uv: true },
  ]);

  // The meadow, and the whole of the countryside either side of the lane, in one
  // material with **three** sets: turf, cliff and shore. This is the one that
  // removes the seams the ground mesh used to be split into three groups for.
  //
  // The set numbers are the three the three single materials used, unchanged:
  //
  //   - **turf** at 0.2 and 0.3 with a gain of 1.20. Five metres a tile, and that
  //     is the number that answers "this map reads at a hundred paces and then
  //     stops": a course verge is two hundred and forty metres across, so a
  //     two-metre tile went past a hundred times in a single row and the stems
  //     lined up into corduroy visible from the start line. The map was redrawn
  //     for the tile — the lattice that gives a four-centimetre stem is about
  //     125, not the 53 it was built on, so the tile grew and the stems did not.
  //     The strength is 0.3 and the map itself is at 1024 with the relief in
  //     thin lines rather than in lobes, so those two are one change: the old
  //     numbers together gave two and a half degrees of slope across a whole
  //     county of grass, which is nothing, because two degrees of tilt is a
  //     value change and a vertex colour already has one. A detail map's strength
  //     is a function of its tile, and the rule the old 0.6 broke is still true.
  //     The gain is the map's own mean put back, because it is built under one.
  //     The colour is on the **normal's** tile and not on its own, because
  //     `TURF()` is one field feeding both maps: a pale blade in the albedo is
  //     the blade the light is coming off.
  //
  //   - **cliff** at 0.55 and 1.0 with a gain of 1, on one tile for the two
  //     halves. A little under two metres so a slab is about the size of a slab,
  //     and the strength well above the bed's because the point of it is the
  //     **edges** — a fractured face is edges — and at the bed's 0.7 the steps
  //     between plates are a fifth of a degree of light. The gain is 1 and not the
  //     1.5 it first went on with: the map is built under one precisely so the
  //     mean can be put back, and putting back 1.5 means brightening the face by
  //     half, which is how a weathered cliff came out paler than the road above
  //     it. The tile is the normal's 0.55 and not the ground's 0.7 it used to be
  //     on — a comment claimed the two were in agreement about scale and the
  //     numbers said 0.55 and 0.7, so the pale plate in the colour was a quarter
  //     smaller than the plate the normal had raised and the face was two textures
  //     laid over each other.
  //
  //   - **shore** at 1.1 and 0.9 with a gain of 1.35, one tile for the two halves
  //     for the cliff's reason: `SAND()` is one field feeding both maps, so a
  //     crest that is pale in the colour is the crest that is raised in the
  //     normal. Nine tenths of a metre a tile, so a crest is about a hand's
  //     width. The strength is well under the cliff's because this is a
  //     *strength* question on a fine grain, and sand that stands up like a rock
  //     face is not a shore.
  //
  // One material rather than three, and each set guarded on its own weight, so
  // open meadow pays for one set of three projections and a pool's edge pays for
  // two. The turf is the one set that is never absent, because the ground is
  // meadow for nine hundred and ninety-nine parts in a thousand of its width.
  triplanarSets(mat.course, [
    { map: detailOf('grass', 'normalMap'), scale: 0.2, strength: 0.3, colour: detailOf('grass', 'map'), colourGain: 1.20 },
    { map: detailOf('cliff', 'normalMap'), scale: 0.55, strength: 1.0, colour: detailOf('cliff', 'map'), colourGain: 1.0 },
    { map: detailOf('sand', 'normalMap'), scale: 1.1, strength: 0.9, colour: detailOf('sand', 'map'), colourGain: 1.35 },
  ]);
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

  // The two things that give out light. They are the one pair in the project
  // that cannot be drawn in the material out of their own file, because the hour
  // drives their emissive by material name - and a material the hour does not
  // know about stays dark at midnight. So the maps are handed to `mat.paper` and
  // `mat.lampGlass` here, where the hour can see them, and `GAME_MATERIAL` in
  // the manifest keeps `scatter()` from swapping them back out.
  //
  // An emissive map is read as a colour and multiplied into the emissive, so it
  // is not a mask: it is what the lit thing looks like. The paper's is warm and
  // ribbed, and the ribs being *brighter* than the paper either side of them is
  // the whole trick - a rib is paper seen edge-on, so it is thinner, so it gives
  // out more. Without it a paper lantern is a glowing ball.
  for (const [m, prop, part] of [[mat.paper, 'lantern-pole', 'paper'], [mat.lampGlass, 'lamp-glass', '']]) {
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
  gfxU, gfxSurfaceTargets, gtaoWind, windMark, waterFresnel,
};