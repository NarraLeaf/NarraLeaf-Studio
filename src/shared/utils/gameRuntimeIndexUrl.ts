import {
    GAME_RUNTIME_CRASH_POLICY_QUERY_PARAM,
    GAME_RUNTIME_CRASH_QUERY_PARAM,
    GAME_RUNTIME_LAUNCH_QUERY_PARAM,
    GAME_RUNTIME_LOG_PATH_QUERY_PARAM,
    GAME_RUNTIME_PROTOCOL,
    normalizeGameCrashPolicy,
    type GameCrashPolicy,
} from "@shared/types/gameRuntime";
import { normalizeGameLaunchTiming, type GameLaunchTiming } from "@shared/types/gameLaunchTiming";

/**
 * The address of the game's own page, carrying the two things the crash screen has to know before
 * it can read anything, the failure to draw when there is one, and when the process began - the
 * zero the page's performance timeline is placed against.
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
    /** When the process started and what it did before the page; see `gameLaunchTiming`. */
    launch?: GameLaunchTiming | null;
}

export interface GameRuntimeIndexUrlParams {
    policy: GameCrashPolicy;
    logPath: string | null;
    crashDetails: string | null;
    /** Null where the shell says nothing - the web export - or said something unreadable. */
    launch: GameLaunchTiming | null;
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
    if (input.launch) {
        params.set(GAME_RUNTIME_LAUNCH_QUERY_PARAM, JSON.stringify(input.launch));
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
        launch: readLaunchParam(params.get(GAME_RUNTIME_LAUNCH_QUERY_PARAM)),
    };
}

/** A launch timing that does not parse is no launch timing: the page falls back to its own origin. */
function readLaunchParam(raw: string | null): GameLaunchTiming | null {
    if (!raw) {
        return null;
    }
    try {
        return normalizeGameLaunchTiming(JSON.parse(raw));
    } catch {
        return null;
    }
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
