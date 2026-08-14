import { LINT_CATEGORY_ORDER, type LintCategory, type LintRule, type LintRuleId } from "../types";
import { ASSETS_LINT_RULES } from "./assets";
import { PORTABILITY_LINT_RULES } from "./portability";
import { NETWORK_LINT_RULES } from "./network";
import { STORY_LINT_RULES } from "./story";
import { BLUEPRINT_LINT_RULES } from "./blueprint";
import { UI_LINT_RULES } from "./ui";
import { VARIABLES_LINT_RULES } from "./variables";
import { TEXT_LINT_RULES } from "./text";
import { LOCALIZATION_LINT_RULES } from "./localization";
import { VOICE_LINT_RULES } from "./voice";
import { BRAND_LINT_RULES } from "./brand";

/**
 * The rule registry - the one place that knows every rule exists.
 *
 * This file is owned by the framework, not by the rule authors: a category file is edited to fill
 * in a `run` body, never to add or remove an entry here. That split is what lets the category files
 * be worked on in parallel without anyone touching a shared file, and it is why `registry.test.ts`
 * asserts the id list against a literal - a new rule should be a deliberate edit in two places, not
 * something that appears because an array grew.
 */
export const LINT_RULES: readonly LintRule[] = [
    ...ASSETS_LINT_RULES,
    ...PORTABILITY_LINT_RULES,
    ...NETWORK_LINT_RULES,
    ...STORY_LINT_RULES,
    ...BLUEPRINT_LINT_RULES,
    ...UI_LINT_RULES,
    ...VARIABLES_LINT_RULES,
    ...TEXT_LINT_RULES,
    ...LOCALIZATION_LINT_RULES,
    ...VOICE_LINT_RULES,
    ...BRAND_LINT_RULES,
];

const RULES_BY_ID: ReadonlyMap<LintRuleId, LintRule> = new Map(LINT_RULES.map(rule => [rule.id, rule]));

export function getLintRule(id: LintRuleId): LintRule | undefined {
    return RULES_BY_ID.get(id);
}

/** Every category in display order, each with its rules in registry order. */
export const LINT_RULES_BY_CATEGORY: Readonly<Record<LintCategory, readonly LintRule[]>> =
    Object.freeze(
        LINT_CATEGORY_ORDER.reduce((acc, category) => {
            acc[category] = LINT_RULES.filter(rule => rule.category === category);
            return acc;
        }, {} as Record<LintCategory, readonly LintRule[]>),
    );

export { ASSETS_LINT_RULES } from "./assets";
export { PORTABILITY_LINT_RULES } from "./portability";
export { NETWORK_LINT_RULES, collectBlueprintNetworkNodes } from "./network";
export { STORY_LINT_RULES } from "./story";
export { BLUEPRINT_LINT_RULES, UNCHECKED_OPTIONS_SOURCES } from "./blueprint";
export { UI_LINT_RULES } from "./ui";
export { VARIABLES_LINT_RULES } from "./variables";
export { TEXT_LINT_RULES } from "./text";
export { LOCALIZATION_LINT_RULES } from "./localization";
export { VOICE_LINT_RULES } from "./voice";
export { BRAND_LINT_RULES, classifyBrandLink, collectBrokenBrandLinks } from "./brand";
