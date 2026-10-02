// wired.mjs - is every module wired to every other one?
//
//   node tools/wired.mjs src/*.js meshes/palette.js meshes/maps.js
//
// Four directions, and none of them is the interesting one:
//
//  - **a name a file imports that another module does not declare, or declares
//    but does not export** - a `SyntaxError` or a `ReferenceError` at module
//    load, before a frame is drawn;
//  - **a name a file *reads bare*, which another module declares, and does not
//    import.** `node --check` parses each file on its own and cannot see this,
//    and it is the one that actually happened: `_todSky` is the hour of the
//    day's scratch colour, it moved into `graphics.js` in the step that took the
//    renderer out, and the frame loop went on reading it;
//  - **a field of `world` that is read and written by nobody**, which is a
//    failure with no symptom at all - a default is a quiet answer - and there
//    were four of them, one per step, for four steps;
//  - **a top-level read of a `const` declared below it**, which is the temporal
//    dead zone and is a crash on the first line of the module.
//
// **After a declaration moves out, every bare read of it has to have become an
// import.** A word is counted as a read only in a statement position - not after
// a `.`, not before a `:`, not inside a comment or a string - so object keys,
// property names and prose do not make the list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, and **read off this file's own location rather than
 *  written down** - because a gate that reads a hardcoded path is a gate that
 *  validates a different tree from the one it was run in. `check.sh` derives the
 *  same directory the same way for the same reason.
 *
 *  It was a literal here for the whole of the split, and the failure is silent in
 *  the worst direction: `check.sh` hands this script a *relative* file list after
 *  `cd`-ing to its own root, so from a second checkout every path resolved and
 *  every name matched - in the **first** checkout. A clone with a genuinely
 *  broken import came back `wired.mjs: clean.` and `11 modules`, having checked
 *  the tree the author happened to be sitting in. `import.meta.url` is the one
 *  thing in a Node script that is true wherever the script is. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
 * function, a parameter, a method shorthand. A file that has a local
 * `const scene` inside `makeEnv()` is not missing an import of somebody else's
 * `scene`, and the check has to tell the two apart or it is noise on every run.
 *
 * **Four shapes, and every one of them had to be a wrong answer first.** A key
 * and a call were both in this set, and both are the same mistake wearing
 * different hats: **something that looks like a binding and is not one silences
 * the report instead of making it.** Both have been taken out, and the story of
 * each is at the foot of this function - the second of them hid a crash the
 * whole suite walked past.
 */
function owns(src) {
  const out = new Set(declared(src));
  const bare = strip(src);
  for (const m of bare.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  // **No rule for an object-literal key, and there was one, and that was the
  // fourth wrong answer and the only one of the four that hid a crash.** The
  // `surging: false` in a racer is a *field*; the `surging` in `(surging ||
  // race.autoSurge)` is the app's flag for the space bar. The two have nothing to
  // do with each other except that one is spelled like the other, and a racer is
  // full of fields - `surging`, `spent`, `stam`, `aiOn`, `wob` - that are also
  // words the entry and the sim use for something of their own. So the key
  // claimed the name, `stepRacer()`'s bare read of the app's `let` came back
  // clean, and the first simulated race threw `surging is not defined` on its
  // first frame. A key is not a binding, and leaving it out costs no report: a
  // key cannot be read bare, because `reads()` refuses a name with a `:` after.
  // **A method shorthand is `NAME(...) {` and not `NAME(`.** The first version of
  // this line matched any call and so claimed `$('boot').textContent` as a
  // method named `$`, which silenced the report it existed for: a `$(...)` in a
  // module that had not imported `$` from `core.js` came back clean. Requiring
  // the brace tells the two apart - a call is followed by `)` and then `.`, a
  // method by `)` and then `{` - and the brace is what makes it worth knowing
  // about.
  for (const m of bare.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm)) {
    out.add(m[1]);
    // and its parameters, which is the other half: `domeToneFix(c, chainUp)` has a
    // `chainUp` of its own, and a parameter is not a read of anybody else's.
    for (const q of m[2].split(',')) {
      const n = q.split('=')[0].trim().replace(/^\.\.\./, '').replace(/[{}]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
    }
  }
  // **`function name(...) {` as well, and its absence was this checker's third
  // wrong answer about a name it should have recognised.** The shape above
  // matches a bare `name(` and a method shorthand and it does *not* match a
  // function declaration, because there the line starts with `function` and the
  // name is the second word - so **every parameter of every `function` in the
  // county was invisible here**, and a parameter that shares a name with another
  // module's export reads as a bare use of that export. `spinFans(dt, clock)` is
  // what it took to find it, and a parameter is not a read of anybody else's.
  for (const m of bare.matchAll(/\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    out.add(m[1]);
    for (const q of m[2].split(',')) {
      const n = q.split('=')[0].trim().replace(/^\.\.\./, '').replace(/[{}]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
    }
  }
  // **And there is no catch-all over `name(` either, which is the one that was
  // here longest and the one that silenced five at a stroke.** A **call at the
  // head of its own line, or after a comma, is not a declaration of anything**,
  // and reading it as one is how `syncProbes()` in `race.js` came back clean:
  // `buildCourse()` calls it, `post.js` declares it, `race.js` imported neither,
  // and the one check that exists to say so read the call as a local. Same
  // mistake as the key, same cost: the step that took the race out left
  // `timeOfDay`, `paintSky`, `refreshEnvironment`, `syncGlow` and `chainUp` read
  // out of two modules it had not imported, and every one of them called at the
  // head of its own line.
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
    // **Comments out of the brace list before it is split**, and that is this
    // check's fifth wrong answer about what a name in a file is. An import list
    // is the one place in the county a comment belongs *inside* a name list -
    // three lines explaining why one of these forty names is imported at all -
    // and this split the list on commas without stripping, so the comment's own
    // words became imported names. The symptom was the reverse of every other
    // wrong answer here: not a name silently *not* seen, but `STEP` reported as
    // read bare and not imported, while it was plainly on the list three lines
    // below the comment. A parser that reads prose as a symbol table is the
    // worst kind, because it invents names that no file contains.
    const list = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:"'`$\\])\/\/[^\n]*/g, '$1 ');
    out[mod] = new Set(
      list.split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
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
 *
 * **And `)` is in the prefix set, which it was not for most of this checker's
 * life, and the shape it missed is the commonest one in the county**: a call at
 * the start of a statement that follows a condition. `else if (race.t % 0.1 <
 * dt) updateHUD();` is a read of `updateHUD` - it is the only read in the line -
 * and it came back clean for the whole of the step that took the race out, so
 * `stepRace()` threw `updateHUD is not defined` on the tenth frame of the first
 * simulated race and the check that exists to say so had no opinion about it. A
 * `)` before a name is a statement start and nothing else: there is no expression
 * in the county where a name can follow a closing paren and still be part of it.
 */
function reads(bare, name) {
  const lead = /^[A-Za-z0-9_]/.test(name) ? '\\b' : '';
  const tail = /[A-Za-z0-9_]$/.test(name) ? '\\b' : '';
  const esc = name.replace(/[$]/g, '\\$');
  const re = new RegExp(
    `(?:^|[(),=+\\-*/%;?:&|!<>~^\\[\\]{}]|\\b(?:return|typeof|new|await|&&|\\|\\|)\\s*)\\s*${lead}${esc}${tail}\\s*(?![:.\\w$])`,
    'm');
  // **and where.** A report that names a line is a report somebody can go and
  // look at; "read bare in X" three times over is a shrug. It cost one match to
  // find the index and it has already paid for itself once.
  const hit = bare.search(re);
  if (hit < 0) return null;
  const line = bare.slice(0, hit).split('\n').length;
  return line;
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
    const at = reads(bare[f], n);
    if (at == null) continue;              // never read bare
    const got = imp[f][home];
    if (!got || !got.has(n)) {
      say(`NO IMPORT   ${n}  read bare at ${f}:${at}, declared in ${home}`
        + (exp[home].has(n) ? '' : ' (and not exported there)'));
    }
  }
}

/**
 * The registry's third direction: a field of `world` that is read and **written by
 * nobody**.
 *
 * **This is the direction the split cannot see by itself, and it is the one that
 * cost four silent regressions over four steps.** Every other failure in this
 * split announced itself - a `SyntaxError` at load, a `ReferenceError` on the
 * first frame, a value in a number. A registry field that nobody fills announces
 * nothing at all: it has a default, the default is a plausible-looking empty
 * value, and the code that reads it goes on running. Four of them were sitting
 * there for the whole of the split and every test passed, because the things they
 * broke are the four the golden baseline does not measure:
 *
 *  - `shadowRoots` and `racers`, so `applyShadows()` walked nothing and **the
 *    shadows row stopped stamping props** - `scatter()` was still setting
 *    `userData.gfxCast` on six thousand pieces for a flag nothing read;
 *  - `water`, so `eachWaterSurface()` saw no pools and **no course got a
 *    reflection probe at all**, while the stable's - which comes from
 *    `world.stage`, and that one was filled - kept working, so the row looked
 *    alive on the hub and dead everywhere it mattered;
 *  - `restage`, so **no density change rebuilt the stable** and the four rows that
 *    need a rebuild to be visible did nothing but write a flag.
 *
 * A field is written either by `world.x =` somewhere, or by being a method of the
 * registry's own literal, and a field with no reads is reported too - a registry
 * nobody asks a question of is one nobody has to answer.
 */
const REGISTRY = 'world';
const use = new Map();   // name -> { assign: [], read: [], mut: [], called: [] }
const note = (name, kind, at) => {
  if (!use.has(name)) use.set(name, { assign: [], read: [], mut: [], called: [] });
  const u = use.get(name);
  u[kind].push(at);
  if (kind !== 'assign') u.read.push(at);
};
/** The two kinds of member of the registry's literal: a **field** somebody fills
 *  with `=`, and a **method** that fills itself. A field nobody writes is the
 *  silent failure; a method nobody calls is dead weight. */
const fields = new Set(), methods = new Set();
{
  const s = src['src/graphics.js'];
  const m = /export\s+const\s+world\s*=\s*\{/.exec(s);
  if (!m) say('REGISTRY   src/graphics.js has no `export const world = {`');
  else {
    // **and `this.x` inside the literal is a read of a field.** `renderScene()`
    // asks `this.modeOf()` and reads `this.stageScene`, and a scan that only
    // looked for `world.x` called both of them unread and then asked who was
    // filling them - which is the wrong way round, because the methods are the
    // registry's own and are the only things in the county allowed to say `this`.
    const head = s.slice(0, m.index + m[0].length).split('\n').length - 1;
    let depth = 0, key = null, isMethod = false, n = head;
    for (const line of s.slice(m.index + m[0].length).split('\n')) {
      n++;
      if (key !== null) { (isMethod ? methods : fields).add(key); key = null; }
      // **two spaces of indent**, and the depth: a nested key belongs to whatever
      // object holds it - `e.key.color` in the registry is not a field of `world`
      const k = /^ {2}([A-Za-z_$][\w$]*)\s*([(:])/.exec(line);
      if (k && depth === 0) { key = k[1]; isMethod = k[2] === '('; }
      for (const c of line) { if (c === '{') depth++; else if (c === '}') depth--; }
      if (depth < 0) break;
      for (const t of strip(line).matchAll(/\bthis\.([A-Za-z_$][\w$]*)/g)) {
        note(t[1], 'read', `src/graphics.js:${n}`);
      }
    }
  }
}
/** A member call that *changes* the thing rather than asking it a question.
 *  `world.courseWater.push(wm)` fills the registry's list as much as an
 *  assignment does, and the county's own comment on that field is that a list
 *  emptied by the module that does not fill it is a list two modules argue about
 *  - so a list the modules argue about is a list they both reach into. */
const MUTATORS = /\.\s*(push|splice|pop|shift|unshift|sort|reverse|copyWithin|fill)\s*\(/;
for (const f of files) {
  if (f.startsWith('meshes/')) continue;
  const s = strip(src[f]);
  for (const m of s.matchAll(/\bworld\.([A-Za-z_$][\w$]*)/g)) {
    const at = `${f}:${s.slice(0, m.index).split('\n').length}`;
    const after = s.slice(m.index + m[0].length);
    if (/^\s*=(?!=)/.test(after)) note(m[1], 'assign', at);
    // **asking a field a question is reading it**, which is why a field the whole
    // county calls on is not a field nobody reads - the arrow-function fields are
    // half the registry and every one of them is called rather than indexed.
    else if (/^\s*\(/.test(after)) { note(m[1], 'called', at); }
    else if (MUTATORS.test(after)) { note(m[1], 'mut', at); }
    else note(m[1], 'read', at);
  }
}
for (const [name, u] of [...use].sort()) {
  if (methods.has(name)) {
    if (!u.called.length) say(`NEVER CALLED   world.${name}()  declared in the registry, called by nobody`);
    continue;
  }
  if (!fields.has(name)) { say(`NO SUCH FIELD   world.${name}  read at ${u.read[0] || u.mut[0]}, and the registry declares no such field`); continue; }
  if (!u.assign.length && !u.mut.length) say(`NEVER WRITTEN   world.${name}  read at ${u.read.join(', ')}`);
  else if (!u.read.length) say(`NEVER READ      world.${name}  written at ${u.assign.join(', ')}`);
}

/**
 * A top-level statement that reads a `const` declared *below* it: the temporal
 * dead zone, which is a boot-time `ReferenceError` and not a warning.
 *
 * **This one is here because of how it was found, which is the whole argument for
 * it.** Writing `world.water = waterMeshes;` above the `const waterMeshes = []`
 * that owns the list is a crash on the first line of the module - `Cannot access
 * 'waterMeshes' before initialization` - and every other direction in this file
 * is blind to it, because the name is imported, declared and used in the right
 * file by the right module; it is only *early* that it is wrong. It cost a
 * twenty-second boot timeout on eight tests to find out.
 *
 * Two things are deliberately out of its reach. A **`function` declaration is
 * hoisted**, so reading one above it is not a fault and a line like
 * `world.racers = () => race.racers;` above `const race` is perfectly legal
 * because the arrow runs later. **A statement carrying an `=>` is skipped whole**,
 * for the same reason and because the alternative is a scope analysis: the body of
 * an arrow is not run at the point it is written, and a checker that cannot tell
 * that reports the legal version as the broken one.
 */
{
  for (const f of files) {
    if (f.startsWith('meshes/')) continue;
    const s = src[f];
    const bareS = bare[f];
    // where each top-level `const`/`let`/`class` is declared, and where each
    // column-0 statement is: both are "at the top" only if the line starts at
    // column zero, which is what this file's whole layout is built on
    const at = new Map();
    const lines = s.split('\n');
    lines.forEach((l, i) => {
      const d = /^(?:export\s+)?(?:const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(l);
      if (d) at.set(d[1], i + 1);
    });
    lines.forEach((l, i) => {
      if (!l || /^[\s}]/.test(l)) return;                    // not a top-level statement
      const isDecl = /^(?:export\s+)?(?:const|let|var|class)\b/.test(l);
      const isWrite = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\s*=(?!=)/.test(l);
      // **A function declaration is not here at all**, and its absence is not an
      // oversight: the only thing on `function name(a, b) {` is a signature, and a
      // parameter is a local of that function rather than a read of anything -
      // `triplanarDetail(..., colour, ...)` above the module's own `const colour`
      // is a *shadow*, which is ordinary and legal, and it was the one report
      // this direction produced on its first run over a county that has none.
      if (!isDecl && !isWrite) return;
      if (l.includes('=>')) return;                          // the body runs later
      const semi = l.indexOf(';');
      const stmt = (semi >= 0 ? l.slice(0, semi) : l);
      for (const [n, line] of at) {
        if (line <= i + 1) continue;
        const at2 = reads(strip(stmt), n);
        if (at2 == null) continue;
        say(`READS BEFORE DECLARED  ${n}  read at ${f}:${i + 1}, declared at ${f}:${line}`);
      }
    });
    void bareS;
  }
}

console.log(bad ? `\n${bad} problem(s)` : 'wired.mjs: clean.');
process.exit(bad ? 1 : 0);