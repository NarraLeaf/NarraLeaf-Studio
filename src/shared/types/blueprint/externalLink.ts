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
 * ## The other regime
 *
 * A *plugin* opening an address is a different question with a different answer, and the two are
 * kept apart deliberately - see {@link resolvePluginExternalLink} at the bottom of this file. The
 * node above stays exactly what it was: exact match, `http(s)` only, declared per variant.
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
import { isExternalLinkPatternDeclared } from "../externalLinkPattern";

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

/**
 * The line a shell writes when it refuses a *plugin's* request.
 *
 * Same shape as the one above and the same two facts - which address, and that it was never
 * declared - with the third fact this case has: whose declaration was consulted. A plugin's
 * patterns are its own, so "not declared" is always a statement about one plugin, and a message
 * that left the name out would send an author looking through the project's build variants for a
 * list that has nothing to do with it.
 *
 * The remedy differs too, and says so: a project address is added in Studio, while a plugin's is
 * part of what the author approved at install, so changing it means a new version of the plugin and
 * a fresh approval.
 */
export function pluginExternalLinkRefusalMessage(pluginId: string, url: string): string {
    return `The plugin ${pluginId.trim() || "(unknown)"} does not declare the address `
        + `${url.trim() || "(none)"}. `
        + "Add it to the plugin's contributes.externalLinks and reinstall the plugin to open it.";
}

/**
 * Decide one plugin request against the patterns that plugin declared.
 *
 * The counterpart of {@link resolveDeclaredExternalLink}, and separate from it on purpose - the two
 * regimes answer different questions and must not be able to answer each other's. This one takes
 * patterns rather than addresses, accepts any scheme the pattern language allows rather than
 * `http(s)` only, and is never consulted for the Open Link node. Its result type is shared because
 * a refusal is the same event either way: the graph or the plugin is told which address was refused
 * and gets on with something else.
 *
 * `patterns` must come from the manifest entry of the plugin named by `pluginId`, read where the
 * act is performed. A caller that passes one plugin's id with another's patterns has already lost
 * the boundary, which is why every call site here reads both out of the same record.
 *
 * Never throws, for the reason the other one does not.
 */
export function resolvePluginExternalLink(
    pluginId: string,
    request: BlueprintOpenExternalRequest,
    patterns: readonly string[] | undefined,
): { allowed: true; url: string } | { allowed: false; result: BlueprintOpenExternalResult } {
    const url = String(request?.url ?? "").trim();
    if (!url || !isExternalLinkPatternDeclared(patterns, url)) {
        return {
            allowed: false,
            result: {
                outcome: "refused",
                error: pluginExternalLinkRefusalMessage(String(pluginId ?? ""), url),
            },
        };
    }
    return { allowed: true, url };
}

/**
 * Just enough of a plugin record to answer "what did this one declare".
 *
 * Structural rather than an import of the manifest type, so the three shells can pass what they
 * already hold - pack entries on the packaged game and the web export, install descriptors in Dev
 * Mode - without any of them building a second list for this to read. Every field is optional
 * because two of those three arrive as parsed JSON from disk.
 */
export type ExternalLinkDeclaringPlugin = {
    manifest?: {
        id?: string;
        contributes?: { externalLinks?: string[] };
    };
};

/**
 * Find the plugin `pluginId` names and decide the request against *its* declaration.
 *
 * The one place the lookup happens, so "a plugin's own patterns and only its own" is one line of
 * code rather than the same line written three times in three shells with three chances to drift.
 *
 * An id that names nothing in the list declares nothing, and so does a list that is missing
 * entirely: both refuse. That is what makes an unknown id - a typo, a plugin that did not ship in
 * this build, a name invented by a caller - the safe case rather than an unhandled one.
 */
export function resolvePluginExternalLinkAmong(
    plugins: readonly ExternalLinkDeclaringPlugin[] | undefined,
    pluginId: string,
    request: BlueprintOpenExternalRequest,
): { allowed: true; url: string } | { allowed: false; result: BlueprintOpenExternalResult } {
    const id = String(pluginId ?? "");
    const entry = (plugins ?? []).find(plugin => plugin.manifest?.id === id);
    return resolvePluginExternalLink(id, request, entry?.manifest?.contributes?.externalLinks);
}
