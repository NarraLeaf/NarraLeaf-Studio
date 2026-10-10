import {
    DEV_MODE_AGENT_ANSWER_GRACE_MS,
    DEV_MODE_AGENT_BUDGET_MS,
    DevModeAgentErrorCode,
    type DevModeAgentAction,
    type DevModeAgentResult,
} from "@shared/types/devMode";
import type { RequestStatus } from "@shared/types/ipcEvents";

/**
 * Carrying an agent's play-test action to a Dev Mode window and its answer back.
 *
 * Kept apart from `DevModeManager` so the parts that decide what an agent is told - which wait
 * timed out, whether the window is gone or just silent - can be pinned without an Electron window.
 *
 * Comments in English per project convention.
 */

/** The one window this talks to, as far as a play-test needs it. */
export type DevModeAgentDriveTarget = {
    /** Ask the window to carry out `action`. May reject when the window goes away mid-call. */
    ask(action: DevModeAgentAction, timeoutMs: number): Promise<RequestStatus<DevModeAgentResult>>;
    /** The window's own pixels, as a PNG data URL. */
    capturePage(): Promise<string>;
    /**
     * Keep the page rendering while it is hidden or covered.
     *
     * ⚠ The engine's stage capture (html-to-image) resolves each image it builds inside a
     * `requestAnimationFrame` callback, and a covered or hidden window runs none: on macOS an
     * occluded window's rAF stops outright, so a capture asked of it never settles and the window
     * never answers. The typewriter and the transitions an advance waits on are paced by the same
     * frames and by timers Chromium throttles in a background page.
     */
    keepPainting(): void;
    isClosed(): boolean;
};

/** A refusal with the `code` the agent tool reads; `IPCHost.failed` carries it across. */
export class DevModeAgentError extends Error {
    constructor(message: string, readonly code: string) {
        super(message);
        this.name = "DevModeAgentError";
    }
}

/** How long main waits for the window's answer: the window's own budget, plus the grace. */
export function devModeAgentAnswerTimeoutMs(kind: DevModeAgentAction["kind"]): number {
    return DEV_MODE_AGENT_BUDGET_MS[kind] + DEV_MODE_AGENT_ANSWER_GRACE_MS;
}

const ACTION_NAMES: Record<DevModeAgentAction["kind"], string> = {
    capture: "screenshot",
    state: "status read",
    advance: "advance",
};

function seconds(ms: number): string {
    return `${Math.round(ms / 1000)} s`;
}

/**
 * Race `work` against a timer, settling with `onTimeout()`'s error when the timer wins. The work is
 * not cancelled - nothing it waits on can be - only stopped being waited for.
 */
export function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
        work.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export async function driveDevModeWindow(
    target: DevModeAgentDriveTarget,
    action: DevModeAgentAction,
): Promise<DevModeAgentResult> {
    target.keepPainting();
    const timeoutMs = devModeAgentAnswerTimeoutMs(action.kind);
    const name = ACTION_NAMES[action.kind];
    let answer: RequestStatus<DevModeAgentResult>;
    try {
        // The IPC's own timer is set a little later than this one, so the sentence an agent gets
        // is always the one below rather than the transport's.
        answer = await withTimeout(
            target.ask(action, timeoutMs + 1000),
            timeoutMs,
            () => new DevModeAgentError(
                `The Dev Mode window is open but did not answer the ${name} within ${seconds(timeoutMs)}: `
                + "the game page is not responding.",
                DevModeAgentErrorCode.noAnswer,
            ),
        );
    } catch (error) {
        if (error instanceof DevModeAgentError) {
            throw error;
        }
        if (target.isClosed()) {
            throw new DevModeAgentError(
                `The Dev Mode window closed before it answered the ${name}.`,
                DevModeAgentErrorCode.notRunning,
            );
        }
        throw error;
    }
    if (!answer.success) {
        const message = answer.error ?? "The game did not answer.";
        throw answer.code ? new DevModeAgentError(message, answer.code) : new Error(message);
    }
    if (answer.data.kind === "capture" && !answer.data.png) {
        // Nothing on the stage yet - a page such as the title is all there is - so the window's own
        // pixels stand in. Bounded like the engine's capture, for the same reason.
        const png = await withTimeout(
            target.capturePage(),
            DEV_MODE_AGENT_BUDGET_MS.capture,
            () => new DevModeAgentError(
                `The Dev Mode window did not produce a picture of itself within ${seconds(DEV_MODE_AGENT_BUDGET_MS.capture)}.`,
                DevModeAgentErrorCode.captureTimeout,
            ),
        );
        return { kind: "capture", png, source: "window" };
    }
    return answer.data;
}
