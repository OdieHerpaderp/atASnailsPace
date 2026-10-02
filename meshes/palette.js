/* ================================================================== *
 * The county's palette.
 *
 * One jar, in one place, shared by everything that makes a colour: the
 * builders in this folder, the texture builder, and the game itself. Before
 * this file there were three hand-kept copies of the same forty colours - `C`
 * in build-scenery.html, `PAL` in src/materials.js, and the loose triples written
 * into build-snail.html and build-shell.html - and they drifted, because
 * anything written twice is written twice differently.
 *
 * Every value here is a **linear** RGB triple in the 0..1 range, which is the
 * space a vertex colour is written in and the space three.js lights in, so
 * nothing has to be converted on the way in. A colour picked in a drawing
 * program is sRGB, so the two helpers at the bottom go both ways:
 *
 *     import { COUNTY, lin, css, hex } from './palette.js';
 *
 *     tint(g, COUNTY.dirtA)                     a vertex colour, unchanged
 *     ctx.fillStyle = css('dirtA')              a colour on a canvas
 *     new THREE.Color(hex('waterB'))            a colour three.js lights
 *
 * The numbers are the colours that were already in use, unchanged: every
 * consumer of this file draws the same colour it drew before, which is the
 * only way to move the palette into a texture builder without repainting the
 * county. New colours go in the jar and nowhere else, and a colour that reads
 * as a stone at race distance never goes in white.
 * ================================================================== */

/** The whole jar, grouped by what it is the colour of. */
export const COUNTY = {
  // ---- the ground the course is cut into -------------------------------
  dirtA: [0.3916, 0.2831, 0.1441],
  dirtB: [0.2705, 0.1946, 0.0908],
  dirtEdge: [0.2582, 0.1946, 0.1070],
  dirtLight: [0.5711, 0.4452, 0.2664],
  earth: [0.3600, 0.2900, 0.2100],
  earthDark: [0.2800, 0.2200, 0.1600],
  earthDeep: [0.1070, 0.0782, 0.0452],
  sand: [0.5210, 0.4233, 0.2016],
  dry: [0.3916, 0.4072, 0.1070],

  // ---- the track the course is run on ----------------------------------
  // Crushed brick, and it is the one surface in the county that is **not a
  // natural colour**: everything above is a soil or a stone and this is a
  // mineral somebody broke up on purpose. That is the whole reason it is as
  // saturated as it is - a track drawn in `dirtA` is a footpath, and the red
  // is what tells a snail it is on a course and not out in the meadow.
  //
  // The **green is the number that matters** and it is not a small one. Clay
  // with almost no green in it is a maroon, and a maroon is what a red at this
  // value turns into under this county's low sun: a brick that has been in a
  // shed. Brick dust is brick, but the tile it is crushed from is fired to a
  // warm orange, and these are at green-over-red of a quarter against a red
  // this deep - measured off photographs of a court in the sun, and the first
  // cut of them was at a seventh and came out the colour of a plum. The
  // *value* is the other half and it is why they are as high as they are: at
  // the exposure this county is lit at, a red that reads as brick in a
  // photograph reads as a dark stain on the ground.
  clay: [0.8000, 0.2150, 0.0750],
  clayDeep: [0.2500, 0.0450, 0.0140],
  // The dust the racers sweep up, and it is **a pink and not a tan**: brick
  // dust is brick, ground finer, and it is the one term on the track that is not
  // a hue of the clay - green-over-red of nearly half, against the clay's
  // quarter. This is the wear that says "every snail has been this way".
  clayDust: [0.5800, 0.2600, 0.1700],
  // The line at the edge of it, and it is a **chalk** and not a white. A white
  // ten centimetres reads as a row of stones laid along the lane at race
  // distance, and a painted line is chalk on brick whatever colour a
  // photograph of one happens to be. `trackLineWorn` is the same paint with
  // the sweep through it, because no line on a surface that gets driven over
  // is one value.
  trackLine: [0.7600, 0.7300, 0.6500],
  trackLineWorn: [0.5200, 0.4600, 0.3700],

  // ---- the stone in it, and the stone a course is cut through ---------
  stone: [0.6000, 0.5800, 0.5400],
  stoneDark: [0.4400, 0.4200, 0.3900],
  stoneA: [0.4233, 0.3916, 0.3325],
  stoneB: [0.2831, 0.2582, 0.2159],
  granite: [0.5500, 0.5500, 0.5300],
  graniteDark: [0.2700, 0.2900, 0.2900],
  graniteWarm: [0.5000, 0.4400, 0.3500],
  // The county's one pale stone. A granite is grey and a limestone is not: it is
  // a buff-cream, it is **warmer** than the stone it is coursed against, and it
  // is the only thing here light enough to stand out of the ground at fifty
  // metres. Five steps, because a tower is read as one thing from a long way off
  // and as five from ten paces - the sunlit face, the body of it, the courses in
  // shadow, the mouldings, and the inside of a doorway.
  brickPale: [0.7200, 0.6800, 0.5700],
  brickWorn: [0.5900, 0.5500, 0.4400],
  brickShade: [0.4300, 0.3900, 0.3000],
  brickDark: [0.2900, 0.2600, 0.2000],
  brickDeep: [0.1500, 0.1300, 0.1000],
  gill: [0.3000, 0.2500, 0.2100],
  gillPale: [0.7000, 0.6600, 0.5800],

  /* ---- the county's limestone ----------------------------------------- *
   * The `brick*` five above are the **dressed** stone - a bedded cream that a
   * claw has cut and laid in courses - and they are `limestoneBrick` now, so
   * this ramp could have the plain `lime*` name. This is the stone the courses
   * are cut *through* and the tower is built of, and it is a different rock in
   * one way that shows at a glance: it is far more saturated, a red-over-blue
   * of two where the dressed stone is nearer one and a quarter, because it is
   * an iron-stained buff rather than a chalk.
   *
   * Every one of the seven is **measured off the reference photograph** rather
   * than picked, and they are the means of its own populations - the ramp split
   * at its percentiles into eight and averaged, with the two middle bands
   * merged into one stop - because a hand-picked buff ramp lands nowhere near
   * it: the reference's mean is linear (0.667, 0.511, 0.334) at a luminance
   * of 0.531, and it sits at a red over blue of 2.00.
   *
   * And the ramp **rotates in hue as it goes down**, which is the measurement
   * a hand-picked one cannot have and the reason these are not seven copies of
   * one buff at seven values: the darkest eighth of the picture sits at a red
   * over blue of 2.87 and the lightest at 1.66, so the shadow of this stone is
   * redder than its face and a ramp that held its hue would read as one flat
   * colour through a range of values.
   */
  limePale: [0.8430, 0.6907, 0.5075],
  limeBright: [0.7704, 0.6126, 0.4266],
  limeMid: [0.7293, 0.5702, 0.3856],
  limeBody: [0.6937, 0.5344, 0.3516],
  limeStain: [0.6180, 0.4599, 0.2828],
  limeShade: [0.5647, 0.4090, 0.2383],
  limeDeep: [0.4547, 0.3083, 0.1586],
  // The one fleck the reference has. Iron staining and dead leaf are burnt
  // orange at a red over blue of nearly nine, which is nothing else in the
  // jar at that value, and it measures at the top tenth of a per cent of the
  // pixels - so it is a hard gate in the drawer and not a weight. There is
  // **no green in the reference at any percentile**, so the grey-green fleck
  // this ramp used to carry is gone rather than turned down.
  limeIron: [0.2562, 0.1276, 0.0292],

  // ---- what grows -----------------------------------------------------
  grassA: [0.2384, 0.4179, 0.0762],
  grassB: [0.1095, 0.2582, 0.0452],
  deep: [0.0561, 0.1620, 0.0273],
  leaf: [0.3000, 0.4400, 0.2000],
  leafLight: [0.4400, 0.5800, 0.2600],
  leafDark: [0.2200, 0.3200, 0.1600],
  leafOlive: [0.4600, 0.5500, 0.2800],
  stalk: [0.5200, 0.6000, 0.2600],
  stem: [0.7200, 0.6800, 0.6000],
  stemPale: [0.5600, 0.5600, 0.5000],
  stemDark: [0.2600, 0.2000, 0.1500],
  moss: [0.2400, 0.3400, 0.1500],
  mossLight: [0.3400, 0.4600, 0.1900],
  mossDark: [0.1300, 0.2100, 0.1000],
  bushCore: [0.1300, 0.1900, 0.1000],
  bushCoreLit: [0.2100, 0.2900, 0.1400],
  // The conifer's greens, and they are a **ramp** rather than a colour: a spruce
  // from a race distance is a blue-green hollow with the sun on the outside of
  // it, and one flat green cannot say both ends of that at once. `needleDeep` is
  // the inside of the tree and `needleTip` the top of a spray in full sun, and a
  // piece picks along the five of them rather than out of two of them.
  needleDeep: [0.0300, 0.0750, 0.0280],
  needleDark: [0.0700, 0.1700, 0.0550],
  needle: [0.1500, 0.3100, 0.0900],
  needleLight: [0.2900, 0.5000, 0.1500],
  needleTip: [0.4500, 0.6800, 0.2300],
  // The broadleaf's autumn, and it is a **ramp** for the same reason the conifer's
  // is: a gold canopy is dark rust in the middle of it and pale straw where the
  // sun comes through, and one flat yellow reads as a paint bucket. `leafDeep` is
  // the inside of a mass of leaves, `leafGold` is the top of one in full light,
  // and a piece picks along the five of them the way the conifer picks along the
  // needle five. The county is a place with a season in it, and this is the one
  // piece of the year that is in the jar.
  leafDeep: [0.3400, 0.1300, 0.0400],
  leafRust: [0.5600, 0.2200, 0.0500],
  leafAmber: [0.7600, 0.3800, 0.0700],
  leafGold: [0.9000, 0.5600, 0.1200],
  leafStraw: [0.9600, 0.7200, 0.2600],

  // ---- the wet ground and what is in it -------------------------------
  waterA: [0.0203, 0.0865, 0.1590],
  waterB: [0.0630, 0.2423, 0.3467],
  cane: [0.4000, 0.5600, 0.2600],
  canePale: [0.6200, 0.7000, 0.4200],
  caneTip: [0.7800, 0.7600, 0.5400],
  lilyStem: [0.3400, 0.4800, 0.2000],
  lilyLeaf: [0.3000, 0.5000, 0.2000],
  lilyLeafTip: [0.4000, 0.6000, 0.2400],
  lilyRib: [0.5200, 0.6800, 0.3200],
  lilyBud: [0.4000, 0.5600, 0.2400],
  lilyBudTip: [0.6200, 0.3600, 0.3400],
  lilyThroat: [0.8000, 0.8200, 0.5200],
  lilyFilament: [0.8800, 0.8400, 0.6000],
  lilyAnther: [0.3000, 0.1300, 0.1500],
  petalBase: [0.9700, 0.9400, 0.9000],
  petalMid: [0.9600, 0.7400, 0.7800],
  petalTip: [0.8000, 0.2800, 0.4200],
  padTop: [0.3200, 0.5000, 0.2400],
  padUnder: [0.2200, 0.3400, 0.1700],
  padVein: [0.4400, 0.6200, 0.3000],
  padPetal: [0.9800, 0.9500, 0.9300],
  padPetalMid: [0.9500, 0.7800, 0.8000],
  padPetalTip: [0.9000, 0.5500, 0.6200],
  padHeart: [0.9200, 0.7800, 0.3000],
  shellPale: [0.8800, 0.8000, 0.7000],
  shellRib: [0.7000, 0.5600, 0.4800],

  // ---- what is built out of it ----------------------------------------
  plaster: [0.8600, 0.8200, 0.7200],
  cap: [0.6000, 0.5000, 0.3600],
  capDark: [0.4200, 0.3400, 0.2500],
  timber: [0.4000, 0.3000, 0.2100],
  plank: [0.4400, 0.4000, 0.3300],
  plankDark: [0.3100, 0.2800, 0.2400],
  /**
   * The chest a snail shoves, and it is a ramp and not a copy of `plank`.
   *
   * `timber` and `plank` are the county's **structural** wood: a grey-brown beam
   * and a weathered board, and the map that goes with them is a weathered sawn
   * face. The boards on a fruit chest are planed softwood off a fresh tree -
   * warmer, more saturated than anything else the county is built out of, and
   * **not paler**. Three steps because a chest is read as three things at once
   * from the lane: the pale frame round the lid, the boards between the rails, and
   * the posts and skids under it, which never see the light.
   *
   * And it is a ramp that **runs at a third of the county's structural wood and
   * not at its own brightness**, which is a number found by standing in the
   * inspector rather than by looking at the reference. The first cut of these was
   * half again as light - `chestPale` at 0.59 - and the crate came up as a crate
   * of fresh pine in a county of weathered earth: a bright orange box standing on
   * red clay beside grey-green meadow, reading as a different *place* rather than
   * as the same place in a new material. The reference is a warm mid brown-orange
   * and this is that, a third under.
   */
  chestPale: [0.3900, 0.2050, 0.0950],
  chestBody: [0.3050, 0.1520, 0.0640],
  chestShade: [0.2050, 0.0950, 0.0380],
  /**
   * The iron on it, and **the county's first metal**.
   *
   * A metalness of one and an albedo of a sixth is not steel's own reflectance -
   * bare steel reflects something over half the light that lands on it - but it
   * is what a crate bracket looks like after ten seasons in the rain: a dark grey
   * that has gone slightly blue, and that only reads as metal because the
   * highlight it gives back is the sky and not the diffuse. Put the value anywhere
   * near the real one and the bracket is a lamp in the middle of a field, which is
   * the tell that a metal has been given a colour rather than a reflectance.
   *
   * And **it cannot be much lower than this**, which is a number found by looking
   * rather than by reasoning: at a tenth the bracket rendered as a black shape with
   * a bright dot on it, because a metal this smooth reflects the *sky* at sixteen
   * per cent and there is not sixteen per cent of a sky in a black. The wood it
   * is nailed to runs from a fifth of a unit to two fifths, so the iron has to
   * sit under all of it and still catch enough of the sky to be a surface.
   *
   * **And the blue is two per cent, not eighteen.** It was a fifth at first, on the
   * reasoning that steel goes blue - and it does, in a shadow, but this bracket
   * reflects the *sky* rather than being lit by it, so a blue in the albedo comes
   * back out as a blue on top of a blue and eight crates of them came up as eight
   * cold blue boxes in a warm county. The reference's brackets are a charcoal that
   * is only just cool.
   *
   * `ironDark` is the same metal a stop down and it is the pocket a stamped plate
   * leaves round its raised centre, so it is a *shadow* and not a second iron.
   * `brass` is the one warm thing on the piece - the dome on a rivet head - and it
   * is the only place in the county where a saturated yellow is allowed, because
   * at three centimetres across it is the one thing on a crate that is polished by
   * being handled. **A bronze and not a gold**: at half of a unit it came out an
   * amber bead, and the reference's rivet heads are the colour of old harness
   * buckles rather than the colour of a trumpet.
   */
  ironBody: [0.1700, 0.1720, 0.1820],
  ironDark: [0.0850, 0.0860, 0.0930],
  brass: [0.3000, 0.1650, 0.0650],
  thatch: [0.5000, 0.4300, 0.2900],
  thatchDark: [0.3500, 0.3000, 0.2000],
  post: [0.3800, 0.3400, 0.2800],
  cob: [0.8200, 0.6600, 0.2400],
  rope: [0.4200, 0.3500, 0.2400],
  cloth: [0.7200, 0.3600, 0.2800],
  paleTop: [0.6200, 0.6300, 0.5700],
  capPink: [0.5000, 0.3800, 0.3300],
  dark: [0.2000, 0.1700, 0.1400],
  bark: [0.1470, 0.0723, 0.0331],
  // The conifer's own trunk, which is a red-brown and not the grey-brown the
  // palm's is: a spruce in a painting has a warm trunk and a blue-green crown,
  // and putting the palm's wood on it makes the tree look like a dead thing.
  barkRed: [0.1900, 0.0930, 0.0560],
  barkRedLit: [0.3050, 0.1600, 0.0960],
  barkRedDark: [0.1100, 0.0510, 0.0310],
  // And the broadleaf's, which is neither of those: a maple is a grey thing with
  // a warm face, pale enough to be nearly silver where the light is on it, and it
  // is a pale trunk under a gold crown that does most of what tells the two trees
  // in this county apart at thirty metres. A red-brown trunk on a gold canopy is
  // the conifer with the wrong leaves on it.
  barkPale: [0.2450, 0.2100, 0.1750],
  barkPaleLit: [0.3500, 0.3100, 0.2650],
  barkPaleDark: [0.1350, 0.1100, 0.0900],
  capWood: [0.3000, 0.2000, 0.1400],
  capWoodDark: [0.1800, 0.1200, 0.0900],
  mushroomRed: [0.5271, 0.0409, 0.0242],
  mushroomBrown: [0.1946, 0.0844, 0.0296],

  // ---- the light in them ----------------------------------------------
  // paperWarm is over one on purpose: a lantern's paper is lit from inside,
  // and a value below one cannot be
  paperWarm: [1.5500, 1.3400, 1.0000],
  paperBand: [0.9000, 0.2600, 0.2200],

  // ---- the greys the tintable things are made of -----------------------
  // Anything the game recolours at runtime - the snail, the shells, the
  // flowers - carries a near-grey albedo, so the tint is a hue and not a hue
  // shift. These are the numbers those maps are painted from.
  shellBody: [0.9600, 0.9450, 0.9100],
  snailBelly: [0.9600, 0.9500, 0.9100],
  snailFoot: [0.8700, 0.8600, 0.8200],
  snailShade: [0.9600, 0.9500, 0.9000],
  flowerHead: [0.9400, 0.9300, 0.9000],
  flowerLeaf: [0.3000, 0.4600, 0.2000],
};

/** The greens a scattered plant is drawn at: three, not one. */
export const GREEN = [[0.0762, 0.2122, 0.0369], [0.0467, 0.1470, 0.0252], [0.1248, 0.2831, 0.0685]];
/** The stones a scattered piece is drawn at: three greys, and not one. */
export const STONE = [[0.3663, 0.3419, 0.2874], [0.4342, 0.3916, 0.3231], [0.2831, 0.2623, 0.2307]];
/**
 * No pure white in the flowers: at ten centimetres across a white speck in
 * the grass reads as a stone, and there are enough of them to notice. These
 * are sRGB hexes because they arrive as an `instanceColor` tint rather than as
 * a vertex colour.
 */
export const FLOWER_COLORS = [0xe6d59b, 0xf6d867, 0xe98fb0, 0xc9a0e0];

/* ------------------------------------------------------------------ *
 * The two ways out of the jar. Linear in, sRGB out, for the things that
 * are not lit - a canvas, a colour picker, a hex.
 * ------------------------------------------------------------------ */
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
/** The linear triple for a name in the jar, or for a raw sRGB hex number. */
export function lin(name) {
  if (typeof name === 'number') {
    return [s2l(((name >> 16) & 255) / 255), s2l(((name >> 8) & 255) / 255), s2l((name & 255) / 255)];
  }
  const c = COUNTY[name];
  if (!c) throw new Error('no colour called ' + name + ' in the jar');
  return c;
}
/**
 * The same colour, encoded into sRGB. A canvas holds sRGB numbers and the game
 * reads an albedo map as sRGB, so a colour out of the jar has to be encoded on
 * the way into one - otherwise it is decoded a second time on the way back out
 * and a mid grey arrives as a quarter of itself, which is how a granite map
 * ends up painting a stone black.
 */
export const srgb = (c) => [clamp01(l2s(c[0])), clamp01(l2s(c[1])), clamp01(l2s(c[2]))];
/** The same colour as a hex number three.js reads as sRGB. */
export function hex(name) {
  const c = srgb(lin(name));
  return ((Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255));
}
/** The same colour as a `rgb()` string, for a canvas or a stylesheet. */
export function css(name) {
  return 'rgb(' + srgb(lin(name)).map((v) => Math.round(v * 255)).join(',') + ')';
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
