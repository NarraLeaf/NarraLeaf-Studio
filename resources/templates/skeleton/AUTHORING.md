# Skeleton template — how its blueprints are written

The skeleton is the first project most authors open, and they learn how Studio's blueprints are
written by reading it. A graph in here is an example before it is anything else, so it is held to
the rules below. The Config page and the Global blueprint are written this way; bring any other page
to the same standard when it is touched.

This file sits beside `content/` and is not copied into projects (`template.json` copies `content/`
and the `content.<locale>/` overlays only).

## 1. One job per layer, named for the job

- A layer does one thing, and its name says what, the way an author would put it: "Open on the Text
  pane", "Show the saved skip setting", "Change the master volume and show it". Never "Layer 1".
- Several event heads share a layer only when they start the same job.
- Names are short verb phrases. They are translated through the locale tables like every other
  author-facing word (section 7).

## 2. Notes that teach

- A layer whose name does not say everything gets a note (a comment card) across its top: when it
  runs, what changes on screen, and why when that is not obvious ("so a returning player sees the
  choice they left"). Where the layer shows a pattern worth copying, the note says what to change to
  reuse it.
- A layer with distinct sections frames each one with a comment in frame mode, slate-coloured,
  titled for the section ("Apply the setting" / "Show the number", "In full screen" / "In a window").
  Frames are for sections, not decoration: a four-node chain does not need one.
- No note that only lists the nodes it sits above.
- A note is sized for the longest of its English, Chinese and Japanese text, measured in the editor,
  so it never scrolls in any language.

## 3. Layout a reader can follow

- Every layer is laid out by `node project/app/blueprint.js format`, which runs the same layout as
  the canvas toolbar's Format graph button, and is applied as it comes out. Cards are not placed by
  hand: if a formatted layer is still hard to read, change the graph, not the positions.
- What that gives: execution runs left to right along one row; an If's true branch continues the
  row and its false branch starts a row of its own below everything the true branch led to; a loop
  (For, For Each, While) reads the same way, its body continuing the row and Completed starting a
  row below; a data node sits just before and below the input it feeds, a card's feeders stacked in
  the order of its inputs; a note goes above the part of the graph it was written over; a frame is
  re-fitted around the cards it held and keeps everything else out of its whole rectangle, so a
  section can be framed even where the other side of a branch starts right under it.
- The template is laid out once, in English, and the Chinese and Japanese trees keep its positions.
  `format` allows for a card turning out narrower in another language, so the counts it reports are
  the ones every language's editor shows. Format the English source, never the generated trees.
- A frame holds the cards its rectangle fully contains when `format` runs. To frame a section whose
  cards are not yet together, place them inside the new frame's rectangle in the `.bp` first - away
  from the rest if need be - and let `format` put the frame back in the row.
- `format` reports what is left on each layer: wire crossings, wires drawn under a card that is
  neither of their ends, and backwards wires. The graph is the cause of every one of them, so bring
  each layer to the lowest count a restructure can reach. The usual causes: one Element node fanned
  out to several consumers (give each consumer its own Element node), a value computed early and read
  far away (read it again where it is used), and several execution nodes that each produce one input
  of a later node.
- No two cards overlap, and a frame either holds a card entirely or not at all. This is measured
  from the cards the editor actually draws (their DOM rectangles), not from stored positions.

## 4. The current way to write each thing

- A value goes in the node's own field when the input has one (`÷ 100`, the text a Log writes, a
  Go Page target). A separate literal node only where the input takes none, which today means
  boolean pins (`Set Skip Read Text`, `Set Mute When Unfocused`).
- A number feeds a text input directly; it is converted the same way To String would. No To String,
  no `Concat` with an empty string.
- Show and hide with **Set Element Property** (Property: Visible, Value: Visible / Hidden). The card
  reads as words, needs no literal node, and works for every widget type.
- Highlight with **Set Element Variant** (Selected / Default), each with its own Element node.
- Branch with **If** (True / False). If Else only when there is an else-if.
- A page the player never comes back to - the Splash page - hands over with **Replace Page**, not
  Go Page. Go Page would leave it at the bottom of the page stack, where every Title button's
  `Go Page (None)` lands.
- **Memo** only where one value feeds two inputs (an output feeds one input; Memo, literals, Element
  nodes and Fn head params are the exceptions), and the note says so.
- No palette-hidden node types: compare `node project/app/blueprint.js nodes --all` with the plain
  listing.
- **A sound that always plays when an element is pressed or hovered is set in that element's Sound
  section** (`clickSound` / `hoverSound`), not in a blueprint. A blueprint plays a sound only when
  the sound depends on something — a locked card that opens nothing, a dialog whose first answer
  acts and whose others back out — and then it calls `UI confirm cue` or `UI back cue` from the
  Global blueprint after the check. A key has no element to carry a sound, so a page that answers
  one plays the cue itself: the Confirm page calls `UI back cue` when Escape backs out of a question.
- A list that fills itself, in its own blueprint, uses the **Set List Content** that takes no
  Element input. The Log, Load and Extra lists are written that way.
- A control on a list row that does something of its own - the Log's replay button - answers its
  own **Mouse Click**: a press on it is that control's, and the list's Item Click answers presses
  anywhere else on the row. A control only some rows have is shown by binding its visibility to a
  boolean field of the row (the replay button reads `hasVoice`).
- Before **Ask Confirm**, fetch the texts last-asked first: cancel, then the answer, then the
  question. Each text's wire then runs forwards into its own input, and none crosses another.
  Where the answer is handled, read the pressed row's `index` field with **Get Item Field** rather
  than keeping the press in a Memo.
- Escape backs out of a question: the Confirm page answers Dismiss by closing with no answer, so
  **Show Confirm** leaves through Dismissed. Whatever a question does after Cancel, it does after
  Dismissed too - wire both to the same nodes, or neither.
- When both branches of an If end by doing the same thing, that thing is a function called from
  both. Wires run back together would pass under every card between them, and a copy would have
  to be kept in step.
- A Blueprint Value has one Init head. Every Init and Flush head on every layer runs each time the
  value is read and the last one returned wins, so a second head only does the work twice.
- A page's rail shows the entry for the page itself as text, not as a button: a button there would
  open a second copy of the page on top of it.

## 5. Repetition becomes structure

- Where several elements carry the same graph and differ only by a value a node input can take,
  they become instances of one component with a param, and the graph lives once, on the component
  definition (`Get Component Param` reads the instance's value). The Config page's BGM, Sound
  effects and Voice rows are instances of `Volume slider` with an `Audio track` param.
- Keep the copies, identical in shape, when the difference cannot go through a param, and say why
  in the note:
  - which node runs (the three toggle pairs each change their setting with a different node; the
    master volume is set with Set Global Volume, not a track);
  - a setting that is a field on the node with no pin, because a param reaches only a pin (the
    Gallery nodes' Type, which is why the four Extra lists stay copies; Play Sound's track);
  - a label or any other prop: a component instance draws its definition's props, so instances
    cannot differ in text on the canvas. That is why the volume component holds the slider and its
    number but not the row's label.

## 6. Behaviour stays the same

What the player sees and what is saved stay byte-for-byte the same. Walk the page in Dev Mode on a
fresh project from the branch and on one from `develop`, and compare: values shown, settings read
back from the game, state shown when the page reopens, Escape, Back, and opening the page from the
title and from inside a game.

## 7. Words

- The English template is the source. The Chinese and Japanese trees are generated from it with
  `scripts/gen-skeleton-locale.mjs`; every new layer name, note and frame title needs an entry in
  `scripts/gen-skeleton-locale.zh.json` and `.ja.json`, and an entry nothing uses any more has to go.
  Run the generator, then `--check`. The generator also brings the English interface document to the
  version Studio writes, through the step Studio runs on opening a project; a conflict in the
  template's files is resolved by running it again, not by hand.
- A widget's words have one source. A keyed widget holds no words of its own - its key's are shown.
  A widget's own words with a letter in them are translated through its own unit
  (`ui:<elementId>.<prop>`) in `zh-CN.json` and `ja.json`, which the generator promotes into the
  Chinese and Japanese trees; sample words (under a binding, or written over by a blueprint) are not.
- In the Chinese and Japanese notes, nodes, widgets, pages and panels are called by the names the
  interface shows in that language (the `blueprint.node.*`, `uiEditor.*` and `properties.*`
  catalogues), and elements by the names their Element cards show — never by type ids.
- English notes follow the interface's register: they state what happens, plainly, without asides.
  The table is keyed by the English string, so two meanings need two strings (a slider's `Track`
  part and an audio track are not the same word).
- A colour of the template's own (`editor/brand.json`) has an id with no dot and a name that says
  what it paints. Project ▸ Design lists an author's colour by an id without a dot; a dotted id is a
  control slot Studio seeds, and one Studio does not seed is listed nowhere. The name goes through the
  tables like any other word, and the generator writes it into each tree's `brand.json`.

## 8. Tools

- Edit with `node project/app/blueprint.js show` → edit the `.bp` → `format` → `check` → `apply --write`, and
  `node project/app/ui.js` for elements and components. Never edit `uidoc.json` or `uigraphs.json` by
  hand. Keep each blueprint's id and its first layer's id, so references and history follow.
- Before and after any change: `blueprint.js check` and `ui.js check` on `content/`, `content.zh/`
  and `content.ja/`, the generator's `--check`, and the tests under
  `src/renderer/apps/project-wizard/starter*.test.ts`.
