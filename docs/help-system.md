# Studio help system

The rules for every word Studio shows an author, and the machinery that carries the long ones.

This file is the source of truth for **interface copy**, the same way
[design-system.md](design-system.md) is for pixels. Read it before writing a label, a hint, a
confirmation, or a help topic.

## 1. Three tiers of text

Every sentence in the interface belongs to exactly one tier. The tier decides where it renders.

| Tier | What it is | Where it renders | Budget |
|---|---|---|---|
| **Label** | the name of the thing | on the control | 2-6 words |
| **Expectation** | what you get if you use it | one line beside/under the control, or a tooltip | one short sentence |
| **Topic** | the fuller answer | help popover (F1) or the help browser, **never inline** | 3-8 lines |

The rule that follows from the table: **a surface may render tiers 1 and 2. Tier 3 lives behind
F1.** A panel that explains itself in a paragraph has put a topic where an expectation belongs.

Corollary for empty states: an empty panel says what will be there and how to put something there
(tier 2). It does not teach the feature.

## 2. What a topic may say

In this order, stopping as soon as there is nothing true left to add:

1. **What it does**, stated as the result, not the action.
2. **What you will see** once you use it.
3. **What it will not do**, but only where a real misreading exists.
4. Related topics and the shortcuts that reach it (rendered by the popover, not written by hand).

## 3. What no Studio text may say

- **Why it was built this way.** Design rationale belongs in the repo, in a comment or a plan.
- **How it works inside.** No stores, no trees, no passes, no serialization, no "under the hood".
- Encouragement, congratulation, or narration of the author's feelings. No "easily", "powerful",
  "just", "simply", "seamless", "let's", exclamation marks.
- Em dashes (`—`) or Chinese dashes (`——`) in author-facing copy. Split the sentence.
- ALL CAPS labels, and decorative badges around a value that is merely being displayed.
- Bracketed plurals (`file(s)`). Use `detailOne` / `detailMany` keys.
- Internal vocabulary: store, document, node id, revision object, HEAD, working tree, dirty.

## 3a. Register: state it, do not narrate it

> **Professional, not colloquial, not machine-written. State the expectation; do not describe the
> mechanism.**
>
> This is the first test every author-facing string has to pass. The three failure modes below are
> what breaking it looks like in practice; §3 lists what may never appear at all.


Every sentence is a statement of fact about the product. It is not a remark made to the author.
Three failure modes, all of which have shipped and all of which read as machine-written:

- **Rhetorical shape.** Parallelism, negation-first framing and epigram: *"Nothing leaves this
  machine and nothing arrives until you ask for it."*, *"Nothing is looked at until you ask."*,
  *"What you time is what plays."* Say the fact once: *"Nothing is sent or fetched except by an
  explicit action."*
- **Colloquialism.** Casual verbs and metaphors, in either language: 「叫回来」「搅在一起」「跑一遍」
  「读不出来」「换了图」「出厂时的值」「值能活多久」, "take it back", "eats your work", "on its own",
  "at a glance", "try again", "all caught up". Use the plain verb: 「重新打开」「互不影响」「运行一次」
  「无法读取」「更换了图片」「默认值」「值保留多久」.
- **Second person as narrator.** `you` / 「你」 is for an instruction the author is about to carry out
  ("Press F1"), not for describing what the product does to their data. *"Your project files are left
  untouched until you unfreeze it"* → *"Project files are not written until the project is unfrozen."*

Chinese carries two extra rules: no 「这个/那个」 where 「该/本」 is meant, and no sentence-final
particles (「了」「吧」「呢」) doing tone work.

## 3b. Shape

Three shapes. A string that takes the wrong one reads as the wrong tier.

- **A title is a noun phrase.** Not a sentence, not a question, and it ends in nothing.
  *"Showing one change."* → *"Showing one change"*. *"What changed here?"* → *"Changes in this
  file"*.
- **A pair of values is drawn as a pair**, `from → to`, never folded into prose. *"The width
  changed from 320 to 640"* → *"Width (320 → 640)"*. One arrow, one row; a second pair belongs on
  a second row, because two arrows on one line cannot be read at any width.
- **No roadmap.** The interface describes the product that is installed. No "not yet", "coming
  soon", "in a future version", "for now". A promise about the future is still a promise when it is
  negative, and it is wrong the moment the next version ships. *"Live2D models cannot be imported
  yet."* → *"Live2D models are not imported."*

The interface also never apologises and never explains itself. A failure is a state, not an
event that happened to the author: *"Sorry, we could not read this file - it may be corrupted,
which means the comparison is incomplete."* → *"This file could not be read."*

## 3c. Three languages, not one and two translations

English, Chinese and Japanese are each written for a reader who has only that one. A string that
reads as a translation of another has failed, however faithful it is.

- **Punctuation is the language's own.** An English expectation is a sentence and ends in a full
  stop. A Chinese or Japanese hint does not: 「只比较了总数，没有比较内容本身」,
  「比べたのは合計だけで、中身そのものは比べていない」. Labels end in nothing, in all three.
- **Japanese is plain form (常体), not です・ます.** The interface states facts; it does not address
  the author politely. *「変更はありません」* → *「変更はない」*.
- **Sentence structure does not carry across.** Translate the fact, then write the sentence in the
  target language. A Japanese string built by walking the English clause order is the commonest way
  this rule is broken.
- **Terms are fixed, and the catalogue is the record of them**: 资产 / アセット for an asset,
  版本 / バージョン for a repository version, バリアント for a build variant. Count the
  catalogue before coining a synonym; the term is almost always already in it.

**Before writing a new string, read the keys either side of it** in `catalog/en/<namespace>.ts` and
copy their shape. Nearly every string here has a neighbour answering the same kind of question, and
matching it is faster than deciding the shape again, and more consistent than deciding it well.

## 4. Naming a control

Name a control by **the state it produces**, and check that the name cannot be read as an action on
the author's files.

The case this rule was written from: leaving the read-only view of an old version used to be called
**Return to the Current Version** / 「回到当前版本」, sitting under a counter-clockwise arrow, next
to the button that actually overwrites the project. Everything about it reads as "roll my project
back", which is the one thing it does not do. It is now named for the mode it leaves
(**Stop Viewing History** / 「退出历史查看」), and no longer wears a revert icon.

Two mechanical checks:

- **A control that leaves a mode is named after the mode it leaves**, not the place it lands.
- **Icons carry meaning before words do.** Never give a non-destructive control an icon from the
  undo/revert/trash family. If the icon and the label disagree, the icon wins and the label is
  decoration.

## 5. Where help appears

Four surfaces, in order of how often an author meets them. None of them occupies the workspace
permanently.

1. **Help popover (`F1`)** — anchored, transient, closes on Escape or a click outside. It resolves
   the topic from the nearest `data-help-topic` ancestor of whatever has focus (or of the pointer's
   position), so it answers "what is *this*" without the author naming anything. Following a
   `See also` link keeps a trail: a back arrow appears in the header, named after where it lands,
   and `Alt+Left` does the same. Asking for help again from outside starts a fresh trail, because
   that is a new question. The browser needs none of this, since its list is the way back.
2. **`?` trigger** — a hover-revealed glyph in a panel header, opening the same popover. It exists
   so the popover is discoverable by mouse; it is not a second surface.
3. **Command palette** — every topic is a palette entry under Help, so a topic is reachable by name
   from anywhere.
4. **Help browser** — the whole topic set as a two-pane reader. It is the Launcher's Learning tab,
   and an on-demand editor tab in the workspace. Being an editor tab means it costs viewport only
   while it is open, like any document.

There is no permanent help panel, no startup tips dialog, and no callout that appears uninvited.

The popover is hosted per window. The workspace mounts it in `WorkspaceHelp`; the Settings window
mounts `HelpOverlay` bare, with no browser footer, because it has no editor tabs to open one in.

### Where a `?` is drawn, and where it is not

A surface opts in through the nearest seam that already exists, rather than by knowing about the
help system:

| Seam | Gives |
|---|---|
| `PANEL_HELP_TOPICS` | `F1` over a sidebar panel, no markup in the panel |
| `SettingsGroup helpTopic` / `trailing={<HelpTrigger/>}` | one part of a project sub-page |
| `ProjectSubPage helpTopic` | a whole sub-page that is one subject end to end |
| `Modal helpTopic` | `F1` in a dialog, and a `?` beside its close button |
| `dialogs.show({helpTopic})` | the same, for a dialog opened through the UI service rather than mounted as a component |
| `data-help-topic` on an editor's root | `F1` anywhere in that editor |

Draw a visible `?` only where the surface decides something the author cannot read off the controls
in front of them: a merge they did not ask for, a build switch that changes the shipped files, a
mode they arrived in from a failure. A row that already carries a control gets the attribute and no
glyph, because two adjacent icon buttons are a row of glyphs to skim past.

## 6. Topic content format

A topic body is one catalog string. The renderer understands three things and nothing else:

```
A paragraph is a line of prose.

Blank line separates paragraphs.

- A line starting with "- " is a bullet.
- Bullets in a row form one list.
```

No headings, no bold, no links, no images inside a body. A topic that needs a heading is two
topics; use `related` to join them.

## 7. Adding a topic

1. Write `title` and `body` under `help.topics.<id>` in `src/shared/i18n/catalog/en/help.ts`, then
   the same keys in `zh/help.ts` and `ja/help.ts`. The parity test fails if one of them is
   missing.
2. Add the entry to `HELP_TOPICS` in `src/renderer/lib/help/helpTopics.ts`: its section, and
   optionally `shortcuts` (keybinding catalog ids, rendered as chords) and `related`.
3. Tag the surface it describes with `data-help-topic="<id>"` so `F1` finds it. Panel headers can
   pass `helpTopic` instead and get the `?` trigger for free.

`helpTopics.test.ts` checks that every registered topic has both keys, that every `related` id and
every `shortcuts` id exists, and that every topic is reachable from a section.

## 8. Reviewing copy

Before committing author-facing text, read it back and ask:

- Can this be cut to half the words without losing an expectation? Then cut it.
- Does it explain a mechanism? Delete that clause.
- Read it aloud. Does it sound like a sentence someone wrote to be admired? Rewrite it as the fact.
- Would this line survive in a reference manual? If it only works as conversation, it is the wrong
  register (§3a).
- Could a nervous author read this as "my work is about to be overwritten"? Rename.
- Does the icon agree with the label?
Two of those questions are mechanical, and are worth running over any file of new strings:

```sh
# An em dash or a Chinese dash inside a string value (§3). Legitimate only in a format example.
grep -nE '"[^"]*(—|——)[^"]*"' src/shared/i18n/catalog/*/*.ts

# A string describing its own implementation.
grep -nE '"[^"]*(the engine|internally|because |which means)' src/shared/i18n/catalog/*/*.ts
```

A hit on the second is not a wording question. The string is explaining a mechanism (§3), and the
fix is to delete that clause rather than to reword it.

