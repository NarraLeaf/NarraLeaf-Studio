import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryNodeActionPayload,
    StoryRichRun,
    StoryScene,
    StorySceneId,
    StoryTextSegment,
} from "@shared/types/story";
import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { assertValidStoryEntityId } from "@shared/utils/storyId";
import {
    isTextRun,
    normalizeRuns,
    richIfMeaningful,
    richRunsToPlain,
    segmentToRuns,
} from "@/apps/workspace/modules/story/scene-editor/richText";
import { getSegmentSlot } from "@/apps/workspace/modules/story/scene-editor/storyFindReplace";
import { canAcceptChildren } from "@services/story/storyModel";
import {
    STORY_SCRIPT_ANCHOR_CLOSE,
    STORY_SCRIPT_ANCHOR_OPEN,
    STORY_SCRIPT_FORMAT_VERSION,
    STORY_SCRIPT_NOTE_PREFIX,
    STORY_SCRIPT_OPAQUE_PREFIX,
    STORY_SCRIPT_OPTION_PREFIX,
    STORY_SCRIPT_RUN_CLOSE,
    STORY_SCRIPT_RUN_OPEN,
} from "./storyScriptTypes";
import type {
    ParsedStoryScript,
    ParsedStoryScriptLine,
    ParsedStoryScriptScene,
    StoryScriptDiagnostic,
    StoryScriptDiagnosticCode,
    StoryScriptExportOptions,
    StoryScriptImportPlan,
    StoryScriptLineShape,
    StoryScriptParseErrorCode,
    StoryScriptParseResult,
    StoryScriptPlanInput,
    StoryScriptScenePlan,
    StoryScriptSceneStats,
} from "./storyScriptTypes";

/**
 * Story Script codec: scene -> prose + snapshot, and back.
 *
 * The one structural idea, restated because everything else follows from it: **the `»` label is never
 * parsed**. A row the text layer cannot edit projects to a cosmetic label and comes back from `#data`
 * verbatim, keyed by its anchor. That is why this file has no payload switch, why growing the action
 * union costs it nothing, and why the merge is a question about four line shapes rather than forty.
 */

/** Two spaces per nesting level. The tree is rebuilt from this on import. */
const INDENT_UNIT = "  ";
/** Exactly one space between a line's prose and its anchor - import strips exactly that one. */
const ANCHOR_SEPARATOR = " ";

const HEADER_DIRECTIVE = "#nlscript";
const STORY_DIRECTIVE = "#story";
const SCENE_DIRECTIVE = "#scene";
const ORIGIN_DIRECTIVE = "#origin";
const DATAHASH_DIRECTIVE = "#datahash";
const DATA_DIRECTIVE = "#data";

/**
 * Characters that must never reach the reader as themselves: the four markers, the escape character,
 * and the three whitespace forms that would change the line structure.
 *
 * `:` is in here for one reason - `Speaker: text` is the dialogue shape, so a *narration* line reading
 * `他说: 你好` would come back as a line spoken by 他说. It is escaped only before a space, which is the
 * only sequence that can be misread, so ordinary colons stay readable.
 */
const ESCAPE = "\\";

/** Sigils that mean something only at the start of a line, so only a leading one needs escaping. */
const LINE_START_SIGILS = new Set(["#", "/", "-", "»"]);

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 64-bit, over UTF-8, rendered as 16 lowercase hex characters.
 *
 * **An integrity check against accidental corruption and file drift - explicitly NOT a security
 * boundary.** It catches a truncated download, a half-written save, an editor that mangled the footer,
 * and a snapshot taken from a scene that has since moved on. It catches nothing deliberate: FNV is not
 * a cryptographic hash and anyone editing the file can recompute it in one line. That is the correct
 * trade here, because the file is one the author exported themselves and the failure being defended
 * against is a mistake, not an attacker.
 *
 * Written out rather than taken from a dependency because the alternative in a renderer is
 * `crypto.subtle`, which is async - and an async digest would make `exportStoryScript` async, which
 * would make every one of its callers async, to defend against nothing.
 *
 * The arithmetic runs on four 16-bit limbs rather than `BigInt`: every partial product stays under
 * 2^31 so it is exact in a double, and the footer of a large story is hundreds of kilobytes, which is
 * hundreds of thousands of iterations.
 */
export function storyScriptDigest(text: string): string {
    // 0xcbf29ce484222325, the FNV-1a 64 offset basis, as [low..high] 16-bit limbs.
    const h = [0x2325, 0x8422, 0x9ce4, 0xcbf2];
    // 0x00000100000001b3, the FNV-1a 64 prime. Limbs 1 and 3 are zero, which is why the multiply below
    // has four products instead of ten.
    const bytes = new TextEncoder().encode(text);
    for (let index = 0; index < bytes.length; index += 1) {
        h[0] ^= bytes[index];
        const r0 = h[0] * 0x1b3;
        const r1 = h[1] * 0x1b3;
        const r2 = h[2] * 0x1b3 + h[0] * 0x100;
        const r3 = h[3] * 0x1b3 + h[1] * 0x100;
        h[0] = r0 & 0xffff;
        const c1 = r1 + (r0 >>> 16);
        h[1] = c1 & 0xffff;
        const c2 = r2 + (c1 >>> 16);
        h[2] = c2 & 0xffff;
        h[3] = (r3 + (c2 >>> 16)) & 0xffff;
    }
    return [h[3], h[2], h[1], h[0]].map(limb => limb.toString(16).padStart(4, "0")).join("");
}

/**
 * The bytes `#origin` and `#datahash` are taken over.
 *
 * Line endings are normalized and the outer whitespace trimmed *before* hashing, because the file's
 * whole point is that it travels through editors on other machines - and a great many of them rewrite
 * LF to CRLF, or add a final newline, on save. Those rewrites change the framing, never the content,
 * and a corruption check that fired on them would fire on almost every real import.
 */
function digestOfText(text: string): string {
    return storyScriptDigest(text.replace(/\r\n?/g, "\n").trim());
}

/**
 * Canonical JSON of a scene, for `#origin`.
 *
 * The `JSON.parse(JSON.stringify(...))` is not paranoia. `encodeCanonicalJson` throws on an
 * `undefined` property (`canonicalJson.ts:163`) and real story payloads carry them - a command spec
 * that writes `payload.color = undefined` is enough. Dropping them first is exactly what the file
 * itself does, since the snapshot is written through the same pass.
 */
function canonicalSceneJson(scene: StoryScene): string {
    return encodeCanonicalJson(JSON.parse(JSON.stringify(scene)) as unknown);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape author text so no character in it can be read as structure.
 *
 * Total by construction: every escape is `\` followed by exactly one character, and the reader turns
 * `\X` back into X for every X it does not otherwise know (`\n`, `\r`, `\t`). So there is no character
 * sequence - including a text made entirely of backslashes and anchor brackets - that survives the
 * round trip as anything but itself.
 */
function escapeInline(value: string): string {
    let out = "";
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        switch (char) {
            case ESCAPE:
                out += "\\\\";
                break;
            case "\n":
                out += "\\n";
                break;
            case "\r":
                out += "\\r";
                break;
            case "\t":
                out += "\\t";
                break;
            case STORY_SCRIPT_ANCHOR_OPEN:
            case STORY_SCRIPT_ANCHOR_CLOSE:
            case STORY_SCRIPT_RUN_OPEN:
            case STORY_SCRIPT_RUN_CLOSE:
                out += ESCAPE + char;
                break;
            case ":":
                // Only `: ` can be misread (as the dialogue separator); a bare colon stays readable.
                out += value[index + 1] === " " ? "\\:" : ":";
                break;
            default:
                out += char;
        }
    }
    return out;
}

/**
 * Escape the spaces at either end of a rendered text.
 *
 * Leading, because the indent is counted in spaces and a line starting with one would read as deeper
 * than it is. Trailing, because the anchor is separated by a space and the reader strips exactly one -
 * so the author's own trailing space has to be spelled differently from the separator.
 */
function escapeBoundarySpaces(value: string): string {
    // Measured on the input and applied once. Two chained `replace`s cannot do this: the leading run
    // is rewritten to `\ \ \ `, which *ends in a space*, and the trailing rule then escapes the escape.
    const leading = (/^ */.exec(value)?.[0].length ?? 0);
    if (leading === value.length) {
        return "\\ ".repeat(leading);
    }
    const trailing = (/ *$/.exec(value)?.[0].length ?? 0);
    return `${"\\ ".repeat(leading)}${value.slice(leading, value.length - trailing)}${"\\ ".repeat(trailing)}`;
}

/** Escape a leading `#`, `/`, `-` or `»`, which would otherwise be read as a directive or a prefix. */
function escapeLineStart(body: string): string {
    const first = body[0];
    return first !== undefined && LINE_START_SIGILS.has(first) ? ESCAPE + body : body;
}

/**
 * A `»` label, made safe to sit on a line. Not escaping - the label is never read back, so this only
 * has to keep it from impersonating an anchor or breaking the line in two.
 */
function sanitizeLabel(label: string): string {
    return label
        .replace(/[\r\n\t]+/g, " ")
        .replace(new RegExp(`[${STORY_SCRIPT_ANCHOR_OPEN}${STORY_SCRIPT_ANCHOR_CLOSE}]`, "g"), "")
        .trim();
}

// ---------------------------------------------------------------------------
// Rich runs <-> line text
// ---------------------------------------------------------------------------

/**
 * Project a segment's runs into line text.
 *
 * A plain text run is its own characters. Everything else is addressed by *index into this segment's
 * runs* rather than described: `‹4›` is "run 4, whatever it is", and a marked text run wraps its
 * characters in `‹4›…‹/4›` so the words stay editable while the styling stays a reference. The
 * consequence is that a pause, an interpolation and an inline event need no grammar of their own -
 * which is the same bargain the `»` label strikes, one level down.
 */
function renderRuns(runs: StoryRichRun[]): string {
    let out = "";
    for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        const open = `${STORY_SCRIPT_RUN_OPEN}${index}${STORY_SCRIPT_RUN_CLOSE}`;
        if (!isTextRun(run)) {
            out += open;
            continue;
        }
        if (!run.marks) {
            out += escapeInline(run.text);
            continue;
        }
        out += `${open}${escapeInline(run.text)}${STORY_SCRIPT_RUN_OPEN}/${index}${STORY_SCRIPT_RUN_CLOSE}`;
    }
    return escapeBoundarySpaces(out);
}

type ScriptToken =
    | { kind: "text"; value: string }
    | { kind: "marker"; index: number; close: boolean };

const MARKER_PATTERN = new RegExp(`^${STORY_SCRIPT_RUN_OPEN}(/?)(\\d+)${STORY_SCRIPT_RUN_CLOSE}`);

/** Split line text into literal text and run markers, unescaping as it goes (one pass, so an escaped `‹` never becomes a marker). */
function tokenizeLineText(raw: string): ScriptToken[] {
    const tokens: ScriptToken[] = [];
    let buffer = "";
    let index = 0;
    const flush = () => {
        if (buffer) {
            tokens.push({ kind: "text", value: buffer });
            buffer = "";
        }
    };
    while (index < raw.length) {
        const char = raw[index];
        if (char === ESCAPE) {
            const next = raw[index + 1];
            if (next === undefined) {
                // A lone trailing backslash can only come from a hand edit. Keep it as itself.
                buffer += ESCAPE;
                index += 1;
                continue;
            }
            buffer += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
            index += 2;
            continue;
        }
        if (char === STORY_SCRIPT_RUN_OPEN) {
            const match = MARKER_PATTERN.exec(raw.slice(index));
            if (match) {
                flush();
                tokens.push({ kind: "marker", close: match[1] === "/", index: Number(match[2]) });
                index += match[0].length;
                continue;
            }
        }
        buffer += char;
        index += 1;
    }
    flush();
    return tokens;
}

/**
 * Rebuild runs from tokens, taking every non-text run verbatim from the snapshot.
 *
 * `snapshotRuns` is empty for a line the author typed themselves, which is why a marker on a new line
 * is a dropped marker and not a crash.
 */
function tokensToRuns(
    tokens: ScriptToken[],
    snapshotRuns: StoryRichRun[],
    report: (code: StoryScriptDiagnosticCode, message: string) => void,
): StoryRichRun[] {
    const runs: StoryRichRun[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.kind === "text") {
            runs.push({ text: token.value });
            continue;
        }
        const source = snapshotRuns[token.index];
        if (!source) {
            report("unknownRun", `run ${token.index} is not in this row's snapshot; the marker was dropped`);
            continue;
        }
        if (token.close) {
            report("unknownRun", `closing marker for run ${token.index} has no opening marker; it was dropped`);
            continue;
        }
        if (!isTextRun(source)) {
            // An atomic run - pause, interpolation, inline event. It comes back as itself.
            runs.push(cloneJson(source));
            continue;
        }
        const closeAt = tokens.findIndex(
            (candidate, position) =>
                position > index && candidate.kind === "marker" && candidate.close && candidate.index === token.index,
        );
        if (closeAt < 0) {
            report("unknownRun", `run ${token.index} is styled text but its closing marker is gone; the marker was dropped`);
            continue;
        }
        // Marks are carried by the marker, so whatever the author left between the pair wears them.
        const marks = source.marks;
        for (const inner of tokensToRuns(tokens.slice(index + 1, closeAt), snapshotRuns, report)) {
            runs.push(isTextRun(inner) && marks ? { text: inner.text, marks: cloneJson(marks) } : inner);
        }
        index = closeAt;
    }
    return normalizeRuns(runs);
}

/**
 * A segment carrying new runs, keeping the segment's identity.
 *
 * `textId` is preserved by writing over the existing segment, and that is the single highest-stakes
 * line in this file: the id is simultaneously the localization unit and the engine's `voiceId`
 * (`lint/rules/text/textSegments.ts:42`), so minting a fresh one silently unbinds the row's
 * translations and its recorded voice take.
 *
 * `rich` is *deleted* rather than set to `undefined` when the content is plain. An `undefined`
 * property would throw in `encodeCanonicalJson` the next time the document is written.
 */
function segmentWithRuns(segment: StoryTextSegment, runs: StoryRichRun[]): StoryTextSegment {
    const rich = richIfMeaningful(runs);
    const next: StoryTextSegment = { ...segment, value: richRunsToPlain(runs) };
    if (rich) {
        next.rich = rich;
    } else {
        delete next.rich;
    }
    return next;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export function storyScriptLineShape(block: StoryBlock): StoryScriptLineShape {
    if (block.kind === "note") {
        return "note";
    }
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") {
            return "narration";
        }
        if (block.payload.action === "dialogue") {
            return "dialogue";
        }
        if (block.payload.action === "choiceOption") {
            return "choiceOption";
        }
    }
    // Including `choice` itself: its prompt is a row's *configuration*, edited in Studio, and letting
    // the text layer own it would mean the choice row had two representations to keep in step.
    return "opaque";
}

type StoryDialoguePayload = Extract<StoryNodeActionPayload, { action: "dialogue" }>;

const SEGMENT_ROLE: Record<Exclude<StoryScriptLineShape, "opaque">, StoryTextSegment["role"]> = {
    narration: "narration",
    dialogue: "dialogue",
    choiceOption: "choiceText",
    note: "note",
};

/** Every block of a scene with its nesting depth, in reading order. Mirrors `types/story/order.ts:30`, which cannot supply the depth. */
function walkSceneWithDepth(scene: StoryScene): Array<{ block: StoryBlock; depth: number }> {
    const ordered: Array<{ block: StoryBlock; depth: number }> = [];
    const seen = new Set<StoryBlockId>();
    const visit = (blockId: StoryBlockId, depth: number) => {
        if (seen.has(blockId)) {
            return;
        }
        seen.add(blockId);
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        ordered.push({ block, depth });
        for (const childId of block.childrenIds ?? []) {
            visit(childId, depth + 1);
        }
    };
    for (const rootId of scene.rootBlockIds ?? []) {
        visit(rootId, 0);
    }
    return ordered;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Render scenes as a Story Script file. See `storyScriptTypes.ts` for what the format guarantees.
 *
 * Deterministic to the byte: no clock, no ids minted, no key order borrowed from a record. Two exports
 * of the same document are the same file, which is what makes `review` mode diffable.
 */
export function exportStoryScript(
    document: StoryDocument,
    sceneIds: StorySceneId[],
    options: StoryScriptExportOptions,
): string {
    const roundtrip = options.mode === "roundtrip";
    const out: string[] = [`${HEADER_DIRECTIVE} ${STORY_SCRIPT_FORMAT_VERSION}`, `${STORY_DIRECTIVE} ${document.id}`];
    const exported: Record<StorySceneId, StoryScene> = {};

    for (const sceneId of sceneIds) {
        const scene = document.scenes[sceneId];
        if (!scene) {
            // A scene id the document does not have describes nothing; there is no honest section to
            // write for it, and refusing the whole export would fail a multi-scene job over one stale id.
            continue;
        }
        exported[sceneId] = scene;
        out.push("");
        out.push(`${SCENE_DIRECTIVE} ${sceneId} ${sanitizeLabel(scene.name)}`.trimEnd());
        if (roundtrip) {
            out.push(`${ORIGIN_DIRECTIVE} ${digestOfText(canonicalSceneJson(scene))}`);
        }
        out.push("");

        // Anchors restart at 1 in every scene section, so a section reads the same whether the scene
        // was exported alone or with twenty others.
        let anchor = 0;
        for (const { block, depth } of walkSceneWithDepth(scene)) {
            anchor += 1;
            const body = exportLineBody(scene, block, options);
            const line = `${INDENT_UNIT.repeat(depth)}${body}`;
            out.push(roundtrip ? `${line}${ANCHOR_SEPARATOR}${STORY_SCRIPT_ANCHOR_OPEN}${anchor}${STORY_SCRIPT_ANCHOR_CLOSE}` : line);
        }
    }

    if (!roundtrip) {
        return `${out.join("\n")}\n`;
    }

    const data = encodeCanonicalJson(JSON.parse(JSON.stringify({ scenes: exported })) as unknown);
    out.push("");
    out.push(`${DATAHASH_DIRECTIVE} ${digestOfText(data)}`);
    out.push(DATA_DIRECTIVE);
    // `encodeCanonicalJson` already ends in a newline, so the file does too.
    return `${out.join("\n")}\n${data}`;
}

function exportLineBody(scene: StoryScene, block: StoryBlock, options: StoryScriptExportOptions): string {
    const shape = storyScriptLineShape(block);
    if (shape === "opaque") {
        return `${STORY_SCRIPT_OPAQUE_PREFIX}${sanitizeLabel(options.label(scene, block.id))}`;
    }
    const slot = getSegmentSlot(block);
    // Unreachable for the four editable shapes; a `»` label is the honest answer if it ever is not.
    if (!slot) {
        return `${STORY_SCRIPT_OPAQUE_PREFIX}${sanitizeLabel(options.label(scene, block.id))}`;
    }
    const text = renderRuns(segmentToRuns(slot.segment));
    switch (shape) {
        case "note":
            return `${STORY_SCRIPT_NOTE_PREFIX}${text}`;
        case "choiceOption":
            return `${STORY_SCRIPT_OPTION_PREFIX}${text}`;
        case "dialogue":
            return escapeLineStart(`${escapeBoundarySpaces(escapeInline(options.speaker(scene, block.id)))}: ${text}`);
        default:
            return escapeLineStart(text);
    }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseError(code: StoryScriptParseErrorCode, message: string, line?: number): StoryScriptParseResult {
    return { ok: false, error: { code, message, ...(line === undefined ? {} : { line }) } };
}

const ANCHOR_SUFFIX = new RegExp(`${ANCHOR_SEPARATOR}${STORY_SCRIPT_ANCHOR_OPEN}(\\d+)${STORY_SCRIPT_ANCHOR_CLOSE}$`);

/** Parse a Story Script file into its text lines plus the snapshot it carries. */
export function parseStoryScript(text: string): StoryScriptParseResult {
    const lines = text.split(/\r\n?|\n/);
    const header = /^#nlscript[ \t]+(\d+)[ \t]*$/.exec(lines[0] ?? "");
    if (!header) {
        return parseError("notAScript", "the first line is not a #nlscript header", 1);
    }
    const formatVersion = Number(header[1]);
    if (formatVersion !== STORY_SCRIPT_FORMAT_VERSION) {
        return parseError("unsupportedVersion", `format version ${formatVersion} is not supported`, 1);
    }

    let storyId = "";
    let dataAt = -1;
    let declaredDataHash: string | null = null;
    const sections: Array<{ sceneId: StorySceneId; name: string; origin: string; lines: ParsedStoryScriptLine[] }> = [];

    for (let index = 1; index < lines.length; index += 1) {
        const raw = lines[index];
        const lineNumber = index + 1;
        if (raw.trim().length === 0) {
            // Blank lines are layout. A row with no text still carries its anchor, so nothing that
            // means something is ever blank.
            continue;
        }
        if (raw.startsWith("#")) {
            if (raw.startsWith(`${DATA_DIRECTIVE} `) || raw === DATA_DIRECTIVE) {
                dataAt = index;
                break;
            }
            const directive = /^(#[a-z]+)[ \t]*(.*)$/.exec(raw);
            if (!directive) {
                return parseError("malformed", `unreadable directive: ${raw}`, lineNumber);
            }
            const [, name, rest] = directive;
            if (name === STORY_DIRECTIVE) {
                storyId = rest.trim();
                continue;
            }
            if (name === SCENE_DIRECTIVE) {
                const space = rest.indexOf(" ");
                const sceneId = (space < 0 ? rest : rest.slice(0, space)).trim();
                if (!sceneId) {
                    return parseError("malformed", "#scene names no scene", lineNumber);
                }
                sections.push({ sceneId, name: space < 0 ? "" : rest.slice(space + 1).trim(), origin: "", lines: [] });
                continue;
            }
            if (name === ORIGIN_DIRECTIVE) {
                const section = sections[sections.length - 1];
                if (!section) {
                    return parseError("malformed", "#origin outside a scene section", lineNumber);
                }
                section.origin = rest.trim();
                continue;
            }
            if (name === DATAHASH_DIRECTIVE) {
                declaredDataHash = rest.trim();
                continue;
            }
            if (name === HEADER_DIRECTIVE) {
                return parseError("malformed", "a second #nlscript header", lineNumber);
            }
            return parseError("malformed", `unknown directive ${name}`, lineNumber);
        }
        const section = sections[sections.length - 1];
        if (!section) {
            return parseError("malformed", "a line before the first #scene", lineNumber);
        }
        section.lines.push(parseLine(raw, lineNumber));
    }

    if (dataAt < 0) {
        return parseError("dataMissing", "the file carries no #data snapshot, so nothing can be restored from it");
    }
    const dataText = lines.slice(dataAt + 1).join("\n");
    if (declaredDataHash && digestOfText(dataText) !== declaredDataHash) {
        return parseError("dataCorrupt", "the #data snapshot does not match its #datahash", dataAt + 1);
    }
    let payload: { scenes?: Record<string, StoryScene> };
    try {
        payload = JSON.parse(dataText) as { scenes?: Record<string, StoryScene> };
    } catch (error) {
        return parseError("dataCorrupt", `the #data snapshot is not valid JSON: ${String(error)}`, dataAt + 1);
    }
    const snapshots = payload?.scenes;
    if (!snapshots || typeof snapshots !== "object") {
        return parseError("dataCorrupt", "the #data snapshot has no `scenes`");
    }

    const scenes: ParsedStoryScriptScene[] = [];
    for (const section of sections) {
        const snapshot = snapshots[section.sceneId];
        if (!snapshot) {
            return parseError("dataCorrupt", `#data has no snapshot for scene ${section.sceneId}`);
        }
        scenes.push({
            sceneId: section.sceneId,
            name: section.name,
            origin: section.origin,
            snapshot,
            lines: section.lines,
        });
    }

    return { ok: true, script: { formatVersion, storyId, scenes } };
}

function parseLine(raw: string, lineNumber: number): ParsedStoryScriptLine {
    // The anchor first: it is a fixed suffix, so stripping it before anything else keeps a line ending
    // in `:` from being read as a speaker with an anchor for a name.
    let body = raw;
    let anchor: number | undefined;
    const anchored = ANCHOR_SUFFIX.exec(body);
    if (anchored) {
        anchor = Number(anchored[1]);
        body = body.slice(0, body.length - anchored[0].length);
    }
    const indent = /^ */.exec(body)?.[0].length ?? 0;
    const depth = Math.floor(indent / INDENT_UNIT.length);
    const content = body.slice(indent);
    const line: ParsedStoryScriptLine = { lineNumber, depth, shape: "narration" };
    if (anchor !== undefined) {
        line.anchor = anchor;
    }

    if (content.startsWith(STORY_SCRIPT_OPAQUE_PREFIX) || content === STORY_SCRIPT_OPAQUE_PREFIX.trim()) {
        line.shape = "opaque";
        return line;
    }
    if (content.startsWith(STORY_SCRIPT_NOTE_PREFIX) || content === STORY_SCRIPT_NOTE_PREFIX.trim()) {
        line.shape = "note";
        line.text = content.slice(STORY_SCRIPT_NOTE_PREFIX.length);
        return line;
    }
    if (content.startsWith(STORY_SCRIPT_OPTION_PREFIX) || content === STORY_SCRIPT_OPTION_PREFIX.trim()) {
        line.shape = "choiceOption";
        line.text = content.slice(STORY_SCRIPT_OPTION_PREFIX.length);
        return line;
    }
    const separator = findSpeakerSeparator(content);
    if (separator !== null) {
        line.shape = "dialogue";
        line.speaker = unescapeText(content.slice(0, separator));
        line.text = content.slice(separator + 2);
        return line;
    }
    line.text = content;
    return line;
}

/** The first *unescaped* `: `, which is the only thing that separates a speaker from their line. */
function findSpeakerSeparator(content: string): number | null {
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === ESCAPE) {
            index += 1;
            continue;
        }
        if (content[index] === ":" && content[index + 1] === " ") {
            return index;
        }
    }
    return null;
}

/** Plain text of an escaped fragment - the tokenizer with the markers thrown away. */
function unescapeText(value: string): string {
    return tokenizeLineText(value)
        .map(token => (token.kind === "text" ? token.value : ""))
        .join("");
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

type MergeNode = {
    block: StoryBlock;
    depth: number;
    /** `snapshot` keeps its identity and its position history; the other two are rows that did not exist. */
    origin: "snapshot" | "new" | "clone";
    /** The snapshot row this came from - the basis for `moved` vs `unchanged`. */
    sourceId?: StoryBlockId;
    /** The author changed the words or the speaker. Counted before position, because an edit that also moved reads as an edit. */
    edited?: boolean;
};

/**
 * Work out what importing would do, without doing it: the merged scenes, the counts the confirm
 * dialog shows, and every diagnostic. Applying the plan is a `replaceScene` per scene.
 */
export function planStoryScriptImport(input: StoryScriptPlanInput): StoryScriptImportPlan {
    return {
        storyMatches: input.script.storyId === input.live.id,
        scenes: input.script.scenes.map(scene => planScene(scene, input)),
        diagnostics: [],
    };
}

function planScene(parsed: ParsedStoryScriptScene, input: StoryScriptPlanInput): StoryScriptScenePlan {
    const diagnostics: StoryScriptDiagnostic[] = [];
    const stats: StoryScriptSceneStats = { unchanged: 0, edited: 0, added: 0, removed: 0, cloned: 0, moved: 0 };
    const snapshot = parsed.snapshot;
    const snapshotOrder = walkSceneWithDepth(snapshot);
    // Anchor n is the n-th row of the snapshot in reading order. Nothing in the file states the
    // mapping, because the file already carries the scene it was taken from.
    const byAnchor = new Map<number, StoryBlock>();
    snapshotOrder.forEach(({ block }, index) => byAnchor.set(index + 1, block));

    const consumed = new Set<StoryBlockId>();
    const nodes: MergeNode[] = [];

    for (const line of parsed.lines) {
        const node = mergeLine(line, {
            byAnchor,
            consumed,
            diagnostics,
            snapshot,
            generateId: input.generateId,
            resolveSpeaker: input.resolveSpeaker,
            speakerLabel: input.speakerLabel,
        });
        if (node) {
            nodes.push(node);
        }
    }

    for (const { block } of snapshotOrder) {
        if (!consumed.has(block.id)) {
            stats.removed += 1;
        }
    }

    const scene = assembleScene(snapshot, nodes, diagnostics, stats);
    const live = input.live.scenes[parsed.sceneId];
    return {
        sceneId: parsed.sceneId,
        sceneName: snapshot.name,
        scene,
        stats,
        stale: Boolean(live) && parsed.origin.length > 0 && digestOfText(canonicalSceneJson(live)) !== parsed.origin,
        missing: !live,
        diagnostics,
    };
}

/**
 * Deliberately without the stats: every count is derived in {@link countPositions}, from the nodes that
 * actually survived placement. Counting as we went would have to be undone the moment a row turned out
 * to be unplaceable, and a counter you can decrement is a counter that drifts.
 */
type MergeContext = {
    byAnchor: Map<number, StoryBlock>;
    consumed: Set<StoryBlockId>;
    diagnostics: StoryScriptDiagnostic[];
    /** The scene as exported. `speakerLabel` is asked about rows of *this* scene, never the live one. */
    snapshot: StoryScene;
    generateId: StoryScriptPlanInput["generateId"];
    resolveSpeaker: StoryScriptPlanInput["resolveSpeaker"];
    speakerLabel: StoryScriptPlanInput["speakerLabel"];
};

function mergeLine(line: ParsedStoryScriptLine, context: MergeContext): MergeNode | null {
    const report = (code: StoryScriptDiagnosticCode, message: string, severity: "error" | "warning" = "error") => {
        context.diagnostics.push({ severity, code, line: line.lineNumber, message });
    };

    if (line.anchor === undefined) {
        if (line.shape === "opaque") {
            // The label says nothing about the action it stood for, so there is nothing to create.
            report("opaqueWithoutAnchor", "a » line with no anchor names no action, so no row was created");
            return null;
        }
        return { block: createBlock(line, context), depth: line.depth, origin: "new" };
    }

    const source = context.byAnchor.get(line.anchor);
    if (!source) {
        report("unknownAnchor", `anchor ${line.anchor} is not in this file's snapshot; the line was dropped`);
        return null;
    }

    const snapshotShape = storyScriptLineShape(source);
    const duplicate = context.consumed.has(source.id);
    context.consumed.add(source.id);

    if (snapshotShape === "opaque" || line.shape === "opaque") {
        if (snapshotShape !== line.shape) {
            // Two codes, not one: which half survived is the whole content of the message, and the
            // author's next move differs (re-type the prose, or leave the action alone).
            report(
                snapshotShape === "opaque" ? "shapeMismatchAction" : "shapeMismatchText",
                snapshotShape === "opaque"
                    ? `anchor ${line.anchor} is an action row, rewritten here as prose; the row was kept and the edit dropped`
                    : `anchor ${line.anchor} is a text row, rewritten here as a » line; the row was kept and the edit dropped`,
            );
        }
        if (duplicate) {
            report("duplicateAnchor", `anchor ${line.anchor} appears more than once; this copy is a new row`, "warning");
            return { block: cloneBlock(source, context.generateId), depth: line.depth, origin: "clone" };
        }
        return { block: cloneJson(source), depth: line.depth, origin: "snapshot", sourceId: source.id };
    }

    if (duplicate) {
        report("duplicateAnchor", `anchor ${line.anchor} appears more than once; this copy is a new row`, "warning");
        const clone = applyTextEdit(cloneBlock(source, context.generateId), source, line, context, () => {});
        return { block: clone, depth: line.depth, origin: "clone" };
    }

    let edited = false;
    const block = applyTextEdit(cloneJson(source), source, line, context, () => {
        edited = true;
    });
    return { block, depth: line.depth, origin: "snapshot", sourceId: source.id, edited };
}

/**
 * Write the line's text (and speaker) onto a block that already exists.
 *
 * The block keeps its `id` **and its segment's `textId`** whatever the author did to the words: this
 * is an edit of a line, not a replacement of it, and the two ids are what bind the line to its
 * translations and its voice take.
 */
function applyTextEdit(
    block: StoryBlock,
    source: StoryBlock,
    line: ParsedStoryScriptLine,
    context: MergeContext,
    markEdited: () => void,
): StoryBlock {
    const slot = getSegmentSlot(block);
    const sourceSlot = getSegmentSlot(source);
    if (!slot || !sourceSlot) {
        return block;
    }
    const snapshotRuns = segmentToRuns(sourceSlot.segment);
    const raw = line.shape === storyScriptLineShape(source) ? line.text ?? "" : lineContent(line);
    const runs = tokensToRuns(tokenizeLineText(raw), snapshotRuns, (code, message) => {
        context.diagnostics.push({ severity: "warning", code, line: line.lineNumber, message });
    });

    let next = block;
    if (!runsEqual(runs, snapshotRuns)) {
        next = slot.withSegment(segmentWithRuns(slot.segment, runs));
        markEdited();
    }
    return applySpeakerEdit(next, source, line, context, markEdited);
}

/**
 * The line's whole body, re-escaped - what an anchored row reads when the author gave its line a
 * *different* prose shape than the row has.
 *
 * The four prose shapes are deliberately not interconvertible from the text layer: a row that is
 * narration stays narration, and `Alice: 你好` typed onto it becomes its text, prefix and all. The
 * alternative - turning the row into a dialogue - would have to invent a speaker binding out of a
 * label, on a row the author may only have mistyped, and there is no way back from that. Keeping the
 * shape loses nothing: every character the author typed survives, and re-exporting escapes it so the
 * file is stable from then on.
 *
 * `escapeInline` is its own round trip (unescape ∘ escape = identity), so re-escaping the speaker the
 * parser already unescaped is exact.
 */
function lineContent(line: ParsedStoryScriptLine): string {
    const text = line.text ?? "";
    switch (line.shape) {
        case "note":
            return `${STORY_SCRIPT_NOTE_PREFIX}${text}`;
        case "choiceOption":
            return `${STORY_SCRIPT_OPTION_PREFIX}${text}`;
        case "dialogue":
            return `${escapeInline(line.speaker ?? "")}: ${text}`;
        default:
            return text;
    }
}

/**
 * Rebind a dialogue row's speaker - but only if the author actually retyped the label.
 *
 * The question this asks is deliberately **not** "what does this label resolve to?". A display name is
 * a lossy projection of a binding: a deleted character projects to `""`, two characters can project to
 * the same string, and a temp `speakerName` can be spelled exactly like a character's name. Resolving
 * an *unedited* label therefore rewrites three states that were correct - which made a round trip with
 * no edits in it destroy a binding, steal another character's identity, or invent one, and report all
 * three as `edited`.
 *
 * So the comparison is against the label **the snapshot row would have printed**, through the very
 * labeller the export ran through. Equal means the author did not touch it, and an untouched label is
 * not a statement about the binding at all.
 */
function applySpeakerEdit(
    block: StoryBlock,
    source: StoryBlock,
    line: ParsedStoryScriptLine,
    context: MergeContext,
    markEdited: () => void,
): StoryBlock {
    if (block.kind !== "nodeAction" || line.shape !== "dialogue") {
        return block;
    }
    const payload = block.payload;
    if (payload.action !== "dialogue") {
        return block;
    }
    const label = line.speaker ?? "";
    const exportedLabel = context.speakerLabel?.(context.snapshot, source.id);
    if (exportedLabel !== undefined) {
        if (exportedLabel === label) {
            return block;
        }
    } else if (payload.characterId && label.trim().length === 0) {
        // No labeller to compare against, so an empty label is ambiguous: it is equally what a binding
        // to a deleted character prints and what an author types to clear a speaker. Destroying the
        // binding is the only one of the two that cannot be undone from the file, so it is refused.
        return block;
    }
    if (!context.resolveSpeaker) {
        // Without the project's characters, the only label this file can recompute is a bare
        // `speakerName`. A character-bound row was exported under a display name, so a change to it is
        // not just unresolvable but *undetectable* - and guessing would unbind the character.
        if (payload.characterId) {
            return block;
        }
        if ((payload.speakerName ?? "") !== label) {
            context.diagnostics.push({
                severity: "warning",
                code: "speakerUnresolved",
                line: line.lineNumber,
                message: `the speaker label changed to "${label}" but no speaker resolver was supplied; the change was ignored`,
            });
        }
        return block;
    }
    const resolved = context.resolveSpeaker(label);
    if ("characterId" in resolved) {
        if (payload.characterId === resolved.characterId) {
            return block;
        }
        const next: StoryDialoguePayload = { ...payload, characterId: resolved.characterId };
        // Deleted rather than set to `undefined`: an undefined property throws in `encodeCanonicalJson`.
        delete next.speakerName;
        markEdited();
        return { ...block, payload: next };
    }
    if (!payload.characterId && (payload.speakerName ?? "") === resolved.speakerName) {
        return block;
    }
    const next: StoryDialoguePayload = { ...payload, speakerName: resolved.speakerName };
    delete next.characterId;
    markEdited();
    return { ...block, payload: next };
}

/** A copy of a row with a new identity: a fresh block id AND a fresh `textId`, because two rows cannot share a translation unit or a voice take. */
function cloneBlock(source: StoryBlock, generateId: StoryScriptPlanInput["generateId"]): StoryBlock {
    const clone = cloneJson(source);
    clone.id = mintId(generateId, "Story block id");
    clone.childrenIds = [];
    const slot = getSegmentSlot(clone);
    if (!slot) {
        return clone;
    }
    return slot.withSegment({ ...slot.segment, textId: mintId(generateId, "Story text id") });
}

function createBlock(line: ParsedStoryScriptLine, context: MergeContext): StoryBlock {
    const shape = line.shape as Exclude<StoryScriptLineShape, "opaque">;
    const runs = tokensToRuns(tokenizeLineText(line.text ?? ""), [], (code, message) => {
        context.diagnostics.push({ severity: "warning", code, line: line.lineNumber, message });
    });
    const rich = richIfMeaningful(runs);
    const segment: StoryTextSegment = {
        textId: mintId(context.generateId, "Story text id"),
        value: richRunsToPlain(runs),
        role: SEGMENT_ROLE[shape],
        ...(rich ? { rich } : {}),
    };
    const id = mintId(context.generateId, "Story block id");
    if (shape === "note") {
        return { id, kind: "note", parentId: null, childrenIds: [], payload: { text: segment } };
    }
    if (shape === "dialogue") {
        const label = line.speaker ?? "";
        // With no resolver the label is carried as a temp speaker, which the model supports outright
        // (`document.ts:376`) - an unknown name is a valid line, not an error.
        const resolved = context.resolveSpeaker?.(label) ?? { speakerName: label };
        const payload: StoryDialoguePayload =
            "characterId" in resolved
                ? { action: "dialogue", text: segment, characterId: resolved.characterId }
                : { action: "dialogue", text: segment, speakerName: resolved.speakerName };
        return { id, kind: "nodeAction", parentId: null, childrenIds: [], payload };
    }
    if (shape === "choiceOption") {
        return {
            id,
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: { action: "choiceOption", text: segment },
        };
    }
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: segment },
    };
}

function mintId(generateId: StoryScriptPlanInput["generateId"], label: string): string {
    const id = generateId();
    // A non-UUID id is accepted everywhere until the document is next loaded, and then the whole story
    // refuses to open. Failing here names the callback that produced it.
    assertValidStoryEntityId(id, label);
    return id;
}

function runsEqual(a: StoryRichRun[], b: StoryRichRun[]): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rebuild the block tree from the lines' indentation and hand back a structurally valid scene.
 *
 * `replaceScene` (`StoryService.ts:1084`) validates nothing and normalizes nothing - it stores what it
 * is given - so everything that makes a scene loadable has to be true by the time this returns.
 */
function assembleScene(
    snapshot: StoryScene,
    nodes: MergeNode[],
    diagnostics: StoryScriptDiagnostic[],
    stats: StoryScriptSceneStats,
): StoryScene {
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    const rootBlockIds: StoryBlockId[] = [];
    const stack: StoryBlock[] = [];
    const kept: MergeNode[] = [];

    for (const node of nodes) {
        // A line cannot be deeper than one level below the line above it, however far it was indented.
        const depth = Math.min(node.depth, stack.length);
        while (stack.length > depth) {
            stack.pop();
        }
        // Nor can it sit under a row that takes no children - a `jump`, or any leaf action. Walking up
        // is what keeps "a jump block has no children" (`storyModel.ts:927`) true by construction.
        while (stack.length > 0 && !canAcceptChildren(stack[stack.length - 1])) {
            stack.pop();
        }
        const parent = stack[stack.length - 1];
        if (node.origin !== "snapshot" && node.block.kind === "nodeAction" && node.block.payload.action === "choiceOption") {
            const parentAction = parent?.kind === "nodeAction" ? parent.payload.action : null;
            if (parentAction !== "choice" && parentAction !== "choiceOption") {
                // A row the author typed that the model cannot hold where they put it. Dropping it is
                // the honest answer: a choice option with no choice is a row Studio itself cannot make.
                diagnostics.push({
                    severity: "error",
                    code: "unplaceableLine",
                    message: "an option row has no choice above it to belong to, so it was dropped",
                });
                continue;
            }
        }
        node.block.parentId = parent?.id ?? null;
        node.block.childrenIds = [];
        blocks[node.block.id] = node.block;
        if (parent) {
            parent.childrenIds.push(node.block.id);
        } else {
            rootBlockIds.push(node.block.id);
        }
        kept.push(node);
        stack.push(node.block);
    }

    const scene: StoryScene = { ...cloneJson(snapshot), rootBlockIds, blocks };
    countPositions(snapshot, scene, kept, stats);
    assertStoryScriptSceneValid(scene);
    return scene;
}

/**
 * Count the surviving rows. Every kept row lands in exactly one bucket, in this order: `added` /
 * `cloned` for a row that did not exist, then `edited`, then `moved`, then `unchanged` - so a row the
 * author both rewrote and re-indented reads as an edit, which is what the confirm dialog is asking about.
 */
function countPositions(snapshot: StoryScene, scene: StoryScene, nodes: MergeNode[], stats: StoryScriptSceneStats): void {
    for (const node of nodes) {
        if (node.origin === "new") {
            stats.added += 1;
            continue;
        }
        if (node.origin === "clone") {
            stats.cloned += 1;
            continue;
        }
        if (node.edited) {
            stats.edited += 1;
            continue;
        }
        const before = node.sourceId ? snapshot.blocks[node.sourceId] : undefined;
        const after = scene.blocks[node.block.id];
        if (!before || !after || !node.sourceId) {
            stats.unchanged += 1;
            continue;
        }
        const beforeSiblings = before.parentId ? snapshot.blocks[before.parentId]?.childrenIds ?? [] : snapshot.rootBlockIds;
        const afterSiblings = after.parentId ? scene.blocks[after.parentId]?.childrenIds ?? [] : scene.rootBlockIds;
        const moved =
            (before.parentId ?? null) !== (after.parentId ?? null) ||
            beforeSiblings.indexOf(node.sourceId) !== afterSiblings.indexOf(node.block.id);
        if (moved) {
            stats.moved += 1;
        } else {
            stats.unchanged += 1;
        }
    }
}

/**
 * Everything a scene must satisfy for `replaceScene` to be safe to call with it.
 *
 * Exported so the tests can state the invariant rather than re-derive it, and thrown rather than
 * reported because a plan that produced an invalid scene is a defect in this file, not in the file the
 * author edited.
 */
export function assertStoryScriptSceneValid(scene: StoryScene): void {
    const seen = new Set<StoryBlockId>();
    for (const [id, block] of Object.entries(scene.blocks)) {
        if (block.id !== id) {
            throw new Error(`Story script: block ${id} is stored under the wrong key (${block.id})`);
        }
        if (block.kind === "jump" && block.childrenIds.length > 0) {
            throw new Error(`Story script: jump block ${id} has children`);
        }
        for (const childId of block.childrenIds) {
            const child = scene.blocks[childId];
            if (!child) {
                throw new Error(`Story script: block ${id} names a missing child ${childId}`);
            }
            if (child.parentId !== id) {
                throw new Error(`Story script: block ${childId} does not agree that ${id} is its parent`);
            }
            if (seen.has(childId)) {
                throw new Error(`Story script: block ${childId} has more than one parent`);
            }
            seen.add(childId);
        }
    }
    for (const rootId of scene.rootBlockIds) {
        const block = scene.blocks[rootId];
        if (!block) {
            throw new Error(`Story script: rootBlockIds names a missing block ${rootId}`);
        }
        if (block.parentId !== null) {
            throw new Error(`Story script: root block ${rootId} claims a parent`);
        }
        if (seen.has(rootId)) {
            throw new Error(`Story script: block ${rootId} is both a root and a child`);
        }
        seen.add(rootId);
    }
    for (const id of Object.keys(scene.blocks)) {
        if (!seen.has(id)) {
            throw new Error(`Story script: block ${id} is in the record but in no parent's children`);
        }
    }
}
