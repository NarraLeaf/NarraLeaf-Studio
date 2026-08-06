import { voiceLineText, type VoiceUnit } from "@shared/types/voice";
import { isSourceHashStale } from "@shared/utils/localizationText";
import type { LintContext } from "../context";
import type { LintFinding, LintRule } from "../types";
import {
    isBlankSegment,
    legacyVoiceAssetId,
    listLiveTextSegments,
    segmentSourceText,
    storyBlockTarget,
    storyLocation,
    SPOKEN_TEXT_SEGMENT_KINDS,
    type LintTextSegmentRef,
} from "./text/textSegments";

/**
 * `voice` - whether the recorded takes still match the script.
 *
 * Silent (`[]`) when `ctx.voice` is null - see the note on the localization rules; the same R5
 * reasoning applies to a project that has not set up `voicedLocales`.
 *
 * **Scope of `voice/missing`: spoken lines only - narration and dialogue.** A choice button and a
 * choice prompt are read by the player, not by an actor; the voice module has never listed them
 * (`extractVoiceableRows` filters to the same two roles), so flagging them would invent a coverage
 * gap the recording script never contained and would roughly double the finding count on any
 * choice-heavy VN - drowning the real gaps. `voice/stale` and `voice/orphan` deliberately do NOT
 * narrow that way: they act on units that exist, and a project that did record a choice line (by
 * importing a take against its unit id) must still be told when that recording goes out of date or
 * loses its line.
 */

/** A unit only counts once it actually points at an imported clip. */
function hasClip(unit: VoiceUnit | undefined): unit is VoiceUnit {
    return Boolean(unit && unit.assetId);
}

function voicedSegments(ctx: LintContext): LintTextSegmentRef[] {
    return listLiveTextSegments(ctx).filter(ref => !isBlankSegment(ref.segment));
}

/**
 * A spoken line with no recording in a voiced language.
 *
 * The precedence mirrors the compiler exactly (`storyCompiler`: the scene voice map is consulted
 * first and the row's legacy `voiceAssetId` is the inline fallback the engine tries when the map has
 * no entry, `scene.getVoice(id) || voice`). A line carrying only the legacy field therefore plays,
 * and is not a finding - a lint that disagreed with the shipped game would be worse than no lint.
 *
 * The legacy field is language-agnostic: it silences the finding in every voiced locale, because
 * that single clip is what every locale will play.
 */
function runMissing(ctx: LintContext): LintFinding[] {
    const voice = ctx.voice;
    if (!voice || voice.voicedLocales.length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const ref of voicedSegments(ctx)) {
        if (!SPOKEN_TEXT_SEGMENT_KINDS.includes(ref.kind)) {
            continue;
        }
        if (legacyVoiceAssetId(ref.block)) {
            continue;
        }
        for (const locale of voice.voicedLocales) {
            if (hasClip(voice.documents.get(locale)?.units[ref.textId])) {
                continue;
            }
            findings.push(finding(ref, "lint.rule.voiceMissing.message", locale, "voice/missing"));
        }
    }
    return findings;
}

/**
 * A take recorded against text the author has since rewritten - the clip now says the wrong words.
 *
 * Measured per language against the text an actor for THAT language reads (`voiceLineText`): a
 * Japanese take goes stale when the Japanese line changes, not when the English source does. Judging
 * every dub by the source line got both directions wrong at once - rewriting a translation left its
 * own take looking current, and rewriting one source line reported every language as stale.
 */
function runStale(ctx: LintContext): LintFinding[] {
    const voice = ctx.voice;
    if (!voice || voice.voicedLocales.length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const ref of voicedSegments(ctx)) {
        const sourceText = segmentSourceText(ref.segment);
        for (const locale of voice.voicedLocales) {
            const unit = voice.documents.get(locale)?.units[ref.textId];
            const lineText = voiceLineText(ctx.localization?.documents.get(locale), ref.textId, sourceText);
            if (!hasClip(unit) || !isSourceHashStale(unit.sourceHash, lineText)) {
                continue;
            }
            findings.push(finding(ref, "lint.rule.voiceStale.message", locale, "voice/stale"));
        }
    }
    return findings;
}

/**
 * A recording whose line is gone - deleted, or disabled out of the game.
 *
 * Measured against every live segment rather than only the spoken ones: a unit imported against a
 * choice line is unusual but real, and calling it orphaned while its line is still in the script
 * would be a false report that costs an author an audio file.
 *
 * **One finding per locale, carrying a count** - for the reason spelled out on `localization/orphan`:
 * an orphan's row is what is missing, so it has no location beyond the project and no jump target,
 * and one finding per unit rendered as N identical unactionable rows. A locale with no orphans emits
 * nothing.
 */
function runOrphan(ctx: LintContext): LintFinding[] {
    const voice = ctx.voice;
    if (!voice || voice.voicedLocales.length === 0) {
        return [];
    }
    const liveTextIds = new Set(listLiveTextSegments(ctx).map(ref => ref.textId));
    const findings: LintFinding[] = [];
    for (const locale of voice.voicedLocales) {
        const document = voice.documents.get(locale);
        if (!document) {
            continue;
        }
        const count = Object.keys(document.units).filter(unitId => !liveTextIds.has(unitId)).length;
        if (count === 0) {
            continue;
        }
        findings.push({
            ruleId: "voice/orphan",
            messageKey: "lint.rule.voiceOrphan.message",
            messageParams: { count, locale },
            location: { kind: "project" },
        });
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
        location: storyLocation(ref),
        target: storyBlockTarget(ref),
    };
}

export const VOICE_LINT_RULES: readonly LintRule[] = [
    {
        id: "voice/missing",
        category: "voice",
        defaultSeverity: "warning",
        slug: "voiceMissing",
        run: ctx => runMissing(ctx),
    },
    {
        id: "voice/stale",
        category: "voice",
        defaultSeverity: "warning",
        slug: "voiceStale",
        run: ctx => runStale(ctx),
    },
    {
        id: "voice/orphan",
        category: "voice",
        defaultSeverity: "info",
        slug: "voiceOrphan",
        run: ctx => runOrphan(ctx),
    },
];
