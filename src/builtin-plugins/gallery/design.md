# Gallery editor: UI design decisions

Not documentation of what exists — the *reasons*, so the next change does not
undo them by accident. Written 2026-07-29 when the editor grew from one content
kind to four.

## The problem four kinds create

A CG, a recollection, a music track and a voice line are not four flavours of
the same object. They differ in what identifies them, what you must see to
recognise one, and what you do to verify one:

| kind | identity | must see | verify by |
|---|---|---|---|
| cg | the picture | the picture | looking |
| scene | a story coordinate | thumbnail **+ where it points** | looking |
| music | a filename you cannot see | title, duration | **hearing it** |
| voice | the spoken line | **the line text** | hearing it |

The first editor forced everything through one shape: a 16:9 image tile in a
grid, an inspector that appeared on selection, and a group sidebar. That shape
is right for exactly one of the four rows above.

## P1 — Kind is the primary axis; group is secondary

Kinds are content *types* with different fields, verbs and shapes, so they are
top-level segments, not a filter dropdown. Groups are a cross-cutting tag, so
they became a chip row under the segments.

This also retires 176px of near-empty sidebar: with no groups authored it
showed a single "All" row. Chips cost one line and give the content pane the
width it actually needs.

## P2 — Each kind gets the card shape its content deserves

**Grid** (`cg`, `scene`): image-dominant tiles. The picture is the identity.

**List** (`music`, `voice`): rows. A grid of 16:9 tiles for audio is wasted
space — a track is a title, a duration and a play button; a voice line is text
that needs room to be read. This is the one decision most likely to be
"simplified" back into a uniform grid later. Do not: it is the difference
between a gallery editor and a CG editor with three broken tabs.

## P3 — Audition in place

An audio entry you cannot hear in the editor is unverifiable, and an author
will not open the game to check whether they picked the right take of 200. Every
audio row plays inline through `assets.createObjectUrl` — editor-side, no
running game required. One shared player so a second row stops the first.

## P4 — The inspector column is always mounted

It used to appear on selection, which reflowed the grid under the cursor. Now
it holds a fixed width and shows a per-kind hint when nothing is selected, so
the space is never wasted and the grid never moves.

An absolute overlay would also stop the reflow, and was rejected: floating
layers inside the editor tab host have caused a resize-loop before (see
`editor-group-overflow-trap` — a one-pixel overflow grew a scrollbar, which
shrank the container, which re-clipped the layer, forever).

## P5 — Teach the blueprint contract where the author already is

The point of every entry is to be read by `Get Gallery` and fed into a List
widget, and the first editor never said so. The idle inspector now names the
node, its Kind setting, and the row fields this kind carries.

Deliberately in the *idle* state and nowhere else: the project's UI convention
is minimal chrome and no explanatory prose (`ui-style-constraints`), so this
must never become a banner over the content. It fills space that would
otherwise be blank, and disappears the moment the author selects something.

## P6 — Settings are not a fake group

"Locked look" was a sidebar row that replaced the grid with a form. Navigation
items must navigate. It is now a header icon opening a modal, which also lets
the author see the grid behind the placeholder they are choosing.

## P7 — Creation verbs are per kind

"Import CGs" is meaningless on the Music tab. The primary action renames with
the segment: Import CGs / Add Recollection / Import Tracks / Add Voice Lines.
The empty state offers the same verb, so an empty tab teaches what it is for
instead of dead-ending.
