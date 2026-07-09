/**
 * Source-text serialization and translated-text parsing for game localization.
 *
 * A story text segment is serialized to a translator-facing plain string where
 * each inline interpolation run becomes a numbered `{n}` placeholder (n = the
 * interpolation's order of appearance). Styling marks and pauses are invisible
 * here on purpose: restyling a line must not invalidate its translations.
 *
 * The same serialized form is hashed (FNV-1a) into `LocalizationUnit.sourceHash`
 * so staleness can be derived at read time.
 *
 * Comments in English per project convention.
 */

import type { StoryTextSegment } from "../types/story/document";
import { fnv1aHex } from "./contentHash";

const SOURCE_HASH_PREFIX = "fnv1a:";

/** Serialize a segment to translator-facing text: plain runs verbatim, interpolations as `{n}`. */
export function serializeSegmentSourceText(segment: StoryTextSegment): string {
    if (!segment.rich || segment.rich.length === 0) {
        return segment.value;
    }
    let out = "";
    let interpolationIndex = 0;
    for (const run of segment.rich) {
        if ("pause" in run) {
            continue;
        }
        if ("interpolation" in run) {
            out += `{${interpolationIndex}}`;
            interpolationIndex += 1;
            continue;
        }
        out += run.text;
    }
    return out;
}

/** Count of inline interpolation runs (the valid `{n}` placeholder range in translations). */
export function countSegmentInterpolations(segment: StoryTextSegment): number {
    if (!segment.rich) {
        return 0;
    }
    return segment.rich.reduce((count, run) => count + ("interpolation" in run ? 1 : 0), 0);
}

export function hashSourceText(sourceText: string): string {
    return `${SOURCE_HASH_PREFIX}${fnv1aHex(sourceText)}`;
}

/** True when a stored unit was translated against a different source text. */
export function isSourceHashStale(sourceHash: string, currentSourceText: string): boolean {
    return sourceHash !== hashSourceText(currentSourceText);
}

export type TranslatedTextPart =
    | { kind: "text"; text: string }
    | { kind: "placeholder"; index: number };

const PLACEHOLDER_PATTERN = /\{(\d+)\}/g;

export type PlaceholderParityIssue =
    /** The translation references `{index}` but the source has no such interpolation. */
    | { kind: "outOfRange"; index: number }
    /** The source interpolation `{index}` is never referenced by the translation. */
    | { kind: "missing"; index: number };

/**
 * Validate a translation's `{n}` placeholders against the source segment's
 * interpolation count. Out-of-range references are always defects (they render
 * as nothing); missing references are warnings (a translator may drop a value
 * deliberately, but it is usually an oversight).
 */
export function validatePlaceholderParity(target: string, interpolationCount: number): PlaceholderParityIssue[] {
    const referenced = new Set<number>();
    for (const part of parseTranslatedText(target)) {
        if (part.kind === "placeholder") {
            referenced.add(part.index);
        }
    }
    const issues: PlaceholderParityIssue[] = [];
    for (const index of [...referenced].sort((a, b) => a - b)) {
        if (index >= interpolationCount) {
            issues.push({ kind: "outOfRange", index });
        }
    }
    for (let index = 0; index < interpolationCount; index++) {
        if (!referenced.has(index)) {
            issues.push({ kind: "missing", index });
        }
    }
    return issues;
}

/** Split a translated string into literal chunks and `{n}` placeholder references. */
export function parseTranslatedText(target: string): TranslatedTextPart[] {
    const parts: TranslatedTextPart[] = [];
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(target)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ kind: "text", text: target.slice(lastIndex, match.index) });
        }
        parts.push({ kind: "placeholder", index: Number(match[1]) });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < target.length) {
        parts.push({ kind: "text", text: target.slice(lastIndex) });
    }
    return parts;
}
