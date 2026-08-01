import type { LintContext } from "./context";
import { LINT_RULES } from "./rules";
import {
    LINT_CATEGORY_ORDER,
    LINT_SEVERITY_ORDER,
    type LintFinding,
    type LintLocation,
    type LintReport,
    type LintReportEntry,
    type LintRule,
    type LintRuleId,
    type LintRuleOptionSpec,
    type LintRuleOptions,
    type LintSeverity,
} from "./types";

/**
 * The lint engine: one sequential pass over the registry.
 *
 * Three behaviours are deliberate and each has cost the alternative:
 *
 *  - **Sequential, with a yield between rules.** Running the rules concurrently would finish sooner
 *    and freeze the window while it did - a whole-project sweep on a real VN is seconds of
 *    synchronous work. Yielding between rules is what keeps the progress bar moving and the cancel
 *    button clickable, which matters more than the wall clock.
 *  - **A throwing rule does not abort the sweep.** One bad rule taking down the report would make
 *    lint useless exactly when the project is in the broken state lint is for. The failure becomes
 *    an `error` finding against the project, so it is visible rather than swallowed.
 *  - **Cancellation keeps what it has.** The partial report is returned with the unrun rules in
 *    `skipped`, so a cancelled run reads as "these rules did not run" instead of as a clean bill.
 */

export type LintProgress = {
    done: number;
    total: number;
    ruleId: LintRuleId;
};

export type LintRunOptions = {
    signal?: AbortSignal;
    onProgress?: (progress: LintProgress) => void;
    /** Override the rule set. Tests only - production always sweeps the whole registry. */
    rules?: readonly LintRule[];
};

/** Message key used when a rule throws; params: `rule`. */
export const LINT_RULE_FAILED_MESSAGE_KEY = "lint.message.ruleFailed" as const;

export async function runLintRules(ctx: LintContext, options: LintRunOptions = {}): Promise<LintReport> {
    const rules = options.rules ?? LINT_RULES;
    const startedAt = Date.now();
    const entries: LintReportEntry[] = [];
    const rulesRun: LintRuleId[] = [];
    const skipped: LintRuleId[] = [];

    // Resolved up front so `skipped` is complete even if the sweep is cancelled halfway: a rule the
    // project turned off is skipped whether or not we ever reached it.
    const scheduled: { rule: LintRule; severity: LintSeverity }[] = [];
    for (const rule of rules) {
        const severity = resolveSeverity(ctx, rule);
        if (severity === "off") {
            skipped.push(rule.id);
            continue;
        }
        scheduled.push({ rule, severity });
    }

    let done = 0;
    for (let index = 0; index < scheduled.length; index++) {
        const { rule, severity } = scheduled[index];
        if (options.signal?.aborted) {
            for (let rest = index; rest < scheduled.length; rest++) {
                skipped.push(scheduled[rest].rule.id);
            }
            break;
        }

        // Between rules, not after the last one: the final yield would only delay the report.
        if (index > 0) {
            await yieldToEventLoop();
        }

        rulesRun.push(rule.id);
        let findings: LintFinding[];
        try {
            findings = await rule.run(ctx, resolveRuleOptions(rule));
        } catch (error) {
            console.error(`[lint] rule ${rule.id} failed`, error);
            findings = [
                {
                    ruleId: rule.id,
                    messageKey: LINT_RULE_FAILED_MESSAGE_KEY,
                    messageParams: { rule: rule.id },
                    location: { kind: "project" },
                },
            ];
            // A rule that blew up is a defect in Studio, not a style preference the project
            // configured - it is reported at `error` regardless of the rule's own severity.
            for (const finding of findings) {
                entries.push({ ...finding, severity: "error" });
            }
            done += 1;
            options.onProgress?.({ done, total: scheduled.length, ruleId: rule.id });
            continue;
        }

        for (const finding of findings) {
            entries.push({ ...finding, severity });
        }
        done += 1;
        options.onProgress?.({ done, total: scheduled.length, ruleId: rule.id });
    }

    entries.sort(compareEntries);

    return {
        startedAt,
        finishedAt: Date.now(),
        entries,
        counts: countBySeverity(entries),
        rulesRun,
        skipped,
    };
}

/** `config.severities[id]` when the project set one, the rule's own default otherwise. */
export function resolveSeverity(ctx: LintContext, rule: LintRule) {
    return ctx.config.severities[rule.id] ?? rule.defaultSeverity;
}

/**
 * Declared defaults, overridden by whatever the project stored and the spec accepts. A stored value
 * of the wrong kind (or outside the declared range) is dropped rather than clamped: it means the
 * config was hand-edited or predates a spec change, and the default is the only value we know is
 * meaningful.
 */
export function resolveRuleOptions(rule: LintRule, stored?: Record<string, string | number>): LintRuleOptions {
    const specs = rule.options;
    if (!specs) {
        return {};
    }
    const configured = stored ?? {};
    const resolved: LintRuleOptions = {};
    for (const [key, spec] of Object.entries(specs)) {
        resolved[key] = coerceOption(spec, configured[key]);
    }
    return resolved;
}

function coerceOption(spec: LintRuleOptionSpec, value: unknown): string | number {
    if (spec.kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return spec.default;
        }
        if (spec.min !== undefined && value < spec.min) {
            return spec.default;
        }
        if (spec.max !== undefined && value > spec.max) {
            return spec.default;
        }
        return value;
    }
    return typeof value === "string" && spec.values.includes(value) ? value : spec.default;
}

function countBySeverity(entries: readonly LintReportEntry[]): LintReport["counts"] {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const entry of entries) {
        counts[entry.severity] += 1;
    }
    return counts;
}

/** Severity, then category, then rule id, then location - stable and locale-independent. */
function compareEntries(a: LintReportEntry, b: LintReportEntry): number {
    const bySeverity = LINT_SEVERITY_ORDER[a.severity] - LINT_SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) {
        return bySeverity;
    }
    const byCategory = categoryRank(a.ruleId) - categoryRank(b.ruleId);
    if (byCategory !== 0) {
        return byCategory;
    }
    if (a.ruleId !== b.ruleId) {
        return a.ruleId < b.ruleId ? -1 : 1;
    }
    const aKey = locationSortKey(a.location);
    const bKey = locationSortKey(b.location);
    return aKey === bKey ? 0 : aKey < bKey ? -1 : 1;
}

/**
 * Rank by the id's own prefix rather than by looking the rule up in the registry: entries survive
 * the run (they are handed to a report tab) and must sort the same way even for a rule set the
 * registry does not contain, which is exactly the case in the engine tests.
 */
function categoryRank(ruleId: LintRuleId): number {
    const prefix = ruleId.split("/")[0];
    const index = LINT_CATEGORY_ORDER.indexOf(prefix as (typeof LINT_CATEGORY_ORDER)[number]);
    return index === -1 ? LINT_CATEGORY_ORDER.length : index;
}

export function locationSortKey(location: LintLocation): string {
    switch (location.kind) {
        case "project":
            return "project";
        case "asset":
            return `asset ${location.assetName} ${location.assetId}`;
        case "story":
            return [
                "story",
                location.storyName,
                location.storyId,
                location.sceneName ?? "",
                location.sceneId ?? "",
                location.blockId ?? "",
            ].join(" ");
        case "blueprint":
            return [
                "blueprint",
                location.blueprintName ?? "",
                location.blueprintId,
                location.graphId ?? "",
                location.nodeId ?? "",
            ].join(" ");
        case "character":
            return `character ${location.characterName} ${location.characterId}`;
    }
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
