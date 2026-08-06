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
   the same keys in `zh/help.ts`. The parity test fails if one side is missing.
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
- Could a nervous author read this as "my work is about to be overwritten"? Rename.
- Does the icon agree with the label?
