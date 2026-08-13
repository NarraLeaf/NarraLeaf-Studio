/**
 * Project -> Linting: whether a build runs the project check, what stops it, and how much each
 * rule matters.
 *
 * Three things here are deliberate and easy to undo by accident:
 *
 *  - **Every write stays sparse.** Choosing a rule's own default DELETES its entry instead of
 *    storing it, and so does an option value that equals its declared default. A config that
 *    accumulated every default would freeze today's defaults into every project that ever opened
 *    this page, so improving a default later would reach nobody.
 *  - **Option editors are rendered from `LintRuleOptionSpec`, never from a rule id.** Only
 *    `text/overlong` declares options today; the next rule that declares one gets its editor here
 *    for free, which is the entire reason the spec exists.
 *  - **A rule's description is only ever in the hint popover.** Twenty-six rows that each explained
 *    themselves in a sentence would be a wall of prose; the title says what the rule is, the popover
 *    says what it looks for.
 *
 * This page deliberately does NOT use the shared `SettingShell` card that Settings and Game use. A
 * bordered, filled card per row reads as a grouped setting at the four-to-six rows those pages have;
 * at twenty-six rules plus their options it becomes a wall of boxes, which is what this page looked
 * like when it shipped. This is a registry list, not a handful of settings, so it gets list
 * treatment - the panel's own dense-row idiom (a plain row, a hairline, no fill). `SettingShell` is
 * left alone rather than given a variant, because the sibling pages are right to keep their cards.
 */

import { useCallback, useMemo, useState } from "react";
import { HintPopover, Select, Switch, type SelectOption } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    LINT_CATEGORY_ORDER,
    LINT_RULES_BY_CATEGORY,
    resolveRuleOptions,
    type LintRule,
    type LintRuleOptionSpec,
    type LintRuleSeverity,
} from "@/lib/lint";
import {
    normalizeLintingConfiguration,
    type LintingConfiguration,
} from "@/lib/workspace/project/configuration";
import { NumberField } from "./NumberField";
import type { ProjectSectionProps } from "./types";

/**
 * One row of this page: a label on the left, its control on the right, and nothing else. Rows are
 * separated by the space between them and by their category heading - a per-row border would put
 * twenty-six more lines on a page whose whole problem was too much furniture.
 *
 * The label truncates rather than wraps so every row is the same height and the controls stay on one
 * axis; the full text is in the hint popover next to it either way.
 */
function LintRow({
    title,
    hint,
    tooltip,
    children,
}: {
    title: string;
    hint?: string;
    /** Hover text for the row - the freeze reason, which a disabled control never reports itself. */
    tooltip?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-3 py-0.5" data-tip={tooltip}>
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-fg">
                <span className="truncate">{title}</span>
                {hint && <HintPopover text={hint} />}
            </div>
            {children}
        </div>
    );
}

/** Worst first; `off` last, because it is the absence of a severity rather than a lighter one. */
const SEVERITY_CHOICES: readonly LintRuleSeverity[] = ["error", "warning", "info", "off"];

type FailBuildOn = LintingConfiguration["failBuildOn"];

const FAIL_BUILD_ON_CHOICES: readonly FailBuildOn[] = ["error", "warning"];

const FAIL_BUILD_ON_LABEL_KEYS: Record<FailBuildOn, TranslationKey> = {
    error: "lint.settings.failBuildOnError",
    warning: "lint.settings.failBuildOnWarning",
};

/** `maxChars` -> `MaxChars`, so an option key composes into its i18n key. */
function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Bounds for a number option that declared none - `NumberField` needs a range to validate against. */
const NUMBER_OPTION_MIN = 0;
const NUMBER_OPTION_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Widths for the three selects on this page. Stated together because the constraint they answer to
 * is the panel's, not each control's: this is a sidebar, and a select sized by its own longest label
 * pushes its row past the panel edge and turns the whole section into a horizontal scroller.
 *
 * `fullWidth` at every call site is what makes these bite. Without it the trigger is an inline-flex
 * sized by its content, and the `truncate` on its label never engages - the width below is then only
 * a suggestion the control is free to ignore, which is exactly what it did.
 *
 * The rule and threshold selects keep `shrink-0` so the severity column stays one width down the
 * whole list - ragged control widths are what would make a flat list look untidy, and their labels
 * are single words ("Warning", "Errors") with nothing to ellipse anyway. The row's title gives
 * instead, by truncating. The option select also gives: it sits inset under its rule, so it has the
 * least room and the longest labels, and an option value is the one label here that reads half-shown.
 */
const RULE_SELECT_CLASS = "w-24 shrink-0";
// w-36, not w-40: at w-40 the threshold row's own title ("Stop the build on") missed fitting by two
// pixels and ellipsed, which is a poor look for one of only two settings at the top of the page.
const THRESHOLD_SELECT_CLASS = "w-36 shrink-0";
const OPTION_SELECT_CLASS = "w-40 min-w-0 max-w-full";

export function ProjectLintingSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t, has } = useTranslation();
    // `LintRow` is a plain frame with no freeze awareness of its own, so every control on this page
    // is guarded from here.
    const freeze = useFreezeGuard();
    const [linting, setLinting] = useState<LintingConfiguration>(
        () => normalizeLintingConfiguration(config.app?.linting),
    );
    const [saving, setSaving] = useState<string | null>(null);

    const commit = useCallback(async (field: string, patch: Partial<LintingConfiguration>) => {
        if (saving) {
            return;
        }
        const previous = linting;
        setSaving(field);
        setLinting(current => ({ ...current, ...patch }));
        try {
            const updated = await projectService.updateLintingConfiguration(patch);
            setLinting(normalizeLintingConfiguration(updated.app?.linting));
            onConfigChange(updated);
        } catch (error) {
            setLinting(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(null);
        }
    }, [linting, onConfigChange, projectService, saving, uiService]);

    /**
     * A rule (or an option) whose string is missing still has to be configurable, so fall back to
     * the literal id rather than rendering a raw key. Only reachable for a rule added without its
     * catalogue entries - `registry.test.ts` fails the build for a registered rule missing one.
     */
    const text = useCallback(
        (key: string, fallback: string) => (has(key) ? t(key as TranslationKey) : fallback),
        [has, t],
    );

    const severityOptions: SelectOption[] = useMemo(
        () => SEVERITY_CHOICES.map(severity => ({
            value: severity,
            label: t(`lint.severity.${severity}`),
        })),
        [t],
    );

    const failBuildOnOptions: SelectOption[] = useMemo(
        () => FAIL_BUILD_ON_CHOICES.map(choice => ({
            value: choice,
            label: t(FAIL_BUILD_ON_LABEL_KEYS[choice]),
        })),
        [t],
    );

    /** Store the choice only when it differs from the rule's own default (see the header). */
    const setRuleSeverity = useCallback((rule: LintRule, next: LintRuleSeverity) => {
        const severities = { ...linting.severities };
        if (next === rule.defaultSeverity) {
            delete severities[rule.id];
        } else {
            severities[rule.id] = next;
        }
        void commit(rule.id, { severities });
    }, [commit, linting.severities]);

    /**
     * Same sparseness for options, one level deeper: a rule whose last overridden option goes back
     * to its default loses its whole entry rather than keeping an empty record.
     */
    const setRuleOption = useCallback((
        rule: LintRule,
        key: string,
        spec: LintRuleOptionSpec,
        next: string | number,
    ) => {
        const options = { ...linting.options };
        const entry = { ...(options[rule.id] ?? {}) };
        if (next === spec.default) {
            delete entry[key];
        } else {
            entry[key] = next;
        }
        if (Object.keys(entry).length === 0) {
            delete options[rule.id];
        } else {
            options[rule.id] = entry;
        }
        void commit(`${rule.id}:${key}`, { options });
    }, [commit, linting.options]);

    const renderOption = (rule: LintRule, key: string, spec: LintRuleOptionSpec, value: string | number) => {
        const label = text(`lint.settings.option${capitalize(key)}`, key);
        const frozen = freeze.writes(saving === `${rule.id}:${key}`);
        return (
            <LintRow key={key} title={label} tooltip={frozen["data-tip"]}>
                {spec.kind === "number" ? (
                    <NumberField
                        value={Number(value)}
                        min={spec.min ?? NUMBER_OPTION_MIN}
                        max={spec.max ?? NUMBER_OPTION_MAX}
                        disabled={frozen.disabled}
                        ariaLabel={label}
                        onCommit={next => setRuleOption(rule, key, spec, next)}
                    />
                ) : (
                    <Select
                        options={spec.values.map(choice => ({
                            value: choice,
                            label: text(`lint.settings.${key}${capitalize(choice)}`, choice),
                        }))}
                        value={String(value)}
                        disabled={frozen.disabled}
                        onChange={next => setRuleOption(rule, key, spec, String(next))}
                        size="sm"
                        portalMenu
                        className={OPTION_SELECT_CLASS}
                        fullWidth
                        ariaLabel={label}
                    />
                )}
            </LintRow>
        );
    };

    const renderRule = (rule: LintRule) => {
        const severity = linting.severities[rule.id] ?? rule.defaultSeverity;
        const optionSpecs = Object.entries(rule.options ?? {});
        const optionValues = optionSpecs.length > 0 ? resolveRuleOptions(rule, linting.options[rule.id]) : {};
        const frozen = freeze.writes(saving === rule.id);
        const title = text(`lint.rule.${rule.slug}.title`, rule.id);
        return (
            // `min-w-0` on every nesting level down to the option rows: a grid item is minimum-sized
            // by its content unless told otherwise, so without it one wide row widens the column and
            // every other row with it - the panel would scroll sideways because of a rule the reader
            // is not even looking at.
            <div key={rule.id} className="grid min-w-0">
                <LintRow
                    title={title}
                    hint={text(`lint.rule.${rule.slug}.description`, rule.id)}
                    tooltip={frozen["data-tip"]}
                >
                    <Select
                        options={severityOptions}
                        value={severity}
                        disabled={frozen.disabled}
                        onChange={next => setRuleSeverity(rule, next as LintRuleSeverity)}
                        size="sm"
                        portalMenu
                        className={RULE_SELECT_CLASS}
                        fullWidth
                        ariaLabel={title}
                    />
                </LintRow>
                {optionSpecs.length > 0 ? (
                    // Indented under the rule it belongs to: an option row on its own would read as a
                    // twenty-seventh rule. The hairline is the one piece of furniture kept, because it
                    // is what says "these belong to the rule above" now that nothing is boxed.
                    <div className="ml-1 grid min-w-0 border-l border-edge pl-3">
                        {optionSpecs.map(([key, spec]) => renderOption(rule, key, spec, optionValues[key]))}
                    </div>
                ) : null}
            </div>
        );
    };

    const runOnBuildFrozen = freeze.writes(saving === "runOnBuild");
    const failBuildOnFrozen = freeze.writes(!linting.runOnBuild || saving === "failBuildOn");
    return (
        <div className="grid min-w-0">
            <LintRow
                title={t("lint.settings.runOnBuild")}
                hint={t("lint.settings.runOnBuildHint")}
                tooltip={runOnBuildFrozen["data-tip"]}
            >
                <Switch
                    size="sm"
                    checked={linting.runOnBuild}
                    loading={saving === "runOnBuild"}
                    disabled={runOnBuildFrozen.disabled}
                    onCheckedChange={value => void commit("runOnBuild", { runOnBuild: value })}
                    aria-label={t("lint.settings.runOnBuild")}
                />
            </LintRow>
            <LintRow
                title={t("lint.settings.failBuildOn")}
                // Disabled rather than hidden while the check is off, the same bargain the auto-save
                // interval makes with its own switch: the threshold is still what this project would
                // fail on, and a row that vanishes reads as a missing setting.
                tooltip={failBuildOnFrozen["data-tip"]}
            >
                <Select
                    options={failBuildOnOptions}
                    value={linting.failBuildOn}
                    disabled={failBuildOnFrozen.disabled}
                    onChange={value => void commit("failBuildOn", { failBuildOn: value as FailBuildOn })}
                    size="sm"
                    portalMenu
                    className={THRESHOLD_SELECT_CLASS}
                    fullWidth
                    ariaLabel={t("lint.settings.failBuildOn")}
                />
            </LintRow>

            {/* The one rule that governs the build, then the rules it governs. A single hairline says
                that much better than boxing either group. */}
            {LINT_CATEGORY_ORDER.map((category, index) => (
                <div key={category} className="grid min-w-0">
                    <FieldLabel
                        as="div"
                        className={`mb-0.5 px-0.5 ${index === 0 ? "mt-3 border-t border-edge pt-3" : "mt-3"}`}
                    >
                        {t(`lint.category.${category}`)}
                    </FieldLabel>
                    {LINT_RULES_BY_CATEGORY[category].map(rule => renderRule(rule))}
                </div>
            ))}
        </div>
    );
}
