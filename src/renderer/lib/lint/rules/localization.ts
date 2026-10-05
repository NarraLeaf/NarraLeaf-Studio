import { localizationKeyUnitId, type LocalizationUnit } from "@shared/types/localization";
import { isSourceHashStale, segmentHasMarkup, validateMarkupParity } from "@shared/utils/localizationText";
import { deriveUnitState } from "../../workspace/services/localization/localizationModel";
import type { LintContext, LintLocalizationContext } from "../context";
import type { LintFinding, LintLocation, LintRule } from "../types";
import {
    isBlankSegment,
    listLiveTextSegments,
    segmentSourceText,
    storyLocation,
    type LintTextSegmentRef,
} from "./text/textSegments";
import { indexUITextWriters } from "@shared/types/ui-editor/textWriters";
import { clipLiteral, listInterfaceTextUnitSites } from "./ui";

/**
 * `localization` - whether the translation files still describe the script they were made from.
 *
 * All three return `[]` when `ctx.localization` is null (ruling R5): a project with no target
 * locales is not "passing" these checks, it simply has nothing to check. They stay on so the day a
 * locale is added, the findings appear without anyone revisiting a settings panel.
 *
 * `missing` and `stale` read two kinds of text: the story's lines, and the interface's words that a
 * widget reads through a translation unit (a named key, or the widget's own opted-in unit). Both are
 * rows of the same per-locale document and both fall back to the source words in game, so a missing
 * Save-button translation is the same defect as a missing line. Orphan and markup stay story-only:
 * an interface unit's orphan is a namespaced id, and a widget literal carries no run markup.
 *
 * Two shapes the whole file depends on:
 *
 *  - **The source locale is never a target.** Source text is what the compiler emits directly; it
 *    has no translation unit and cannot be missing one.
 *  - **`sourceHash` is compared through `isSourceHashStale`, never rehashed here.** The hash stored
 *    in every unit was produced by `serializeSegmentSourceText` + `hashSourceText`; a second
 *    implementation of either would make lint and the translation panel disagree about which lines
 *    are stale, and the panel is the one the author fixes them in.
 */

/** Target locales, with the source locale excluded however it was configured. */
function targetLocales(localization: LintLocalizationContext): string[] {
    return localization.targetLocales.filter(locale => locale && locale !== localization.sourceLocale);
}

/** Live lines that carry something to translate. A blank line is `text/empty`'s finding, not this one. */
function translatableSegments(ctx: LintContext): LintTextSegmentRef[] {
    return listLiveTextSegments(ctx).filter(ref => !isBlankSegment(ref.segment));
}

/** Interface words read through a translation unit: one row of the localization panel. */
type InterfaceTextUnit = {
    unitId: string;
    /** What the unit is hashed against - the key's source words, or the widget's own literal. */
    sourceText: string;
    location: LintLocation;
};

/**
 * The interface text a target locale is expected to translate, one entry per unit.
 *
 * Read from the widgets the way the game reads them (`listInterfaceTextUnitSites`), and resolved
 * against the same two sources the localization panel lists - the key registry for a named key, the
 * widget's literal for its own unit - so a row the panel shows as untranslated is the row reported
 * here, and nothing the panel has no row for is.
 *
 * **One entry per unit, not per widget.** The Save button of five pages reads one key, and the
 * author translates it once; five findings for one missing row would be one defect charged five
 * times. The first widget found carries the finding, so the locator still names a page and a widget
 * the author can see.
 *
 * A widget naming a key the registry does not have is left out: there is no source to translate, and
 * the dangling name is a different defect. So is every named key when the registry could not be read
 * - `null` is "not known", and reading it as "no keys" would report a pass that was never checked.
 */
function interfaceTextUnits(ctx: LintContext): InterfaceTextUnit[] {
    if (!ctx.uiDocument) {
        return [];
    }
    const units: InterfaceTextUnit[] = [];
    const seen = new Set<string>();
    for (const site of listInterfaceTextUnitSites(ctx.uiDocument, indexUITextWriters(ctx.blueprintDocument))) {
        let unit: InterfaceTextUnit;
        if (site.binding.kind === "key") {
            const sourceText = ctx.localizationKeys?.get(site.binding.keyName);
            if (sourceText === undefined || !sourceText.trim()) {
                continue;
            }
            unit = {
                unitId: localizationKeyUnitId(site.binding.keyName),
                sourceText,
                location: site.location,
            };
        } else {
            unit = {
                unitId: site.binding.unitId,
                sourceText: site.binding.sourceText,
                location: site.location,
            };
        }
        if (seen.has(unit.unitId)) {
            continue;
        }
        seen.add(unit.unitId);
        units.push(unit);
    }
    return units;
}

function interfaceFinding(
    unit: InterfaceTextUnit,
    messageKey: LintFinding["messageKey"],
    locale: string,
    ruleId: LintFinding["ruleId"],
): LintFinding {
    return {
        ruleId,
        messageKey,
        // The words themselves, because a page location has no excerpt and they are what tells the
        // Save button's finding from the Load button's.
        messageParams: { locale, text: clipLiteral(unit.sourceText) },
        location: unit.location,
        // The page only shows the words; the translation is typed into that language's table, in its
        // row among the interface's words - a named key's row as much as a widget's own.
        target: { kind: "translation", locale, unitId: unit.unitId },
    };
}

/** A unit with no text renders as the source line - for authors that is "not translated yet". */
function hasTranslation(unit: LocalizationUnit | undefined): unit is LocalizationUnit {
    return Boolean(unit && unit.target.trim());
}

/**
 * A translated line the target locale does not have.
 *
 * **`deriveUnitState` is the single authority on what "not translated yet" means, and this rule does
 * not get a second opinion.** It used to have one: it also reported a unit whose stored `status` was
 * still `"untranslated"` even though it carried a real target - while `deriveUnitState`, which is
 * what the localization editor paints that same row with, calls exactly that unit *translated*
 * (`status === "untranslated" ? "translated" : status` - a target present outranks a stale flag left
 * by an import). Two surfaces contradicting each other about one row is worse than either answer, so
 * the rule now asks the function the editor asks.
 *
 * Two consequences worth naming, both accepted:
 *
 *  - `messageUntranslated` no longer has a case to render and is gone from both catalogues.
 *  - A whitespace-only target ("   ") is not reported. `deriveUnitState` tests `!unit.target`, not a
 *    trimmed one, so the editor shows that unit as translated - and a lint that disagreed would be
 *    re-opening the very split this fix closes. Re-trimming here would also be exactly the
 *    duplicated logic this change exists to remove.
 *
 * A `"stale"` unit is not reported here either: `localization/stale` owns it, and charging one line
 * twice for one defect is what that rule's guard already avoids from its side.
 *
 * Locale fallback chains are deliberately not walked: a `zh-TW` line covered only by its `zh`
 * fallback is still an untranslated `zh-TW` line, and the author asking for this report wants to see
 * it.
 */
function runMissing(ctx: LintContext): LintFinding[] {
    const localization = ctx.localization;
    if (!localization) {
        return [];
    }
    const locales = targetLocales(localization);
    if (locales.length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const ref of translatableSegments(ctx)) {
        const sourceText = segmentSourceText(ref.segment);
        for (const locale of locales) {
            const unit = localization.documents.get(locale)?.units[ref.textId];
            if (deriveUnitState(unit, sourceText) !== "untranslated") {
                continue;
            }
            findings.push(finding(ref, "lint.rule.localizationMissing.message", locale, "localization/missing"));
        }
    }
    for (const unit of interfaceTextUnits(ctx)) {
        for (const locale of locales) {
            const stored = localization.documents.get(locale)?.units[unit.unitId];
            if (deriveUnitState(stored, unit.sourceText) !== "untranslated") {
                continue;
            }
            findings.push(interfaceFinding(unit, "lint.rule.localizationMissing.messageInterface", locale, "localization/missing"));
        }
    }
    return findings;
}

/** A translation made against text the author has since rewritten. */
function runStale(ctx: LintContext): LintFinding[] {
    const localization = ctx.localization;
    if (!localization) {
        return [];
    }
    const locales = targetLocales(localization);
    if (locales.length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const ref of translatableSegments(ctx)) {
        const sourceText = segmentSourceText(ref.segment);
        for (const locale of locales) {
            const unit = localization.documents.get(locale)?.units[ref.textId];
            // An empty unit is reported by `localization/missing`; reporting it here as well would
            // charge one line twice for one defect.
            if (!hasTranslation(unit) || !isSourceHashStale(unit.sourceHash, sourceText)) {
                continue;
            }
            findings.push(finding(ref, "lint.rule.localizationStale.message", locale, "localization/stale"));
        }
    }
    for (const unit of interfaceTextUnits(ctx)) {
        for (const locale of locales) {
            const stored = localization.documents.get(locale)?.units[unit.unitId];
            if (!hasTranslation(stored) || !isSourceHashStale(stored.sourceHash, unit.sourceText)) {
                continue;
            }
            findings.push(interfaceFinding(unit, "lint.rule.localizationStale.messageInterface", locale, "localization/stale"));
        }
    }
    return findings;
}

/**
 * A translation whose line is gone.
 *
 * The unit id space is shared: `key:<name>` (named developer strings), `char:<id>` (character
 * nametags), `scene:<id>` (scene names) and `ui:<element>.<prop>` (widget text) live in the same
 * per-locale document and are not story lines at all. Story `textId`s are UUID v4, which cannot
 * contain a colon - so a namespaced id is excluded by construction rather than by chasing the list
 * of namespaces as it grows.
 *
 * A disabled row's unit does read as an orphan, and that is correct: the row is not in the game, so
 * neither is the line it would have translated. `info` severity is what keeps that honest rather
 * than alarming.
 *
 * **One finding per locale, carrying a count.** An orphan has no story row to point at - its row is
 * what is gone - so every finding here has `location: {kind: "project"}`. Emitted
 * per unit, N orphans rendered as N byte-identical rows at project scope: unreadable, unactionable,
 * and enough to bury the rest of the report on any project that has ever renamed a scene. The
 * author's move is the same one whatever the number is (open that language's table), so the number
 * is what the finding carries. A locale with no orphans emits nothing at all.
 *
 * Opening one lands on that language's table, which is as near as there is: the table lists the
 * project's lines, so a translation of a line that is not there has no row in it to reveal, and the
 * table can neither show nor remove one.
 */
function runOrphan(ctx: LintContext): LintFinding[] {
    const localization = ctx.localization;
    if (!localization) {
        return [];
    }
    const locales = targetLocales(localization);
    if (locales.length === 0) {
        return [];
    }
    const liveTextIds = new Set(listLiveTextSegments(ctx).map(ref => ref.textId));
    const findings: LintFinding[] = [];
    for (const locale of locales) {
        const document = localization.documents.get(locale);
        if (!document) {
            continue;
        }
        const count = Object.keys(document.units).filter(
            unitId => !unitId.includes(":") && !liveTextIds.has(unitId),
        ).length;
        if (count === 0) {
            continue;
        }
        findings.push({
            ruleId: "localization/orphan",
            messageKey: "lint.rule.localizationOrphan.message",
            messageParams: { count, locale },
            messageParamCounts: { translations: { key: "lint.rule.localizationOrphan.translationCount", count } },
            location: { kind: "project" },
            target: { kind: "translation", locale },
        });
    }
    return findings;
}

/**
 * A translation that renders plainly where the line does not.
 *
 * This is the one drift `localization/stale` cannot see, and deliberately so: a translation is
 * hashed against the line's plain text, precisely so that restyling a sentence does not invalidate
 * work already done in nine languages. The cost of that ruling is that emphasis added after the
 * translation was written leaves no trace anywhere - the unit still reads `translated`, and the
 * player of that language simply never sees the stress the author put on the word. This rule is
 * where it leaves a trace.
 *
 * Reported at `info`, not `warning`: dropping a mark is a decision a translator is entitled to make
 * (a phrase that wants emphasis in Japanese may want none in English), and a line that renders
 * plainly still renders. It is a list to read through, not a queue to clear.
 *
 * A tag naming a run the line does not have is in the same finding rather than its own rule - both
 * are answered by opening that unit and looking at the source beside it.
 */
function runMarkup(ctx: LintContext): LintFinding[] {
    const localization = ctx.localization;
    if (!localization) {
        return [];
    }
    const locales = targetLocales(localization);
    if (locales.length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const ref of translatableSegments(ctx)) {
        if (!segmentHasMarkup(ref.segment)) {
            continue;
        }
        for (const locale of locales) {
            const unit = localization.documents.get(locale)?.units[ref.textId];
            // A line with no translation at all renders in the source language, styling included -
            // `localization/missing` owns that one.
            if (!hasTranslation(unit)) {
                continue;
            }
            const issues = validateMarkupParity(unit.target, ref.segment);
            if (issues.length === 0) {
                continue;
            }
            findings.push(finding(ref, "lint.rule.localizationMarkup.message", locale, "localization/markup"));
        }
    }
    return findings;
}

function finding(
    ref: LintTextSegmentRef,
    messageKey: LintFinding["messageKey"],
    locale: string,
    ruleId: LintFinding["ruleId"],
): LintFinding {
    return {
        ruleId,
        messageKey,
        messageParams: { locale },
        // Filed under the line, which is what the report groups and numbers by; opened in the
        // language's table, at the line's row, which is where its translation is typed.
        location: storyLocation(ref),
        target: { kind: "translation", locale, unitId: ref.textId, storyId: ref.story.id },
    };
}

export const LOCALIZATION_LINT_RULES: readonly LintRule[] = [
    {
        id: "localization/missing",
        category: "localization",
        defaultSeverity: "warning",
        slug: "localizationMissing",
        run: ctx => runMissing(ctx),
    },
    {
        id: "localization/stale",
        category: "localization",
        defaultSeverity: "warning",
        slug: "localizationStale",
        run: ctx => runStale(ctx),
    },
    {
        id: "localization/markup",
        category: "localization",
        defaultSeverity: "info",
        slug: "localizationMarkup",
        run: ctx => runMarkup(ctx),
    },
    {
        id: "localization/orphan",
        category: "localization",
        defaultSeverity: "info",
        slug: "localizationOrphan",
        run: ctx => runOrphan(ctx),
    },
];
