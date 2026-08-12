/**
 * The Open Link node's wire contract, shared by every shell that implements it.
 *
 * Three implementations satisfy it: the packaged desktop game (renderer -> `runtime:external:open`
 * -> main -> `shell.openExternal`), Studio's Dev Mode (renderer -> `blueprintExternalLink.open` ->
 * Studio's main process), and the web export (`window.open` in the page). Keeping the request, the
 * result and the guard here is what stops the three from becoming three slightly different nodes -
 * and the guard in particular has to be the same one in all three, because it is the boundary.
 *
 * ## What the boundary is
 *
 * A build may open the addresses its variant declared, and nothing else. The declaration lives in
 * `editor/app-tags.json` and travels in the pack (see `GameRuntimePackV1.externalLinks`); the match
 * is exact on the parsed address (see {@link isExternalLinkDeclared}). Every shell checks it in the
 * process that would perform the act, never only in the renderer, because a renderer that asked
 * nicely is not a boundary.
 *
 * ## What this is not
 *
 * It is not a network permission. No request is made and no bytes come back into the game; the page
 * is handed to the browser the player already uses. So it is not gated on the project's Allow HTTP
 * setting, and turning that setting off does not disable it.
 *
 * Comments in English per project convention.
 */

import { isExternalLinkDeclared, normalizeExternalLinkUrl } from "../appTag";

export type BlueprintOpenExternalRequest = {
    url: string;
};

/**
 * Which execution pin the Open Link node leaves by.
 *
 * `refused` is the address not being one this build declared, and it is separate from `failed`
 * because the two have different answers: a refusal is fixed by declaring the address, while a
 * failure is the player's machine having nothing to open it with.
 */
export type BlueprintOpenExternalOutcome = "opened" | "refused" | "failed";

export type BlueprintOpenExternalResult = {
    outcome: BlueprintOpenExternalOutcome;
    /** Human-readable reason, null when the page was handed over. */
    error: string | null;
};

/**
 * The line a shell writes when it refuses, and the reason the node reports.
 *
 * One sentence in one place so the packaged game, Dev Mode and the web export all name the same
 * fact: which address was asked for, and that the project never declared it. A refusal that only
 * said "not allowed" would send an author to the network settings, which are not what governs this.
 */
export function externalLinkRefusalMessage(url: string): string {
    return `This build does not declare the address ${url.trim() || "(none)"}. `
        + "Add it under Project -> Build variants to open it.";
}

/**
 * Decide one request against the addresses this build declared.
 *
 * Never throws: the node branches on the outcome, and an exception would leave the graph with
 * nowhere to go. Performing the act is the caller's - each shell opens a page its own way, and the
 * only thing they must share is this decision.
 */
export function resolveDeclaredExternalLink(
    request: BlueprintOpenExternalRequest,
    declared: readonly string[] | undefined,
): { allowed: true; url: string } | { allowed: false; result: BlueprintOpenExternalResult } {
    const url = String(request?.url ?? "");
    const normalized = normalizeExternalLinkUrl(url);
    if (!normalized || !isExternalLinkDeclared(declared, normalized)) {
        return {
            allowed: false,
            result: { outcome: "refused", error: externalLinkRefusalMessage(url) },
        };
    }
    return { allowed: true, url: normalized };
}
