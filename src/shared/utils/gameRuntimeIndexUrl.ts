import {
    GAME_RUNTIME_CRASH_POLICY_QUERY_PARAM,
    GAME_RUNTIME_CRASH_QUERY_PARAM,
    GAME_RUNTIME_LOG_PATH_QUERY_PARAM,
    GAME_RUNTIME_PROTOCOL,
    normalizeGameCrashPolicy,
    type GameCrashPolicy,
} from "@shared/types/gameRuntime";

/**
 * The address of the game's own page, carrying the two things the crash screen has to know before
 * it can read anything, and the failure to draw when there is one.
 *
 * One module for both ends so the spelling cannot drift: the desktop shell composes the address,
 * the page takes it apart, and neither knows the parameter names by heart.
 */

export interface GameRuntimeIndexUrlInput {
    policy: GameCrashPolicy;
    /** Where this shell writes its log. `null` where there is no log file to name. */
    logPath: string | null;
    /** The death to draw, when this load is replacing a page whose process died. */
    crashDetails?: string | null;
}

export interface GameRuntimeIndexUrlParams {
    policy: GameCrashPolicy;
    logPath: string | null;
    crashDetails: string | null;
}

export function buildGameRuntimeIndexUrl(input: GameRuntimeIndexUrlInput): string {
    const params = new URLSearchParams();
    params.set(GAME_RUNTIME_CRASH_POLICY_QUERY_PARAM, input.policy);
    if (input.logPath) {
        params.set(GAME_RUNTIME_LOG_PATH_QUERY_PARAM, input.logPath);
    }
    if (input.crashDetails) {
        params.set(GAME_RUNTIME_CRASH_QUERY_PARAM, input.crashDetails);
    }
    return `${GAME_RUNTIME_PROTOCOL}://runtime/index.html?${params.toString()}`;
}

/**
 * What the page can tell about itself from its own address.
 *
 * A missing policy parameter is not an unrecognized one: it means this shell does not state a
 * policy at all (the web export, whose page is a static file), and the answer stays the default
 * until the pack lands. An unrecognized value normalizes to the default the same way a stale pack
 * field does.
 */
export function readGameRuntimeIndexUrl(search: string): GameRuntimeIndexUrlParams {
    const params = new URLSearchParams(search);
    const policy = params.get(GAME_RUNTIME_CRASH_POLICY_QUERY_PARAM);
    return {
        policy: normalizeGameCrashPolicy(policy),
        logPath: params.get(GAME_RUNTIME_LOG_PATH_QUERY_PARAM),
        crashDetails: params.get(GAME_RUNTIME_CRASH_QUERY_PARAM),
    };
}

/**
 * The same address with the failure dropped, for the Restart button.
 *
 * Everything else is kept, and that is the point: clearing the whole query would take the policy
 * and the log path with it, so a game restarted from the crash screen would come back knowing
 * less about itself than the one that crashed.
 */
export function withoutGameRuntimeCrashDetails(search: string): string {
    const params = new URLSearchParams(search);
    params.delete(GAME_RUNTIME_CRASH_QUERY_PARAM);
    const rest = params.toString();
    return rest ? `?${rest}` : "";
}
