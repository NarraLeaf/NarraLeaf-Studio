import type { AssetTransferEntry } from "@shared/types/assetTransfer";
import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { listBlockAssetSites } from "@/lib/workspace/services/references/referenceModel";
import type { SerializedStoryBlock, StoryClipboardPayload } from "./storySceneEditorTypes";

/**
 * Story rows pasted into a project other than the one they were copied from.
 *
 * Studio opens one project per window and the rows travel on the *system* clipboard, so a payload
 * copied in one window can be pasted into any other - and every id inside it (characters, assets,
 * scenes, blueprints, variables) is a UUID minted by the project that wrote it. What that means
 * here is decided per kind, and the shape of the decision is the same each time: an id that would
 * have resolved is never touched, and an id that does not resolve is left where the author can see
 * it reported rather than quietly emptied.
 *
 *  - **Characters resolve first.** Every project created from one template ships the same character
 *    ids, so two projects genuinely share identities; degrading a reference that would have
 *    resolved throws away a correct binding. Only what does not resolve is treated.
 *  - **A dialogue row degrades to a bare name.** NarraLeaf's dialogue box displays whatever name
 *    its `Character` carries, so a line with a `speakerName` and no `characterId` is a first-class
 *    shippable state, not a broken row - and it is exactly the state the speaker-rebind gesture
 *    repairs, so the author can bind it to one of this project's characters in one move.
 *  - **A character stage row keeps its id.** It has no bare-name arm to fall back to, and
 *    `story/character-missing` reports it as an error with a jump to the row. Degrading it would
 *    trade a loud, clickable report for a silently empty stage.
 *  - **Every other id is kept verbatim**, for the same reason: `assets/missing`,
 *    `story/jump-missing` and `blueprint/reference-missing` already report each site and refuse a
 *    build. That reporting is the feature.
 *
 * Assets are the one kind that can be *made* to resolve, because their bytes still exist in the
 * source project and the main process can vouch for a window's right to read them - see
 * {@link importTransferredAssets}.
 */

/**
 * Whether the payload came from a different project than the one pasting it.
 *
 * The project path is the identity, compared through `normalizeProjectPath` - the one key every
 * project-path comparison in Studio agrees on, and the only thing that tells two spellings of one
 * directory from two directories. The identifier deliberately takes no part: two projects can carry
 * the same one.
 *
 * A payload with no `source` was written by a Studio from before the field existed, which can only
 * have happened on this machine, and is read as same-project - the behaviour it was copied under.
 */
export function isStoryPasteFromAnotherProject(payload: StoryClipboardPayload, projectPath: string): boolean {
    const source = payload.source?.path;
    if (typeof source !== "string" || !source.trim() || !projectPath.trim()) {
        return false;
    }
    return normalizeProjectPath(source) !== normalizeProjectPath(projectPath);
}

/** What treating a foreign payload's character references did to it. */
export type ForeignCharacterTreatment = {
    roots: SerializedStoryBlock[];
    /** Dialogue rows now speaking as a bare name. */
    degradedSpeakers: number;
    /** Rows left holding a character id this project has nothing for. */
    unresolvedCharacterRows: number;
};

export type ForeignCharacterOptions = {
    /** The pasting project's cast, as a membership test. */
    knownCharacterIds: ReadonlySet<string>;
    /**
     * `characterId` → display name, as the copying project knew them.
     *
     * Read only in the direction id → name. A name never finds a character: it is neither total nor
     * injective over a cast, and binding a line to whoever happens to share a name would hand it to
     * a stranger. Turning a name back into an identity is an author's gesture, never a paste's.
     */
    characterNames: Readonly<Record<string, string>>;
};

/**
 * Apply the character rules to a payload's rows, leaving everything else exactly as copied.
 *
 * Returns new nodes rather than rewriting the ones it was given, so the decision can be tested
 * against a payload and so a caller may compare the two.
 */
export function treatForeignCharacterRefs(
    roots: readonly SerializedStoryBlock[],
    options: ForeignCharacterOptions,
): ForeignCharacterTreatment {
    let degradedSpeakers = 0;
    let unresolvedCharacterRows = 0;

    const treat = (node: SerializedStoryBlock): SerializedStoryBlock => {
        const children = node.children.map(treat);
        const block = node.block;
        const treatment = treatRow(block, options);
        if (treatment.kind === "speakerName" && block.kind === "nodeAction" && block.payload.action === "dialogue") {
            degradedSpeakers += 1;
            // The id is dropped rather than kept beside the name, because that is the shape the rest
            // of Studio reads as "a speaker waiting for a character": `collectUnresolvedSpeakerRows`
            // counts it, the row's context menu offers to bind it, and deleting a character leaves
            // exactly the same thing behind.
            const { characterId: _dropped, ...rest } = block.payload;
            return { block: { ...block, payload: { ...rest, speakerName: treatment.name } }, children };
        }
        if (treatment.kind === "unresolved") {
            unresolvedCharacterRows += 1;
        }
        return { block, children };
    };

    return { roots: roots.map(treat), degradedSpeakers, unresolvedCharacterRows };
}

/**
 * The character ids the rows name, in the order they are met.
 *
 * The two fields that hold one on a row: a dialogue row's speaker and a character stage row's
 * subject. The third site a character id can occupy - an inline reveal-time expression token - is
 * not collected: it lives inside a text segment's rich runs, it has no bare-name arm to degrade to,
 * and `story/character-missing` already reports one that resolves to nothing.
 */
export function collectStoryCharacterIds(blocks: Iterable<StoryBlock>): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
        const id = rowCharacterId(block);
        if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

/**
 * The asset ids the rows name, in the order they are met.
 *
 * Which fields those are is {@link listBlockAssetSites}' answer rather than a second list here, so
 * a row that starts naming a new asset travels with it without anyone remembering to say so twice.
 */
export function collectStoryAssetIds(blocks: Iterable<StoryBlock>): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
        for (const site of listBlockAssetSites(block)) {
            const id = typeof site.assetId === "string" ? site.assetId.trim() : "";
            if (id && !seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
        }
    }
    return ids;
}

/**
 * The fields naming an asset this project does not have.
 *
 * Counted per field rather than per id, because that is what a report of them is: `assets/missing`
 * names each site separately and carries a jump to it, so two rows naming one missing file are two
 * things for the author to look at.
 */
export function countUnresolvedAssetSites(blocks: Iterable<StoryBlock>, resolves: (assetId: string) => boolean): number {
    let unresolved = 0;
    for (const block of blocks) {
        for (const site of listBlockAssetSites(block)) {
            const id = typeof site.assetId === "string" ? site.assetId.trim() : "";
            if (id && !resolves(id)) {
                unresolved += 1;
            }
        }
    }
    return unresolved;
}

/** Every block in a clipboard payload's subtrees, each root before its children. */
export function listSerializedBlocks(roots: readonly SerializedStoryBlock[]): StoryBlock[] {
    const blocks: StoryBlock[] = [];
    const walk = (nodes: readonly SerializedStoryBlock[]): void => {
        for (const node of nodes) {
            blocks.push(node.block);
            walk(node.children);
        }
    };
    walk(roots);
    return blocks;
}

/**
 * Every block in the named subtrees of a scene, each root before its children.
 *
 * What a copy is *about*: the rows the author marked plus everything nested inside them, which is
 * the same set the clipboard payload serializes. A missing id is skipped rather than thrown over -
 * a selection can outlive the row it names.
 */
export function collectSubtreeBlocks(scene: StoryScene, rootIds: readonly StoryBlockId[]): StoryBlock[] {
    const blocks: StoryBlock[] = [];
    const walk = (blockId: StoryBlockId): void => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        blocks.push(block);
        for (const childId of block.childrenIds) {
            walk(childId);
        }
    };
    for (const rootId of rootIds) {
        walk(rootId);
    }
    return blocks;
}

/**
 * What {@link importTransferredAssets} needs of the workspace around it.
 *
 * Stated as functions rather than taken as services so the import order - redeem, skip what is
 * already here, read, create, and stop the moment the workspace freezes - can be exercised without
 * a project behind it.
 */
export interface TransferredAssetPort {
    /** Trade the clipboard's token for the files it stands for, or null when it stands for none. */
    redeem(token: string): Promise<AssetTransferEntry[] | null>;
    /** Whether this project's library already holds that id, under any type. */
    has(assetId: string): boolean;
    /** The bytes at a path the redeem granted read access to, or null when they cannot be read. */
    read(sourcePath: string): Promise<Uint8Array | null>;
    /**
     * File the bytes under the id they had in the source project.
     *
     * `"present"` answers an id the library turned out to be holding after all, which is the same
     * outcome as {@link has} and not a failure: the reference already resolves.
     */
    create(entry: AssetTransferEntry, bytes: Uint8Array): Promise<"created" | "present" | "failed">;
    /** Whether this window's project data has frozen. Asked again after every await. */
    isFrozen(): boolean;
}

/**
 * The clipboard's half of an asset transfer: a token, and the ids the copy said it stands for.
 *
 * Only the ids are read. What each file is called and where it lives are answered by the main
 * process at redeem time, against the window that offered them - nothing written on a clipboard
 * addresses a file.
 */
export type TransferredAssetGrant = {
    token: string;
    declaredAssetIds: readonly string[];
};

export type TransferredAssetImport = {
    /** Files that were not in this project and now are. */
    imported: number;
    /** Files that could not be brought over. One of these costs the author nothing but that file. */
    failed: number;
    /**
     * The workspace froze part-way through.
     *
     * The caller must abandon the paste rather than finish it: rows written into a frozen
     * workspace reach the in-memory scene, are refused at the file-system boundary and are gone
     * again when the thaw re-reads the document.
     */
    frozen: boolean;
};

/**
 * Bring the files a foreign payload references into this project, under the ids they already have.
 *
 * Importing under the source's own id is what lets the rows be pasted verbatim: every reference in
 * them keeps naming the file it named, so nothing has to be rewritten inside payload shapes that
 * are open-ended by design.
 *
 * An unavailable manifest is an ordinary outcome, not an error - the copying window has closed, or
 * the copy came from another Studio process whose grants this one cannot see. The rows still paste;
 * their asset references stay foreign and `assets/missing` reports each one.
 */
export async function importTransferredAssets(
    port: TransferredAssetPort,
    grant: TransferredAssetGrant | undefined,
    wantedAssetIds: readonly string[],
): Promise<TransferredAssetImport> {
    const result: TransferredAssetImport = { imported: 0, failed: 0, frozen: false };
    // What the copy declared, intersected with what the rows actually name and what this project is
    // missing. A token answers with the whole manifest it was minted for, and a paste takes out of
    // that only the files its own rows point at - never simply whatever the grant reaches.
    const declared = new Set(grant?.declaredAssetIds ?? []);
    const wanted = new Set(wantedAssetIds.filter(id => declared.has(id) && !port.has(id)));
    if (!grant?.token || wanted.size === 0) {
        return result;
    }

    const granted = await port.redeem(grant.token);
    if (port.isFrozen()) {
        return { ...result, frozen: true };
    }
    if (!granted) {
        return result;
    }

    for (const entry of granted) {
        if (!wanted.has(entry.assetId)) {
            continue;
        }
        const bytes = await port.read(entry.sourcePath);
        if (port.isFrozen()) {
            return { ...result, frozen: true };
        }
        if (!bytes) {
            result.failed += 1;
            continue;
        }
        const outcome = await port.create(entry, bytes);
        if (port.isFrozen()) {
            return { ...result, frozen: true };
        }
        if (outcome === "created") {
            result.imported += 1;
        } else if (outcome === "failed") {
            result.failed += 1;
        }
    }
    return result;
}

/** The character id a row is about, or null when it names none. */
function rowCharacterId(block: StoryBlock): string | null {
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        return block.payload.characterId?.trim() || null;
    }
    if (block.kind === "action" && block.payload.action === "character") {
        return block.payload.characterId?.trim() || null;
    }
    return null;
}

/** What this project can make of one row's character reference. */
type RowTreatment =
    | { kind: "keep" }
    | { kind: "speakerName"; name: string }
    | { kind: "unresolved" };

function treatRow(block: StoryBlock, options: ForeignCharacterOptions): RowTreatment {
    const id = rowCharacterId(block);
    if (!id || options.knownCharacterIds.has(id)) {
        return { kind: "keep" };
    }
    const isDialogue = block.kind === "nodeAction" && block.payload.action === "dialogue";
    const name = options.characterNames[id]?.trim();
    // A row whose name the copying project could not supply either - its character was already gone
    // there - is left as it is rather than given an invented one.
    return isDialogue && name ? { kind: "speakerName", name } : { kind: "unresolved" };
}


