import type {
    DownloadRewriteOutcome,
    DownloadRewriteRule,
} from "@shared/types/downloadSource";

/**
 * Applying the author's download rewrites to one URL.
 *
 * Pure and dependency-free so it can sit on both sides of the process boundary: the main
 * process calls it at every fetch site, and the build worker - which is deliberately
 * electron-free - calls it with rules handed over in its config, the same way
 * `electronMirror` already travels.
 *
 * The whole security surface is {@link rewriteDownloadUrl}: a rewrite may move a download to
 * another https host and may do nothing else. It cannot downgrade to http, cannot reach
 * `file:` or `data:`, and cannot be supplied by a renderer - the rules come from global
 * state, read in main, exactly as `plugins.registryUrl` already is.
 */

/** A rule is only usable if it is on and actually says something. */
function isUsable(rule: DownloadRewriteRule): boolean {
    return rule.enabled && rule.from.trim().length > 0 && rule.to.trim().length > 0;
}

/**
 * Rewrite `url` with the first enabled rule whose `from` it starts with.
 *
 * Returns the original URL when no rule matches, and *also* when a rule matched but produced
 * something unusable - with `refused` set. Falling back rather than throwing is deliberate: a
 * malformed mirror must not be able to stop an author from downloading anything at all, and
 * the caller logs the refusal so it is not silent either.
 */
export function rewriteDownloadUrl(
    url: string,
    rules: readonly DownloadRewriteRule[] | undefined | null,
): DownloadRewriteOutcome {
    if (!Array.isArray(rules) || rules.length === 0) {
        return { url };
    }
    for (const rule of rules) {
        if (!isUsable(rule)) {
            continue;
        }
        const from = rule.from.trim();
        if (!url.startsWith(from)) {
            continue;
        }
        const candidate = `${rule.to.trim()}${url.slice(from.length)}`;
        let parsed: URL;
        try {
            parsed = new URL(candidate);
        } catch {
            return { url, refused: "unparseable" };
        }
        if (parsed.protocol !== "https:") {
            return { url, refused: "not-https" };
        }
        return { url: candidate, applied: rule };
    }
    return { url };
}

/**
 * Drop anything a hand-edited `global.json` (or an imported settings document) could have put
 * where the rule array belongs.
 *
 * Applied on read rather than on write because the store is a file an author can open; the
 * write path validating alone would leave the read path trusting whatever survived.
 */
export function normalizeRewriteRules(value: unknown): DownloadRewriteRule[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const rules: DownloadRewriteRule[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") {
            continue;
        }
        const record = raw as Record<string, unknown>;
        const from = typeof record.from === "string" ? record.from.trim() : "";
        const to = typeof record.to === "string" ? record.to.trim() : "";
        if (!from || !to) {
            continue;
        }
        rules.push({ from, to, enabled: record.enabled !== false });
    }
    return rules;
}

/**
 * A source URL as the feature that reads it should see it: the configured value, trimmed, or
 * the official default when nothing is configured.
 *
 * The one place the "empty means official" convention is spelled out. Every source setting
 * documents it and three separate readers had grown their own copy.
 */
export function resolveDownloadSource(configured: unknown, officialDefault: string): string {
    const trimmed = typeof configured === "string" ? configured.trim() : "";
    return trimmed.length > 0 ? trimmed : officialDefault;
}

/**
 * Describe what a rewrite did, for the log line R4 requires.
 *
 * Returns null when nothing happened, so a caller can `const line = describe(...); if (line)`
 * without deciding for itself what counts as worth saying.
 */
export function describeRewrite(original: string, outcome: DownloadRewriteOutcome): string | null {
    if (outcome.refused === "unparseable") {
        return `download rewrite ignored for ${original}: the rewritten address is not a valid URL`;
    }
    if (outcome.refused === "not-https") {
        return `download rewrite ignored for ${original}: the rewritten address is not https`;
    }
    if (outcome.applied) {
        return `download rewritten: ${original} -> ${outcome.url}`;
    }
    return null;
}
