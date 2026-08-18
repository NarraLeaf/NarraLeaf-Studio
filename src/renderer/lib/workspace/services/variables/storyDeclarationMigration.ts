import { listSceneDeclarationBlocks } from "@shared/types/story/declarations";
import type { StoryDeclarationBlock, StoryDocument, StoryId } from "@shared/types/story/document";
import { listScenesInDocumentOrder } from "@shared/types/story/order";
import type {
  VariableRegistry,
  VariableRegistryEntry,
  VariableRegistryScope
} from "@shared/types/variables/registry";
import { normalizePersistentValueType } from "@shared/variables/variableRegistryModel";

/**
 * The one-shot pass that moves `saved` / `persistent` declaration ROWS out of story documents and
 * into the project variable registry.
 *
 * `/save` and `/global` are retired: the story document owns `scene` variables and nothing else. The
 * two project scopes have one authoring surface now (the registry), so a project written under the
 * old rules has to be converted before anything reads it - otherwise the same variable exists twice,
 * once as a row and once as an entry, and the two surfaces disagree about its default.
 *
 * ## Why the entry takes the ROW's id
 *
 * The conversion is lossless because it changes no key anywhere else in the project:
 *
 *  - a `StoryVariableRef` is `{ scope: "saved", variableId: <block id> }`;
 *  - a scene snapshot is keyed `saved:<block id>`;
 *  - a save file on a player's disk is keyed by `storageKey`, which `buildDeclaration` set to the
 *    block id when the row was created.
 *
 * So the entry is minted with `id = block.id` and `storageKey = block.payload.storageKey`, and every
 * one of those keeps resolving with no rewrite pass, no ref fixup, and no invalidated player save. A
 * fresh uuid here would silently orphan all three at once - and the save-file half of that is not
 * even recoverable by re-authoring, because the value is on someone else's machine.
 *
 * ## Why there is no "already migrated" flag
 *
 * The gate is observable state - "does this story still contain project-scoped declaration rows" -
 * and deliberately never a stored flag or a schema counter. On a FROZEN project `FileSystem.write`
 * answers `FROZEN_NO_OP` (`{ ok: true, data: undefined }`): the write is dropped and the caller is
 * told it succeeded, so a service marks itself clean believing it saved. A flag-gated migration
 * would therefore record itself as done having written nothing, and the rows would be stranded in a
 * document that no later run would ever look at again.
 *
 * Because entry ids are derived from block ids, a second run OVERWRITES rather than duplicates.
 * That is what makes a frozen project, a half-finished pass, or a failed write all simply re-converge
 * on the next open. Do not "simplify" this into a version flag - the flag is the bug.
 *
 * There is no cross-document transaction and none is wanted: the registry is written through its
 * ordinary `save()`, the story documents ride the ordinary dirty/autosave path, and nothing is pushed
 * onto the undo history (a migration is not undoable - an undo entry holding a pre-migration document
 * would put the rows back while the entries stayed, which is the duplicate state this pass exists to
 * remove).
 */

/** Enough of `StoryService` to run the pass; narrowed so a test needs no service graph. */
export type MigrationStoryHost = {
  listStories(): readonly { readonly id: StoryId }[];
  loadStory(storyId: StoryId): Promise<StoryDocument>;
  deleteDeclarationRow(storyId: StoryId, variableId: string): boolean;
};

/** Enough of `VariableRegistryService` to run the pass. */
export type MigrationRegistryHost = {
  getRegistry(): VariableRegistry;
  applyRegistryMutation(mutator: (registry: VariableRegistry) => void): void;
  save(registry: VariableRegistry): Promise<void>;
};

/**
 * The declaration rows in one document that no longer belong there, in document order.
 *
 * `scene` rows are skipped and stay exactly where they are - the story still owns them, and `/local`
 * is still a command.
 */
export function listProjectScopedDeclarations(document: StoryDocument): StoryDeclarationBlock[] {
  const rows: StoryDeclarationBlock[] = [];
  for (const scene of listScenesInDocumentOrder(document)) {
    for (const block of listSceneDeclarationBlocks(scene)) {
      if (block.payload.scope === "saved" || block.payload.scope === "persistent") {
        rows.push(block);
      }
    }
  }
  return rows;
}

/**
 * The registry entry a project-scoped declaration row becomes.
 *
 * `storageKey` falls back to the block id the way `defOf` does: Studio has always written them equal,
 * but a hand-edited document can be missing the field, and an entry with an empty storage key would
 * read and write the save file under `""`.
 */
export function registryEntryFromDeclarationRow(
  block: StoryDeclarationBlock
): VariableRegistryEntry | null {
  const scope = block.payload.scope;
  if (scope !== "saved" && scope !== "persistent") {
    return null;
  }
  return {
    id: block.id,
    name: block.payload.name,
    scope: scope satisfies VariableRegistryScope,
    valueType: normalizePersistentValueType(block.payload.valueType),
    // Conditional spreads, never `defaultValue: payload.defaultValue`. The canonical encoder
    // refuses a property holding `undefined` by name, so an assigning form would make every
    // row-without-a-default the thing that stops the registry saving.
    ...(block.payload.defaultValue !== undefined
      ? { defaultValue: block.payload.defaultValue }
      : {}),
    storageKey: block.payload.storageKey || block.id,
    ...(block.payload.description ? { description: block.payload.description } : {})
  };
}

/**
 * Run the pass. Returns how many rows were converted - `0` when there was nothing to do, which is
 * the steady state every open after the first reaches.
 *
 * The registry is written BEFORE the rows are deleted, and that order is the crash-safety argument:
 * if the write lands and the deletions do not, the next open finds the rows again and re-converges
 * onto identical entries. The other order would delete an author's variables and then fail to record
 * them anywhere.
 */
export async function migrateProjectScopedDeclarations(
  stories: MigrationStoryHost,
  registry: MigrationRegistryHost
): Promise<{ converted: number }> {
  const pending: { storyId: StoryId; entry: VariableRegistryEntry }[] = [];

  for (const story of stories.listStories()) {
    let document: StoryDocument;
    try {
      document = await stories.loadStory(story.id);
    } catch (error) {
      // One unreadable story does not stop the others being converted, and it is not recorded
      // as handled either: with no flag to lie to, it is simply retried on the next open.
      console.warn(
        `[variables] could not read story ${story.id} while migrating declarations`,
        error
      );
      continue;
    }
    for (const block of listProjectScopedDeclarations(document)) {
      const entry = registryEntryFromDeclarationRow(block);
      if (entry) {
        pending.push({ storyId: story.id, entry });
      }
    }
  }

  if (pending.length === 0) {
    return { converted: 0 };
  }

  registry.applyRegistryMutation((current) => {
    for (const { entry } of pending) {
      // Assignment, not insert-if-absent: a re-run must land on the row's current values, or a
      // partially-converted project would keep whatever a half-finished earlier pass wrote.
      current.entries[entry.id] = entry;
    }
  });
  // Throws when `editor/variables.json` is on disk but unreadable, which is exactly when the rows
  // must be left alone - they are then the only surviving copy of these variables.
  await registry.save(registry.getRegistry());

  for (const { storyId, entry } of pending) {
    stories.deleteDeclarationRow(storyId, entry.id);
  }

  return { converted: pending.length };
}
