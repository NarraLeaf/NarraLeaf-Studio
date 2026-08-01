import { describe, expect, it } from "vitest";
import type {
    StoryBlock,
    StoryDocument,
    StoryRichRun,
    StoryScene,
    StoryTextMarks,
    StoryTextSegment,
} from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { normalizeRuns, richIfMeaningful, richRunsToPlain } from "@/apps/workspace/modules/story/scene-editor/richText";
import { exportStoryScript, parseStoryScript, planStoryScriptImport } from "./storyScriptCodec";
import type { StoryScriptExportOptions } from "./storyScriptTypes";

/**
 * The losslessness proof.
 *
 * `plan(parse(export(doc))).scene` has to be the scene that went in, for scenes nobody would write by
 * hand: every block kind, every rich-run variant, nesting, disabled rows, and text made of exactly the
 * characters the format reserves. The generator is seeded and the seeds are fixed, so a failure is a
 * *reproducible* failure - which is the whole reason not to reach for `Math.random` (and `fast-check`
 * is not a dependency of this repo).
 */

const SEED_COUNT = 200;

// ---------------------------------------------------------------------------
// A seeded generator (Numerical Recipes LCG - short, exact in 32 bits, no dependency)
// ---------------------------------------------------------------------------

class Rng {
    private state: number;

    constructor(seed: number) {
        this.state = (seed >>> 0) || 0x9e3779b9;
    }

    next(): number {
        this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }

    int(bound: number): number {
        return bound <= 0 ? 0 : Math.min(bound - 1, Math.floor(this.next() * bound));
    }

    pick<T>(items: readonly T[]): T {
        return items[this.int(items.length)];
    }

    chance(probability: number): boolean {
        return this.next() < probability;
    }
}

/** UUID v4 shaped and deterministic, the way `storyModel.test.ts:30` does it. */
function idFactory(tag: string): () => string {
    let next = 0;
    return () => {
        next += 1;
        return `${tag}-0000-4000-8000-${next.toString(16).padStart(12, "0")}`;
    };
}

/**
 * Text the format has to survive. The four reserved characters and the escape character, the three
 * line-structure sigils, the dialogue separator, CJK, emoji, whitespace at both edges, an embedded
 * newline, and the empty string.
 */
const TEXT_FRAGMENTS = [
    "",
    "hello",
    "早上好，指挥官",
    "こんにちは",
    "🌸🎈👩‍👩‍👧‍👦",
    "a⟦b⟧c",
    "‹0›not a run‹/0›",
    "back\\slash\\\\twice",
    " leading",
    "trailing ",
    "  both  ",
    "line\nbreak",
    "tab\there",
    "carriage\rreturn",
    "he said: hello",
    "// not a note",
    "- not an option",
    "» not an action",
    "#not a directive",
    ":",
    ": ",
    "   ",
    "⟦⟧‹›\\",
    "混合 ⟦1⟧ ‹2› \\ 🌊 end ",
];

const MARK_VARIANTS: Array<StoryTextMarks | undefined> = [
    undefined,
    { bold: true },
    { italic: true },
    { color: "#ff3366" },
    { ruby: "かんじ" },
    { cps: 24 },
    { fontSize: 18 },
    { bold: true, italic: true, color: "rgb(1, 2, 3)", ruby: "る", cps: 8, fontSize: 32 },
];

function randomRuns(rng: Rng): StoryRichRun[] {
    const runs: StoryRichRun[] = [];
    const count = rng.int(6);
    for (let index = 0; index < count; index += 1) {
        switch (rng.int(5)) {
            case 0:
                runs.push({ text: rng.pick(TEXT_FRAGMENTS) });
                break;
            case 1: {
                const marks = rng.pick(MARK_VARIANTS);
                runs.push(marks ? { text: rng.pick(TEXT_FRAGMENTS), marks } : { text: rng.pick(TEXT_FRAGMENTS) });
                break;
            }
            case 2:
                runs.push({ pause: rng.chance(0.5) ? true : 100 + rng.int(2000) });
                break;
            case 3: {
                const marks = rng.pick(MARK_VARIANTS);
                const interpolation = rng.pick([
                    { kind: "variable", target: { scope: "scene", variableId: "v-scene" } },
                    { kind: "variable", target: { scope: "saved", variableId: "v-saved" } },
                    { kind: "variable", target: { scope: "persistent", variableId: "v-persistent" } },
                    { kind: "blueprint", blueprintId: "bp-1" },
                    { kind: "expression", expression: { source: "gold + 1", ast: { kind: "binary", op: "+", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } } } },
                ] as const);
                runs.push(marks ? { interpolation, marks } : { interpolation });
                break;
            }
            default:
                runs.push({
                    event: rng.pick([
                        { expression: { characterId: "c-1", pose: "smile" } },
                        { expression: { characterId: "c-2", tags: { mood: "angry" } } },
                        { sound: { assetId: "a-1" } },
                        { expression: { characterId: "c-1" }, sound: { assetId: "a-2" } },
                    ] as const),
                });
        }
    }
    return normalizeRuns(runs);
}

function randomSegment(rng: Rng, role: StoryTextSegment["role"], newId: () => string): StoryTextSegment {
    const runs = randomRuns(rng);
    const rich = richIfMeaningful(runs);
    return { textId: newId(), value: richRunsToPlain(runs), role, ...(rich ? { rich } : {}) };
}

/**
 * Speaker names, including the ones a display name cannot tell apart from a binding: `"Alice"` is also
 * a character's name, so a row carrying it as a *temp* speaker must not come back bound to her.
 */
const TEMP_SPEAKERS = ["？？？", "Voice in the dark", "", "  spaced  ", "Dr: Who", "Alice", "早苗"];
const CHARACTERS: Array<{ id: string; name: string }> = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Alice" },
    { id: "22222222-2222-4222-8222-222222222222", name: "早苗" },
    { id: "33333333-3333-4333-8333-333333333333", name: "Prof: Layton" },
    { id: "44444444-4444-4444-8444-444444444444", name: "  Padded  " },
    // Two characters, one display name. Nothing forbids it, and the file cannot tell them apart.
    { id: "55555555-5555-4555-8555-555555555555", name: "Alice" },
];
/** A character the author deleted. The rows that named it keep the id, and no name can be printed for it. */
const DELETED_CHARACTER = "66666666-6666-4666-8666-666666666666";

/** Every payload shape the `»` label has to stand in for. Values are inert here - the codec never reads them. */
function randomOpaqueBlock(rng: Rng, id: string, newId: () => string): StoryBlock {
    switch (rng.int(12)) {
        case 0:
            return block(id, "action", { action: "setBackground", assetId: "bg-1", transition: { kind: "dissolve", durationMs: 500 } });
        case 1:
            return block(id, "action", { action: "character", operation: "enter", characterId: CHARACTERS[0].id, pose: "smile" });
        case 2:
            return block(id, "action", { action: "audio", operation: "playSound", assetId: "se-1", volume: 0.8 });
        case 3:
            return block(id, "action", { action: "setVariable", target: { scope: "scene", variableId: "v-scene" }, value: 3 });
        case 4:
            return block(id, "action", { action: "wait", mode: "duration", durationMs: 250 });
        case 5:
            return block(id, "action", { action: "camera", operation: "zoom", zoom: 1.4 });
        case 6:
            return block(id, "code", { language: "javascript", source: "// nothing\nconst a = 1;", folded: true });
        case 7:
            return block(id, "invalid", { source: "/set gold" });
        case 8:
            return block(id, "declaration", { scope: "scene", name: "Gold", valueType: "number", defaultValue: 0, storageKey: newId() });
        case 9:
            return block(id, "jump", { targetSceneId: "99999999-9999-4999-8999-999999999999" });
        case 10:
            return block(id, "action", { action: "vfx", operation: "create", objectName: "rain", assetId: "v-1", blendMode: "screen" });
        default:
            return block(id, "action", { action: "screenEffect", effect: "vignette", durationMs: 400, color: "#000" });
    }
}

function block(id: string, kind: StoryBlock["kind"], payload: unknown): StoryBlock {
    return { id, kind, parentId: null, childrenIds: [], payload } as StoryBlock;
}

type Built = { block: StoryBlock; children: Built[] };

function randomRow(rng: Rng, depth: number, newId: () => string): Built {
    const id = newId();
    const roll = rng.int(10);
    if (roll === 0) {
        // A choice and its options - the one container the text layer can edit the inside of.
        const choice = block(id, "nodeAction", {
            action: "choice",
            ...(rng.chance(0.5) ? { prompt: randomSegment(rng, "choicePrompt", newId) } : {}),
        });
        const options: Built[] = [];
        for (let index = 0; index < 1 + rng.int(3); index += 1) {
            const option = block(newId(), "nodeAction", { action: "choiceOption", text: randomSegment(rng, "choiceText", newId) });
            markDisabled(rng, option);
            options.push({ block: option, children: depth < 2 ? randomRows(rng, depth + 1, newId, 2) : [] });
        }
        return { block: choice, children: options };
    }
    if (roll === 1 && depth < 3) {
        const control = block(id, "control", rng.pick([
            { control: "condition" },
            { control: "sequence", mode: "do" },
            { control: "repeat", times: 3 },
        ] as const));
        markDisabled(rng, control);
        return { block: control, children: randomRows(rng, depth + 1, newId, 3) };
    }
    if (roll === 2) {
        const text = randomSegment(rng, "dialogue", newId);
        const speaker = rng.int(4);
        const dialogue =
            speaker === 0
                // A dangling binding: the row prints no name at all, and resolving that empty label
                // would delete the id the author can still repair by re-creating the character.
                ? { action: "dialogue", characterId: DELETED_CHARACTER, text }
                : speaker === 1
                    ? { action: "dialogue", speakerName: rng.pick(TEMP_SPEAKERS), text }
                    : { action: "dialogue", characterId: rng.pick(CHARACTERS).id, text };
        const row = block(id, "nodeAction", dialogue);
        markDisabled(rng, row);
        return { block: row, children: [] };
    }
    if (roll === 3) {
        const row = block(id, "note", { text: randomSegment(rng, "note", newId) });
        markDisabled(rng, row);
        return { block: row, children: [] };
    }
    if (roll <= 5) {
        const row = randomOpaqueBlock(rng, id, newId);
        markDisabled(rng, row);
        return { block: row, children: [] };
    }
    const row = block(id, "nodeAction", { action: "narration", text: randomSegment(rng, "narration", newId) });
    markDisabled(rng, row);
    return { block: row, children: [] };
}

function markDisabled(rng: Rng, target: StoryBlock): void {
    if (rng.chance(0.2)) {
        target.disabled = true;
    }
}

function randomRows(rng: Rng, depth: number, newId: () => string, max: number): Built[] {
    const rows: Built[] = [];
    for (let index = 0; index < rng.int(max + 1); index += 1) {
        rows.push(randomRow(rng, depth, newId));
    }
    return rows;
}

export function randomScene(seed: number): { document: StoryDocument; sceneId: string } {
    const rng = new Rng(seed);
    const newId = idFactory("00000001");
    const sceneId = "abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd";
    const rows = randomRows(rng, 0, newId, 8);
    const blocks: Record<string, StoryBlock> = {};
    const rootBlockIds: string[] = [];
    const attach = (built: Built[], parentId: string | null, into: string[]) => {
        for (const item of built) {
            item.block.parentId = parentId;
            item.block.childrenIds = [];
            blocks[item.block.id] = item.block;
            into.push(item.block.id);
            attach(item.children, item.block.id, item.block.childrenIds);
        }
    };
    attach(rows, null, rootBlockIds);
    const scene: StoryScene = {
        id: sceneId,
        name: "第一场 ⟦test⟧",
        runtimeName: "scene_1",
        description: "a scene with everything in it",
        rootBlockIds,
        blocks,
    };
    const document: StoryDocument = {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        name: "Story",
        chapters: [{ id: "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c", name: "Chapter", sceneIds: [sceneId] }],
        scenes: { [sceneId]: scene },
    };
    return { document, sceneId };
}

function nameOf(characterId: string): string {
    return CHARACTERS.find(character => character.id === characterId)?.name ?? "";
}

export const exportOptions: StoryScriptExportOptions = {
    mode: "roundtrip",
    label: (scene, blockId) => `${scene.blocks[blockId]?.kind ?? "?"} row`,
    speaker: (scene, blockId) => {
        const target = scene.blocks[blockId];
        if (!target || target.kind !== "nodeAction" || target.payload.action !== "dialogue") {
            return "";
        }
        return target.payload.characterId ? nameOf(target.payload.characterId) : target.payload.speakerName ?? "";
    },
};

export const resolveSpeaker = (label: string): { characterId: string } | { speakerName: string } => {
    const match = CHARACTERS.find(character => character.name === label);
    return match ? { characterId: match.id } : { speakerName: label };
};

// ---------------------------------------------------------------------------

describe("story script round trip", () => {
    it(`restores the scene byte for byte across ${SEED_COUNT} generated scenes`, () => {
        for (let seed = 1; seed <= SEED_COUNT; seed += 1) {
            const { document, sceneId } = randomScene(seed);
            const text = exportStoryScript(document, [sceneId], exportOptions);
            const parsed = parseStoryScript(text);
            expect(parsed.ok, `seed ${seed}: ${parsed.ok ? "" : parsed.error.message}`).toBe(true);
            if (!parsed.ok) {
                return;
            }
            const plan = planStoryScriptImport({
                script: parsed.script,
                live: document,
                generateId: idFactory("00000002"),
                resolveSpeaker,
                // The same labeller the export ran through: an unedited label is recognised as
                // unedited rather than re-resolved through a name that means several things.
                speakerLabel: exportOptions.speaker,
            });
            const scenePlan = plan.scenes[0];
            expect(scenePlan.diagnostics, `seed ${seed}`).toEqual([]);
            expect(scenePlan.scene, `seed ${seed}`).toEqual(document.scenes[sceneId]);
            expect(scenePlan.stale, `seed ${seed}`).toBe(false);
            expect(scenePlan.missing, `seed ${seed}`).toBe(false);
            // Every row accounted for as untouched: proves the "unchanged" comparison found the rows
            // equal rather than the merge quietly rebuilding them into something that happens to match.
            expect(scenePlan.stats, `seed ${seed}`).toEqual({
                unchanged: Object.keys(document.scenes[sceneId].blocks).length,
                edited: 0,
                added: 0,
                removed: 0,
                cloned: 0,
                moved: 0,
            });
        }
    });

    it("survives every `»` label being mangled, because the label is never parsed", () => {
        // The mangling avoids only the anchor brackets themselves - a label that ended in `⟦9⟧` would
        // be claiming to be a different row, which is a statement, not noise.
        const mangle = "» 🙃 ЖЖЖ :: -- // \\ ‹9› 完全不同的文字";
        let mangledLines = 0;
        for (let seed = 1; seed <= 40; seed += 1) {
            const { document, sceneId } = randomScene(seed);
            const text = exportStoryScript(document, [sceneId], exportOptions);
            const mangled = text
                .split("\n")
                .map(line => {
                    const match = /^(\s*)» .*?( ⟦\d+⟧)$/.exec(line);
                    if (!match) {
                        return line;
                    }
                    mangledLines += 1;
                    return `${match[1]}${mangle}${match[2]}`;
                })
                .join("\n");
            const parsed = parseStoryScript(mangled);
            expect(parsed.ok, `seed ${seed}`).toBe(true);
            if (!parsed.ok) {
                return;
            }
            const plan = planStoryScriptImport({
                script: parsed.script,
                live: document,
                generateId: idFactory("00000002"),
                resolveSpeaker,
                // The same labeller the export ran through: an unedited label is recognised as
                // unedited rather than re-resolved through a name that means several things.
                speakerLabel: exportOptions.speaker,
            });
            expect(plan.scenes[0].scene, `seed ${seed}`).toEqual(document.scenes[sceneId]);
            expect(plan.scenes[0].diagnostics, `seed ${seed}`).toEqual([]);
        }
        expect(mangledLines).toBeGreaterThan(40);
    });

    it("carries an edit through arbitrary rich text without disturbing the runs around it", () => {
        const suffix = "…追记";
        for (let seed = 1; seed <= 40; seed += 1) {
            const { document, sceneId } = randomScene(seed);
            const scene = document.scenes[sceneId];
            const text = exportStoryScript(document, [sceneId], exportOptions);
            // Append to every prose line, in front of its anchor.
            const edited = text
                .split("\n")
                .map(line => {
                    const match = /^(.*?)( ⟦\d+⟧)$/.exec(line);
                    if (!match || match[1].trimStart().startsWith("» ")) {
                        return line;
                    }
                    return `${match[1]}${suffix}${match[2]}`;
                })
                .join("\n");
            const parsed = parseStoryScript(edited);
            expect(parsed.ok).toBe(true);
            if (!parsed.ok) {
                return;
            }
            const plan = planStoryScriptImport({
                script: parsed.script,
                live: document,
                generateId: idFactory("00000002"),
                resolveSpeaker,
                // The same labeller the export ran through: an unedited label is recognised as
                // unedited rather than re-resolved through a name that means several things.
                speakerLabel: exportOptions.speaker,
            });
            const merged = plan.scenes[0].scene;
            for (const [id, before] of Object.entries(scene.blocks)) {
                const slot = editableSegment(before);
                const after = editableSegment(merged.blocks[id]);
                if (!slot || !after) {
                    expect(merged.blocks[id], `seed ${seed} block ${id}`).toEqual(before);
                    continue;
                }
                // The id and the localization/voice unit are the same row's; only the words moved.
                expect(merged.blocks[id].id).toBe(id);
                expect(after.textId).toBe(slot.textId);
                const expectedRuns = normalizeRuns([...runsOf(slot), { text: suffix }]);
                expect(after.value, `seed ${seed} block ${id}`).toBe(richRunsToPlain(expectedRuns));
                expect(after.rich, `seed ${seed} block ${id}`).toEqual(richIfMeaningful(expectedRuns));
            }
        }
    });
});

function editableSegment(target: StoryBlock | undefined): StoryTextSegment | null {
    if (!target) {
        return null;
    }
    if (target.kind === "note") {
        return target.payload.text;
    }
    if (target.kind === "nodeAction" && (target.payload.action === "narration" || target.payload.action === "dialogue" || target.payload.action === "choiceOption")) {
        return target.payload.text;
    }
    return null;
}

function runsOf(segment: StoryTextSegment): StoryRichRun[] {
    return segment.rich && segment.rich.length > 0 ? normalizeRuns(segment.rich) : segment.value ? [{ text: segment.value }] : [];
}
