import type {
  StoryBlock,
  StoryDeclarationBlock,
  StoryDocument,
  StoryLiteralValue,
  StoryScene,
  StorySceneVariableDefinition,
  StorySavedVariableDefinition,
  StoryVariableValueType
} from "./document";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "./order";

/**
 * The derived variable tables (schema v6): declaration ROWS are the source of truth, and these
 * scans are how everything that used to read the persisted registries sees them now.
 *
 * The projection shape is the old definition record - `{ id, name, valueType, defaultValue,
 * storageKey }` keyed by id - so consumers did not have to change what they hold, only where it
 * comes from. `id` is the declaration block's id, which the migration made take over the old
 * `variableId`, so every stored `StoryVariableRef` resolves unchanged.
 *
 * Declarations bind scene-wide (hoisted): a declaration nested inside a branch still declares - it
 * is authoring metadata, not a runtime action - which keeps "where may I put this row" a
 * non-question. Scope decides the scan's reach: "scene" within its scene, "saved"/"persistent"
 * across the whole document.
 *
 * A `disabled` declaration row is deliberately NOT skipped here (unlike the compiler, which compiles
 * disabled rows out of the runtime). A declaration is a lexical entry, not an executed statement:
 * dropping it from the table would make every reference to that variable elsewhere in the document
 * resolve to "undeclared", cascading errors through lines the author never touched. So a disabled
 * declaration still declares and still seeds its default (the seeding at `storyCompiler` reads this
 * same table); disabling it only greys the row, it does not un-declare the variable. This is an
 * intentional exception to "disabled = compiled out" - do not add a `.disabled` guard to these scans.
 */

export function isStoryDeclarationBlock(block: StoryBlock): block is StoryDeclarationBlock {
  return block.kind === "declaration";
}

/**
 * A declaration as prose — `gold: number = 100`, or `gold: number` when it declares no default.
 *
 * NOT what the story editor's row shows: a declaration row reads back as the `/local gold 100
 * type=number` line that wrote it, like every other row (`storyCommandLine.ts`). This is the reading
 * for the surfaces that have no command vocabulary to spell a line with — the Dev Mode timeline and
 * the scene flow map, which describe blocks rather than echo them. The scope is deliberately absent:
 * those surfaces carry it on the row's badge.
 */
export function describeDeclaration(block: StoryDeclarationBlock): string {
  return block.payload.defaultValue !== undefined
    ? `${block.payload.name}: ${block.payload.valueType} = ${JSON.stringify(block.payload.defaultValue)}`
    : `${block.payload.name}: ${block.payload.valueType}`;
}

/**
 * The zero value a RETYPE resets a declaration's default to — what `type=string` on a variable that
 * held `7` leaves behind.
 *
 * One copy for every surface that offers the type as a choice: the inspector's dropdown, the Story
 * Variables panel, and the `type=` token on the row's own command line. They were three, and three
 * answers to "what does a retype leave in the default" is a disagreement the author sees as a value
 * that changes depending on where they changed the type from.
 *
 * Distinct from `/reset`'s zero (`defaultForType` in the command spec, which answers `null` for json):
 * that one assigns a RUNTIME value, where "no value" is the honest answer, while a declaration's
 * default is a literal an author will edit — and an empty object is something to edit, `null` is not.
 */
export function declarationDefaultForType(valueType: StoryVariableValueType): StoryLiteralValue {
  if (valueType === "boolean") return false;
  if (valueType === "number") return 0;
  if (valueType === "json") return {};
  return "";
}

function defOf(block: StoryDeclarationBlock): StorySceneVariableDefinition {
  return {
    id: block.id,
    name: block.payload.name,
    valueType: block.payload.valueType,
    defaultValue: block.payload.defaultValue,
    storageKey: block.payload.storageKey || block.id
  };
}

/**
 * Every declaration row in a scene, in document order - the order the rows sit in the scene, which
 * is the order the variable table and the snapshot panel list them in.
 *
 * The walk is over the block tree, not `Object.values(scene.blocks)`. The record is a lookup table
 * that grows by append: `/local` inserts its row at the TOP of the scene but stores it at the END of
 * the record, so reading the record listed variables in roughly reverse declaration order.
 *
 * The tail is for a row the tree has lost - one whose parent exists but does not list it among its
 * children, which no Studio operation produces but a damaged file can carry. Dropping it would
 * un-declare its variable, and every reference to that variable elsewhere would resolve to
 * "undeclared", cascading errors through lines the author never touched. Ending up last in the
 * table is a far smaller wrong than disappearing from it.
 */
export function listSceneDeclarationBlocks(scene: StoryScene): StoryDeclarationBlock[] {
  const reached = listSceneBlocksInDocumentOrder(scene);
  const rows = reached.filter(isStoryDeclarationBlock);
  if (reached.length === Object.keys(scene.blocks).length) {
    return rows;
  }
  const reachedIds = new Set(reached.map((block) => block.id));
  for (const block of Object.values(scene.blocks)) {
    if (!reachedIds.has(block.id) && isStoryDeclarationBlock(block)) {
      rows.push(block);
    }
  }
  return rows;
}

/** The scene-scope variable table of one scene - what `StoryScene.sceneVariables` used to persist. */
export function sceneVariableDefs(scene: StoryScene): Record<string, StorySceneVariableDefinition> {
  const defs: Record<string, StorySceneVariableDefinition> = {};
  for (const block of listSceneDeclarationBlocks(scene)) {
    if (block.payload.scope === "scene") {
      defs[block.id] = defOf(block);
    }
  }
  return defs;
}

/** The saved (per-save-file) variable table of a document - what `StoryDocument.savedVariables` used to persist. */
export function savedVariableDefs(
  document: StoryDocument
): Record<string, StorySavedVariableDefinition> {
  return documentWideDefs(document, "saved");
}

/**
 * The persistent variables THIS STORY declares as rows. The full persistent table an editor offers
 * is these merged with the blueprint-declared ones - the merge happens where the blueprint document
 * is in reach (the command context), not here.
 */
export function storyPersistentDefs(
  document: StoryDocument
): Record<string, StorySavedVariableDefinition> {
  return documentWideDefs(document, "persistent");
}

function documentWideDefs(
  document: StoryDocument,
  scope: "saved" | "persistent"
): Record<string, StorySavedVariableDefinition> {
  const defs: Record<string, StorySavedVariableDefinition> = {};
  for (const scene of listScenesInDocumentOrder(document)) {
    for (const block of listSceneDeclarationBlocks(scene)) {
      if (block.payload.scope === scope) {
        defs[block.id] = defOf(block);
      }
    }
  }
  return defs;
}

/** The declaration row backing a variable id, or null - how an editor jumps from a ref to its row. */
export function findDeclarationBlock(
  document: StoryDocument,
  variableId: string
): { sceneId: string; block: StoryDeclarationBlock } | null {
  // Document order, not key order: if a damaged document held the same block id in two scenes, the
  // one an author would call "the" row is the earlier one, and it must not change per save.
  for (const scene of listScenesInDocumentOrder(document)) {
    const sceneId = scene.id;
    const block = scene.blocks[variableId];
    if (block && isStoryDeclarationBlock(block)) {
      return { sceneId, block };
    }
  }
  return null;
}
