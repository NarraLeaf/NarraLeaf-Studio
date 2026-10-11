# Gallery: filling the EXTRA page

The Gallery plugin is what the skeleton's **Extra** page reads. Its catalog has four columns, all
the same shape - an **entry** holding ordered **variants** - and the page already shows whatever the
catalog holds (the Extra page's `Get Gallery` nodes fill its lists). You fill the catalog; you do
not rebuild the page.

| kind | an entry is | a variant is | unlocks in the game |
|---|---|---|---|
| `cg` | one CG | one differential (an image) | only by an **Unlock Gallery** node - see below |
| `scene` | one recollection | a thumbnail image (optional) | by itself, when the player reaches the scene |
| `music` | an album, or one track | a track (an audio asset) | by itself, when the track plays (`/bgm`, `/sound`) |
| `voice` | a set of lines | a recorded line (a voice unit) | by itself, when the line is spoken |

Groups are the chips a player filters by (chapters, routes, characters); an entry has one group or
none.

## Tools

Every write is one undo step for the author. Names are resolved for you: an asset by id or exact
name (import it first with `assets_import`), a scene by id or name, a voice line by unit id.

- `narraleaf_gallery__list {kind?, query?, voiceUnits?}` - the catalog with every id. Call it first.
  `voiceUnits: true` adds the recorded lines a voice entry can use.
- `narraleaf_gallery__add_entries {entries: [...], before?}` - new entries, variants included.
- `narraleaf_gallery__update_entries {entries: [{id, ...}]}` - rename, regroup, hide, set the cover,
  `addVariants`, `removeVariants`, edit `variants` by id, `moveBefore`.
- `narraleaf_gallery__remove_entries {ids}`
- `narraleaf_gallery__set_groups {groups: [{id?, name}]}` - the whole ordered list; left out = deleted.
- `narraleaf_gallery__set_settings {lockedImage?, lockedNameMask?}` - the locked look.

```json
{"entries": [
  {"kind": "cg", "name": "Rooftop at dusk", "group": "Chapter 1",
   "variants": [{"image": "cg_rooftop_a"}, {"image": "cg_rooftop_b", "name": "Smiling"}]},
  {"kind": "scene", "name": "The confession", "group": "Chapter 1",
   "scene": {"scene": "Confession"}, "variants": [{"image": "cg_rooftop_a"}]},
  {"kind": "music", "name": "Original soundtrack",
   "variants": [{"audio": "bgm_theme"}, {"audio": "bgm_rain"}]},
  {"kind": "voice", "name": "Aoi", "variants": [{"voiceUnit": "<unit id from list>"}]}
]}
```

A group name nobody has yet is created on the way.

## Unlocking a CG

Recollections, tracks and voice lines collect themselves. A CG does not - nothing tells the game a
picture counts as seen - so it needs an **Unlock Gallery** node (`narraleaf.gallery.add`, fields
`galleryItemId` = the entry id, `galleryVariantId` = one variant, or empty for all of them). A story
row cannot run a plugin node in the text format, so record the moment in the story and unlock from a
page:

1. One persistent variable per CG (or per route): `variable_upsert {name: "seen_cg_rooftop",
   valueType: "boolean", scope: "persistent", defaultValue: false}`.
2. In the scene, on the row after the CG appears: `/set seen_cg_rooftop true`.
3. On the **title page's** blueprint (the title opens at launch and after every playthrough, so the
   Extra page it leads to is already up to date), one layer per CG or one chain for all of them:

```
event "Collect seen CGs"
    open: blueprint.event.head.surfaceInit
    seen: blueprint.persistent.get
        persistentVariableId = <id from variables_list>
    check: if
    unlock: narraleaf.gallery.add
        galleryItemId = <entry id from narraleaf_gallery__list>

    open.then -> seen.in
    seen.next -> check.in
    seen.value -> check.condition
    check.true -> unlock.in
```

Check each node with `blueprint_node {type}` before writing it, and start from `blueprint_show` of
the title page's own blueprint - a `blueprint` block replaces every layer of its owner. Do not put the
unlock on the Extra page's own open event: it would race the graph that fills the lists.

For "clear the game, get everything", **Unlock Whole Gallery** (`narraleaf.gallery.unlockAll`) on an
ending page's open event.

## What a locked entry shows

The game never shows a locked entry's real content, whatever the page's graphs do: a locked row
carries the placeholder image (the entry's own `lockedImage`, else the catalog's), the name mask
(`???` by default; `""` shows real names) and no description, audio or line. A `hidden` entry is left
out of the list and out of the counts until it is unlocked - use it for secrets whose very existence
is a spoiler.

## Common mistakes

- **One entry per differential set**, not one per image: the variants of one CG go in one entry.
  The reverse for music: an album is one entry with many tracks; a single track is one entry with one.
- Every asset must exist first - `assets_import` (or `assets_placeholder`), then use its id or name.
- A `scene` entry needs `scene`; it unlocks itself, so it needs no Unlock Gallery node.
- Voice units exist only for lines that have recorded voice; with none, use `audio` with a loose clip.
- The Extra page needs no new blueprint to show the entries - only to unlock CGs.
- Check the result: `narraleaf_gallery__list`, then `ui_screenshot` of the Extra page, or play to the
  title and open it in a playtest.
