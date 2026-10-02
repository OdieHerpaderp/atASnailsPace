// /tmp/kilo/split/wired.mjs - is every module wired to every other one?
//
//   node wired.mjs src/*.js meshes/palette.js meshes/maps.js snail-race.js
//
// Two directions, and the second is the one that matters:
//
//  - **a name a file imports that another module does not declare, or declares
//    but does not export** - a `SyntaxError` or a `ReferenceError` at module
//    load, before a frame is drawn;
//  - **a name a file *reads bare*, which another module declares, and does not
//    import.** `node --check` parses each file on its own and cannot see this,
//    and it is the one that actually happened: `_todSky` is the hour of the
//    day's scratch colour, it moved into `graphics.js` in the step that took the
//    renderer out, and the frame loop went on reading it.
//
// **After a declaration moves out, every bare read of it has to have become an
// import.** A word is counted as a read only in a statement position - not after
// a `.`, not before a `:`, not inside a comment or a string - so object keys,
// property names and prose do not make the list.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/odie/atASnailsPace';
const files = process.argv.slice(2);

const DECL = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
// **comma-continued declarations, and every keyword and not just `const`** -
// `let composer = null, composerUp = false;` is two bindings and the one-line
// form of this check saw neither of them, which is how a `composerUp`
// reached `domeToneFix` in `graphics.js` as a bare word for a whole step.
const COMMA = /^(?:const|let|var)\s+(.+?);\s*$/;
const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'length', 'name', 'constructor', 'prototype', 'let', 'const', 'var', 'function', 'class',
  'return', 'typeof', 'new', 'this', 'if', 'for', 'while', 'switch', 'case', 'do', 'else',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'of', 'in']);

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:"'`$\\])\/\/[^\n]*/g, '$1 ')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""');

function declared(src) {
  const out = new Set();
  for (const l of src.split('\n')) {
    const m = DECL.exec(l);
    if (m) out.add(m[1]);
    const c = COMMA.exec(l);
    if (c && !/=>/.test(c[1])) {
      for (const part of c[1].split(',')) {
        const n = part.split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
      }
    }
  }
  return out;
}

/**
 * Every binding a file has of its own, at any depth: a `const` inside a
 * function, an object-literal key, a method shorthand. A file that has a local
 * `const scene` inside `makeEnv()` is not missing an import of somebody else's
 * `scene`, and the check has to tell the two apart or it is noise on every run.
 *
 * **Declarations, keys and method shorthands - and deliberately not "anything
 * followed by a bracket".** That was in the first version and it made
 * `$('boot').textContent` claim that `materials.js` owns a `$`, which silenced
 * exactly the report it existed for: a `$(...)` call in a module that had not
 * imported `$` from `core.js` came back clean. Three shapes, no more.
 */
function owns(src) {
  const out = new Set(declared(src));
  const bare = strip(src);
  for (const m of bare.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of bare.matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:/gm)) out.add(m[1]);
  // **A method shorthand is `NAME(...) {` and not `NAME(`.** The first version of
  // this line matched any call and so claimed `$('boot').textContent` as a
  // method named `$`, which silenced the report it existed for: a `$(...)` in a
  // module that had not imported `$` from `core.js` came back clean. Requiring
  // the brace tells the two apart - a call is followed by `)` and then `.`, a
  // method by `)` and then `{` - and the brace is what makes it worth knowing
  // about.
  for (const m of bare.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) out.add(m[1]);
  return out;
}

function exported(src) {
  const out = new Set();
  for (const m of src.matchAll(/^export\s*\{([\s\S]*?)\}/gm)) {
    for (const n of m[1].split(',')) {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (name) out.add(name);
    }
  }
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    out.add(m[1]);
  }
  return out;
}

function importsOf(src, f) {
  const out = {};
  for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
    const mod = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, f)), m[2]));
    out[mod] = new Set(
      m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
  }
  return out;
}

/**
 * Is NAME read bare - a statement position, not a property, not a key.
 *
 * **The word-boundary guards are only there when the name has word characters at
 * its ends**, because `\b` is defined against `[A-Za-z0-9_]` and the county's `$`
 * is not one of those: `\b\$\b` matches nothing anywhere, so a bare `$(...)` in a
 * module that had not imported it was invisible here. That is the second time
 * this checker has been wrong about a name that is not spelled like a word, and
 * both times it was on a one-character identifier.
 */
function reads(bare, name) {
  const lead = /^[A-Za-z0-9_]/.test(name) ? '\\b' : '';
  const tail = /[A-Za-z0-9_]$/.test(name) ? '\\b' : '';
  const esc = name.replace(/[$]/g, '\\$');
  const re = new RegExp(
    `(?:^|[(,=+\\-*/%;?:&|!<>~^\\[\\]{}]|\\b(?:return|typeof|new|await|&&|\\|\\|)\\s*)\\s*${lead}${esc}${tail}\\s*(?![:.\\w$])`,
    'm');
  return re.test(bare);
}

const src = {}, decl = {}, exp = {}, imp = {}, bare = {}, own = {};
for (const f of files) {
  src[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  decl[f] = declared(src[f]);
  exp[f] = exported(src[f]);
  imp[f] = importsOf(src[f], f);
  bare[f] = strip(src[f]);
  own[f] = owns(src[f]);
}

let bad = 0;
const say = (s) => { console.log('  ' + s); bad++; };

for (const f of files) {
  for (const [mod, names] of Object.entries(imp[f])) {
    if (!fs.existsSync(path.join(ROOT, mod))) { say(`MISSING FILE  ${f} imports ${mod}`); continue; }
    for (const n of names) {
      if (!decl[mod] || !decl[mod].has(n)) say(`NOT DECLARED  ${n}  (${f} <- ${mod})`);
      else if (!exp[mod].has(n)) say(`NOT EXPORTED  ${n}  (${f} <- ${mod})`);
    }
  }
}

// `meshes/` is in the list so its own imports resolve, and out of this map
// because it is not part of the split
const HOME = new Map();
for (const f of files) {
  if (f.startsWith('meshes/')) continue;
  for (const n of decl[f]) if (!HOME.has(n)) HOME.set(n, f);
}
for (const n of KEYWORDS) HOME.delete(n);

for (const f of files) {
  if (f.startsWith('meshes/')) continue;
  for (const [n, home] of HOME) {
    if (home === f) continue;
    if (own[f].has(n)) continue;           // it has a local of its own
    if (!reads(bare[f], n)) continue;      // never read bare
    const got = imp[f][home];
    if (!got || !got.has(n)) {
      say(`NO IMPORT   ${n}  read bare in ${f}, declared in ${home}`
        + (exp[home].has(n) ? '' : ' (and not exported there)'));
    }
  }
}

console.log(bad ? `\n${bad} problem(s)` : 'wired.mjs: clean.');
process.exit(bad ? 1 : 0);