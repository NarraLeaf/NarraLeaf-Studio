import type { DocxParagraph } from "@shared/manuscript/officeRead";
import type { PasteSplit, PasteSpeakerTally, PastedLine, PastePlan, PastePlanRow } from "@/lib/story/paste/storyPasteTypes";
import { speakerMemoryKey, splitPastedText } from "@/lib/story/paste/storyPasteModel";

/**
 * Turning a script file (Word, Fountain, a spreadsheet of lines) into what the paste wizard reads.
 *
 * Two shapes, because the formats split into two kinds:
 *
 * - **structured** - the file already says who speaks each line (a Fountain character cue, a
 *   speaker column). The wizard is handed the split ready-made and skips its separator guess.
 * - **prose** - a Word manuscript is the same wall of `Name: line` text a paste is, so the wizard
 *   runs exactly as it does for a paste, separator inference included.
 *
 * Either way a source is a list of scenes; headings in the file start a new one. The wizard plans
 * one row per line in order, so the plan is cut back into scenes by line counts.
 */

export type ManuscriptImportLine = { speaker?: string; text: string; note?: string };

export type ManuscriptImportSource =
    | { kind: "structured"; scenes: { name?: string; lines: ManuscriptImportLine[] }[] }
    | { kind: "prose"; scenes: { name?: string; text: string }[] };

// ---------------------------------------------------------------------------
// Into the wizard
// ---------------------------------------------------------------------------

/** The text a prose source hands the wizard: every scene, in order. */
export function proseSourceText(source: Extract<ManuscriptImportSource, { kind: "prose" }>): string {
    return source.scenes.map(scene => scene.text).join("\n");
}

/** How many wizard lines each scene contributes, so the plan can be cut back into scenes. */
export function sourceSceneLineCounts(source: ManuscriptImportSource): number[] {
    if (source.kind === "structured") {
        return source.scenes.map(scene => scene.lines.length);
    }
    // The same splitter the wizard runs, so the counts cannot disagree with its lines.
    return source.scenes.map(scene => splitPastedText(scene.text, { kind: "none" }).lines.length);
}

/** A structured source as the split the wizard would otherwise have inferred. */
export function structuredSourceSplit(source: Extract<ManuscriptImportSource, { kind: "structured" }>): PasteSplit {
    const lines: PastedLine[] = [];
    const tallies: PasteSpeakerTally[] = [];
    const byKey = new Map<string, PasteSpeakerTally>();
    let narrationCount = 0;
    for (const scene of source.scenes) {
        for (const entry of scene.lines) {
            const index = lines.length;
            const speaker = entry.speaker?.trim();
            if (!speaker) {
                lines.push({ index, raw: entry.text, text: entry.text });
                narrationCount += 1;
                continue;
            }
            lines.push({ index, raw: `${speaker}: ${entry.text}`, speaker, text: entry.text });
            const key = speakerMemoryKey(speaker);
            const tally = byKey.get(key);
            if (tally) {
                tally.count += 1;
                tally.lineIndices.push(index);
            } else {
                const next = { label: speaker, count: 1, lineIndices: [index] };
                byKey.set(key, next);
                tallies.push(next);
            }
        }
    }
    return { lines, speakers: tallies, narrationCount };
}

/** Notes by wizard line index, for the rows a confirm adds after each line. */
export function structuredSourceNotes(source: ManuscriptImportSource): Map<number, string> {
    const notes = new Map<number, string>();
    if (source.kind !== "structured") {
        return notes;
    }
    let index = 0;
    for (const scene of source.scenes) {
        for (const line of scene.lines) {
            if (line.note?.trim()) {
                notes.set(index, line.note.trim());
            }
            index += 1;
        }
    }
    return notes;
}

export type PlannedImportScene = { name?: string; rows: { row: PastePlanRow; note?: string }[] };

/** Cut the wizard's plan back into the source's scenes. Scenes that end up empty are dropped. */
export function partitionPlanIntoScenes(plan: PastePlan, source: ManuscriptImportSource): PlannedImportScene[] {
    const counts = sourceSceneLineCounts(source);
    const notes = structuredSourceNotes(source);
    const scenes: PlannedImportScene[] = [];
    let cursor = 0;
    counts.forEach((count, sceneIndex) => {
        const rows = plan.rows.slice(cursor, cursor + count).map((row, offset) => {
            const note = notes.get(cursor + offset);
            return note ? { row, note } : { row };
        });
        cursor += count;
        if (rows.length > 0) {
            const name = source.scenes[sceneIndex].name?.trim();
            scenes.push(name ? { name, rows } : { rows });
        }
    });
    return scenes;
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

/**
 * A Word manuscript as prose. A heading starts a scene named after it; the document title (level 0)
 * names nothing and is dropped, and so is a heading that would only open an empty scene before the
 * first real one.
 */
export function docxToSource(paragraphs: readonly DocxParagraph[]): Extract<ManuscriptImportSource, { kind: "prose" }> {
    const scenes: { name?: string; lines: string[] }[] = [{ lines: [] }];
    for (const paragraph of paragraphs) {
        if (paragraph.headingLevel === 0) {
            continue;
        }
        if (paragraph.headingLevel !== undefined) {
            const name = paragraph.text.replace(/\s+/g, " ").trim();
            if (!name) {
                continue;
            }
            const current = scenes[scenes.length - 1];
            if (current.lines.every(line => !line.trim())) {
                current.name = name;
            } else {
                scenes.push({ name, lines: [] });
            }
            continue;
        }
        scenes[scenes.length - 1].lines.push(paragraph.text);
    }
    return {
        kind: "prose",
        scenes: scenes
            .map(scene => ({ ...(scene.name ? { name: scene.name } : {}), text: scene.lines.join("\n") }))
            .filter(scene => scene.text.trim()),
    };
}

// ---------------------------------------------------------------------------
// Fountain
// ---------------------------------------------------------------------------

const SCENE_HEADING = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const TRANSITION = /^[A-Z0-9 .'-]+TO:$/;
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const SENTENCE_PUNCTUATION = /[。！？，、；…!?,;"“”「」『』]/;

/** Strip Fountain's emphasis markers (`*bold*`, `_underline_`) and escapes, keeping the words. */
function stripEmphasis(text: string): string {
    return text
        .replace(/\\([*_])/g, "\u0000$1")
        .replace(/\*{1,3}([^*\n]+?)\*{1,3}/g, "$1")
        .replace(/_([^_\n]+?)_/g, "$1")
        .replace(/\u0000/g, "");
}

/**
 * A character cue. Upper case is the Fountain rule, but CJK has no case, so a CJK line counts when it
 * is short and carries no sentence punctuation - which is what a name on a line of its own looks like.
 */
function isCharacterCue(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.startsWith("@")) {
        return trimmed.length > 1;
    }
    if (trimmed.startsWith("!") || SCENE_HEADING.test(trimmed) || TRANSITION.test(trimmed)) {
        return false;
    }
    const name = trimmed.replace(/\s*\^$/, "").replace(/\s*\([^)]*\)$/, "");
    if (!name) {
        return false;
    }
    if (CJK.test(name)) {
        return [...name].length <= 12 && !SENTENCE_PUNCTUATION.test(name) && !name.includes(":") && !name.includes("：");
    }
    return /\p{Lu}/u.test(name) && !/\p{Ll}/u.test(name);
}

function cueName(line: string): string {
    return line.trim().replace(/^@/, "").replace(/\s*\^$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Parse a Fountain screenplay.
 *
 * Scene headings start scenes; a character cue and the lines under it are one dialogue row (lines
 * of one speech join with a space, or with nothing between CJK characters); a parenthetical becomes
 * that row's note; action paragraphs are narration; notes `[[...]]` are notes; the title page,
 * sections, synopses, transitions, page breaks and boneyard are dropped.
 */
export function parseFountain(input: string): Extract<ManuscriptImportSource, { kind: "structured" }> {
    let text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    let lines = text.split("\n");

    // Title page: `Key: value` lines at the very top, up to the first blank line.
    if (lines.length > 0 && /^[A-Za-z][A-Za-z ]*:/.test(lines[0])) {
        const end = lines.findIndex(line => !line.trim());
        lines = end === -1 ? [] : lines.slice(end + 1);
    }

    const scenes: { name?: string; lines: ManuscriptImportLine[] }[] = [{ lines: [] }];
    const current = () => scenes[scenes.length - 1];
    const joinSpeech = (a: string, b: string) =>
        CJK.test(a.slice(-1)) && CJK.test(b.charAt(0)) ? `${a}${b}` : `${a} ${b}`;

    let index = 0;
    let action: string[] = [];
    const flushAction = () => {
        const joined = action.map(line => line.trim()).filter(Boolean).reduce((acc, line) => (acc ? joinSpeech(acc, line) : line), "");
        if (joined) {
            const inlineNote = joined.match(/\[\[([\s\S]*?)\]\]/g);
            const body = stripEmphasis(joined.replace(/\[\[[\s\S]*?\]\]/g, "").trim());
            if (body) {
                current().lines.push({ text: body.replace(/^>\s*|\s*<$/g, "").replace(/^~\s*/, "") });
            }
            // A note has no row of its own in the wizard; it rides on the line it sits under.
            const last = current().lines[current().lines.length - 1];
            for (const note of inlineNote ?? []) {
                const value = note.slice(2, -2).trim();
                if (value && last) {
                    last.note = last.note ? `${last.note} ${value}` : value;
                }
            }
        }
        action = [];
    };

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        const previousBlank = index === 0 || !lines[index - 1].trim();

        if (!trimmed) {
            flushAction();
            index += 1;
            continue;
        }
        if (/^={3,}$/.test(trimmed) || trimmed.startsWith("#") || /^=(?!=)/.test(trimmed)) {
            flushAction();
            index += 1;
            continue;
        }
        if (previousBlank && (SCENE_HEADING.test(trimmed) || /^\.[^.]/.test(trimmed))) {
            flushAction();
            const name = trimmed.replace(/^\./, "").replace(/\s*#[^#]*#\s*$/, "").trim();
            if (current().lines.length === 0 && current().name === undefined) {
                current().name = name;
            } else {
                scenes.push({ name, lines: [] });
            }
            index += 1;
            continue;
        }
        if (previousBlank && (trimmed.startsWith(">") && !trimmed.endsWith("<") || TRANSITION.test(trimmed))) {
            flushAction();
            index += 1;
            continue;
        }
        const nextLine = lines[index + 1];
        if (previousBlank && action.length === 0 && nextLine !== undefined && nextLine.trim() && isCharacterCue(trimmed)) {
            const speaker = cueName(trimmed);
            index += 1;
            let speech = "";
            let notes: string[] = [];
            // A parenthetical in the middle of a speech splits it into two rows, as it is read: the
            // direction belongs to the half that follows it.
            const pushSpeech = () => {
                const body = stripEmphasis(speech.replace(/\[\[[\s\S]*?\]\]/g, "").trim());
                if (body) {
                    current().lines.push({ speaker, text: body, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) });
                }
                speech = "";
                notes = [];
            };
            while (index < lines.length && lines[index].trim()) {
                const part = lines[index].trim();
                if (/^\(.*\)$/.test(part)) {
                    if (speech) {
                        pushSpeech();
                    }
                    notes.push(part.slice(1, -1).trim());
                } else {
                    const words = part.replace(/^~\s*/, "");
                    speech = speech ? joinSpeech(speech, words) : words;
                }
                index += 1;
            }
            pushSpeech();
            continue;
        }
        action.push(line.replace(/^!/, ""));
        index += 1;
    }
    flushAction();

    return {
        kind: "structured",
        scenes: scenes.filter(scene => scene.lines.length > 0),
    };
}

// ---------------------------------------------------------------------------
// Tables (.csv / .xlsx)
// ---------------------------------------------------------------------------

/** Tokenise delimited text, guessing comma, tab or semicolon from the first lines. */
export function parseDelimitedText(input: string): string[][] {
    const text = input.replace(/^﻿/, "");
    const sample = text.split(/\r?\n/).slice(0, 10).join("\n").replace(/"[^"]*"/g, "");
    const counts = [",", "\t", ";"].map(delimiter => ({ delimiter, count: sample.split(delimiter).length - 1 }));
    const delimiter = counts.sort((a, b) => b.count - a.count)[0].count > 0 ? counts[0].delimiter : ",";
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === "\"") {
                if (text[i + 1] === "\"") {
                    field += "\"";
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === "\"" && field.length === 0) {
            quoted = true;
        } else if (char === delimiter) {
            row.push(field);
            field = "";
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") {
                i += 1;
            }
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.map(cells => {
        const trimmed = [...cells];
        while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
            trimmed.pop();
        }
        return trimmed;
    });
}

export type TableColumnRole = "speaker" | "text" | "note" | "scene";

export type TableMapping = {
    /** The first row names the columns and is not a line. */
    headerRow: boolean;
    speaker: number | null;
    text: number | null;
    note: number | null;
    scene: number | null;
};

const HEADER_WORDS: Record<TableColumnRole, RegExp> = {
    speaker: /^(speaker|character|name|who|role|说话人|說話人|角色|人物|名字|姓名|发言人|キャラ|キャラクター|話者|名前|役)/i,
    text: /^(text|line|dialogue|dialog|content|words|script|台词|台詞|对白|對白|内容|内容|セリフ|せりふ|本文|テキスト|文本)/i,
    note: /^(note|notes|comment|comments|remark|direction|备注|備註|注释|说明|メモ|備考|注記|ト書き)/i,
    scene: /^(scene|chapter|section|场景|場景|章节|章節|シーン|場面|章)/i,
};

/** The columns the first row names, or the most likely layout when it names none. */
export function guessTableMapping(rows: readonly string[][]): TableMapping {
    const first = rows[0] ?? [];
    const found: Partial<Record<TableColumnRole, number>> = {};
    first.forEach((cell, column) => {
        const word = cell.trim();
        for (const role of ["speaker", "text", "note", "scene"] as const) {
            if (found[role] === undefined && HEADER_WORDS[role].test(word)) {
                found[role] = column;
                break;
            }
        }
    });
    if (found.text !== undefined || found.speaker !== undefined) {
        return {
            headerRow: true,
            speaker: found.speaker ?? null,
            text: found.text ?? (found.speaker === 0 ? 1 : 0),
            note: found.note ?? null,
            scene: found.scene ?? null,
        };
    }
    const width = Math.max(0, ...rows.slice(0, 20).map(row => row.length));
    // No header: one column is lines; two or more is speaker then line.
    return width <= 1
        ? { headerRow: false, speaker: null, text: 0, note: null, scene: null }
        : { headerRow: false, speaker: 0, text: 1, note: width >= 3 ? 2 : null, scene: null };
}

/** The labels for the column picker: the header cell when there is one, else nothing. */
export function tableColumnCount(rows: readonly string[][]): number {
    return Math.max(0, ...rows.map(row => row.length));
}

/**
 * Rows of a table as a structured source. A row with no line is skipped (a blank separator row, or a
 * row that only carries a scene name); a change in the scene column starts a scene.
 */
export function tableToSource(rows: readonly string[][], mapping: TableMapping): Extract<ManuscriptImportSource, { kind: "structured" }> {
    const scenes: { name?: string; lines: ManuscriptImportLine[] }[] = [{ lines: [] }];
    const body = mapping.headerRow ? rows.slice(1) : rows;
    const cell = (row: readonly string[], column: number | null) => (column === null ? "" : (row[column] ?? "").trim());
    let lastScene: string | undefined;
    for (const row of body) {
        const sceneName = cell(row, mapping.scene);
        if (sceneName && sceneName !== lastScene) {
            lastScene = sceneName;
            const current = scenes[scenes.length - 1];
            if (current.lines.length === 0) {
                current.name = sceneName;
            } else {
                scenes.push({ name: sceneName, lines: [] });
            }
        }
        const text = cell(row, mapping.text).replace(/\r\n?/g, "\n");
        if (!text) {
            continue;
        }
        const speaker = cell(row, mapping.speaker);
        const note = cell(row, mapping.note);
        scenes[scenes.length - 1].lines.push({
            text,
            ...(speaker ? { speaker } : {}),
            ...(note ? { note } : {}),
        });
    }
    return { kind: "structured", scenes: scenes.filter(scene => scene.lines.length > 0) };
}
