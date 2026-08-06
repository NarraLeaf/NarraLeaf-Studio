# In-Studio help, documentation and hints

Card: 2026-08-05-001 · Branch `feat/in-studio-docs` · Worktree `.claude/worktrees/docs`

Companion: [help-system.md](../help-system.md) is the durable half of this work (the copy rules and
how to add a topic). This file is the round: what was wrong, what was decided, what shipped.

## 1. Problem

Two symptoms of one thing.

**The Launcher's Learning tab is a link wall.** `LearningTab.tsx` renders
`LEARNING_RESOURCES` — six cards, five of which point at `narraleaf.com` and one at GitHub. The
tutorials section is a commented-out template. Nothing about Studio is readable inside Studio.

**So the interface documents itself in place.** With nowhere to put a paragraph, panels grew their
own: the Welcome editor is a 4xl title, a tagline and four numbered prose steps; project settings
carry a permanent two-line description under every switch; the audio section opens with a paragraph
about buses; the recovery panel opens with a paragraph about probes. 136 catalog strings are 30
characters or longer, and the long ones are concentrated in exactly the surfaces an author reads
once and then reads past forever.

The second symptom has a sharper edge than verbosity. Text written to be *complete* drifts into
explaining the machine, and text that explains the machine has to name the machine's parts. That is
how the version rail ended up with **Return to the Current Version** under a counter-clockwise
arrow: a phrase describing what happens to the repository, sitting one control away from the button
that actually overwrites the author's files, wearing the revert icon.

## 2. Rulings

**R1 — Help is transient by default.** The primary surface is an `F1` popover anchored to whatever
has focus. No permanent panel, no dock, no reserved column. The only surface that can hold the
whole topic set open is an editor tab, which costs viewport exactly like a document does and only
while it is open. This is the answer to "must not steal viewport".

**R2 — One registry, two windows.** Topics live in `src/renderer/lib/help/`, content in the `help`
i18n namespace. The Launcher's Learning tab and the workspace's Help tab render the *same*
registry through the same component. Content is written once and cannot disagree with itself.

**R3 — Topics answer "what will happen", never "how it works".** Enforced by review, not by code;
the rules are in [help-system.md](../help-system.md) §2-§3 so a reviewer has something to point at.

**R4 — Context resolution is DOM-based, not registry-based.** `F1` walks up from the focused
element (falling back to the element under the pointer) looking for `data-help-topic`. A surface
opts in with one attribute and needs no registration, no id plumbing through props, and no
knowledge of the help system.

**R5 — Cutting inline text is part of this round, not a follow-up.** A help system that adds
surfaces without removing any is a net loss. Every topic that ships must delete or shorten the
inline prose it replaces.

**R6 — Legal notices are not help text.** The Live2D and Spine licensing paragraphs in the
character editor stay exactly where and as they are. They are shown because the author is about to
accept them, not because they are informative.

## 3. What shipped

### M1 — Mechanism (`src/renderer/lib/help/`)

- `helpTopics.ts` — `HelpTopicId` union, `HELP_SECTIONS`, `HELP_TOPICS`, lookup + search.
- `helpBody.ts` — the three-construct body parser (paragraph / bullet list / blank line), with a
  test.
- `HelpContent.tsx` — renders parsed blocks, the shortcut rows, and the related-topic links.
- `HelpPopover.tsx` + `helpController.ts` — the anchored transient popover and the window-local
  opener, following the `commandPaletteController` / `openKeybindingCheatSheet` precedent.
- `HelpTrigger.tsx` — the hover-revealed `?` glyph.
- `HelpBrowser.tsx` — the two-pane reader shared by both windows.

### M2 — Wiring

- `F1` registered in the keybinding catalog under General, so it appears in the cheat sheet and can
  be rebound.
- `data-help-topic` on the left rail panels, the version rail, the story scene editor, the assets
  panel and the project settings sections.
- Every topic is a command-palette entry under **Help**.
- Workspace **Help** editor tab, opened from the palette, from the popover's "All topics", and from
  the Welcome tab.
- Launcher **Learning** tab rebuilt on `HelpBrowser`; the external links survive as one section at
  the end of the list rather than as the whole page.

### M3 — Copy

The version rail's leave-history control renamed and re-iconed (§4 of help-system.md), the frozen
and revision notices rewritten to lead with what is not being saved, the Welcome editor stripped to
its actions, and the settings/audio/recovery paragraphs cut to one expectation each with the rest
moved into topics.

## 4. Deferred, deliberately

- **Guided interactive tours** (JetBrains' "Learn IDE Features"). Needs a step runner that can
  observe project state, and content that does not exist. The topic registry is the prerequisite
  and is now in place.
- **"Got it" feature callouts.** Cheap to build, but they appear uninvited; they are worth having
  only for a genuinely new feature, and want a persisted "seen" set first.
- **Tip of the day.** Rejected. A modal at startup is the loudest possible way to say something
  optional.
- **Per-lint-rule topics.** The 26 project lint rules each deserve one, and their messages already
  carry the expectation; wiring `data-help-topic` from a finding row to a rule topic is a small
  follow-up once the rule ids and topic ids are reconciled.
- **A topic for every panel.** The registry ships with the surfaces an author meets in the first
  week. Gaps are gaps, not placeholders: an unregistered surface simply has no `?`.
