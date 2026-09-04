/**
 * Keeping the author's place across a Dev Mode hot reload.
 *
 * A reload recompiles the story and mounts a fresh environment, and everything the engine held goes
 * with it. Before this, that meant the run restarted at the story entry: an author who changed one
 * word of a line thirty rows into a chapter had to click their way back to it, every time. The row
 * they were standing on is knowable - the play head names it, and it is the same answer the Dev Mode
 * timeline shows - so the reload can enter the recompiled story there instead, through the very
 * mechanism a row's play control already uses.
 *
 * What that needs from this file is the part that has no engine and no React in it: given where the
 * play head stood and the story document as it is NOW, decide which row the run should resume on.
 * The document has moved under the position - that is why the reload happened - so the row may be
 * gone, and so may the scene.
 *
 * Deliberately engine-free so the decision can be exercised directly, which is the only way to state
 * the three answers as tests: the row survived, the row was deleted, the scene was deleted.
 */

import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import type { StoryDocument, StoryLiteralValue } from "@shared/types/story";

/**
 * Where the run stood when the reload arrived.
 *
 * `blockId` is the play head's own answer - the row it is on, or the last one it could name (see
 * `playHead.ts`) - and `trail` is the rows before it, oldest first. The trail is what makes "the
 * nearest surviving row before it" answerable at all: the row that was deleted is not in the new
 * document, so there is nothing there to walk backwards from. What the run actually played is.
 */
export type StoryResumePosition = {
    /** The Studio scene the run was in. */
    sceneId: string;
    /** The row the play head was on, absent when it never reached one. */
    blockId?: string;
    /** Rows this run played, oldest first, most recent last. May include `blockId`. */
    trail: readonly string[];
};

/**
 * Where the reload should enter the recompiled story.
 *
 * `previousRow` and `sceneStart` are relocations inside the scene the author is looking at, which is
 * a change they can see for themselves. `entry` is the one answer that puts them somewhere else
 * entirely, so it is the one that has to be said out loud.
 */
export type StoryResumeTarget =
    | { kind: "row"; sceneId: string; blockId: string }
    | { kind: "previousRow"; sceneId: string; blockId: string }
    | { kind: "sceneStart"; sceneId: string }
    | { kind: "entry"; reason: "sceneMissing" | "storyMissing" };

/**
 * Resolve a captured position against the story as it is now.
 *
 * Same-scene only, on purpose. Walking the trail into an earlier scene would answer "the nearest row
 * before it" with a row in a chapter the author left ten minutes ago, which is further from where
 * they were than the start of the scene they are actually reading.
 */
export function resolveStoryResumeTarget(
    position: StoryResumePosition,
    document: StoryDocument | undefined,
): StoryResumeTarget {
    if (!document) {
        return { kind: "entry", reason: "storyMissing" };
    }
    const scene = document.scenes[position.sceneId];
    if (!scene) {
        return { kind: "entry", reason: "sceneMissing" };
    }
    if (position.blockId && scene.blocks[position.blockId]) {
        return { kind: "row", sceneId: position.sceneId, blockId: position.blockId };
    }
    // Newest first: the nearest surviving row before the one that went away.
    for (let index = position.trail.length - 1; index >= 0; index--) {
        const candidate = position.trail[index];
        if (candidate === position.blockId || !candidate) {
            continue;
        }
        if (scene.blocks[candidate]) {
            return { kind: "previousRow", sceneId: position.sceneId, blockId: candidate };
        }
    }
    return { kind: "sceneStart", sceneId: position.sceneId };
}

/**
 * A relaunch's remembered start row, checked against the story as it is now.
 *
 * Asked by every relaunch that names a row: the Scene Snapshot picker replays from the row the run
 * began at, and the document has been edited since - that is what the author has been doing while it
 * played. Handed a row that has gone, the compile builds no pre-posed entry scene and
 * `collectStoryPlaybackPlan` falls back to the top of the scene, so the run restarts somewhere else
 * and nothing says so. The relocation is invisible precisely because the row is: there is no longer
 * anything on screen to notice missing.
 *
 * The answer is the row or the start of the scene, and deliberately not
 * {@link StoryResumeTarget}'s middle rung. A resume walks the trail - the rows this run PLAYED - to
 * find the nearest surviving one before the row it was on. For a row-precise launch that trail
 * *begins* at the row being asked about, so every surviving entry in it is a row the run reached
 * AFTER the one that has gone: walking it would land the restart on the furthest row the playthrough
 * got to, which is not a restart at all. Nothing records where the deleted row sat among its
 * neighbours, so "a nearby row" is not answerable here - the scene's own start is.
 */
export function resolveRelaunchStartRow(params: {
    sceneId: string;
    /** The row the relaunch asked for, absent when it asked for the scene from its start. */
    startBlockId?: string;
    /** The story as it is NOW - the document the recompile will read. */
    document: StoryDocument | undefined;
}): { startBlockId?: string; notice: string | null } {
    const { sceneId, startBlockId, document } = params;
    if (!startBlockId) {
        return { notice: null };
    }
    // An empty trail by construction: see above. `resolveStoryResumeTarget` then answers exactly the
    // two rungs this can take, so a reload and a relaunch decide a missing row the same way rather
    // than each carrying its own rule.
    const target = resolveStoryResumeTarget({ sceneId, blockId: startBlockId, trail: [] }, document);
    if (target.kind === "row") {
        return { startBlockId, notice: null };
    }
    if (target.kind === "sceneStart") {
        return { notice: "The row this run started from no longer exists; restarted from the start of the scene." };
    }
    // The scene itself is gone. Left to the compile to answer, which is the one thing here that
    // cannot be improved by dropping the row: there is no scene to restart the top of.
    return { startBlockId, notice: null };
}

/** Everything a reload lifted off the running game, ready to be laid over a fresh compile. */
export type StoryResumeState = {
    position: StoryResumePosition;
    /** Scene-local values, by storage key. */
    sceneVariables: Record<string, StoryLiteralValue>;
    /** Saved-scope values, by storage key. */
    savedVariables: Record<string, StoryLiteralValue>;
};

/** What a reload should compile, what it should remember having launched, and where it landed. */
export type StoryResumeLaunch = {
    /** The launch this session is now running, as the story-runtime bridge reports it. */
    launchRequest: DevModeStartStoryRequest;
    /** The same launch plus the values to lay over its stage walk - what the compile is given. */
    compileRequest: DevModeStartStoryRequest;
    /** Null when there was nothing to resume, i.e. the reload is the plain restart it always was. */
    target: StoryResumeTarget | null;
};

/**
 * Turn "where the player was" into the launch a reload enters through.
 *
 * The whole of the decision, in one place, so that what a reload does is testable without an engine
 * or a React tree: which row it enters at, which values it carries, and what the author is told.
 *
 * Two things are deliberately dropped from a resume. The **Scene Snapshot** the run was launched
 * with: its persistent overrides are written into the profile store on every compile, so carrying it
 * through each reload would keep overwriting values the player had since chosen - and the live
 * values of the two scopes that do not outlive a run are already here, which is what the snapshot
 * was standing in for. And the **variable overlay when the target is a scene start**: the overlay
 * rides the row-precise launch's pre-pose, and a launch with no row has no pre-pose to ride.
 */
export function buildStoryResumeLaunch(params: {
    /** The launch the run was started with, and the fallback when nothing can be resumed. */
    request: DevModeStartStoryRequest;
    /** What was lifted off the running game, or null when there was no run to lift it from. */
    resume: StoryResumeState | null;
    /** The story as it is NOW - the document the recompile will read. */
    document: StoryDocument | undefined;
}): StoryResumeLaunch {
    const { request, resume, document } = params;
    if (!resume) {
        return { launchRequest: request, compileRequest: request, target: null };
    }
    const target = resolveStoryResumeTarget(resume.position, document);
    if (target.kind === "entry") {
        // The scene the run was launched at is the one that has gone, so re-asking for it would only
        // fail the compile - "start from the beginning" has to mean the story's own entry scene. A
        // document that names none, or no document at all, leaves nothing better than the request.
        const entrySceneId = document?.entrySceneId;
        return entrySceneId && entrySceneId !== request.sceneId
            ? {
                launchRequest: { storyId: request.storyId, sceneId: entrySceneId },
                compileRequest: { storyId: request.storyId, sceneId: entrySceneId },
                target,
            }
            : { launchRequest: request, compileRequest: request, target };
    }
    const launchRequest: DevModeStartStoryRequest = {
        storyId: request.storyId,
        sceneId: target.sceneId,
        ...(target.kind === "sceneStart" ? {} : { startBlockId: target.blockId }),
    };
    const compileRequest: DevModeStartStoryRequest = launchRequest.startBlockId
        ? {
            ...launchRequest,
            resume: { sceneVariables: resume.sceneVariables, savedVariables: resume.savedVariables },
        }
        : launchRequest;
    return { launchRequest, compileRequest, target };
}

/**
 * Lay a resume's values over the stage walk a row-precise launch computed.
 *
 * Last over everything - the walk's own reconstruction and any Scene Snapshot - because these are
 * the values the run actually held, and both of the others are earlier states. Keyed by storage key
 * already, so nothing has to be resolved through a definition table.
 */
export function applyResumeToLaunchSnapshot(
    snapshot: { sceneVariables: Record<string, StoryLiteralValue>; savedVariables: Record<string, StoryLiteralValue> },
    resume: NonNullable<DevModeStartStoryRequest["resume"]>,
): void {
    Object.assign(snapshot.sceneVariables, resume.sceneVariables);
    Object.assign(snapshot.savedVariables, resume.savedVariables);
}

/**
 * The message the author is told when a reload could not put them back, or `null` when it could.
 *
 * English here rather than through the i18n catalog for the reason every compile diagnostic is: this
 * file is inside the shared game app, which is also what a packaged game runs, and the catalog is a
 * Studio thing. The Dev Mode Issues panel shows what the runtime says, verbatim.
 */
export function storyResumeNotice(target: StoryResumeTarget): string | null {
    if (target.kind === "entry") {
        return target.reason === "sceneMissing"
            ? "The scene you were on no longer exists; restarted from the beginning."
            : "The story you were playing no longer exists; restarted from the beginning.";
    }
    if (target.kind === "previousRow") {
        return "The row you were on no longer exists; resumed from the row before it.";
    }
    if (target.kind === "sceneStart") {
        return "The row you were on no longer exists; resumed from the start of the scene.";
    }
    return null;
}

/**
 * A Storable namespace narrowed to the values a launch snapshot can carry.
 *
 * The engine's namespaces hold whatever a story put in them, and a launch snapshot is a record of
 * literals - so a `Date`, a function or an `undefined` has no spelling there. Those are dropped
 * rather than coerced: seeding a variable with a JSON-ish stand-in for a value would be a quieter
 * failure than seeding it with its declared default, which is what dropping it leaves the compile
 * to do.
 */
export function toStoryLiteralRecord(values: Record<string, unknown>): Record<string, StoryLiteralValue> {
    const out: Record<string, StoryLiteralValue> = {};
    for (const [key, value] of Object.entries(values)) {
        const literal = toStoryLiteral(value);
        if (literal !== undefined) {
            out[key] = literal;
        }
    }
    return out;
}

/** One value, or `undefined` when it is not something a launch snapshot can state. */
function toStoryLiteral(value: unknown): StoryLiteralValue | undefined {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        // NaN and the infinities survive neither JSON nor an expression, so they are not literals.
        return Number.isFinite(value) ? value : undefined;
    }
    if (Array.isArray(value)) {
        const items: StoryLiteralValue[] = [];
        for (const item of value) {
            const literal = toStoryLiteral(item);
            // A hole in the middle would renumber everything after it, so one unstatable item
            // disqualifies the array rather than shortening it.
            if (literal === undefined) {
                return undefined;
            }
            items.push(literal);
        }
        return items;
    }
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        const record: Record<string, StoryLiteralValue> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            const literal = toStoryLiteral(entry);
            if (literal === undefined) {
                return undefined;
            }
            record[key] = literal;
        }
        return record;
    }
    return undefined;
}
