# Story CLI

`project/app/story.js` answers questions about the story command catalogue,
reads a project's scenes as text, checks them, and writes them back. It exists
so that writing a scene does not mean driving Studio over CDP to type rows and
watching the lint panel to find out whether they were any good.

**This is a tool format, not a product feature.** Studio offers an author no
text-based way to write a story, and nothing here appears in its interface. A
`.story` file lives in the checkout's scratch directory for as long as one edit
takes. (The author-facing `.txt` script export is a different, narrower thing:
it makes prose editable outside Studio and projects every other row to a label
it will never read back. The two do not share a codec.)

**A green `check` is not a played scene.** It says the rows are well-formed and
that the project linter found nothing. Whether the scene *plays* right is still
a question only Dev Mode answers.

```sh
node project/app/story.js --help
```

The first run after any change under `src/` rebuilds a bundle into
`.dev/cache/story-cli` (about a second). Runs after that take about half.

A flag the command does not declare stops the run rather than being ignored, and
so does a `--category` value that is not one of the ones there are.

## Finding a command

```sh
node project/app/story.js commands                 # all 53, by category
node project/app/story.js commands sound           # search token, id, params, examples
node project/app/story.js commands --category flow
node project/app/story.js commands --limit 0     # the first 60 otherwise
node project/app/story.js categories
node project/app/story.js command say
node project/app/story.js command background       # the id works too, not just /bg
```

`command <token>` is the one to reach for before writing anything. Everything it
prints comes from the spec the editor itself commits through, so a param renamed
there renames here:

```
/say
  id         say
  category   character
  builds     nodeAction/dialogue

  positional (in this order)
    <character>             character, or a bare name for a one-off speaker  - required
    <text>                  text  - takes the rest of the line

  examples
    /say Alice Hello there.
    /say Zoe Who are you?
```

`builds` is the block a bare invocation lands, run rather than tabulated.
`required` marks a core param: a line missing one is a draft row in Studio and an
error here, because a file has no draft state.

`lines` prints the other half of the format - the line shapes that are not
commands.

## Finding what a project holds

A line names things by name, never by id. This prints the names:

```sh
node project/app/story.js stories --project D:/path/to/project
node project/app/story.js scenes  --project D:/path/to/project
node project/app/story.js targets --project D:/path/to/project
node project/app/story.js targets Alice --project D:/path/to/project
```

`targets` reads the same resolved table a typed line resolves against, so a name
it prints is a name that resolves. It lists characters, one-off speakers already
used in the story, images, audio, videos, audio tracks, variables, scenes, pages,
build variants, value blueprints and choice options. Stage objects and labels are
scene-scoped and deliberately absent - they belong to the scene being written.

`--story` picks the story when a project has more than one; with a single story
it is not needed.

## The text format

A `.story` file is **one scene**. Two spaces per nesting level, and the shape of
a line comes from what it starts with and nothing else:

```
#nlstory 1
#story Skeleton
#scene The corridor ⟦f306e2d5-70c0-421b-ba8a-c7b2d3ce9d33⟧

» Set background corridor  ⟦db4296b2⟧
/bgm bgm-quiet track=Music vol=0.7 fade=1.2s loop=true  ⟦a63fe9cb⟧
The last bell rang twenty minutes ago.  ⟦b2d057b6⟧
Narra: You're late.  ⟦51d4f8dc⟧
/menu What do we make?
  - Something loud.
      /set met true
  - Something quiet.
? gold > 10
```

- **`/<token> args`** - a command. A line opening with `/` is *always* a command:
  an unknown one is an error, never prose.
- **`Name: words`** - dialogue. Everything before the first `: ` is the speaker;
  a name no character answers to is a one-off speaker, exactly as `/say` does.
- **plain text** - narration, which is any line that is none of the others.
- **`// text`** - a note.
- **`- text`** - a choice option, under a `/menu` row.
- **`? expression`** or **`? else`** - a branch of the `/if` above it.
- **`» label`** - a row this format cannot spell. See below.
- **`.`** - a row that holds nothing. A blank *line* is spacing and means no row.

Escaping is a backslash, before a leading marker, a `: ` inside narration, an
anchor bracket, or a space at either end. `show` writes these for you.

### The anchor is the row

The trailing `⟦…⟧` carries the block id - its first eight characters, or more
where that is not unique in the scene - and, after a space, `disabled` for a row
that is switched off.

It is not decoration. A row's `textId` is the unit every translation of that line
is filed under, and its block id is what a save anchor and a row-level launch
point resolve against. A line with an anchor keeps its row; a line without one is
a new row; **a line deleted takes its row with it**, because a file describes the
whole scene.

### `»` - the rows with no spelling

Some rows have no line that reads back as themselves: a `/transform` on a portrait
the enter row never named, a character transition the vocabulary has no word for
in that direction, a `/set` assigning a scene reference, a transform stating four
channels at once where the grammar has one slot for "how". Those are written as a
`»` label and their payload goes verbatim into the `#data` footer.

**The label is never parsed.** Editing one changes nothing; the row comes back
from the snapshot. That is what makes the escape hatch safe, and it is why the
line is written at all: a row the file did not mention would be deleted on apply.

The proportion is worth knowing before writing anything: about three rows in four
have a spelling, and the ones that do not cluster in the transform and transition
vocabulary. `show` says how many and names them.

### How the printer decides

Every line the printer writes is read straight back and compared with the row it
came from; a line whose row does not come back identically is not written, and
the row becomes opaque instead. So coverage is a property of the file's
construction rather than a claim about the printer: what is written as a line can
be edited as a line.

## Reading, checking, writing

```sh
node project/app/story.js show  --project <dir> --scene "The corridor" --out corridor.story
node project/app/story.js check corridor.story --project <dir>
node project/app/story.js apply corridor.story --project <dir> --write
```

A filename with no directory in it means `.ignored/` at the root of this
checkout, which git ignores - so all three commands name the same short file.
Anything that looks like a path is one, `./corridor.story` included. `--out` with
no filename after it names the file after the scene.

`check` runs two layers. The file layer answers whether every line reads as
something, against the catalogue that exists and the names this project has -
unknown command with the near misses, a param the command does not declare, a
value the slot refuses, a missing required param, a branch outside a condition.
The document layer runs the project linter's story rules, the same ones Studio's
lint panel runs: a jump to a scene that is gone, a duplicate label, a dead end, an
empty choice, a stage object shown but never created.

Every other rule category is **named as not run** rather than skipped silently.
Those rules read asset bytes or the reference index, which only a running Studio
builds, so this says nothing about them either way.

Exit code 1 means something at error severity was found; 0 means clean.

`check` with no file checks the project's stories as they stand.

## Writing

`apply` checks first and writes nothing if anything is at error severity. It
writes `editor/story/stories/<id>/storydoc.json` the way `StoryService` does, so
the file it leaves and the file Studio leaves are the same shape.

Four things to know before using it:

- **A file describes a whole scene.** Applying it deletes every row the file does
  not mention; `apply` names them before it happens, and writes nothing without
  `--write`.
- **A zero-edit round trip changes nothing.** `show` then `apply` on an untouched
  file leaves the document byte for byte as it was - rows keep their stored key
  order, so a one-line edit is a one-line diff.
- **A rename is reported, not applied.** Renaming a scene moves every jump that
  names it, so that is done in Studio.
- **Close the project in Studio first.** Nothing reloads this file on its own, and
  a running Studio will write its own copy over yours on the next save.

An older document is migrated on read, and applying makes that permanent for the
whole document rather than just the scene. `apply` says so when it happens.

## Where this lives

The wrapper is `project/app/story.js`; the commands are TypeScript under
`src/renderer/lib/story-cli/`, because that is where the command spec registry,
the line parser and the resolver are. `dsl/` holds the format: `shapes` (the line
shapes and escaping), `parse` (text to AST), `compile` (AST to a scene, through
the same parse → resolve → build the row editor commits through), `print` (the
inverse, with the echo check), `prose` and `condition` (the two halves no command
spec covers), `equal` (when two rows say the same thing).

`lib/lint/projectContext.ts` is the headless lint context, and belongs to no one
tool: it is what lets any command-line caller run the rules Studio runs.

`story` owns `editor/story/`; `ui` owns `uidoc.json` and `blueprint` owns
`uigraphs.json`. The seams are ids - a `/quit` names a page, a Story Action row
names a blueprint - and this tool reads both of those documents without ever
writing them.
