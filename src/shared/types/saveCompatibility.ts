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
 *  - **`storyId` + `storyHash`** - which of the project's stories the save was written in, and that
 *    story's content hashed when the bundle is assembled rather than when a game runs. Per story
 *    rather than per library: a save belongs to one of them, and asking whether the whole library
 *    changed retires a player's saves on the first route because the third was patched. Both have
 *    to be knowable with no story mounted, because the first thing a save screen does is list
 *    slots, and a title screen has no live game to ask.
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
    /**
     * The project story the save was written in.
     *
     * Blank on a record written before saves knew which story they belonged to, and on one taken
     * with no story mounted. A blank one cannot be compared against anything and falls to
     * `unknown`, which is how every save written before the stamp existed already behaves.
     *
     * Also what lets a save screen say which route a slot is on - see `GameAppSaveHeader`.
     */
    storyId: string;
    /** That story, hashed at bundle assembly. Blank when it could not be taken. */
    storyHash: string;
    /** The author's `metadata.version`. Blank is normal - a project need not carry one. */
    gameVersion: string;
};

/**
 * What the build now running is, for comparing a save against.
 *
 * Not a {@link SaveCompatibilityStamp}: the save side names one story, and the build side has to
 * answer for all of them. A save screen lists slots from every route the player has been on, with
 * no story mounted, so the reader needs the whole table rather than whichever story happens to be
 * up.
 */
export type SaveBuildStamp = {
    protocol: number;
    /** Every story this build ships, each hashed on its own. Keyed by story id. */
    storyHashes: Readonly<Record<string, string>>;
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
 * A save from the same story is resumed; a save from a different story puts the player back where
 * it stopped instead.
 *
 * The two halves are answering two different questions, so they do not take the same default. Same
 * story is not a risk at all - the prose the save points into is byte-for-byte what it was - and
 * refusing it by default would take a playthrough away for a version number. A different story is
 * the case where the position may no longer mean what it meant, and where loading it anyway is the
 * choice an author should make on purpose rather than inherit.
 *
 * This costs nothing to a save that has already been written: those carry no stamp, cannot be
 * compared, and load exactly as they always did. It changes what happens to saves a build writes
 * from here on.
 */
export const DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION: SaveCompatibilityConfiguration = {
    compatible: "resume",
    incompatible: "resumeScene",
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
        // Absent on every record written before saves carried one, which is a complete stamp
        // otherwise - refusing to read those would turn a field addition into a protocol break.
        storyId: typeof record.storyId === "string" ? record.storyId : "",
        storyHash: record.storyHash,
        gameVersion: record.gameVersion,
    };
}

/** The stamp written into one save, for the story it was taken in. */
export function buildSaveCompatibilityStamp(input: {
    storyId?: string | null;
    storyHash?: string | null;
    gameVersion?: string | null;
}): SaveCompatibilityStamp {
    return {
        protocol: SAVE_PROTOCOL_VERSION,
        storyId: typeof input.storyId === "string" ? input.storyId : "",
        storyHash: typeof input.storyHash === "string" ? input.storyHash : "",
        gameVersion: typeof input.gameVersion === "string" ? input.gameVersion : "",
    };
}

/** What this build is, for comparing every save against. */
export function buildSaveBuildStamp(input: {
    storyHashes?: Readonly<Record<string, string>> | null;
    gameVersion?: string | null;
}): SaveBuildStamp {
    return {
        protocol: SAVE_PROTOCOL_VERSION,
        storyHashes: input.storyHashes ?? {},
        gameVersion: typeof input.gameVersion === "string" ? input.gameVersion : "",
    };
}

/** The hash this build carries for one save's story, or blank when it carries none. */
export function buildHashForSave(
    saved: SaveCompatibilityStamp,
    build: SaveBuildStamp,
): string {
    return saved.storyId ? build.storyHashes[saved.storyId] ?? "" : "";
}

/**
 * Where one save stands against the build now running.
 *
 * Every missing half is an absence rather than a difference, and all of them fall to `unknown`,
 * which loads exactly as an unstamped save always has:
 *
 *  - **No `storyId` on the save.** Written before saves knew their story. There is nothing to look
 *    up, and the library-wide hash such a record carries answers a question this no longer asks.
 *  - **No hash in this build for that story.** The story is not in this build at all - an
 *    uninstalled DLC is the ordinary way that happens - so what the policy would decide is not
 *    "the story changed" but "the content is not here right now". Deciding it here would let a
 *    policy hide or restart a slot over a DLC the player can reinstall in a minute; the load itself
 *    answers it honestly instead, by finding nowhere to put the player.
 *  - **A blank hash on either side.** A bundle assembled before hashes existed, or one that could
 *    not be taken.
 *
 * A blank `gameVersion` is a real value, not an absence: a project need not carry a version, and
 * two builds that both carry none are two builds of the same version.
 */
export function classifySaveCompatibility(
    saved: SaveCompatibilityStamp | null,
    build: SaveBuildStamp | null,
): SaveCompatibility {
    if (!saved || !build) {
        return "unknown";
    }
    if (saved.protocol !== build.protocol) {
        return "unsupported";
    }
    const mine = buildHashForSave(saved, build);
    if (!saved.storyHash || !mine) {
        return "unknown";
    }
    if (saved.storyHash !== mine) {
        return "incompatible";
    }
    return saved.gameVersion === build.gameVersion ? "identical" : "compatible";
}

/**
 * What to do with a save the player asked for, or that a save screen is about to list.
 *
 * `relaunch` says nothing about how precisely the player can be put back, because nothing here can
 * know: that is a question about whether the row the save names is still in the story, and only
 * whoever holds the story documents can answer it. It is asked at the moment of the relaunch and
 * answered there - see `SaveRelaunchLanding` in `saveLoad.ts`.
 */
export type SaveResumePlan =
    /** Load the save. */
    | { action: "resume" }
    /** Start the story where the save was, without the state the save holds. */
    | { action: "relaunch" }
    /** Do not offer it and do not load it. */
    | { action: "discard"; reason: "protocol" | "policy" };

export function resolveSaveResumePlan(
    compatibility: SaveCompatibility,
    config: SaveCompatibilityConfiguration,
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
                ? { action: "relaunch" }
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
    build: SaveBuildStamp | null,
    config: SaveCompatibilityConfiguration,
): { compatibility: SaveCompatibility; plan: SaveResumePlan } {
    const compatibility = classifySaveCompatibility(savedStamp, build);
    return { compatibility, plan: resolveSaveResumePlan(compatibility, config) };
}
