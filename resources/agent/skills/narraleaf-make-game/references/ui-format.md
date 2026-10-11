# The `.ui` format and editing pages

`ui_show` prints a page (or a component) in the `.ui` text format with ids, props and its
`revision`. `ui_patch` makes small edits by id; `ui_apply` replaces whole pages from `.ui` text. This
page is a condensed reference. **The catalogue tools are the truth**: `ui_widget {type}` lists a
widget's props with defaults, what it may contain, its parts, events and notes; `ui_usage {type}`
prints how the shipped skeleton really uses it, in pasteable `.ui` text. Ask them before writing a
widget or a prop for the first time - a prop name that does not exist is silently kept and does
nothing.

## Pages, Game UIs and components

- A **page** (`kind=appSurface`) is a full screen: Title, Save, Load, Config, Log, Extra, Confirm,
  Splash. One page is the entry the game starts on (Splash in the skeleton).
- A **Game UI** (`kind=stageSurface slot=…`) is drawn over the story while it plays: `dialog` (the
  dialogue box), `choice` (the menu), `onStage` (the quick menu), `notification`, `nvl`.
- A **component** is a reusable element tree placed on pages with params (the skeleton's `Save slot`,
  `Volume slider`, `Title button`, `Back button`).
- The title page has the fixed id `narraleaf-studio:main-surface`. It cannot be deleted and no other
  page can take that id; restyle it in place.

`ui_surfaces {query}` lists them all with element paths and ids and the blueprints hanging off each
element.

## Reading a dump

```
surface Title id=narraleaf-studio:main-surface kind=appSurface size=1920x1080
    setting backgroundColor = nlbrand:pageBackground
    Root: nl.root id=8b611438-… @0,0 1920x1080
        Title: nl.container id=b674b641-… @0,0 1920x1080  # blueprint: Title
            "Key art": nl.image id=a4d2552e-… @0,0 1920x1080
                fitMode = cover
                fillOpacity = 0.3
                imageFill = {"mode":"cover","assetId":"5322b0e3-…"}
            "Game title": nl.text id=c6d9dc8d-… @140,150 1000x120
                text = "Your Game"
                fontSize = 88
                color = nlbrand:text.primary
            Start: nl.button id=1e01e9cf-… @1480,420 300x60  # blueprint: Start
                localizationKey = menu.start
                # words: Start
                clickSound = {"assetId":"e54ece05-…"}
```

- **Indentation is the tree.** `<name>: <type> id=<id> @x,y WxH` declares an element; what is indented
  under it is inside it. Positions are relative to the parent.
- `<key> = <value>` sets a prop. Values are JSON where unambiguous, otherwise a bare word is a string.
  Dotted keys write one key of an object (`imageFill.assetId = <id>`, `clickSound.volume = 0.5`);
  `layout.`, `style.`, `extra.` reach the element's other bags.
- `# blueprint: …` names the blueprints already attached. `# words: …` shows a translation key's text.
- `setting <key> = <value>` writes a page setting (background colour, page animation);
  `answers <action>` says which input actions the page handles (Escape -> `dismiss` and so on).

## Colours, assets, words

- **Colours** should be palette references - `nlbrand:<id>`, optionally with alpha
  (`nlbrand:primary/0.5`). The skeleton already uses them everywhere, which is why `brand_set` restyles
  the whole game. Write raw colours only for one-off accents.
- **Assets** are referenced by **id** (`assets_list` shows ids): `imageFill = {"mode":"cover","assetId":"<id>"}`
  on an image, `clickSound.assetId = <id>` on a button, `fontAssetId = <id>` on text.
- **Words**: a text's `text`, a button's `label`. An element with a `localizationKey` shows that key's
  text instead and holds no words of its own (writing `text`/`label` beside a key is refused as
  `ui.words_two_sources`). The skeleton's menu words (Start, Load, Config …) are keys, shipped in
  English, Chinese and Japanese. Check with a screenshot that they show in the game's language; leave
  them unless they do not or the author wants different words, in which case set `localizationKey` to
  `null` and the `label`/`text` in the same `set` op.
- Sounds: `clickSound` / `hoverSound` on any element (`{"assetId": "<id>", "volume": 0.6}`). The nearest
  element up the tree with a sound wins.

## `appearance`: why a colour change "does nothing"

Containers, buttons, images and texts carry an `appearance` prop: variants (`default`, `selected` …)
holding rows per style property, each row optionally conditioned on a state. **The renderer reads the
appearance rows; the flat prop is only the baseline under them.** So `ui_patch set
backgroundColor=#222` on a button whose appearance row still says `nlbrand:button.primary` changes
nothing on screen.

- Best: change the palette entry the row points at (`brand_set`), which is what the rows are for.
- Otherwise: write the whole `appearance` object back with the row changed (read it from `ui_show`,
  edit, `set` it), and change the flat prop to the same value.
- Hover and pressed looks are rows with conditions:
  `{"conditions":{"hovered":true},"value":…}` and `{"conditions":{"active":true},"value":…}`; also
  `focused`, `disabled`, `selected` (a list's selected row). The last matching row wins, and a group's
  `transition` (`{"type":"tween","durationMs":160,"easing":"easeOut"}`) animates the change. The
  title's Start button is the model: its `effectTextShadow` and `transformOffsetX` rows move and glow
  on hover.
- A button's text colour cannot be switched by a variant; express "selected" with fill and border.

## `ui_patch` - the everyday tool

One call edits one page (or component) and is one undo step:

```json
{
  "surface": "Title",
  "baseRevision": 14,
  "ops": [
    {"op": "set", "element": "c6d9dc8d-9524-4102-985e-5612b971a776", "props": {"text": "Winter Echo", "fontSize": 96}},
    {"op": "set", "element": "a4d2552e-a1db-4226-b224-e88d072f57b0", "props": {"imageFill.assetId": "<key art asset id>", "fillOpacity": 1}},
    {"op": "layout", "element": "1e01e9cf-1ef0-44bf-9cbf-c04422dce551", "x": 1460, "y": 640, "width": 320, "height": 60}
  ]
}
```

| op | Needs | Does |
|---|---|---|
| `set` | `element`, `props` | Merges props (dotted keys allowed). |
| `layout` | `element`, any of `x` `y` `width` `height` | Moves / resizes (relative to the parent). |
| `add` | `parent`, `type`, `name`, optional `id`, `index`, `x` `y` `width` `height`, `props` | Adds a widget. |
| `move` | `element`, `parent`, optional `index` | Re-parents or reorders. |
| `rename` | `element`, `name` | Renames (the outline name). |
| `delete` | `element` | Deletes it and its subtree. |
| `instantiate` | `component`, `parent`, optional `id`, `index`, position | Places a component. |

Address elements by **id** (paths work but break when anything is renamed). Give an explicit `id` to
any element a blueprint will refer to.

**New containers and images come out white.** A freshly added `nl.container` paints a white
background through its default appearance even with `fillVisible = false`. When adding one, copy the
whole props bag of a similar element from `ui_show` / `ui_usage` (for example a transparent plate on
the same page) into the `add` op's `props`, then adjust.

## `ui_apply` - whole pages

A `.ui` document whose `surface` / `component` blocks each **replace that page's entire element
tree**; elements the block leaves out are deleted (the answer names them, and names blueprints that
would lose their element). Pages the document does not mention are untouched. Use it for a page of
your own, or a page you are deliberately rebuilding - always starting from `ui_show` so ids survive
(an element keeps its id when it stays at the same place in the tree).

Other block kinds you may meet:

- `param <id> <name> [type=text|string|number|boolean|list|json] [= default]` under a page: values the
  page is opened with.
- `component <name> id=… size=WxH` with `param` lines, and `component <componentId> param="value"`
  under an element to place it.
- `struct <id>` with `field` lines: a list's row shape. `action <id> <name>` with `key` lines: an input
  action.
- `document <name> entry=<page>` moves the entry page. Leaving it out leaves the entry alone.
- `bind <prop> = blueprint <id>` (a value blueprint drives the prop), `bind <prop> = field <fieldId>`
  (a list row's field), `bind text = param <id>` (a component's or page's text param).

## Lists

`nl.list`, `nl.choice.list`, `nl.notification.list`, `nl.nvl.list` draw their **children as the row
template**, once per item. There is no "item element" prop. `repeatDirection` (`vertical` /
`horizontal`), `repeatWrap`, `itemGap` arrange rows. A row's content comes from **field bindings**
(`bind text = field <fieldId>`) against the list's `itemStructId`; a blueprint's Set Text cannot
address a single row. The skeleton's Log, Load/Save and Extra lists are working examples - restyle
them rather than rebuilding them, and check any list change with a screenshot showing several
different rows.

## Rules that cause refusals

| Code | Meaning |
|---|---|
| `ui.unknown_widget_type` | No such widget (`ui_widgets`). Plugin widgets need their plugin loaded in the project. |
| `ui.not_a_part` / children errors | A child under a widget that takes none, or that is not one of a part-owning widget's parts (sliders, switches). Do not delete or re-parent parts. |
| stage widget on a page | `nl.dialog.sentence`, `nl.choice.list` etc. only on their Game UI slot. |
| `ui.binding_owner_mismatch` | A prop bound to a blueprint some other element owns. |
| `ui.frame_target_missing` / `ui.frame_loop` | A Page widget (`nl.frame`) naming a missing page, or a page that leads back to itself. |
| `ui.words_two_sources` | Words and a translation key on one element. |
| `ui.entry_unknown` / `ui.entry_not_a_page` | `entry=` naming nothing, or a Game UI. |
| `stale_revision` | The author edited the page since your `ui_show`. Read again. |

Notes, not refusals: `ui.unknown_prop` (kept, probably does nothing - check the spelling with
`ui_widget`), `ui.orphaned_blueprint`, `ui.binding_blueprint_missing`.

## After every visible change

`ui_screenshot {surface}` (or `{component}`, or `{surface, element}` to crop) renders the page as the
game draws it. Game UIs render with sample text. Look before moving on - see `ui-design` for the
checklist.
