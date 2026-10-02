# SOUL.md

The voice this project is documented in, written down so another agent can write in
it. The evidence is `AGENTS.md`, `tools/README.md` and the four files in
`.kilo/skills/`, and there is a test for that evidence: **if a sentence here is
not in one of those, it is not the style.** Where this file and they disagree,
they are right.

It is loaded through the `county-voice` skill in `.kilo/skills/`, and not as an
instruction file, deliberately: it is material an agent imitates rather than
rules an agent obeys, and the moment it is wanted is just before a piece of
prose is written rather than at the start of every session. The four files in
`.kilo/skills/` are the corpus; this one is the fifth and is not evidence for
itself.

It is also written in the style, on purpose, and that is the only way a style
guide is worth reading — a specimen that breaks its own rules teaches the wrong
thing. Read the prose before the rules.

The voice belongs to technical reference for one project, and it is worth being
clear about that: it is a person who has been wrong in this codebase, remembers
exactly how, and is writing for the next person so the same hour is not spent
twice. It is not a house style for a blog post, a changelog, a commit message or
a README for a library. Use it in `AGENTS.md`, in a skill, in a note beside a
non-obvious number, and nowhere else.

## The one move

Everything in this voice is built out of a single shape, and it is the whole of
what the voice is:

> **the rule, the mistake it came out of, the number that proves the mistake,
> and the general principle the mistake is an instance of.**

The authority is never asserted. It is demonstrated by a specific failure with a
specific value in it, and then the failure is generalised into something the
reader can carry to a case nobody has met yet. Four beats, in that order, and the
fourth is what makes it worth reading.

From `AGENTS.md`, the real thing:

> **A wall is a step, and it is three pieces and not a ramp.** `groundYAt()` used
> to ease the lane's own level out to the terrain across one band, which is a
> straight line, and a straight line from the top of a wall to the bottom of it is
> a rounded slope: a four-metre wall came out as five metres of thirty-six-degree
> hillside with the road lying on it. So there is a **shelf** at the lane's own
> level scaling with the height of the wall, a **face** a third of the drop wide
> and therefore standing at fifty to seventy degrees however tall the wall is,
> and the country easing out of the foot of it. The face is a **plane** and not a
> smoothstep, because a smoothstep rounds both ends of it and a rounded end is
> the whole of what went wrong. The sign of the drop is not consulted, so a road
> cut into a hillside gets a bank and a road perched on one gets a face, and
> neither is a lump.

Rule in the first sentence, in the past tense so the mistake is already dead.
The failure is concrete and the numbers in it are the argument — five metres of
thirty-six-degree hillside, and the reader can check that against what the road
does. The generalisation is the last clause, and it covers the case the writer
never saw: a road cut into a hillside rather than perched on one.

A rule with no failure behind it in this voice reads as a preference, and the
reader has no way to tell which rules are load-bearing and which are taste. If
you have not hit the mistake, you do not yet have the rule — write down the
question instead, or go and find out.

## The sentence

Present tense, declarative, and about the code rather than about the author.
**There is no "we".** A statement is a property of the thing, not a thing that
somebody did, and the whole passage reads differently for it: `A surface with no
uv can only be given a normal map, never a roughness map` rather than *you can't
give a uvless surface a roughness map*. Second person appears only where it is
doing a job — the imperative list, or an aside handing over a fix.

**The em dash carries the turn and the colon carries the payoff.** A dash is
where the sentence admits the thing it was building towards; a colon is where
the consequence lands. Two or three in a sentence is normal, and a paragraph
with none of either is doing something else — usually nothing.

**Bold is a clause and not a word.** The load-bearing words get bold in this
voice and the load-bearing clauses do not get it, which is the wrong way round
and is the single most common tell of somebody imitating this style. `**a
vertex colour can be faded halfway and a material cannot**` is the voice.
`**important**` is not.

**"X and not Y" is the load-bearing clause and it is used constantly**: *three
pairs and not one*, *a plane and not a smoothstep*, *a gain and not a material*,
*a map and not a colour*, *one file per prop and not a directory of them*. It
works because it refuses the thing the reader was about to assume, and the
refusal is the content.

**Numbers are inline, specific, and carry their unit every time**: 0.57 linear,
1.3, 24.8 m, a fifth of a second, sixty centimetres, about seven degrees. A
round number is a rounded observation and should be written as one. Every claim
this voice makes about a surface, a map or a cost has a number in it, and a
paragraph with no number in it is an opinion.

**A short verdict stands alone on its line, after the long sentence that earned
it.** Nothing precedes it, nothing elaborates on it, and that is the effect:

- That has already cost one round of work twice.
- Two hours went into that.
- and that is a relief.

**A fragment is allowed where a sentence would be padding.** *and not a fourth
file.* *and both of them.* *which is the point.* This is not terseness for its
own sake; it is the writer declining to restate a conclusion the paragraph has
already reached, and the space after the full stop is doing the emphasis.

**A rhetorical question is permitted once, and it is answered inside the same
sentence.** *which is what `propMatFor` is for* / *why a mushroom is a
mushroom* / *and it cannot be ruled out from the material at all*. Never a
question left open, and never a question to a person.

## The paragraph

A paragraph opens by **stating the rule in the first clause and bolding it**, and
then never states it again. What follows is the evidence and the edges of the
rule, and it runs long — four, five, six sentences, eight when the argument needs
a fifth beat to land. There is a strong preference for the argument in prose and
for bullets only where the items are genuinely parallel and genuinely
orderless: an options table, a list of files, a list of things never to do. A
bulleted explanation is a paragraph that has given up.

**The passage admits what it used to be**, because the history is the argument:
*it used to*, *that is what the folder is for*, *and it survived a long time
because from above a mushroom's underside is a thirty-pixel sliver nobody looks
at*. This is the sentence that stops a rule reading as arbitrary, and it is also
the reason the documents here are longer than the subject seems to need.

**The cost is admitted, dryly, and then not dwelt on.** *and it is not
subtle*, *which cost an afternoon*, *a third of that gain was not brightness the
stone wanted*. The voice is not proud of having been wrong and not ashamed of it
either; it simply knows what it cost and moves on, and the reader is left with
the number rather than the feeling.

**"which is the point" and "which is the whole of it"** close an argument. They
are used where the preceding sentence was a list and the list turns out to have
been one thing.

**A specific noun beats an abstract one, every time.** *a fringe of straws in
mid-air*, *a black wedge on a green hillside*, *a mushroom in mid-air*, *a field
of white dots rather than water*, *a snout with a hand's width of air under it*.
When the voice reaches for an abstraction it has usually lost the image, and the
fix is to go back and find the thing that was actually seen.

## The document

**Headings are short, and half of them are claims rather than labels.**
*Checks*, *Models*, *Data* for the containers. **A wall is a step, and it is
three pieces and not a ramp.** for the rule. **The half-way is the middle of the
clearest stretch of the course, and the clearest stretch stops at the finish.**
for the rule with its sting in it. A section never restates its heading in the
first line of its body, because the heading already said it.

**Tables carry anything with columns**, and the house idiom for a two-column one
is a blank header:

| | |
|---|---|
| `serve.py` | the game, plus a dev server with no cache on it |

**Commands go in indented blocks or fenced ones**, unlabelled, usually with the
one comment that says what the output will be: `python3 tools/serve.py
# http://127.0.0.1:8713`. Filenames, symbols and values are backticked on first
mention and then frequently left bare, because the reader has them by then.

**A document ends on a check.** *cp snail-race.js /tmp/kilo/check.mjs && node
--check* and *node tools/plan-test.mjs*, then what to look at, then the actual
failure modes in order of likelihood. There is no summary at the end, because a
document that has to summarise itself did not make its point in the body.

**The opening of a document is a table of what is what**, or a paragraph that
says what the thing is and what it is not, and then the one command that runs it.

**The voice borrows the game's own nouns and does not gloss them.** *The
county* is the walled valley the five courses run through and it stands in for
this world and then for this project — *the county's palette*, *every mushroom
in the county*, *the one place in the county where the two tiles disagree*. It
is never defined in any of the corpus, because the reader is assumed to have
been in the project, and that assumption is part of what the voice is. Lily Deep
and Crag Ascent are course names and get used as landmarks in an argument about
shading without a word of introduction. Replicate the habit, and gloss a term
the first time a reader who has not opened the project could plausibly not have
it — which in practice means the in-world ones, since a symbol in backticks
explains itself and *the county* does not.

## Never

- **Never "Note:", "Important:", "Tip:", "Gotcha:".** A rule is a rule; it does
  not need a label to be taken seriously, and the label is usually covering for a
  rule that has not been made to earn its place.
- **Never "obviously", "of course", "note that", or "simply do X".** Every one of
  them is a way of not doing the work. The voice does the work and then states
  the result flatly. *Simply* and *just* are not on that list on their own,
  because both are in the corpus — but only as an **intensifier of an absolute**,
  never as a softener of an instruction. *a prop with no `uv` simply cannot have
  one*, *it just does not point at either of its ends*. The test is whether the
  word makes a thing more certain or less demanding: more certain is the voice,
  less demanding is a writer asking to be agreed with.
- **Never restate the heading, summarise the section, or preview what follows.**
- **Never hedge.** Not *might*, not *could potentially*, not *it seems*. If the
  claim is not sure, it does not go in the document; it goes in as an open
  question at the end.
- **Never a bullet list where the argument belongs in a paragraph.**
- **Never a list of things to do where a rule covers it.** *Do not build a
  material per course. `dropCourse()` disposes geometry and instanced meshes and
  has never disposed a material.* is one line; a checklist of eleven would be
  worse and would hide the one that matters.
- **Never praise, apologise, or congratulate.** No "Great", no "Nice", no
  "Oops", no emoji, no exclamation mark in the entire corpus.
- **Never a placeholder.** No "TODO", no "see above", no "etc." in a list that
  claims to be complete.

## Calibration

When in doubt, match these. They are the corpus, and the register is in them
rather than in any rule above.

> `clear` is a **minimum distance out past the waterline**, not a tolerance
> inside it. A water plant whose `at()` range lies inside the pool is rejected by
> every draw unless it sets `inWater: true` — and it will silently place
> *nothing* rather than throw. That has already cost one round of work twice.

> A texture baked into the glb is one the game cannot swap or leave out, which is
> the whole reason maps live in a folder.

> Resolution buys the tooth, and only the tooth; the size of a feature is the
> frequency, and it does not move with the resolution.

> The samples carry on past the line into the run-out the finishing camera stands
> in, and on a water course that run-out is the widest clear stretch there is:
> Lily Deep's is 24.8 m against the band's 21, it won, and both the tower and the
> half-way line were built on the finish line. A stretch the race never covers is
> not a candidate for its own half-way mark however clear it is.

> A preview that can only be seen from the three-quarter it was set up on is good
> for a first look and useless for the second: a shape can look right from the
> front and be wrong from the side, a seam can hide behind the piece, and
> something standing at the wrong angle to the ground only shows once you can get
> down to it.

## Before you send it

- Does the first clause of the paragraph state the rule, and is it bolded?
- Is there a failure and a number in it, and is the number one you have actually
  seen rather than one that sounds right?
- Does the last clause generalise past the case you wrote about?
- Is every bold a clause and every dash doing a turn?
- Have you hedged — *might*, *could potentially*, *it seems* — or summarised what
  the section was about?
- Would a reader who has never opened this project know what to run, and would a
  reader who has know which rules they cannot break?
