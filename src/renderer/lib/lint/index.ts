/**
 * Project lint - the public surface.
 *
 * Rule authors import from `../types` and `../context` directly (they live inside); everything
 * outside `lib/lint` should come through here.
 */
export type {
    LintCategory,
    LintFinding,
    LintLocation,
    LintReport,
    LintReportEntry,
    LintRule,
    LintRuleId,
    LintRuleMeta,
    LintRuleOptionSpec,
    LintRuleOptions,
    LintRuleSeverity,
    LintRulelessId,
    LintSeverity,
    RegisteredLintRuleId,
} from "./types";
export {
    LINT_CATEGORY_ORDER,
    LINT_RULELESS_IDS,
    LINT_SEVERITY_ORDER,
    deriveLintRuleSlug,
    isLintRulelessId,
} from "./types";
export { describeStoryLoadFailure, storyUnreadableFinding } from "./storyLoadFailure";
export type {
    LintAssetEntry,
    LintCharacterEntry,
    LintContext,
    LintImageProbe,
    LintIo,
    LintLocalizationContext,
    LintStoryEntry,
    LintVoiceContext,
    PersistentNameCollision,
} from "./context";
export { createTestLintContext } from "./testContext";
export { LINT_RULES, LINT_RULES_BY_CATEGORY, getLintRule } from "./rules";
export { runLintRules, resolveRuleOptions, resolveSeverity, LINT_RULE_FAILED_MESSAGE_KEY } from "./engine";
export type { LintProgress, LintRunOptions } from "./engine";
