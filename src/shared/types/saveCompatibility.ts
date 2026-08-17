/**
 * Whether a save written by one build of a game may be resumed by another.
 *
 * A save is not a document the player owns in isolation - it is a position inside a story, held as
 * ids into that story's compiled form. Ship a new build and those ids may still resolve, may
 * resolve to something else, or may be gone. The engine's own pre-check (`saveLoad.ts`) catches
 * only the last of those, and only at the moment the player presses Load. This decides the question
 * earlier and by the author's policy rather than by accident.
 *
 * # The three things a save is stamped with
 *
 * Each answers a different question, and folding any two together would lose one of them:
 *
 *  - **`protocol`** - the shape of the record itself, ours rather than the engine's. It changes
 *    only when a record written by an older Studio cannot be understood at all, which is why it is
 *    expected to sit at 1 indefinitely. A mismatch here is not a policy question: nothing can be
 *    read out of the record to act on, so the save is never listed and never loaded.
 *  - **`storyHash`** - the story this build ships, hashed when the bundle is assembled rather than
 *    when a game runs. It has to be knowable with no story mounted, because the first thing a save
 *    screen does is list slots, and a title screen has no live game to ask.
 *  - **`gameVersion`** - the author's own semantic version, exactly as typed into
 *    Project ▸ Details. Studio never interprets it; it only compares it.
 *
 * # What the author is actually choosing
 *
 * Same story, different version is the ordinary case of a patch: the prose the save points into is
 * byte-for-byte what it was, so resuming is safe and the author is only being asked whether they
 * want it to happen. A different story is the case where the position may mean something else than
 * it did, and there the three answers differ in kind - refuse it, put the player back at the top of
 * the chapter they were in, or resume anyway and let the existing pre-check catch what it catches.
 *
 * Comments in English per project convention.
 */

/**
 * The shape of a Studio save record.
 *
 * Bumped only for a change that makes an older record unreadable - not for a field added to
 * metadata, which older and newer readers both survive. See the module comment.
 */
export const SAVE_PROTOCOL_VERSION = 1;

/** What produced one save, carried in its record header so listing never has to open the game. */
export type SaveCompatibilityStamp = {
    /** {@link SAVE_PROTOCOL_VERSION} as of the build that wrote the record. */
    protocol: number;
    /** The story this build shipped, hashed at bundle assembly. Blank when it could not be taken. */
    storyHash: string;
    /** The author's `metadata.version`. Blank is normal - a project need not carry one. */
    gameVersion: string;
};

/** How one save stands against the build now running. */
export type SaveCompatibility =
    /** Same protocol, same story, same version. Nothing to decide. */
    | "identical"
    /** Same protocol, same story, a different version. The author's `compatible` policy applies. */
    | "compatible"
    /** Same protocol, a different story. The author's `incompatible` policy applies. */
    | "incompatible"
    /** A record shape this build cannot read. Never listed, never loaded, not a policy question. */
    | "unsupported"
    /** One side carries no stamp, so the two cannot be compared. Treated as it always was. */
    | "unknown";

/** What the author allows for a save from a different version of the same story. */
export type SaveCompatiblePolicy =
    /** Load it. What every build did before this setting existed. */
    | "resume"
    /** Do not. The slot is not listed and Load Save reports a failure. */
    | "discard";

/** What the author allows for a save from a different story. */
export type SaveIncompatiblePolicy =
    /** Put the player back where the save was, without the state the save holds. */
    | "resumeScene"
    /** Do not load it. The slot is not listed and Load Save reports a failure. */
    | "discard"
    /** Load it anyway. What every build did before this setting existed. */
    | "force";

export type SaveCompatibilityConfiguration = {
    compatible: SaveCompatiblePolicy;
    incompatible: SaveIncompatiblePolicy;
};

/**
 * Both defaults reproduce, exactly, what a build did before this setting existed: every save is
 * offered and every save is attempted, and a position that no longer resolves is caught where it
 * always was - by the pre-check in `saveLoad.ts`, which refuses without spending the run.
 *
 * Deliberately not the safer-sounding pair. Turning a policy on by default would change what
 * already-shipped titles do to saves players already have, on nothing more than an update to
 * Studio.
 */
export const DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION: SaveCompatibilityConfiguration = {
    compatible: "resume",
    incompatible: "force",
};

const COMPATIBLE_POLICIES: readonly SaveCompatiblePolicy[] = ["resume", "discard"];
const INCOMPATIBLE_POLICIES: readonly SaveIncompatiblePolicy[] = ["resumeScene", "discard", "force"];

/** Coerce an unknown (persisted, partially-migrated, absent) value into a complete configuration. */
export function normalizeSaveCompatibilityConfiguration(value: unknown): SaveCompatibilityConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    const compatible = record.compatible as SaveCompatiblePolicy;
    const incompatible = record.incompatible as SaveIncompatiblePolicy;
    return {
        compatible: COMPATIBLE_POLICIES.includes(compatible)
            ? compatible
            : DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION.compatible,
        incompatible: INCOMPATIBLE_POLICIES.includes(incompatible)
            ? incompatible
            : DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION.incompatible,
    };
}

/**
 * Read a stamp off whatever a store handed back.
 *
 * Null for anything that is not a complete stamp, which is the only honest answer: a record written
 * before the stamp existed and a record whose stamp is half-written are the same thing to a reader,
 * and both have to end up at {@link SaveCompatibility} `unknown` rather than at a comparison
 * against invented values.
 */
export function readSaveCompatibilityStamp(value: unknown): SaveCompatibilityStamp | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.protocol !== "number" || !Number.isFinite(record.protocol)) {
        return null;
    }
    if (typeof record.storyHash !== "string" || typeof record.gameVersion !== "string") {
        return null;
    }
    return {
        protocol: Math.trunc(record.protocol),
        storyHash: record.storyHash,
        gameVersion: record.gameVersion,
    };
}

/** The stamp this build writes into every save it takes. */
export function buildSaveCompatibilityStamp(input: {
    storyHash?: string | null;
    gameVersion?: string | null;
}): SaveCompatibilityStamp {
    return {
        protocol: SAVE_PROTOCOL_VERSION,
        storyHash: typeof input.storyHash === "string" ? input.storyHash : "",
        gameVersion: typeof input.gameVersion === "string" ? input.gameVersion : "",
    };
}

/**
 * Where one save stands against the build now running.
 *
 * A blank `storyHash` on either side is not a difference, it is an absence - a bundle assembled
 * before hashes existed, or a hash that could not be taken - and comparing it would report every
 * save as belonging to another story. Those fall to `unknown`, which loads exactly as it always
 * did. A blank `gameVersion` is a real value: a project need not carry a version, and two builds
 * that both carry none are two builds of the same version.
 */
export function classifySaveCompatibility(
    saved: SaveCompatibilityStamp | null,
    current: SaveCompatibilityStamp | null,
): SaveCompatibility {
    if (!saved || !current) {
        return "unknown";
    }
    if (saved.protocol !== current.protocol) {
        return "unsupported";
    }
    if (!saved.storyHash || !current.storyHash) {
        return "unknown";
    }
    if (saved.storyHash !== current.storyHash) {
        return "incompatible";
    }
    return saved.gameVersion === current.gameVersion ? "identical" : "compatible";
}

/**
 * What to do with a save the player asked for, or that a save screen is about to list.
 *
 * `relaunch` carries how precisely it can put the player back, and that is decided here rather
 * than by the caller because it is decided by the same comparison: a story that hashes the same
 * still holds the row the save stopped on, so the player returns to the line rather than to the
 * top of the scene. A story that does not may still have the scene, and the top of it is the
 * nearest honest place to be put.
 */
export type SaveResumePlan =
    /** Load the save. */
    | { action: "resume" }
    /** Start the story where the save was, without the state the save holds. */
    | { action: "relaunch"; precision: "row" | "scene" }
    /** Do not offer it and do not load it. */
    | { action: "discard"; reason: "protocol" | "policy" };

export function resolveSaveResumePlan(
    compatibility: SaveCompatibility,
    config: SaveCompatibilityConfiguration,
    precision: "row" | "scene",
): SaveResumePlan {
    switch (compatibility) {
        case "unsupported":
            return { action: "discard", reason: "protocol" };
        case "compatible":
            return config.compatible === "discard"
                ? { action: "discard", reason: "policy" }
                : { action: "resume" };
        case "incompatible":
            if (config.incompatible === "discard") {
                return { action: "discard", reason: "policy" };
            }
            return config.incompatible === "resumeScene"
                ? { action: "relaunch", precision }
                : { action: "resume" };
        default:
            return { action: "resume" };
    }
}

/**
 * The whole decision for one slot, from its stamp.
 *
 * One entry point for both readers - the listing filter and the load itself - so a slot a save
 * screen offers is a slot that loads, and a slot it hides is one nothing else will quietly accept.
 */
export function planSaveResume(
    savedStamp: SaveCompatibilityStamp | null,
    currentStamp: SaveCompatibilityStamp | null,
    config: SaveCompatibilityConfiguration,
): { compatibility: SaveCompatibility; plan: SaveResumePlan } {
    const compatibility = classifySaveCompatibility(savedStamp, currentStamp);
    // Same story means the row anchors the save holds are the row anchors this build compiled, so a
    // relaunch can land on the line. That is only reachable when a policy routes a same-story save
    // here, which no built-in classification does today - it is stated rather than assumed so the
    // option stays well defined however it is reached.
    const precision = savedStamp && currentStamp && savedStamp.storyHash
        && savedStamp.storyHash === currentStamp.storyHash
        ? "row"
        : "scene";
    return { compatibility, plan: resolveSaveResumePlan(compatibility, config, precision) };
}
