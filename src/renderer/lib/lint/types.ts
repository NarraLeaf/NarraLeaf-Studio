import type { TranslationKey } from "@shared/i18n/catalog";
import type { SearchJumpTarget } from "../workspace/services/search/searchIndexModel";
import type { LintContext } from "./context";

/**
 * Project lint - the vocabulary.
 *
 * The engine is one loop over a registry of pure rules (see `engine.ts`); this file is what a rule
 * is allowed to say. Three decisions are load-bearing and worth knowing before editing anything
 * here:
 *
 *  - **Rules never build prose.** A finding carries a `messageKey` plus params, never a rendered
 *    sentence. The report tab, the console channel and the build gate each render it their own way
 *    (and in the user's locale, which a rule running during a build has no business deciding).
 *  - **Severity is not on the finding.** A rule states what it found; the *project* states how much
 *    that matters. Resolving `config.severities[id] ?? rule.defaultSeverity` happens once, in the
 *    engine, so a rule can never smuggle an un-configurable error past the settings panel.
 *  - **Options are declared, not read ad hoc.** `LintRuleOptionSpec` exists so the settings UI can
 *    render an editor for a rule it has never heard of. A rule that reads an option it did not
 *    declare gets `undefined` and deserves it.
 */

export type LintSeverity = "error" | "warning" | "info";

/** A configured severity: the three real ones, plus the "do not run this at all" state. */
export type LintRuleSeverity = LintSeverity | "off";

export type LintCategory =
    | "assets"
    | "portability"
    | "network"
    | "story"
    | "blueprint"
    | "variables"
    | "text"
    | "localization"
    | "voice"
    | "brand";

/** Fixed presentation (and sort) order of categories. */
export const LINT_CATEGORY_ORDER: readonly LintCategory[] = [
    "assets",
    "portability",
    "network",
    "story",
    // Beside `story` rather than after `network`: the two answer the same question about the two
    // halves of a project - does every route this names still lead somewhere.
    "blueprint",
    "variables",
    "text",
    "localization",
    "voice",
    "brand",
] as const;

/** Error first, info last - the order findings are reported and rendered in. */
export const LINT_SEVERITY_ORDER: Record<LintSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
};

/**
 * Every rule id, spelled out.
 *
 * A closed union rather than `string`: the config maps ids to severities, and a typo in a stored
 * config or a UI call site should not silently address a rule that does not exist.
 */
export type LintRuleId =
    | "assets/unused"
    | "assets/missing"
    | "assets/unreadable"
    | "assets/oversized"
    | "portability/asset-name"
    | "portability/case-collision"
    | "portability/media-format"
    | "network/fetch-disallowed"
    | "network/fetch-not-allowlisted"
    | "story/invalid-command"
    | "story/goto-missing"
    | "story/label-duplicate"
    | "story/label-unused"
    | "story/jump-missing"
    | "story/empty-choice"
    | "story/dead-end"
    | "story/unreachable-scene"
    | "story/empty-scene"
    | "story/app-tag-unknown"
    | "story/cut-point-orphan"
    | "story/cut-point-unreachable"
    | "blueprint/reference-missing"
    | "blueprint/unreachable-node"
    | "blueprint/empty-event"
    | "blueprint/save-field-empty"
    | "variables/undeclared"
    | "variables/unused"
    | "variables/name-collision"
    | "variables/random-outside-assignment"
    | "text/overlong"
    | "text/empty"
    | "localization/missing"
    | "localization/stale"
    | "localization/orphan"
    | "voice/missing"
    | "voice/stale"
    | "voice/orphan"
    | "brand/broken-link";

/**
 * Where a finding lives.
 *
 * Coarser than the jump target on purpose: this is what the report *groups* by and what the console
 * line names, so it has to be readable without resolving anything. `target` carries the precise
 * deep link when there is one.
 */
export type LintLocation =
    | { kind: "project" }
    | { kind: "asset"; assetId: string; assetName: string }
    | {
          kind: "story";
          storyId: string;
          storyName: string;
          sceneId?: string;
          sceneName?: string;
          blockId?: string;
          /**
           * The row's number within its scene, 1-based - the very number the scene editor prints in
           * its gutter, so "line 12" in the report and "12" in the editor are the same row.
           *
           * Not written by rules: {@link annotateStoryLocation} resolves it from `blockId` once, for
           * every rule at once. A rule that names a row therefore cannot forget to number it, and a
           * rule added later gets the number for free.
           */
          line?: number;
          /**
           * The row's own words, clipped - the author's text, never a rendered description.
           *
           * It is what makes four hundred `localization/missing` findings tellable apart: "No zh
           * translation" is the same sentence on every one of them, and the line the author wrote is
           * the only thing that says *which* of them this is. Absent on rows that carry no text
           * (a jump, a `/show`), which is honest rather than a gap.
           */
          excerpt?: string;
      }
    | { kind: "blueprint"; blueprintId: string; blueprintName?: string; graphId?: string; nodeId?: string }
    | { kind: "character"; characterId: string; characterName: string };

/** What a rule emits. Severity is resolved from config when the report is assembled. */
export type LintFinding = {
    ruleId: LintRuleId;
    /** `lint.rule.<slug>.message` (or a declared variant); never a rendered sentence. */
    messageKey: TranslationKey;
    messageParams?: Record<string, string | number>;
    location: LintLocation;
    /** Reuse of the global-search navigation layer; absent when a site has no deep link. */
    target?: SearchJumpTarget;
};

export type LintReportEntry = LintFinding & { severity: LintSeverity };

export type LintReport = {
    startedAt: number;
    finishedAt: number;
    entries: LintReportEntry[];
    counts: { error: number; warning: number; info: number };
    rulesRun: LintRuleId[];
    /** Rules configured `off`, plus anything left unrun when the sweep was cancelled. */
    skipped: LintRuleId[];
};

/**
 * One tunable knob on a rule. The settings panel renders from this, so a new option kind means a
 * new editor there - keep the set small and boring.
 */
export type LintRuleOptionSpec =
    | { kind: "number"; default: number; min?: number; max?: number }
    | { kind: "enum"; default: string; values: readonly string[] };

/** Resolved option values handed to `run` - defaults merged with the project's overrides. */
export type LintRuleOptions = Record<string, string | number>;

export type LintRuleMeta = {
    id: LintRuleId;
    category: LintCategory;
    defaultSeverity: LintRuleSeverity;
    /** i18n: lint.rule.<slug>.title / .description */
    slug: string;
    options?: Record<string, LintRuleOptionSpec>;
};

export type LintRule = LintRuleMeta & {
    run(ctx: LintContext, options: LintRuleOptions): LintFinding[] | Promise<LintFinding[]>;
};

/**
 * `assets/unused` -> `assetsUnused`, `story/goto-missing` -> `storyGotoMissing`.
 *
 * The slug is written out literally on every rule (it is what the i18n keys are named after, and a
 * grep for `assetsUnused` should find both the rule and its strings), and the registry test asserts
 * each literal equals what this derives - so the two can never drift.
 */
export function deriveLintRuleSlug(id: LintRuleId): string {
    const words = id.split(/[/-]/).filter(Boolean);
    return words
        .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
        .join("");
}
