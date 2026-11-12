/**
 * Marks the element Dev Mode draws over the game while an agent holds the session (`useAgentHold`).
 * Hit tests that stand in for a player's pointer (`agentPlaytestInput`) look through it.
 */
export const AGENT_HOLD_SHIELD_ATTRIBUTE = "data-agent-hold-shield";

/** Marks the notice that names the agent holding the session. */
export const AGENT_HOLD_CAPSULE_ATTRIBUTE = "data-agent-hold-capsule";

/** Longest the notice stays away if main never says the picture is taken. */
const CAPTURE_RESTORE_FALLBACK_MS = 3000;

let restoreTimer: ReturnType<typeof setTimeout> | null = null;

function capsule(doc: Document): HTMLElement | null {
    return doc.querySelector<HTMLElement>(`[${AGENT_HOLD_CAPSULE_ATTRIBUTE}]`);
}

/**
 * Put the agent notice away before main photographs the window for an agent's screenshot: the notice
 * is for the author, and the agent must see the game as a player does. Resolves once a frame without
 * it has been drawn. Main says so when the picture is taken (`restoreAfterCapture`); a timer brings it
 * back if that never comes.
 */
export async function prepareWindowCapture(doc: Document = document): Promise<void> {
    const node = capsule(doc);
    if (!node) {
        return;
    }
    node.style.visibility = "hidden";
    if (restoreTimer) {
        clearTimeout(restoreTimer);
    }
    restoreTimer = setTimeout(() => restoreAfterCapture(doc), CAPTURE_RESTORE_FALLBACK_MS);
    const view = doc.defaultView;
    if (view) {
        await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())));
    }
}

export function restoreAfterCapture(doc: Document = document): void {
    if (restoreTimer) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
    }
    capsule(doc)?.style.removeProperty("visibility");
}
