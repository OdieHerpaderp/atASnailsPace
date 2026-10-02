/* ================================================================== *
 * The maps a model is drawn with, in a tool.
 *
 * A glb in meshes/ carries no images at all: every map belongs to
 * meshes/tex/ and is loaded by name out of the one manifest in
 * meshes/maps.js, which the game does at load time. So a page that wants to
 * look at a prop as the game draws it has to do that part too, or it is
 * looking at a model with its surface missing and reaching a conclusion about
 * a map it has not loaded.
 *
 * This is that part, once, for render.html and compare.html both.
 * ================================================================== */
import * as THREE from 'three';
import { MAPS, allMaps, allParts, mapSlots, mapsFor, slotFor } from '../meshes/maps.js';

let all = null;
/** Every map the manifest names, as a texture, skipping the missing ones. */
export async function loadMaps() {
  if (all) return all;
  all = new Map();
  const loader = new THREE.TextureLoader();
  await Promise.all(allMaps().map((name) => new Promise((res) => {
    loader.load('/meshes/tex/' + name + '.png', (t) => {
      // a colour map is read as sRGB; a normal, a roughness or an occlusion is
      // data, and reading it as colour is what makes a normal map come out flat
      t.colorSpace = slotIsColour(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      all.set(name, t);
      res();
    }, undefined, () => res());
  })));
  return all;
}

const slotIsColour = (name) => {
  const slot = slotFor(name);
  return !slot || slot === 'map' || slot === 'emissiveMap';
};

/**
 * The prop a file name is the file of: `mossy-rock.glb` is `mossy-rock`.
 *
 * Only a file in `meshes/` is a prop. The copy of it in `tools/backup/` is a
 * record of what it used to be, and a page comparing the two wants the old one
 * to look old - which is the whole reason the backup exists. So a backup gets
 * no maps and a page that asks for a prop outside meshes/ gets null.
 */
export const propOf = (file) => (/^(\.\/)?(tools\/)?meshes\//.test(file) || /(^|\/)meshes\//.test(file)
  ? file.replace(/^.*\//, '').replace(/\.glb$/, '')
  : null);

/**
 * Hand a model the maps its own file declares, part by part, exactly as the
 * game does: a prop that is an array in the manifest has the same on every
 * part, a prop that is an object has its own per part, and a part it does not
 * name gets none. Returns the names of the maps it found, so a page can say
 * which file was looked at.
 */
export function applyMaps(root, file, textures) {
  const tex = textures || all;
  const prop = propOf(file);
  if (!tex || !prop || !MAPS[prop]) return [];
  const wanted = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const part = o.name.startsWith(prop + '-') ? o.name.slice(prop.length + 1) : '';
    for (const name of mapsFor(prop, part)) {
      // `mapSlots()` rather than `slotFor()`: a `-rgh` fills two material
      // fields, and a tool that put one of them on would be looking at the
      // crate's iron as the grey plastic the game is not drawing.
      for (const slot of mapSlots(name)) {
        if (!tex.has(name)) continue;
        o.material[slot] = tex.get(name);
      }
      o.material.needsUpdate = true;
      wanted.add(name);
    }
  });
  return [...wanted];
}

/** Every map name, for a page that wants to list them before it loads them. */
export const mapNames = () => allMaps();
/** The parts a prop is split into, for a page that wants to say so. */
export const partsOf = (prop) => allParts(prop);
