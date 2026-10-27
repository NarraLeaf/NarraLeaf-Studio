import type { LintFinding, LintRule, LintRuleOptions } from "../types";
import type { LintContext } from "../context";
import { inlineTextEffectRegistry } from "../../plugins/inlineTextEffectRegistry";
import { widgetModuleRegistry } from "../../ui-editor/widget-modules/registryInstance";
import {
    measureSegmentWidth,
    type LintTextCountMode,
} from "./text/displayWidth";
import {
    isBlankSegment,
    listLiveTextSegments,
    storyBlockTarget,
    storyLocation,
} from "./text/textSegments";

/**
 * `text` - what the dialogue box will actually be asked to hold.
 *
 * `text/overlong` counts East-Asian wide characters as two by default, because a 60-character
 * Chinese line overflows the same box a 120-character English one fits. `countMode: "codePoints"`
 * is there for projects whose script is entirely Latin and who would rather see the raw length.
 *
 * Both rules read the shared live-segment walk (`./text/textSegments`), so a disabled row - which
 * the compiler strips - is never reported: the point of the check is what a player will see.
 */

/** Options arrive already merged with the declared defaults (see `resolveRuleOptions`). */
function readCountMode(options: LintRuleOptions): LintTextCountMode {
    return options.countMode === "codePoints" ? "codePoints" : "eastAsianWidth";
}

function readMaxChars(options: LintRuleOptions): number {
    const value = options.maxChars;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 120;
}

/**
 * Every rendered line wider than the configured maximum.
 *
 * Applied to all four player-facing kinds rather than to dialogue alone: a choice button and a
 * choice prompt overflow their box the same way a spoken line does, and a 121-column option is as
 * much a layout defect as a 121-column line. Interpolated runs contribute nothing to the count -
 * their rendered width depends on a save file this rule cannot see (see `segmentLiteralText`).
 */
function runOverlong(ctx: LintContext, options: LintRuleOptions): LintFinding[] {
    const mode = readCountMode(options);
    const max = readMaxChars(options);
    const findings: LintFinding[] = [];
    for (const ref of listLiveTextSegments(ctx)) {
        const width = measureSegmentWidth(ref.segment, mode);
        if (width <= max) {
            continue;
        }
        findings.push({
            ruleId: "text/overlong",
            messageKey: "lint.rule.textOverlong.message",
            messageParams: { width, max },
            location: storyLocation(ref),
            target: storyBlockTarget(ref),
        });
    }
    return findings;
}

/**
 * A live line with nothing in it.
 *
 * Narration, dialogue and choice options only. A choice *prompt* is optional by design - an author
 * who leaves it blank is stating "no prompt", not shipping an empty line - so a blank one is not a
 * finding. "Nothing in it" follows the compiler: a line made only of an interpolation or of an
 * inline event still renders and is not empty.
 */
function runEmpty(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = [];
    for (const ref of listLiveTextSegments(ctx)) {
        if (ref.kind === "choicePrompt" || !isBlankSegment(ref.segment)) {
            continue;
        }
        findings.push({
            ruleId: "text/empty",
            messageKey: "lint.rule.textEmpty.message",
            location: storyLocation(ref),
            target: storyBlockTarget(ref),
        });
    }
    return findings;
}

/**
 * A live line with text set in an inline effect that no loaded plugin provides.
 *
 * The game draws such a run as plain text, and the build refuses to ship a project whose effects'
 * plugin it cannot package, so this is where the author finds which line it is. One finding per line
 * and effect, naming the effect: its id says which plugin is missing.
 *
 * Stands down when no widget is registered at all, the reading `ui/unknown-widget` makes of the same
 * state: that is not a workspace, and nothing would be loaded to provide any effect.
 */
function runUnknownEffect(ctx: LintContext): LintFinding[] {
    if (widgetModuleRegistry.list().length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const ref of listLiveTextSegments(ctx)) {
        const reported = new Set<string>();
        for (const run of ref.segment.rich ?? []) {
            const id = "marks" in run ? run.marks?.effect?.id : undefined;
            if (!id || reported.has(id) || inlineTextEffectRegistry.get(id)) {
                continue;
            }
            reported.add(id);
            findings.push({
                ruleId: "text/unknown-effect",
                messageKey: "lint.rule.textUnknownEffect.message",
                messageParams: { effect: id },
                location: storyLocation(ref),
                target: storyBlockTarget(ref),
            });
        }
    }
    return findings;
}

export const TEXT_LINT_RULES: readonly LintRule[] = [
    {
        id: "text/overlong",
        category: "text",
        defaultSeverity: "warning",
        slug: "textOverlong",
        options: {
            maxChars: { kind: "number", default: 120, min: 1, max: 2000 },
            countMode: {
                kind: "enum",
                default: "eastAsianWidth",
                values: ["eastAsianWidth", "codePoints"],
            },
        },
        run: runOverlong,
    },
    {
        id: "text/empty",
        category: "text",
        defaultSeverity: "warning",
        slug: "textEmpty",
        run: ctx => runEmpty(ctx),
    },
    {
        id: "text/unknown-effect",
        category: "text",
        // An error, like `ui/unknown-widget`: the build cannot package what draws the run.
        defaultSeverity: "error",
        slug: "textUnknownEffect",
        run: ctx => runUnknownEffect(ctx),
    },
];
