import { describe, expect, it } from "vitest";

import type { StoryBlock, StoryScene, StoryTextSegment } from "@shared/types/story";

import { narralangSceneExpressible, printNarralangScene, type NarralangLookups } from "./narralangPrinter";

// --- Fixtures -----------------------------------------------------------------------------------

function text(value: string, role: StoryTextSegment["role"], rich?: StoryTextSegment["rich"]): StoryTextSegment {
    return rich === undefined ? { textId: `t-${value}`, value, role } : { textId: `t-${value}`, value, role, rich };
}

/** A scene built from a flat list; `children` nests by id so fixtures stay readable. */
function scene(blocks: (Omit<StoryBlock, "parentId" | "childrenIds"> & { children?: string[] })[]): StoryScene {
    const byId: Record<string, StoryBlock> = {};
    const claimed = new Set<string>();
    for (const block of blocks) {
        for (const childId of block.children ?? []) {
            claimed.add(childId);
        }
    }
    for (const block of blocks) {
        const { children, ...rest } = block;
        byId[block.id] = {
            ...rest,
            parentId: null,
            childrenIds: children ?? [],
        } as StoryBlock;
    }
    for (const block of blocks) {
        for (const childId of block.children ?? []) {
            const child = byId[childId];
            if (child) {
                (child as { parentId: string | null }).parentId = block.id;
            }
        }
    }
    return {
        id: "scene-1",
        name: "走廊 · 傍晚",
        runtimeName: "corridor_dusk",
        rootBlockIds: blocks.map((block) => block.id).filter((id) => !claimed.has(id)),
        blocks: byId,
    };
}

const ASSETS: Record<string, string> = {
    "asset-bg": "corridor_dusk",
    "asset-bgm": "evening_theme",
    "asset-voice": "alice_01",
};

const lookups: NarralangLookups = {
    character: (id) => (id === "char-alice" ? { name: "爱丽丝" } : null),
    assetName: (id) => ASSETS[id] ?? null,
    appearanceName: (_characterId, refId) => (refId === "pose-smile" ? "smile" : null),
};

// --- Golden -------------------------------------------------------------------------------------

describe("printNarralangScene", () => {
    it("prints a scene as a script", () => {
        const fixture = scene([
            { id: "b1", kind: "action", payload: { action: "setBackground", assetId: "asset-bg", transition: { kind: "dissolve", durationMs: 500 } } },
            { id: "b2", kind: "action", payload: { action: "audio", operation: "setBgm", assetId: "asset-bgm", volume: 0.7, fadeMs: 1500, loop: true } },
            { id: "b3", kind: "nodeAction", payload: { action: "narration", text: text("夕阳把走廊染成橘色。", "narration") } },
            { id: "b4", kind: "action", payload: { action: "character", operation: "enter", characterId: "char-alice", pose: "pose-smile", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 300 } } },
            { id: "b5", kind: "nodeAction", payload: { action: "dialogue", characterId: "char-alice", text: text("你也留到这么晚啊。", "dialogue") } },
            { id: "b6", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "b6" } },
            {
                id: "b7",
                kind: "nodeAction",
                payload: { action: "choice", prompt: text("要说点什么吗？", "choicePrompt") },
                children: ["b8", "b10"],
            },
            { id: "b8", kind: "nodeAction", payload: { action: "choiceOption", text: text("「其实我在等你。」", "choiceText") }, children: ["b9"] },
            { id: "b9", kind: "action", payload: { action: "setVariable", target: { scope: "scene", variableId: "b6" }, value: 1, expression: { source: "trust + 1", ast: { kind: "literal", value: 1 } } } },
            { id: "b10", kind: "nodeAction", payload: { action: "choiceOption", text: text("「只是忘了时间。」", "choiceText") } },
            { id: "b11", kind: "control", payload: { control: "condition" }, children: ["b12"] },
            {
                id: "b12",
                kind: "control",
                payload: { control: "conditionBranch", branch: "if", condition: { kind: "expression", expression: { source: "trust > 0", ast: { kind: "literal", value: true } } } },
                children: ["b13", "b14"],
            },
            { id: "b13", kind: "action", payload: { action: "camera", operation: "zoom", zoom: 1.4, durationMs: 1200 } },
            { id: "b14", kind: "jump", payload: { targetSceneId: "scene-2" } },
            { id: "b15", kind: "note", payload: { text: text("这里以后要补一段回忆闪回", "note") } },
            { id: "b16", kind: "action", payload: { action: "character", operation: "exit", characterId: "char-alice", transform: { to: { opacity: 0 }, durationMs: 300 } } },
        ] as never);

        const result = printNarralangScene(fixture, {
            ...lookups,
            scenes: { "scene-2": { ...fixture, id: "scene-2", name: "天台 · 夜" } },
        });

        expect(result.issues).toEqual([]);
        expect(result.text).toBe(
            [
                "scene '走廊 · 傍晚':",
                "",
                "  bg corridor_dusk with fade 0.5",
                "  play bgm evening_theme volume 0.7 fadein 1.5 loop",
                "  夕阳把走廊染成橘色。",
                "  show 爱丽丝 smile at left over 0.3",
                "  爱丽丝: 你也留到这么晚啊。",
                "  var trust: number = 0",
                "  menu 要说点什么吗？:",
                "    「其实我在等你。」:",
                "      set trust = trust + 1",
                "    「只是忘了时间。」:",
                "  if trust > 0:",
                "    camera zoom 1.4 over 1.2",
                "    jump '天台 · 夜'",
                "  # 这里以后要补一段回忆闪回",
                "  hide 爱丽丝 with fade 0.3",
                "",
            ].join("\n"),
        );
    });
});

// --- Escaping -----------------------------------------------------------------------------------

describe("escaping", () => {
    it("escapes prose that would otherwise open a statement", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "narration", text: text("show me the money", "narration") } },
            { id: "b2", kind: "nodeAction", payload: { action: "narration", text: text("他说: 你好，她说: 再见", "narration") } },
            { id: "b3", kind: "nodeAction", payload: { action: "narration", text: text("# not a note", "narration") } },
        ] as never);

        const { text: out } = printNarralangScene(fixture, lookups);
        expect(out).toContain("  \\show me the money");
        // Every `: ` is escaped, not just the first - the parser splits at the first unescaped one,
        // so a bare later colon would split the line in the wrong place.
        expect(out).toContain("  他说\\: 你好，她说\\: 再见");
        expect(out).toContain("  \\# not a note");
    });

    it("keeps a choice option's own block marker when the text ends in a colon", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "choice" }, children: ["b2"] },
            { id: "b2", kind: "nodeAction", payload: { action: "choiceOption", text: text("问她:", "choiceText") } },
        ] as never);

        expect(printNarralangScene(fixture, lookups).text).toContain("    问她\\::");
    });

    it("does not escape a colon in dialogue text, where the speaker split has already happened", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "dialogue", speakerName: "？？？", text: text("听着: 别回头。", "dialogue") } },
        ] as never);

        expect(printNarralangScene(fixture, lookups).text).toContain("  ？？？: 听着: 别回头。");
    });
});

// --- Rich text ----------------------------------------------------------------------------------

describe("rich text", () => {
    it("nests marks in a fixed order and prints pauses and interpolations", () => {
        const fixture = scene([
            {
                id: "b1",
                kind: "nodeAction",
                payload: {
                    action: "narration",
                    text: text("", "narration", [
                        { text: "重要", marks: { bold: true, italic: true, color: "#ff8080" } },
                        { pause: 400 },
                        { interpolation: { kind: "expression", expression: { source: "gold + 1", ast: { kind: "literal", value: 1 } } } },
                    ]),
                },
            },
        ] as never);

        expect(printNarralangScene(fixture, lookups).text).toContain("  {b}{i}{color #ff8080}重要{/color}{/i}{/b}{p 0.4}{= gold + 1}");
    });
});

// --- The gate -----------------------------------------------------------------------------------

describe("the expressibility gate", () => {
    it("refuses a scene holding a blueprint row", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "narration", text: text("普通旁白", "narration") } },
            { id: "b2", kind: "action", payload: { action: "blueprint", blueprintId: "bp-1" } },
        ] as never);

        const result = printNarralangScene(fixture, lookups);
        expect(result.issues).toEqual([{ blockId: "b2", reason: "blueprintAction" }]);
        expect(narralangSceneExpressible(fixture, lookups)).toBe(false);
        // Export is best effort: the rest of the scene still prints.
        expect(result.text).toContain("普通旁白");
    });

    it("refuses a scene holding an invalid row, and does not re-read it as script", () => {
        const fixture = scene([
            { id: "b1", kind: "invalid", payload: { source: "/set gold" } },
        ] as never);

        const result = printNarralangScene(fixture, lookups);
        expect(result.issues).toEqual([{ blockId: "b1", reason: "invalidRow" }]);
        expect(result.text).toContain("~~ /set gold");
    });

    it("refuses an asset the lookups cannot name rather than printing its id", () => {
        const fixture = scene([
            { id: "b1", kind: "action", payload: { action: "setBackground", assetId: "asset-missing" } },
        ] as never);

        const result = printNarralangScene(fixture, lookups);
        expect(result.issues).toEqual([{ blockId: "b1", reason: "unresolvedRef", detail: "asset" }]);
        expect(result.text).not.toContain("asset-missing");
    });

    it("refuses a keyframed transform, which has no script spelling", () => {
        const fixture = scene([
            {
                id: "b1",
                kind: "action",
                payload: { action: "character", operation: "move", characterId: "char-alice", transform: { mode: "animation", animationId: "anim-1" } },
            },
        ] as never);

        expect(printNarralangScene(fixture, lookups).issues).toEqual([{ blockId: "b1", reason: "customTransform" }]);
    });

    it("passes a scene whose rows all have spellings", () => {
        const fixture = scene([
            { id: "b1", kind: "action", payload: { action: "wait", mode: "click" } },
            { id: "b2", kind: "control", payload: { control: "label", name: "after refusal" } },
            { id: "b3", kind: "control", payload: { control: "goto", targetLabel: "after refusal" } },
        ] as never);

        expect(narralangSceneExpressible(fixture, lookups)).toBe(true);
        expect(printNarralangScene(fixture, lookups).text).toContain("  goto 'after refusal'");
    });
});

// --- Disabled rows ------------------------------------------------------------------------------

describe("disabled rows", () => {
    it("marks a disabled row and still prints its subtree", () => {
        const fixture = scene([
            { id: "b1", kind: "action", payload: { action: "wait", mode: "duration", durationMs: 1500 }, disabled: true },
        ] as never);

        expect(printNarralangScene(fixture, lookups).text).toContain("  ~ wait 1.5");
    });
});

// --- Locale ---------------------------------------------------------------------------------------

describe("the no-locale invariant", () => {
    // `storyCharacterName` / `getStorySceneName` / `variableRefShortLabel` all answer a miss with
    // `translate(...)`. Reaching one of those from here would put "Unknown character" in an English
    // export and "未知角色" in a Chinese one, for the same document. Found on a real project.
    it("reports a dangling character rather than printing a translated fallback", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "dialogue", characterId: "char-deleted", text: text("还在吗？", "dialogue") } },
            { id: "b2", kind: "action", payload: { action: "character", operation: "enter", characterId: "char-deleted" } },
        ] as never);

        const result = printNarralangScene(fixture, lookups);
        expect(result.issues).toEqual([
            { blockId: "b1", reason: "unresolvedRef", detail: "character" },
            { blockId: "b2", reason: "unresolvedRef", detail: "character" },
        ]);
        expect(result.text).not.toMatch(/Unknown|未知/);
    });

    it("keeps a bare speaker name, which is a real state and not a dangling reference", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "dialogue", speakerName: "旁白者", text: text("嗯。", "dialogue") } },
        ] as never);

        const result = printNarralangScene(fixture, lookups);
        expect(result.issues).toEqual([]);
        expect(result.text).toContain("  旁白者: 嗯。");
    });

    it("reports a dangling jump target rather than naming it", () => {
        const fixture = scene([
            { id: "b1", kind: "jump", payload: { targetSceneId: "scene-gone" } },
        ] as never);

        expect(printNarralangScene(fixture, lookups).issues).toEqual([
            { blockId: "b1", reason: "unresolvedRef", detail: "scene" },
        ]);
    });
});

// --- Whitespace -----------------------------------------------------------------------------------

describe("whitespace at run boundaries", () => {
    // A run is a fragment, so its trailing space is ordinary mid-sentence text. Escaping per run
    // produced `Yes,\ {i}…`, and a run that was a single space came out as `\\ ` (the backslash
    // escape had already run, so the space escape doubled it). Found on a real project.
    it("does not escape the space between two runs", () => {
        const fixture = scene([
            {
                id: "b1",
                kind: "nodeAction",
                payload: {
                    action: "narration",
                    text: text("", "narration", [
                        { text: "Yes, " },
                        { text: "but the snow", marks: { italic: true } },
                        { text: " " },
                        { text: "is beautiful." },
                    ]),
                },
            },
        ] as never);

        expect(printNarralangScene(fixture, lookups).text).toContain("  Yes, {i}but the snow{/i} is beautiful.");
    });

    it("still protects a space at either end of the whole line", () => {
        const fixture = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "narration", text: text(" 缩进过的一行 ", "narration") } },
        ] as never);

        expect(printNarralangScene(fixture, lookups).text).toContain("  \\ 缩进过的一行\\ ");
    });
});
