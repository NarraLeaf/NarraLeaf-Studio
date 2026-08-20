/**
 * Experimental mode: a development launch that unlocks test conditions which are not part of the
 * product.
 *
 * Two switches, deliberately: `--experimental` opens the mode, and one `--x-<id>` flag per
 * condition turns an individual one on. A condition flag on its own does nothing, so nothing here
 * can be reached by a single mistyped argument.
 *
 * Nothing in this area is translated. The conditions change often enough that a catalog entry would
 * describe the previous shape of one as often as the current, and a mode that only reads in English
 * is a mode nobody enters by accident.
 */

/** Opens experimental mode. Ignored by a packaged Studio; see `BaseApp.getExperimentalState`. */
export const EXPERIMENTAL_FLAG = "--experimental";

/** Every condition flag is this prefix followed by the condition id. */
export const EXPERIMENTAL_CONDITION_FLAG_PREFIX = "--x-";

export const EXPERIMENTAL_CONDITION_IDS = [
    "debuggable-build",
] as const;

export type ExperimentalConditionId = typeof EXPERIMENTAL_CONDITION_IDS[number];

export type ExperimentalConditionDescriptor = {
    id: ExperimentalConditionId;
    /** The flag that turns it on, precomputed so callers print one spelling of it. */
    flag: string;
    /** What the condition does to the product, in one line. */
    summary: string;
};

/**
 * The registry. Order is the order every surface lists them in - the log banner, the notice the
 * workspace shows, and the build console.
 */
export const EXPERIMENTAL_CONDITIONS: readonly ExperimentalConditionDescriptor[] = [
    {
        id: "debuggable-build",
        flag: `${EXPERIMENTAL_CONDITION_FLAG_PREFIX}debuggable-build`,
        summary: "Game builds ship without asar integrity validation and accept a remote-debugging "
            + "switch at launch.",
    },
];

/** What experimental mode is doing this run. */
export type ExperimentalState = {
    enabled: boolean;
    /** Active conditions, in registry order. Empty whenever the mode is off. */
    conditions: ExperimentalConditionId[];
    /** `--x-` flags that name no condition, kept so the launch can say which ones did nothing. */
    unknownConditionFlags: string[];
};

export const EXPERIMENTAL_OFF: ExperimentalState = {
    enabled: false,
    conditions: [],
    unknownConditionFlags: [],
};

export function isExperimentalConditionId(value: string): value is ExperimentalConditionId {
    return (EXPERIMENTAL_CONDITION_IDS as readonly string[]).includes(value);
}

export function experimentalCondition(id: ExperimentalConditionId): ExperimentalConditionDescriptor {
    const found = EXPERIMENTAL_CONDITIONS.find(condition => condition.id === id);
    if (!found) {
        throw new Error(`No experimental condition is registered under ${id}`);
    }
    return found;
}

/**
 * Whether a condition is on. Reads `enabled` as well, so a caller cannot act on a condition list
 * that was parsed but never opened.
 */
export function hasExperimentalCondition(
    state: ExperimentalState | null | undefined,
    id: ExperimentalConditionId,
): boolean {
    return Boolean(state?.enabled && state.conditions.includes(id));
}
