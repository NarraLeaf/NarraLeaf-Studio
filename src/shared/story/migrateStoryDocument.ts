/**
 * The story document's schema ladder, and the floor below which a document is refused.
 *
 * **It lives in `@shared` because the main process migrates too.** The Dev Mode and build pipelines
 * read `storydoc.json` straight off disk and hand it to the story compiler, which runs inside the
 * shipped game - so a document that reaches them at an older version is compiled at that version,
 * and whatever the current compiler cannot read is simply absent from what plays.
 *
 * ## Why the ladder is one rung long
 *
 * It used to run from v1, eleven steps, and that was a debt from a product with no releases: every
 * step existed for documents only this repository had ever produced. They are gone. What is left is
 * a **floor** - {@link STORY_DOCUMENT_MIN_SUPPORTED_VERSION} - and the steps from it to the current
 * version, which today is the single step below.
 *
 * A document under the floor is refused by name rather than migrated. That is the honest outcome:
 * the alternative is to keep carrying converters for shapes nothing has written for months, and
 * the cost of keeping them is not the lines - it is that every later change to the block model has
 * to stay expressible in terms of shapes that predate it.
 *
 * The floor moves with the ladder. When a new step lands, the old one stays until the next release
 * decides it can go; when a step is dropped, the floor rises to the version the oldest surviving
 * step reads. Never raise it past a version the shipped template is written at - the skeleton is
 * committed as JSON and does not migrate itself, so the floor and the template move together.
 *
 * Re-exported from `services/story/storyModel`, which is the path the renderer's services and their
 * tests have always imported it from. Same move `characterStoreModel` made, for the same reason.
 */

import {
    listSceneBlocksInDocumentOrder,
    normalizeStageObjectName,
    STORY_DOCUMENT_SCHEMA_VERSION,
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { formatStorySecondsValue } from "@shared/utils/storyTime";

/**
 * How a migration writes a command line into a note: the words of the author's command language.
 *
 * Each method takes the canonical (English) word and returns the word the story editor would print
 * for it - the same tables a committed row is printed from, so a note reads like the rows around
 * it. The command language belongs to the renderer (`commandI18nStore`), so a caller there passes
 * one; everything else - Dev Mode and builds reading a document off disk, the command line, the
 * document spec - migrates with {@link CANONICAL_STORY_COMMAND_SPELLING}, which writes the
 * canonical words. A note is text and is never parsed back, so the two never have to agree.
 */
export type StoryCommandSpelling = {
    /** The verb of the command `commandId`, for a line written as `/token`. */
    command(commandId: string, token: string): string;
    /** The key one of the command's params is written with (`name`, `out`, `d`). */
    param(commandId: string, param: string): string;
    /** The word for one value of one of the command's enum params (`fade`). */
    enumValue(commandId: string, param: string, value: string): string;
    /** The word a number in this unit is suffixed with (`s`). */
    unit(unit: string): string;
};

export const CANONICAL_STORY_COMMAND_SPELLING: StoryCommandSpelling = {
    command: (_commandId, token) => token,
    param: (_commandId, param) => param,
    enumValue: (_commandId, _param, value) => value,
    unit: unit => unit,
};

export type StoryMigrationOptions = {
    /** The words a note quoting a row is written in; canonical when omitted. */
    commandSpelling?: StoryCommandSpelling;
};

/**
 * The oldest document version this build can read.
 *
 * v21 rather than v22 because v21→v22 is the one surviving step: a v21 document has a shape that is
 * genuinely converted below, and a v22 one needs only the stamp. Anything older is refused - see the
 * module comment for why that is a floor and not a gap.
 */
export const STORY_DOCUMENT_MIN_SUPPORTED_VERSION = 21;

/**
 * The refusal a document below the floor gets, as a value rather than only as a sentence.
 *
 * The message already names both versions, because "could not be read" cannot tell an author a
 * damaged file from a project older than this build. That only helps where the message survives,
 * and it does not: every reader between here and a surface rewraps or replaces it, and what an
 * author was left with was their story's name and nothing about versions at all - which reads as a
 * fault in their own script. The two numbers are carried as fields so a surface can say what
 * happened in its own words, in the author's own language.
 */
export class StoryDocumentTooOldError extends Error {
    constructor(
        /** The version the document on disk is written at. */
        public readonly version: number,
        /** The oldest version this build opens - {@link STORY_DOCUMENT_MIN_SUPPORTED_VERSION}. */
        public readonly minimumVersion: number,
    ) {
        super(
            `Story document schema v${version} is older than this Studio version can read`
            + ` (v${minimumVersion} is the oldest supported)`,
        );
        this.name = "StoryDocumentTooOldError";
    }
}

/**
 * The refusal a document from a newer Studio gets - the other end of the ladder, and the worse one
 * to get wrong.
 *
 * A document ahead of this build cannot be migrated *down*. Read as though it were current, every
 * field this Studio has not heard of would be dropped by the normalize pass and written back by
 * the next save, so one visit from an older Studio would silently strip the newer one's work. The
 * ladder used to hand such a document through untouched, which is exactly that outcome; refusing
 * costs the author one sentence, and the sentence carries both versions as fields for the same
 * reason the too-old one does - every reader between here and a surface rewraps the message.
 *
 * The workspace treats it as it treats a file that will not parse: the document is never loaded,
 * so nothing is written to it, and the author is offered recovery mode.
 */
export class StoryDocumentTooNewError extends Error {
    constructor(
        /** The version the document on disk is written at. */
        public readonly version: number,
        /** The newest version this build reads - {@link STORY_DOCUMENT_SCHEMA_VERSION}. */
        public readonly supportedVersion: number,
    ) {
        super(
            `Story document schema v${version} is newer than this Studio version can read`
            + ` (v${supportedVersion} is the newest supported)`,
        );
        this.name = "StoryDocumentTooNewError";
    }
}

/**
 * The {@link StoryDocumentTooOldError} behind a failure, however many times it has been rewrapped.
 *
 * `loadStory` re-throws as a `RendererError` carrying the original as its `cause`, and a caller two
 * services away should not have to know how many wrappers are between it and the ladder.
 */
export function findStoryDocumentTooOldError(error: unknown): StoryDocumentTooOldError | null {
    return findInCauseChain(error, candidate => candidate instanceof StoryDocumentTooOldError);
}

/** The {@link StoryDocumentTooNewError} behind a failure; see {@link findStoryDocumentTooOldError}. */
export function findStoryDocumentTooNewError(error: unknown): StoryDocumentTooNewError | null {
    return findInCauseChain(error, candidate => candidate instanceof StoryDocumentTooNewError);
}

function findInCauseChain<T>(error: unknown, matches: (candidate: unknown) => candidate is T): T | null {
    const seen = new Set<unknown>();
    let current = error;
    while (current && typeof current === "object" && !seen.has(current)) {
        if (matches(current)) {
            return current;
        }
        seen.add(current);
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}

export function migrateStoryDocumentToLatest(document: StoryDocument, options: StoryMigrationOptions = {}): StoryDocument {
    const version = typeof document.schemaVersion === "number" ? document.schemaVersion : 1;
    // Strictly newer is refused, never passed through: "at least current" used to be the test here,
    // and it let a document from a future Studio reach the compiler and the normalize pass as if it
    // were current - which is the one way the ladder can lose an author's work rather than refuse
    // to read it.
    if (version > STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new StoryDocumentTooNewError(version, STORY_DOCUMENT_SCHEMA_VERSION);
    }
    if (version === STORY_DOCUMENT_SCHEMA_VERSION) {
        return document;
    }
    if (version < STORY_DOCUMENT_MIN_SUPPORTED_VERSION) {
        throw new StoryDocumentTooOldError(version, STORY_DOCUMENT_MIN_SUPPORTED_VERSION);
    }
    let migrated = document;
    if (version < 22) {
        migrated = migrateStoryDocumentV21toV22(migrated);
    }
    if (version < 27) {
        migrated = migrateStoryDocumentV26toV27(migrated, options.commandSpelling ?? CANONICAL_STORY_COMMAND_SPELLING);
    }
    // The stamp is unconditional, and has to be. Most bumps are additive - a document at the
    // version below is already valid at the new one, because it cannot contain a field that did not
    // exist to be written - so they get no step, and this line is their entire migration. v23 (a
    // jump learned to come back) is one such. When the ladder tried to stamp inside each step
    // instead, adding a bump without a step left those documents falling through untouched and then
    // failing `assertSupportedStoryDocument`, while the tests for the steps kept passing.
    return { ...migrated, schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION };
}

/**
 * v21→v22: a transition's hold becomes a length of time, and `maskWipe` retires into `softWipe`.
 *
 * The hold was `props.hold`, a percentage of the duration, on `throughColor` and `exposure`. It is
 * converted against the row's own duration - the same duration the compiler was handing the engine -
 * so the number a row ends up with is the share it was set to, spelled in the unit that can hold it.
 *
 * The seconds the row was *getting* were shorter than that share, because the engine spent the hold
 * as a band of eased progress and every eased curve crosses the middle at its fastest (a nominal 30%
 * played as 17.8% of the wall clock). The migration deliberately carries over the **stated** share,
 * not the measured one: the author set 30% meaning something like a third of the run, the engine is
 * what was wrong, and rewriting their number down to match the old defect would preserve the bug in
 * the document.
 *
 * A row that never stated a hold gets no `holdMs`, which is how it keeps the transition's own default
 * (30% of the duration for `throughColor`) rather than being pinned to whatever its duration is today.
 *
 * `maskWipe` is the second half. It compiles to `Reveal` + `Mask.wipe(feather 0)`, which is exactly
 * what `softWipe` with `feather: 0` compiles to, so the rewrite is behaviour-identical. It has to
 * happen because no `t=` word ever named `maskWipe`: the command line printed the raw kind, and
 * `maskwipe` is an alias of `wipe`, so re-reading the row it had just printed turned a hard edge into
 * a feathered one. Nothing writes `maskWipe` any more; the kind stays in the union because
 * `isPlayableStoryTransitionKind` answers about strings off disk.
 */
function migrateStoryDocumentV21toV22(document: StoryDocument): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
        const blocks: Record<StoryBlockId, StoryBlock> = {};
        for (const [blockId, block] of Object.entries(scene.blocks ?? {})) {
            blocks[blockId] = migrateTransitionBlock(block);
        }
        scenes[sceneId] = { ...scene, blocks };
    }
    return { ...document, scenes };
}

/**
 * v26→v27: `play` becomes the only row that puts a clip on the stage, and every play carries its file.
 *
 * Read per scene, in document order, because that is the span a clip's name lives in and the order
 * the old rows took effect in:
 *
 *  - A clip's `create` and `show` rows fold into the next `play` of the same clip that follows them:
 *    that play takes the clip's file, name and mute flag, and the folded rows go. What the scene shows
 *    is unchanged in substance - the clip appears and runs on the play row - minus the stretch where
 *    it stood revealed and still, which no row can say any more.
 *  - A `play` that only named a clip takes that clip's file, so it defines the clip as every play now
 *    does. It no longer keeps its clip on the stage after the end unless it said so; that hold was
 *    never what anyone wanted (the last frame stayed over every later scene), so it is not written in.
 *  - What can no longer be said becomes a note quoting the line: a clip declared or shown and never
 *    played afterwards, a play of a clip nothing gave a file, and a row addressing a clip that no play
 *    in the scene defines - or that it reaches before the clip's first play, when there is no clip yet.
 *    The note keeps the row's place, so nothing disappears from the scene without a trace.
 *
 * "The clip" is the old runtime reading of a name at a row: the first row at or above it that built
 * one with a file (`create`, or a `show` or `play` naming one), which is the clip the compiler's
 * get-or-create handed every later row. Every play is given that clip's file, so it plays after the
 * step what it played before - a play that named a different file of its own was playing the first
 * clip all along, and a play above every declaration of its clip played nothing and becomes a note.
 * A disabled row never built anything, so it declares nothing here either; a disabled `create` or
 * `show` becomes a disabled note.
 *
 * The rows that address a clip afterwards are pointed at the play that now defines it, because the row
 * their reference was bound to may be one of the rows that went.
 */
function migrateStoryDocumentV26toV27(document: StoryDocument, spelling: StoryCommandSpelling): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
        scenes[sceneId] = migrateSceneClips(scene, spelling);
    }
    return { ...document, scenes };
}

/** A v26 video row, read loosely: `create` and `show` are operations the v27 type no longer has. */
type LegacyVideoPayload = {
    action: "video";
    operation: string;
    objectName?: string;
    target?: { name?: string; label?: string; sourceBlockId?: string; builtin?: string };
    assetId?: string;
    muted?: boolean;
    timeMs?: number;
    durationMs?: number;
    [key: string]: unknown;
};

function legacyVideoPayload(block: StoryBlock | undefined): LegacyVideoPayload | null {
    if (!block || block.kind !== "action") {
        return null;
    }
    const payload = block.payload as unknown as LegacyVideoPayload;
    return payload.action === "video" ? payload : null;
}

/** The registry key a clip name had - the rule `normalizeStageObjectName` states. */
function clipKey(name: string | undefined): string {
    return normalizeStageObjectName(name);
}

/** Whether a v26 row built its clip: `create`, or a `show` or `play` naming its own file. */
function legacyDeclares(payload: LegacyVideoPayload): boolean {
    if (payload.operation === "create") {
        return true;
    }
    return (payload.operation === "show" || payload.operation === "play") && Boolean(payload.assetId?.trim());
}

function migrateSceneClips(scene: StoryScene, spelling: StoryCommandSpelling): StoryScene {
    const ordered = listSceneBlocksInDocumentOrder(scene);
    if (!ordered.some(block => legacyVideoPayload(block))) {
        return scene;
    }

    // Rows the compiler skips: a disabled row and everything under it.
    const disabled = new Set<StoryBlockId>();
    for (const block of ordered) {
        if (block.disabled || (block.parentId !== null && disabled.has(block.parentId))) {
            disabled.add(block.id);
        }
    }

    const blocks: Record<StoryBlockId, StoryBlock> = { ...scene.blocks };
    const removed = new Set<StoryBlockId>();
    // The clip each name stands for at the row being read: the first enabled row so far that built it
    // with a file.
    const clips = new Map<string, { name: string; assetId: string; muted?: boolean }>();
    // The play that defines each clip after the step - the first enabled one - which the rows
    // addressing it are bound to.
    const firstPlay = new Map<string, StoryBlockId>();
    // `create` / `show` rows waiting for the next play of their clip.
    const pending = new Map<string, StoryBlockId[]>();

    for (const block of ordered) {
        const payload = legacyVideoPayload(block);
        if (!payload) {
            continue;
        }
        const live = !disabled.has(block.id);
        // Which clip the row is about. A declaring row names it; any other row reaches it through the
        // row its reference was bound to while that is still a video row, and through its own name if
        // not.
        let key: string;
        if (legacyDeclares(payload)) {
            key = clipKey(payload.objectName);
        } else {
            const bound = legacyVideoPayload(payload.target?.sourceBlockId ? scene.blocks[payload.target.sourceBlockId] : undefined);
            key = clipKey(bound?.objectName ?? (payload.target?.name || payload.objectName));
        }
        const ownFile = payload.assetId?.trim();
        if (live && legacyDeclares(payload) && ownFile && !clips.has(key)) {
            clips.set(key, { name: payload.objectName?.trim() || key, assetId: ownFile, ...(payload.muted !== undefined ? { muted: payload.muted } : {}) });
        }
        const clip = clips.get(key);

        if (payload.operation === "create" || payload.operation === "show") {
            if (live) {
                pending.set(key, [...(pending.get(key) ?? []), block.id]);
            } else {
                blocks[block.id] = noteQuoting(block, payload, spelling);
            }
            continue;
        }
        if (payload.operation === "play") {
            // A disabled play built nothing either, so it keeps the file it names when the clip has
            // none to give it.
            const file = clip ?? (!live && ownFile ? { name: payload.objectName?.trim() || key, assetId: ownFile, muted: payload.muted } : undefined);
            if (!file) {
                blocks[block.id] = noteQuoting(block, payload, spelling);
                continue;
            }
            const { target: _target, assetId: _assetId, muted: _muted, ...rest } = payload;
            const next: LegacyVideoPayload = {
                ...rest,
                objectName: payload.objectName?.trim() || file.name,
                assetId: file.assetId,
                ...(file.muted !== undefined ? { muted: file.muted } : {}),
            };
            blocks[block.id] = { ...block, payload: next as unknown as StoryActionPayloadOf<"video"> } as StoryBlock;
            if (live) {
                for (const foldedId of pending.get(key) ?? []) {
                    removed.add(foldedId);
                }
                pending.delete(key);
                if (!firstPlay.has(key)) {
                    firstPlay.set(key, block.id);
                }
            }
            continue;
        }
        // `pause`, `resume`, `seek`, `stop`, `hide`: a row addressing a clip.
        const definingPlay = firstPlay.get(key);
        if (!definingPlay) {
            blocks[block.id] = noteQuoting(block, payload, spelling);
            continue;
        }
        const name = legacyVideoPayload(blocks[definingPlay])?.objectName ?? key;
        blocks[block.id] = {
            ...block,
            payload: {
                ...payload,
                objectName: name,
                ...(payload.target && !payload.target.builtin
                    ? { target: { ...payload.target, name: clipKey(name), label: name, sourceBlockId: definingPlay } }
                    : {}),
            } as unknown as StoryActionPayloadOf<"video">,
        } as StoryBlock;
    }

    // Declarations no later play took up: the clip never ran after them.
    for (const ids of pending.values()) {
        for (const id of ids) {
            const payload = legacyVideoPayload(blocks[id]);
            if (payload) {
                blocks[id] = noteQuoting(blocks[id], payload, spelling);
            }
        }
    }

    if (removed.size === 0) {
        return { ...scene, blocks };
    }
    for (const id of removed) {
        delete blocks[id];
    }
    for (const [id, block] of Object.entries(blocks)) {
        if (block.childrenIds.some(childId => removed.has(childId))) {
            blocks[id] = { ...block, childrenIds: block.childrenIds.filter(childId => !removed.has(childId)) };
        }
    }
    return { ...scene, blocks, rootBlockIds: scene.rootBlockIds.filter(id => !removed.has(id)) };
}

type StoryActionPayloadOf<A extends string> = Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: A }>;

/**
 * A note in the row's place, quoting what the row said the way the story editor prints a row: in the
 * command language `spelling` writes, and with the unit on every time, so `/seek clip 1s` keeps the
 * second it meant rather than reading as a bare number.
 *
 * The file a row named is left out: the document holds its asset id, which is not a word an author
 * can read, and the asset library that would name it is not part of a story document.
 */
function noteQuoting(block: StoryBlock, payload: LegacyVideoPayload, spelling: StoryCommandSpelling): StoryBlock {
    const word = (value: string | undefined): string => {
        const text = (value ?? "").trim();
        return /\s/.test(text) ? `'${text}'` : text;
    };
    const name = word(payload.target?.label || payload.objectName || payload.target?.name);
    const verb = (commandId: string, token: string = commandId): string => `/${spelling.command(commandId, token)}`;
    const key = (commandId: string, param: string): string => spelling.param(commandId, param);
    const seconds = (ms: number | undefined): string =>
        `${formatStorySecondsValue(Math.max(0, ms ?? 0))}${spelling.unit("s")}`;
    let line: string;
    switch (payload.operation) {
        case "create":
            // Typed as `/video`, which is an alias of `/play` now: canonically it keeps the word the
            // author wrote, and in a command language it takes the verb `play` is spelled with.
            line = `${verb("play", "video")} ${key("play", "name")}=${name}${payload.muted ? ` ${key("play", "muted")}` : ""}`;
            break;
        case "seek":
            line = `${verb("seek")} ${name} ${seconds(payload.timeMs)}`;
            break;
        case "hide":
            line = typeof payload.durationMs === "number" && payload.durationMs > 0
                ? `${verb("hide")} ${name} ${key("hide", "out")}=${spelling.enumValue("hide", "out", "fade")} ${key("hide", "d")}=${seconds(payload.durationMs)}`
                : `${verb("hide")} ${name}`;
            break;
        default:
            line = `${verb(payload.operation)} ${name}`;
            break;
    }
    return {
        id: block.id,
        kind: "note",
        parentId: block.parentId,
        childrenIds: [],
        payload: { text: { textId: `${block.id}-note`, role: "note", value: line.trim() } },
        ...(block.disabled ? { disabled: true } : {}),
    };
}

/** The transition kinds that read a hold, and so the only ones whose `props.hold` meant anything. */
const HOLDING_TRANSITION_KINDS = new Set(["throughColor", "exposure"]);

/** What the compiler used when a transition row stated no duration - the divisor for a percentage. */
const DEFAULT_TRANSITION_DURATION_MS = 300;

function migrateTransitionBlock(block: StoryBlock): StoryBlock {
    const key = transitionRefKey(block);
    if (!key) {
        return block;
    }
    const payload = block.payload as Record<string, unknown>;
    const ref = payload[key];
    if (!ref || typeof ref !== "object") {
        return block;
    }
    return { ...block, payload: { ...payload, [key]: migrateTransitionRef(ref as Record<string, unknown>) } } as StoryBlock;
}

function migrateTransitionRef(ref: Record<string, unknown>): Record<string, unknown> {
    let next = ref;

    if (next.kind === "maskWipe") {
        const props = (next.props ?? {}) as Record<string, unknown>;
        next = { ...next, kind: "softWipe", props: { ...props, feather: 0 } };
    }

    const props = next.props as Record<string, unknown> | undefined;
    if (props && typeof props.hold === "number" && HOLDING_TRANSITION_KINDS.has(String(next.kind))) {
        const duration = typeof next.durationMs === "number" ? next.durationMs : DEFAULT_TRANSITION_DURATION_MS;
        const share = Math.min(100, Math.max(0, props.hold)) / 100;
        const rest = { ...props };
        delete rest.hold;
        next = {
            ...next,
            holdMs: Math.round(duration * share),
            ...(Object.keys(rest).length > 0 ? { props: rest } : {}),
        };
        if (Object.keys(rest).length === 0) {
            delete (next as Record<string, unknown>).props;
        }
    }

    return next;
}

/**
 * Which key of a block's payload holds a {@link StoryTransitionRef} - `null` when none does.
 *
 * The same trap {@link transformRefKeys} documents, read the other way round: `transition` on an
 * `nvl` payload is a transform ref and must not be touched here. And the `jump` block is not an
 * `action` at all, so a walker that only looks at actions silently skips the one row kind whose
 * whole purpose is a scene change.
 */
function transitionRefKey(block: StoryBlock): string | null {
    if (block.kind === "jump") {
        return "transition";
    }
    if (block.kind !== "action") {
        return null;
    }
    const action = (block.payload as Record<string, unknown>).action;
    return action === "setBackground" || action === "character" || action === "image" ? "transition" : null;
}
