import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import { serializeSegmentSourceText } from "@shared/utils/localizationText";
import type { StoryScriptLabeller, StoryScriptSpeakerLabeller } from "@/lib/story/script/storyScriptTypes";

/**
 * A readable script: the story as a person reads it on paper, built once and then rendered as HTML
 * (for PDF) or as a Word document. Unlike the Story Script `.txt`, nothing here is ever read back.
 *
 * Line ids are the text segment's `textId` - the `unitId` column of the voice recording script - so
 * an actor's printed page and the recording script name the same line the same way.
 */
export type ManuscriptLine =
    | { kind: "dialogue"; speaker: string; text: string; id?: string; depth: number; context?: boolean }
    | { kind: "narration"; text: string; id?: string; depth: number; context?: boolean }
    | { kind: "choice"; text: string; id?: string; depth: number; context?: boolean }
    | { kind: "option"; text: string; id?: string; depth: number; context?: boolean }
    | { kind: "direction"; text: string; depth: number; context?: boolean }
    | { kind: "note"; text: string; depth: number; context?: boolean }
    /** Lines left out between two kept stretches, when the script is filtered to some speakers. */
    | { kind: "gap" };

export type ManuscriptScene = { id: StorySceneId; name: string; lines: ManuscriptLine[] };

export type Manuscript = {
    title: string;
    /** One line under the title: who the copy is for, how many scenes. Already translated. */
    subtitle?: string;
    /** An actor's copy: scenes run on without a page break each, since most of each is left out. */
    compact?: boolean;
    scenes: ManuscriptScene[];
};

export type ManuscriptOptions = {
    sceneIds: readonly StorySceneId[];
    /** Speaker keys (see {@link manuscriptSpeakerKey}) to keep; null keeps every line. */
    speakers: ReadonlySet<string> | null;
    /** How many spoken lines before each kept line are printed as context, when filtering. */
    contextLines: number;
    includeIds: boolean;
    /** Stage directions (every row that is not text) and author notes. */
    includeDirections: boolean;
    /** Choice rows and their options. The rows nested under an option are kept either way. */
    includeBranches: boolean;
};

export type ManuscriptLabels = {
    /** The `»` sentence the Story Script export writes for a non-text row. */
    label: StoryScriptLabeller;
    /** The speaker name of a dialogue row, `""` when it has none. */
    speaker: StoryScriptSpeakerLabeller;
    /** What a dialogue row with no speaker at all prints as. */
    unnamedSpeaker: string;
};

export type ManuscriptSpeaker = { key: string; name: string; count: number };

/**
 * Who speaks a dialogue row, as a filter key: the character when the row has one that resolves,
 * otherwise the bare name. Two temp speakers spelled the same are one person on paper.
 */
export function manuscriptSpeakerKey(block: StoryBlock, name: string): string | null {
    if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
        return null;
    }
    if (block.payload.characterId && name) {
        return `character:${block.payload.characterId}`;
    }
    return `name:${name.trim().toLowerCase()}`;
}

function walk(scene: StoryScene, visit: (block: StoryBlock, depth: number) => void): void {
    const seen = new Set<StoryBlockId>();
    const step = (blockId: StoryBlockId, depth: number) => {
        if (seen.has(blockId)) {
            return;
        }
        seen.add(blockId);
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        visit(block, depth);
        for (const childId of block.childrenIds ?? []) {
            step(childId, depth + 1);
        }
    };
    for (const rootId of scene.rootBlockIds ?? []) {
        step(rootId, 0);
    }
}

/** Every speaker of the chosen scenes, by number of lines, for the export dialog's filter. */
export function listManuscriptSpeakers(
    document: StoryDocument,
    sceneIds: readonly StorySceneId[],
    speakerLabel: StoryScriptSpeakerLabeller,
    unnamedSpeaker: string,
): ManuscriptSpeaker[] {
    const byKey = new Map<string, ManuscriptSpeaker>();
    for (const sceneId of sceneIds) {
        const scene = document.scenes[sceneId];
        if (!scene) {
            continue;
        }
        walk(scene, block => {
            const name = speakerLabel(scene, block.id);
            const key = manuscriptSpeakerKey(block, name);
            if (!key) {
                return;
            }
            const entry = byKey.get(key) ?? { key, name: name || unnamedSpeaker, count: 0 };
            entry.count += 1;
            byKey.set(key, entry);
        });
    }
    // Ties keep first appearance (a stable sort), which is reading order and does not depend on collation.
    return [...byKey.values()].sort((a, b) => b.count - a.count);
}

type Collected = { line: Exclude<ManuscriptLine, { kind: "gap" }>; spoken: boolean; key: string | null };

function collectScene(scene: StoryScene, options: ManuscriptOptions, labels: ManuscriptLabels): Collected[] {
    const out: Collected[] = [];
    // Depth counts only the ancestors that are printed, so hiding a container does not leave its
    // rows indented under nothing.
    const printedDepth = new Map<StoryBlockId, number>();
    walk(scene, block => {
        const parentDepth = block.parentId ? printedDepth.get(block.parentId) ?? -1 : -1;
        const depth = parentDepth + 1;
        const withId = (id: string) => (options.includeIds ? { id } : {});
        let collected: Collected | null = null;
        if (block.kind === "note") {
            if (options.includeDirections) {
                const text = serializeSegmentSourceText(block.payload.text).trim();
                if (text) {
                    collected = { line: { kind: "note", text, depth }, spoken: false, key: null };
                }
            }
        } else if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
            const name = labels.speaker(scene, block.id);
            collected = {
                line: {
                    kind: "dialogue",
                    speaker: name || labels.unnamedSpeaker,
                    text: serializeSegmentSourceText(block.payload.text),
                    depth,
                    ...withId(block.payload.text.textId),
                },
                spoken: true,
                key: manuscriptSpeakerKey(block, name),
            };
        } else if (block.kind === "nodeAction" && block.payload.action === "narration") {
            collected = {
                line: { kind: "narration", text: serializeSegmentSourceText(block.payload.text), depth, ...withId(block.payload.text.textId) },
                spoken: true,
                key: null,
            };
        } else if (block.kind === "nodeAction" && block.payload.action === "choice") {
            if (options.includeBranches) {
                const prompt = block.payload.prompt ? serializeSegmentSourceText(block.payload.prompt).trim() : "";
                collected = {
                    line: {
                        kind: "choice",
                        text: prompt || labels.label(scene, block.id),
                        depth,
                        ...(prompt && block.payload.prompt ? withId(block.payload.prompt.textId) : {}),
                    },
                    spoken: Boolean(prompt),
                    key: null,
                };
            }
        } else if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
            if (options.includeBranches) {
                collected = {
                    line: { kind: "option", text: serializeSegmentSourceText(block.payload.text), depth, ...withId(block.payload.text.textId) },
                    spoken: true,
                    key: null,
                };
            }
        } else if (options.includeDirections) {
            const text = labels.label(scene, block.id).trim();
            if (text) {
                collected = { line: { kind: "direction", text, depth }, spoken: false, key: null };
            }
        }
        if (collected) {
            printedDepth.set(block.id, depth);
            out.push(collected);
        } else {
            printedDepth.set(block.id, parentDepth);
        }
    });
    return out;
}

/**
 * Keep the chosen speakers' lines, each with the spoken lines before it as context, and mark every
 * stretch left out. Rows that are not spoken (directions, notes) are kept only inside a kept stretch.
 */
function filterToSpeakers(lines: Collected[], speakers: ReadonlySet<string>, contextLines: number): ManuscriptLine[] {
    const keep = new Array<boolean>(lines.length).fill(false);
    const primary = new Array<boolean>(lines.length).fill(false);
    lines.forEach((entry, index) => {
        if (!entry.key || !speakers.has(entry.key)) {
            return;
        }
        primary[index] = true;
        keep[index] = true;
        let remaining = contextLines;
        for (let back = index - 1; back >= 0 && remaining > 0; back -= 1) {
            keep[back] = true;
            if (lines[back].spoken) {
                remaining -= 1;
            }
        }
    });
    const out: ManuscriptLine[] = [];
    let skipped = false;
    lines.forEach((entry, index) => {
        if (!keep[index]) {
            skipped = true;
            return;
        }
        if (skipped && out.length > 0) {
            out.push({ kind: "gap" });
        }
        skipped = false;
        out.push(primary[index] ? entry.line : { ...entry.line, context: true });
    });
    if (skipped && out.length > 0) {
        out.push({ kind: "gap" });
    }
    return out;
}

export function buildManuscript(
    document: StoryDocument,
    options: ManuscriptOptions,
    labels: ManuscriptLabels,
    heading: { title: string; subtitle?: (sceneCount: number) => string },
): Manuscript {
    const scenes: ManuscriptScene[] = [];
    for (const sceneId of options.sceneIds) {
        const scene = document.scenes[sceneId];
        if (!scene) {
            continue;
        }
        const collected = collectScene(scene, options, labels);
        const lines = options.speakers ? filterToSpeakers(collected, options.speakers, options.contextLines) : collected.map(entry => entry.line);
        // A copy for one actor leaves out the scenes they are not in.
        if (options.speakers && lines.length === 0) {
            continue;
        }
        scenes.push({ id: scene.id, name: scene.name, lines });
    }
    const subtitle = heading.subtitle?.(scenes.length);
    return {
        title: heading.title,
        ...(subtitle ? { subtitle } : {}),
        ...(options.speakers ? { compact: true } : {}),
        scenes,
    };
}
