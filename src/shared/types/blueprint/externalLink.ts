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
 * The scheme, and only the scheme. Any address the author writes may be opened, wired or typed,
 * with no list to keep and nothing to declare - the author wrote the graph, so an address in it is
 * the author's decision, and asking them to copy it into a second place only produced two places to
 * forget.
 *
 * What the scheme check is for is a different question, and it is not about trusting the author:
 * `shell.openExternal` hands the address to whatever the operating system registered for it. A
 * `file:` address runs that file's handler, and for `.exe`, `.bat` and `.lnk` that is execution on
 * the player's machine; `javascript:` and `data:` are not addresses at all. So the reachable set is
 * an allowlist rather than a denylist of the four known-bad ones: any software the player installs
 * can register a new scheme, and a denylist cannot be kept ahead of that.
 *
 * `mailto:` is in the set because a contact link is an ordinary thing for a game to have and the
 * handler behind it composes a message rather than running anything. An author who needs a scheme
 * outside the set - `steam:` is the one that comes up - reaches it through a plugin, where the
 * pattern is named in the manifest and approved by name at install.
 *
 * ## The other regime
 *
 * A *plugin* opening an address is a different question with a different answer, and the two are
 * kept apart deliberately - see {@link resolvePluginExternalLink} at the bottom of this file. That
 * one takes wildcard patterns, reaches any scheme the pattern language allows, and is authorized at
 * install time rather than by the author writing it into a graph.
 *
 * ## What this is not
 *
 * It is not a network permission. No request is made and no bytes come back into the game; the page
 * is handed to the browser the player already uses. So it is not gated on the project's network
 * settings, and turning the network off does not disable it.
 *
 * Comments in English per project convention.
 */

import { isExternalLinkPatternDeclared } from "../externalLinkPattern";

/**
 * The schemes the Open Link node can reach. See the note at the top of this file for why this is an
 * allowlist and why `mailto:` is in it.
 */
export const CORE_EXTERNAL_LINK_SCHEMES: readonly string[] = ["http:", "https:", "mailto:"];

/**
 * One address as it is opened: parsed, and in the form `URL` reads it back out as.
 *
 * Null for anything that is not an address this node can open, which is the whole check. Parsed
 * rather than pattern-matched because the platform will parse it too, and a string that only looks
 * like an address to a regular expression is exactly the case worth refusing.
 */
export function normalizeCoreExternalLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!CORE_EXTERNAL_LINK_SCHEMES.includes(parsed.protocol.toLowerCase())) {
    return null;
  }
  // Credentials in an address handed to a browser read as one host and go to another
  // (`https://store.example.com@evil.test/`), and no page a game shows a player carries a
  // password. Refused here for the reason the pattern language refuses them in a declaration.
  if (parsed.username || parsed.password) {
    return null;
  }
  return parsed.href;
}

export type BlueprintOpenExternalRequest = {
  url: string;
};

/**
 * Which execution pin the Open Link node leaves by.
 *
 * `refused` is the address being one this node never opens, and it is separate from `failed`
 * because the two have different answers: a refusal is fixed by writing a different address, while
 * a failure is the player's machine having nothing to open it with.
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
 * fact: which address was asked for, and that its scheme is not one this node opens. It names the
 * reachable set rather than saying "not allowed", because the author's next move depends on knowing
 * that a page is fine and the thing they wrote is not a page.
 */
export function externalLinkRefusalMessage(url: string): string {
  return (
    `Open Link cannot open ${url.trim() || "(none)"}. ` +
    `Addresses must be ${CORE_EXTERNAL_LINK_SCHEMES.join(", ")}; ` +
    "other schemes are reached through a plugin that declares them."
  );
}

/**
 * Decide one request from the Open Link node.
 *
 * Never throws: the node branches on the outcome, and an exception would leave the graph with
 * nowhere to go. Performing the act is the caller's - each shell opens a page its own way, and the
 * only thing they must share is this decision.
 */
export function resolveCoreExternalLink(
  request: BlueprintOpenExternalRequest
): { allowed: true; url: string } | { allowed: false; result: BlueprintOpenExternalResult } {
  const url = String(request?.url ?? "");
  const normalized = normalizeCoreExternalLinkUrl(url);
  if (!normalized) {
    return {
      allowed: false,
      result: { outcome: "refused", error: externalLinkRefusalMessage(url) }
    };
  }
  return { allowed: true, url: normalized };
}

/**
 * The line a shell writes when it refuses a *plugin's* request.
 *
 * Same shape as the one above, with the fact this case has and that one does not: whose
 * declaration was consulted. A plugin's patterns are its own, so "not declared" is always a
 * statement about one plugin, and a message that left the name out would send an author looking
 * through their own project for a list that has nothing to do with it.
 *
 * The remedy is different from the node's too, and says so: an address the author writes is the
 * author's to change, while a plugin's is part of what was approved at install, so changing it
 * means a new version of the plugin and a fresh approval.
 */
export function pluginExternalLinkRefusalMessage(pluginId: string, url: string): string {
  return (
    `The plugin ${pluginId.trim() || "(unknown)"} does not declare the address ` +
    `${url.trim() || "(none)"}. ` +
    "Add it to the plugin's contributes.externalLinks and reinstall the plugin to open it."
  );
}

/**
 * Decide one plugin request against the patterns that plugin declared.
 *
 * The counterpart of {@link resolveCoreExternalLink}, and separate from it on purpose - the two
 * regimes answer different questions and must not be able to answer each other's. This one takes
 * wildcard patterns rather than deciding an address on its scheme alone, reaches any scheme the
 * pattern language allows, and is never consulted for the Open Link node. Its result type is
 * shared because a refusal is the same event either way: the graph or the plugin is told which
 * address was refused and gets on with something else.
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
  patterns: readonly string[] | undefined
): { allowed: true; url: string } | { allowed: false; result: BlueprintOpenExternalResult } {
  const url = String(request?.url ?? "").trim();
  if (!url || !isExternalLinkPatternDeclared(patterns, url)) {
    return {
      allowed: false,
      result: {
        outcome: "refused",
        error: pluginExternalLinkRefusalMessage(String(pluginId ?? ""), url)
      }
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
  request: BlueprintOpenExternalRequest
): { allowed: true; url: string } | { allowed: false; result: BlueprintOpenExternalResult } {
  const id = String(pluginId ?? "");
  const entry = (plugins ?? []).find((plugin) => plugin.manifest?.id === id);
  return resolvePluginExternalLink(id, request, entry?.manifest?.contributes?.externalLinks);
}
