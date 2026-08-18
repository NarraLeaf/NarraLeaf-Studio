/**
 * The "visited" record: which scenes the player has actually entered, and which choice options they
 * have actually picked.
 *
 * Two of the most ordinary things a VN asks for - a one-shot option ("you already said that") and a
 * route lock / recollection screen ("you have been down this path") - need exactly this and nothing
 * else, and Studio had no way to answer either.
 *
 * `game.isTextRead(textId)` cannot stand in for it. That record is written when a line is *displayed*
 * (it is the skip-read-text bookkeeping), so an option counts as "read" the moment its menu pops up,
 * whether or not the player chose it. The whole point of this record is the other timing: an option
 * is written when it is PICKED. The engine has no scene-level visited API at all, so the scene half
 * has no upstream either.
 *
 * ## Where it lives, and why
 *
 * In the NLR `Storable`, under its own reserved namespace, created through `Story.createPersistent`
 * exactly like the "saved" variable namespace next door in `storyCompiler.ts`. That is the saved
 * domain: the record travels inside the save file, so loading an older save rewinds `visited` along
 * with everything else. That is the semantics visited must have - a player who reloads to before a
 * choice has not made that choice yet.
 *
 * That rewind is not an assumption; it follows from what `LiveGame.deserialize` does, verified
 * against the shipped engine bundle (`narraleaf-react/dist/main.js`):
 *
 *   deserialize(savedGame) { ...; this.initNamespaces(); this._storable.load(store); ... }
 *   initNamespaces()       { this._storable.clear().addNamespace(game); this.story.initPersistent(this._storable); }
 *   Persistent.init(s)     { s.hasNamespace(this.namespace) || s.addNamespace(new Namespace(this.namespace, this.defaultContent)); }
 *
 * `clear()` drops every namespace, then each `Persistent` re-adds a FRESH `Namespace` built from its
 * construction-time `defaultContent` - which for this record is two empty arrays. Only then is the
 * save's own data merged in. So an id written during play but absent from the save being loaded is
 * gone after the load, and an id present in the save comes back. Note the sequence matters:
 * `Storable.load` alone merges rather than replaces (`Namespace.deserialize` writes keys into the
 * existing content without clearing it), so the rewind depends on the `initNamespaces()` that runs
 * first. Keep the defaults empty; seeding a default id here would make it un-rewindable.
 *
 * ## Why ids, not names
 *
 * A scene rename or an option rewrite must not invalidate a record, so both halves are keyed by the
 * Studio id (`scene.id` / the option row's `block.id`) - the same convention `StoryVariableRef` and
 * `StoryLayerRef` already follow, where the name exists only for display and repair.
 *
 * Comments in English per project convention.
 */

import { DevTools, Script } from "narraleaf-react";
import type { Persistent, ScriptCtx, Story } from "narraleaf-react";

/**
 * The live store, spelled as the script context's own field rather than by importing `Storable`:
 * the class is not re-exported from the package root, and this is the exact type both callers
 * already hold (`ScriptCtx.storable` inside the game, `LiveGame.getStorable()` on the host side).
 */
export type StoryVisitedStore = ScriptCtx["storable"];

/**
 * Reserved Storable namespace for the visited record.
 *
 * Named in the same shape as `storyCompiler.ts`'s `SAVED_PERSISTENT_NAMESPACE` (`__nlr_story_*__`),
 * and safe from collision by construction rather than by convention: an author never names a
 * namespace. Every "saved" variable an author declares lives as a KEY inside the one saved
 * namespace, and every "scene" variable lives under NLR's `local:` prefix, so no authored name can
 * ever reach this one.
 */
export const STORY_VISITED_NAMESPACE = "__nlr_story_visited__";

/** Key holding the visited scene ids (Studio `scene.id`). */
export const STORY_VISITED_SCENES_KEY = "scenes";

/** Key holding the picked choice-option ids (Studio `block.id` of the `choiceOption` row). */
export const STORY_VISITED_OPTIONS_KEY = "options";

/** The two collections, as they sit in the namespace. */
export type StoryVisitedContent = {
  [STORY_VISITED_SCENES_KEY]: string[];
  [STORY_VISITED_OPTIONS_KEY]: string[];
};

export type StoryVisitedKey = typeof STORY_VISITED_SCENES_KEY | typeof STORY_VISITED_OPTIONS_KEY;

/**
 * Create the record's `Persistent` on a compiled story.
 *
 * Both collections start empty - see the rewind argument in the module comment. Fresh arrays per
 * call rather than a shared module-level literal: `defaultContent` is what `Persistent.init` hands
 * to every rebuilt `Namespace`, so a shared array would be mutated by one compile and then re-used
 * as the "empty" default by the next.
 */
export function createStoryVisitedPersistent(story: Story): Persistent<StoryVisitedContent> {
  // The literal is annotated rather than inferred: bare `[]` infers `never[]`, which makes the
  // resulting `Persistent<{scenes: never[]}>` incompatible with the declared content type.
  const defaults: StoryVisitedContent = {
    [STORY_VISITED_SCENES_KEY]: [],
    [STORY_VISITED_OPTIONS_KEY]: []
  };
  return story.createPersistent(STORY_VISITED_NAMESPACE, defaults);
}

/** Read one collection off a live `Storable`, tolerating a namespace that is not there yet. */
export function readStoryVisitedIds(
  storable: StoryVisitedStore,
  namespaceName: string,
  key: StoryVisitedKey
): string[] {
  if (!namespaceName || !storable.hasNamespace(namespaceName)) {
    return [];
  }
  const value = storable.getNamespace(namespaceName).get(key);
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Membership test for one collection. An empty id is "not visited", never an error. */
export function isStoryVisited(
  storable: StoryVisitedStore,
  namespaceName: string,
  key: StoryVisitedKey,
  id: string
): boolean {
  if (!id) {
    return false;
  }
  return readStoryVisitedIds(storable, namespaceName, key).includes(id);
}

/**
 * The statement that writes one id into the record.
 *
 * A `Script` rather than `Persistent.set`, because this is a read-modify-write on a set: the
 * chainable `set` would need the current array, which only exists at runtime. Running it inside one
 * script also makes the append atomic with respect to the action queue.
 *
 * Re-entering an already-recorded scene (or re-picking an option after a rewind) writes nothing at
 * all, which matters beyond tidiness: `Storable` compares structurally before reporting a change, so
 * a no-op write wakes no subscriber and does not grow the save.
 *
 * The namespace is resolved through `DevTools.getNamespaceName` at *runtime* rather than
 * reconstructed from NLR's `persistent:` prefix convention - the same reasoning as
 * `resolveVariableSlot` in `storyCompiler.ts`: an accessor that disappears breaks the build, whereas
 * a hand-built prefix would silently desynchronize on an engine bump.
 */
export function markStoryVisitedStatement(
  visited: Persistent<StoryVisitedContent>,
  key: StoryVisitedKey,
  id: string
): unknown {
  const namespaceName = DevTools.getNamespaceName(visited);
  return Script.execute(({ storable }) => {
    const namespace = storable.getNamespace(namespaceName);
    const current = namespace.get(key);
    const ids = Array.isArray(current) ? (current as string[]) : [];
    if (ids.includes(id)) {
      return;
    }
    // A new array, not a push: `Namespace.set` compares the value it is given against the one it
    // holds, and mutating the stored array in place would make both sides the same object.
    namespace.set(key, [...ids, id]);
  });
}
