import type {
    StoryBlock,
    StoryDeclarationBlock,
    StoryDocument,
    StoryScene,
    StorySceneVariableDefinition,
    StorySavedVariableDefinition,
} from "./document";

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
 * The row text a declaration reads as — `gold: number = 100`, or `gold: number` when it declares no
 * default. The scope (Local / Var / Global) is deliberately absent: it rides the row's badge, and the
 * one caller that wants it inline (the commit confirmation, bible §3.5) prepends the localized scope
 * word itself. Kept here, next to the projection, so the row label and the confirmation never drift.
 */
export function describeDeclaration(block: StoryDeclarationBlock): string {
    return block.payload.defaultValue !== undefined
        ? `${block.payload.name}: ${block.payload.valueType} = ${JSON.stringify(block.payload.defaultValue)}`
        : `${block.payload.name}: ${block.payload.valueType}`;
}

function defOf(block: StoryDeclarationBlock): StorySceneVariableDefinition {
    return {
        id: block.id,
        name: block.payload.name,
        valueType: block.payload.valueType,
        defaultValue: block.payload.defaultValue,
        storageKey: block.payload.storageKey || block.id,
    };
}

/** Every declaration row in a scene, in document order. */
export function listSceneDeclarationBlocks(scene: StoryScene): StoryDeclarationBlock[] {
    return Object.values(scene.blocks).filter(isStoryDeclarationBlock);
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
export function savedVariableDefs(document: StoryDocument): Record<string, StorySavedVariableDefinition> {
    return documentWideDefs(document, "saved");
}

/**
 * The persistent variables THIS STORY declares as rows. The full persistent table an editor offers
 * is these merged with the blueprint-declared ones - the merge happens where the blueprint document
 * is in reach (the command context), not here.
 */
export function storyPersistentDefs(document: StoryDocument): Record<string, StorySavedVariableDefinition> {
    return documentWideDefs(document, "persistent");
}

function documentWideDefs(document: StoryDocument, scope: "saved" | "persistent"): Record<string, StorySavedVariableDefinition> {
    const defs: Record<string, StorySavedVariableDefinition> = {};
    for (const scene of Object.values(document.scenes)) {
        for (const block of listSceneDeclarationBlocks(scene)) {
            if (block.payload.scope === scope) {
                defs[block.id] = defOf(block);
            }
        }
    }
    return defs;
}

/** The declaration row backing a variable id, or null - how an editor jumps from a ref to its row. */
export function findDeclarationBlock(document: StoryDocument, variableId: string): { sceneId: string; block: StoryDeclarationBlock } | null {
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const block = scene.blocks[variableId];
        if (block && isStoryDeclarationBlock(block)) {
            return { sceneId, block };
        }
    }
    return null;
}
