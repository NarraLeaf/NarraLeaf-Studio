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
    STORY_DOCUMENT_SCHEMA_VERSION,
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";

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
 * The {@link StoryDocumentTooOldError} behind a failure, however many times it has been rewrapped.
 *
 * `loadStory` re-throws as a `RendererError` carrying the original as its `cause`, and a caller two
 * services away should not have to know how many wrappers are between it and the ladder.
 */
export function findStoryDocumentTooOldError(error: unknown): StoryDocumentTooOldError | null {
    const seen = new Set<unknown>();
    let current = error;
    while (current && typeof current === "object" && !seen.has(current)) {
        if (current instanceof StoryDocumentTooOldError) {
            return current;
        }
        seen.add(current);
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}

export function migrateStoryDocumentToLatest(document: StoryDocument): StoryDocument {
    const version = typeof document.schemaVersion === "number" ? document.schemaVersion : 1;
    if (version >= STORY_DOCUMENT_SCHEMA_VERSION) {
        return document;
    }
    if (version < STORY_DOCUMENT_MIN_SUPPORTED_VERSION) {
        throw new StoryDocumentTooOldError(version, STORY_DOCUMENT_MIN_SUPPORTED_VERSION);
    }
    let migrated = document;
    if (version < 22) {
        migrated = migrateStoryDocumentV21toV22(migrated);
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
