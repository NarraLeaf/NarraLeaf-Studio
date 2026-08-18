import type { LocalizationUnit } from "@shared/types/localization";
import { isSourceHashStale } from "@shared/utils/localizationText";
import { deriveUnitState } from "../../workspace/services/localization/localizationModel";
import type { LintContext, LintLocalizationContext } from "../context";
import type { LintFinding, LintRule } from "../types";
import {
  isBlankSegment,
  listLiveTextSegments,
  segmentSourceText,
  storyBlockTarget,
  storyLocation,
  type LintTextSegmentRef
} from "./text/textSegments";

/**
 * `localization` - whether the translation files still describe the script they were made from.
 *
 * All three return `[]` when `ctx.localization` is null (ruling R5): a project with no target
 * locales is not "passing" these checks, it simply has nothing to check. They stay on so the day a
 * locale is added, the findings appear without anyone revisiting a settings panel.
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
  return localization.targetLocales.filter(
    (locale) => locale && locale !== localization.sourceLocale
  );
}

/** Live lines that carry something to translate. A blank line is `text/empty`'s finding, not this one. */
function translatableSegments(ctx: LintContext): LintTextSegmentRef[] {
  return listLiveTextSegments(ctx).filter((ref) => !isBlankSegment(ref.segment));
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
      findings.push(
        finding(ref, "lint.rule.localizationMissing.message", locale, "localization/missing")
      );
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
      findings.push(
        finding(ref, "lint.rule.localizationStale.message", locale, "localization/stale")
      );
    }
  }
  return findings;
}

/**
 * A translation whose line is gone.
 *
 * The unit id space is shared: `key:<name>` (named developer strings), `char:<id>` (character
 * nametags) and `ui:<element>.<prop>` (widget text) live in the same per-locale document and are not
 * story lines at all. Story `textId`s are UUID v4, which cannot contain a colon - so a namespaced id
 * is excluded by construction rather than by chasing the list of namespaces as it grows.
 *
 * A disabled row's unit does read as an orphan, and that is correct: the row is not in the game, so
 * neither is the line it would have translated. `info` severity is what keeps that honest rather
 * than alarming.
 *
 * **One finding per locale, carrying a count.** An orphan has no story row to point at - its row is
 * what is gone - so every finding here has `location: {kind: "project"}` and no jump target. Emitted
 * per unit, N orphans rendered as N byte-identical rows at project scope: unreadable, unactionable,
 * and enough to bury the rest of the report on any project that has ever renamed a scene. The
 * author's move is the same one whatever the number is (open that locale and prune), so the number
 * is what the finding carries. A locale with no orphans emits nothing at all.
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
  const liveTextIds = new Set(listLiveTextSegments(ctx).map((ref) => ref.textId));
  const findings: LintFinding[] = [];
  for (const locale of locales) {
    const document = localization.documents.get(locale);
    if (!document) {
      continue;
    }
    const count = Object.keys(document.units).filter(
      (unitId) => !unitId.includes(":") && !liveTextIds.has(unitId)
    ).length;
    if (count === 0) {
      continue;
    }
    findings.push({
      ruleId: "localization/orphan",
      messageKey: "lint.rule.localizationOrphan.message",
      messageParams: { count, locale },
      location: { kind: "project" }
    });
  }
  return findings;
}

function finding(
  ref: LintTextSegmentRef,
  messageKey: LintFinding["messageKey"],
  locale: string,
  ruleId: LintFinding["ruleId"]
): LintFinding {
  return {
    ruleId,
    messageKey,
    messageParams: { locale },
    location: storyLocation(ref),
    target: storyBlockTarget(ref)
  };
}

export const LOCALIZATION_LINT_RULES: readonly LintRule[] = [
  {
    id: "localization/missing",
    category: "localization",
    defaultSeverity: "warning",
    slug: "localizationMissing",
    run: (ctx) => runMissing(ctx)
  },
  {
    id: "localization/stale",
    category: "localization",
    defaultSeverity: "warning",
    slug: "localizationStale",
    run: (ctx) => runStale(ctx)
  },
  {
    id: "localization/orphan",
    category: "localization",
    defaultSeverity: "info",
    slug: "localizationOrphan",
    run: (ctx) => runOrphan(ctx)
  }
];
