# From a script to scenes

Most authors arrive with a script: a document, a Ren'Py or Tyrano project, a chat log of an idea, or
a few pages of prose. This chapter is how to turn it into NarraLeaf scenes faithfully - and, only when
the author asks, how to write or polish the prose itself.

**The author's text is kept verbatim.** You change its shape (one line per text box, speaker labels,
stage directions turned into commands), never its words, unless the author asked you to write or
edit. When a line looks wrong to you, ask; do not fix it silently.

## 1. Inventory before writing

Read the whole script once and build, in the chat, before any write:

1. **Scenes** - a scene is a stretch in one place and time, usually opened by a location change or a
   chapter heading. Name each as the author would (`Rooftop, after school`), in the game's language.
   Note the order and every branch point and rejoin.
2. **Speakers** - every speaker label. Merge labels that are one person (`Aoi`, `Aoi (phone)`,
   `Girl` before her name is known); the extras become `nicknames`, or a `/rename Aoi ???` row when
   the script hides the name on purpose and reveals it later.
3. **Pictures** - backgrounds per scene, sprites per character and expression, CGs, inserts.
4. **Sound** - music cues and where they start and stop, sound effects, voice files.
5. **State** - every choice and what it changes; every condition that reads it; every ending.

Then the **name map**: script reference -> file -> asset name. Asset names are what story lines use,
so make them short and systematic: `bg_<place>_<time>`, `<character>_<pose>`, `cg_<event>`,
`bgm_<mood>`, `se_<sound>`. Pose names are shared words (`normal`, `smile`, `sad`, `angry`,
`surprised`, `thinking`) so that `/char Aoi sad` reads naturally.

Show the inventory and the gaps (missing files, unused files, ambiguous speakers) and agree how to
fill them before step 3.

## 2. Mapping script constructs

| Script | NarraLeaf |
|---|---|
| Location heading, "INT. CLASSROOM - DAY", `scene bg room` | `/bg bg_classroom_day t=fade d=1` at the scene's top (new scene if it is a new place and time) |
| A character enters / `show aoi happy at left` | `/show Aoi smile pos=left` |
| Expression change mid-scene / `show aoi sad` | `/char Aoi sad` |
| Character leaves / `hide aoi` | `/hide Aoi out=fade d=0.4` |
| Dialogue `Aoi: "…"` / `a "…"` | `Aoi: …` (drop the quotation marks unless the game's style keeps them) |
| Narration, inner monologue | a plain line |
| Unknown speaker "???" | `???: …` as a one-off speaker, or `/rename Aoi ???` then `/rename Aoi Aoi` at the reveal |
| `play music x fadein 2` | `/bgm bgm_x fade=2 loop` |
| `stop music fadeout 2` | `/stop fade=2` (confirm with `story_command stop`) |
| `play sound door` | `/sound se_door` |
| CG shown over the scene | `/show cg_x name=cg pos=center in=fade d=0.6`, later `/hide cg` |
| `with dissolve` / fade between pictures | the row's `t=` / `in=` / `out=` and `d=` |
| `pause 1.0` | `/wait 1` |
| `menu:` with options | `/menu Prompt` and `- Option` lines with their rows indented |
| `$ trust += 1` | `/inc trust` (declare `trust` with `variable_upsert` first) |
| `if trust >= 3:` / `elif` / `else` | a bare `/if` with `? trust >= 3` / `? …` / `? else` |
| `jump chapter2` / `call` | `/jump 'Chapter 2'` (`return` for a call that comes back) |
| `return` at the end of a route | `/ending Name` |
| `window hide` / `window show` | nothing; the dialogue box shows while there is a line |
| `nvl` passages | `/nvl` (see `story_command nvl`) |

Things with no direct equivalent: Ren'Py ATL animation (use `/transform` with `d=` and keep it
simple), screen language (rebuild as interface pages only if the game needs that screen), Python
logic beyond arithmetic on variables (simplify, and tell the author what changed).

Rules that keep the result honest:

- **One script line = one text box.** Do not merge lines into paragraphs or split a sentence the
  author wrote as one line, except to break a line too long for the box (about 120 CJK characters or
  220 Latin), and then tell the author where.
- **One scene per place and time.** A long scene is fine; do not split scenes by length.
- **Each scene sets its own stage** (background, characters present, music) even if the previous
  scene ended the same way - a save loaded or a scene replayed starts there.
- Choices that only change one line rejoin immediately; choices that change the story jump to
  route scenes. Shared material lives in one scene that both routes jump to.
- Every route ends with `/ending <name>`; agree the names with the author (they appear in the
  game's endings list).

## 3. Writing or polishing prose (only when asked)

When the author asks you to write a scene, fill a gap, or polish their text, write the way strong
visual novels read: the player is clicking through a text box, not reading a novel. Every line must
do work.

**Rhythm**
- One line, one text box: 18-22 CJK characters on average (roughly 10-14 English words); about one in
  six lines very short (≤ 10 characters) as a pause - "And then." "Nothing." "Why…".
- Dialogue and narration alternate quickly: typically one line of speech, one line of action or
  thought, one line of speech. Six or more lines of pure dialogue only at an emotional peak.

**Dialogue**
- **No dialogue tags.** No "she said", "he asked with a smile". Who speaks is the speaker label;
  actions go on their own line before or after the line, never fused with it.
- One line does one job: information, emotion, or pushing the scene forward.
- Characters do not name their feelings ("I'm sad because I'm afraid you'll leave") - they show them
  ("…You're not leaving, right?").

**Characters are people, not tags**
- The deletion test: remove every catchphrase, verbal tic and pronoun quirk - can you still tell who
  is speaking? If not, the characters are tags, rewrite.
- Distinguish by what they want, what they fear, what they avoid, whether they finish sentences,
  whether they ask or answer.
- No archetype labels as personality (tsundere, genki, kuudere…), no stock gestures (scratching the
  back of the head, tilting the head, puffing cheeks, sticking out the tongue, hands on hips).

**No over-description**
- The sprite carries the face: almost never describe eyes, lips, pupils, eyebrows (a handful of times
  in a whole game).
- Ration adverbs of softness (gently, slowly, quietly, slightly) - a few per ten thousand words.
- A new place gets at most three lines of description, one or two concrete objects; no full
  inventory of weather, light, smell and sound. No appearance checklists.

**No purple filler**
- The deletion test, line by line: if removing it loses no information, emotion or action, remove it.
- Abstract big words (fate, soul, eternity, youth, bonds, salvation) almost never, unless one is the
  work's actual theme.
- Metaphors come from what the narrator has seen - a child's image for a child narrator, never the
  author's vocabulary. At most one simile in a passage.
- Emotion lives in the gap between what a character wants and what they know, and in concrete action
  - not in adjectives.

**Structure**
- Before writing a scene: who is there, what each wants in it, what has changed when it ends. A
  scene where nothing changes is not written.
- Scene transitions are one plain line of time or place, not lyrical bridges.

After writing, re-read against those rules and show the author what you wrote as text in the chat
before applying it, unless they told you to go ahead.
