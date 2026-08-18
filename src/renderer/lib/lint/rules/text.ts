import type { LintFinding, LintRule, LintRuleOptions } from "../types";
import type { LintContext } from "../context";
import { measureSegmentWidth, type LintTextCountMode } from "./text/displayWidth";
import {
  isBlankSegment,
  listLiveTextSegments,
  storyBlockTarget,
  storyLocation
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
      target: storyBlockTarget(ref)
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
      target: storyBlockTarget(ref)
    });
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
        values: ["eastAsianWidth", "codePoints"]
      }
    },
    run: runOverlong
  },
  {
    id: "text/empty",
    category: "text",
    defaultSeverity: "warning",
    slug: "textEmpty",
    run: (ctx) => runEmpty(ctx)
  }
];
