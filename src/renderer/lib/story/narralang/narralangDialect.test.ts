/**
 * The pluggability test.
 *
 * The claim the refactor makes is that the language is a value: change the table, change the whole
 * surface, and the printer does not move. This file defines a dialect that disagrees with the default
 * about everything a dialect is allowed to disagree about - verb words, prepositions, slot ORDER, the
 * block marker, the indent, the line prefixes, the rich-text fences and tag names, and the spelling of
 * two closed-vocabulary words - and prints the same fixture through both.
 *
 * Nothing under `narralang/` outside the dialect table is touched to make this pass. If a future
 * change makes a spelling reachable only from code, this file is where it shows up.
 */

import { describe, expect, it } from "vitest";

import type { StoryBlock, StoryScene, StoryTextSegment } from "@shared/types/story";

import {
    NARRALANG_DEFAULT_DIALECT,
    narralangDialectKeywords,
    type NarralangDialect,
    type NarralangVerbSyntax,
} from "./narralangDialect";
import type { NarralangVerb } from "./narralangShape";
import { printNarralangScene, printNarralangSceneWithDialect, type NarralangLookups } from "./narralangPrinter";

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
        byId[block.id] = { ...rest, parentId: null, childrenIds: children ?? [] } as StoryBlock;
    }
    return {
        id: "scene-1",
        name: "走廊 · 傍晚",
        runtimeName: "corridor_dusk",
        rootBlockIds: blocks.map((block) => block.id).filter((id) => !claimed.has(id)),
        blocks: byId,
    };
}

const ASSETS: Record<string, string> = { "asset-bg": "corridor_dusk", "asset-bgm": "evening_theme" };

const lookups: NarralangLookups = {
    character: (id) => (id === "char-alice" ? { name: "爱丽丝" } : null),
    assetName: (id) => ASSETS[id] ?? null,
    appearanceName: (_characterId, refId) => (refId === "pose-smile" ? "smile" : null),
};

// --- A dialect that disagrees about everything ----------------------------------------------------

/** Every verb and every preposition, shouted. The slot declarations are otherwise untouched. */
function shout(verbs: NarralangDialect["verbs"]): NarralangDialect["verbs"] {
    const out = {} as Record<NarralangVerb, NarralangVerbSyntax>;
    for (const [verb, syntax] of Object.entries(verbs) as [NarralangVerb, NarralangVerbSyntax][]) {
        out[verb] = {
            keyword: syntax.keyword.toUpperCase(),
            slots: syntax.slots.map((slot) => (slot.lead === undefined ? slot : { ...slot, lead: slot.lead.toUpperCase() })),
        };
    }
    return out;
}

const SHOUTED: NarralangDialect = {
    ...NARRALANG_DEFAULT_DIALECT,
    id: "shouted",
    indent: "    ",
    sceneKeyword: "SCENE",
    block: { open: " {", close: "}" },
    prefix: { note: "//", disabled: "!", builtin: "$" },
    words: { ...NARRALANG_DEFAULT_DIALECT.words, left: "LEFT", fade: "FADE" },
    text: {
        ...NARRALANG_DEFAULT_DIALECT.text,
        open: "[",
        close: "]",
        marks: [
            { mark: "bold", tag: "B" },
            { mark: "italic", tag: "EM" },
            { mark: "color", tag: "COLOUR", arg: "raw" },
            { mark: "fontSize", tag: "SIZE", arg: "number" },
            { mark: "cps", tag: "CPS", arg: "number" },
            { mark: "ruby", tag: "RUBY", arg: "raw" },
        ],
    },
    verbs: {
        ...shout(NARRALANG_DEFAULT_DIALECT.verbs),
        // Slot ORDER is data too: this dialect states where the portrait lands before it says which
        // pose lands there, and hangs the placement off a different preposition.
        characterEnter: {
            keyword: "SHOW",
            slots: [
                { slot: "subject", value: "name" },
                { slot: "placement", lead: "TO", value: "word" },
                { slot: "transformTransition", lead: "WITH", value: "timedWord" },
                { slot: "transformDuration", lead: "OVER", value: "seconds" },
                { slot: "transformEasing", lead: "EASE", value: "name" },
                { slot: "appearance", value: "names" },
                { slot: "transition", lead: "WITH", value: "timedWord" },
                { slot: "transitionEasing", lead: "EASE", value: "name" },
            ],
        },
    },
};

const fixture = scene([
    { id: "b1", kind: "action", payload: { action: "setBackground", assetId: "asset-bg", transition: { kind: "dissolve", durationMs: 500 } } },
    { id: "b2", kind: "action", payload: { action: "audio", operation: "setBgm", assetId: "asset-bgm", volume: 0.7, fadeMs: 1500, loop: true } },
    { id: "b3", kind: "nodeAction", payload: { action: "narration", text: text("夕阳把走廊染成橘色。", "narration") } },
    { id: "b4", kind: "action", payload: { action: "character", operation: "enter", characterId: "char-alice", pose: "pose-smile", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 300 } } },
    { id: "b5", kind: "nodeAction", payload: { action: "dialogue", characterId: "char-alice", text: text("你也留到这么晚啊。", "dialogue") } },
    { id: "b6", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "b6" } },
    { id: "b7", kind: "nodeAction", payload: { action: "choice", prompt: text("要说点什么吗？", "choicePrompt") }, children: ["b8", "b10"] },
    { id: "b8", kind: "nodeAction", payload: { action: "choiceOption", text: text("「其实我在等你。」", "choiceText") }, children: ["b9"] },
    { id: "b9", kind: "action", payload: { action: "setVariable", target: { scope: "scene", variableId: "b6" }, value: 1, expression: { source: "trust + 1", ast: { kind: "literal", value: 1 } } } },
    { id: "b10", kind: "nodeAction", payload: { action: "choiceOption", text: text("「只是忘了时间。」", "choiceText") } },
    { id: "b11", kind: "control", payload: { control: "condition" }, children: ["b12"] },
    {
        id: "b12",
        kind: "control",
        payload: { control: "conditionBranch", branch: "if", condition: { kind: "expression", expression: { source: "trust > 0", ast: { kind: "literal", value: true } } } },
        children: ["b13"],
    },
    { id: "b13", kind: "action", payload: { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 1.4 }, durationMs: 1200 } } },
    { id: "b14", kind: "note", payload: { text: text("这里以后要补一段回忆闪回", "note") } },
    { id: "b15", kind: "action", payload: { action: "wait", mode: "duration", durationMs: 1500 }, disabled: true },
    { id: "b16", kind: "action", payload: { action: "character", operation: "exit", characterId: "char-alice", transform: { to: { opacity: 0 }, durationMs: 300 } } },
] as never);

// --- Tests ----------------------------------------------------------------------------------------

describe("a swapped dialect", () => {
    it("prints the same scene as a different-looking language, with no printer change", () => {
        const result = printNarralangSceneWithDialect(fixture, lookups, SHOUTED);

        expect(result.issues).toEqual([]);
        expect(result.text).toBe(
            [
                "SCENE '走廊 · 傍晚' {",
                "",
                "    BG corridor_dusk WITH FADE 0.5",
                "    PLAY bgm evening_theme VOLUME 0.7 FADEIN 1.5 loop",
                "    夕阳把走廊染成橘色。",
                "    SHOW 爱丽丝 TO LEFT OVER 0.3 smile",
                "    爱丽丝: 你也留到这么晚啊。",
                "    VAR trust: number = 0",
                "    MENU 要说点什么吗？ {",
                "        「其实我在等你。」 {",
                "            SET trust = trust + 1",
                "        }",
                "        「只是忘了时间。」 {",
                "        }",
                "    }",
                "    IF trust > 0 {",
                "        CAMERA ZOOM 1.4 OVER 1.2",
                "    }",
                "    // 这里以后要补一段回忆闪回",
                "    ! WAIT 1.5",
                "    HIDE 爱丽丝 WITH FADE 0.3",
                "}",
                "",
            ].join("\n"),
        );
    });

    it("still prints the default language from the same shapes", () => {
        // The two calls share every line of extraction: only the table differs.
        const result = printNarralangScene(fixture, lookups);

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
                "  # 这里以后要补一段回忆闪回",
                "  ~ wait 1.5",
                "  hide 爱丽丝 with fade 0.3",
                "",
            ].join("\n"),
        );
    });

    it("fences rich text the way the dialect says, tag names included", () => {
        const rich = scene([
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

        expect(printNarralangSceneWithDialect(rich, lookups, SHOUTED).text)
            .toContain("    [B][EM][COLOUR #ff8080]重要[/COLOUR][/EM][/B][p 0.4][= gold + 1]");
    });
});

describe("escaping follows the dialect", () => {
    // The escape exists so a prose line can never be misread as a statement. It therefore has to see
    // the SAME keyword set the reader's "first token is a keyword" rule sees - which is why the set is
    // derived from the verb table rather than kept beside it.
    it("escapes prose against this dialect's keywords, not the default's", () => {
        const prose = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "narration", text: text("show me the money", "narration") } },
            { id: "b2", kind: "nodeAction", payload: { action: "narration", text: text("SHOW me the money", "narration") } },
            { id: "b3", kind: "nodeAction", payload: { action: "narration", text: text("// not a note", "narration") } },
            { id: "b4", kind: "nodeAction", payload: { action: "narration", text: text("# not a note here", "narration") } },
        ] as never);

        const out = printNarralangSceneWithDialect(prose, lookups, SHOUTED).text;
        // `show` is prose in a dialect whose verb is `SHOW`, and the escape correctly leaves it alone.
        expect(out).toContain("    show me the money");
        expect(out).toContain("    \\SHOW me the money");
        expect(out).toContain("    \\// not a note");
        expect(out).toContain("    # not a note here");
    });

    it("escapes this dialect's tag fences in prose", () => {
        const prose = scene([
            { id: "b1", kind: "nodeAction", payload: { action: "narration", text: text("方括号 [1] 与花括号 {1}", "narration") } },
        ] as never);

        expect(printNarralangSceneWithDialect(prose, lookups, SHOUTED).text)
            .toContain("    方括号 \\[1\\] 与花括号 {1}");
    });

    it("derives the keyword set from the verb table, so a renamed verb moves the escape with it", () => {
        expect(narralangDialectKeywords(NARRALANG_DEFAULT_DIALECT).has("show")).toBe(true);
        expect(narralangDialectKeywords(SHOUTED).has("show")).toBe(false);
        expect(narralangDialectKeywords(SHOUTED).has("SHOW")).toBe(true);
        // Verbs the default dialect spells with two words contribute only the word that opens a line.
        expect(narralangDialectKeywords(NARRALANG_DEFAULT_DIALECT).has("create")).toBe(false);
    });
});
