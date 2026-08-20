/**
 * What the parser does with a line, as opposed to what a round trip proves about a scene.
 *
 * The round trip (see `narralangRoundTrip.test.ts`) can only exercise text a printer produced. These
 * are the cases a person types: a keyword that does not parse, a name nothing answers to, two things
 * answering to one name, indentation that skips a level. None of them may throw, and none of them may
 * quietly become a line of narration.
 */

import { describe, expect, it } from "vitest";

import type { StoryBlock } from "@shared/types/story";
import { isValidStoryEntityId } from "@shared/utils/storyId";

import { NARRALANG_DEFAULT_DIALECT } from "./narralangDialect";
import { findNarralangDialectConflicts } from "./narralangMatch";
import { parseNarralangScene, type NarralangParseLookups, type NarralangParseResult } from "./narralangParse";

// --- The project the scripts are read against -------------------------------------------------------

const lookups: NarralangParseLookups = {
    characterId: (name) => (name === "爱丽丝" ? "char-alice" : name === "双子" ? "ambiguous" : null),
    assetId: (name) => (name === "corridor_dusk" ? "asset-bg" : name === "evening_theme" ? "asset-bgm" : null),
    appearanceRef: (_characterId, name) => (name === "smile" ? { kind: "pose", id: "pose-smile" } : null),
    sceneId: (name) => (name === "天台 · 夜" ? "scene-2" : null),
};

function parse(...lines: string[]): NarralangParseResult {
    return parseNarralangScene(lines.join("\n"), lookups);
}

/** The rows, in document order, so a test can read a tree without carrying ids about. */
function rows(result: NarralangParseResult): StoryBlock[] {
    const out: StoryBlock[] = [];
    const walk = (ids: readonly string[]): void => {
        for (const id of ids) {
            const block = result.blocks[id];
            if (block) {
                out.push(block);
                walk(block.childrenIds);
            }
        }
    };
    walk(result.rootBlockIds);
    return out;
}

// --- Prose against statements -------------------------------------------------------------------------

describe("the prose rule", () => {
    it("reads a line whose first token is not a keyword as narration", () => {
        const result = parse("夕阳把走廊染成橘色。");

        expect(result.diagnostics).toEqual([]);
        expect(rows(result)[0].payload).toEqual({
            action: "narration",
            text: { textId: expect.any(String), value: "夕阳把走廊染成橘色。", role: "narration" },
        });
    });

    it("keeps an escaped keyword line as prose", () => {
        const result = parse("\\show me the money");

        expect(result.diagnostics).toEqual([]);
        const payload = rows(result)[0].payload as { action: string; text: { value: string } };
        expect(payload.action).toBe("narration");
        expect(payload.text.value).toBe("show me the money");
    });

    it("does NOT turn a keyword line it cannot read into narration", () => {
        // The failure this exists to prevent: an author's broken command becoming a line the player
        // reads. It is an `invalid` row carrying its source, which is the same bargain the row editor
        // strikes, plus a diagnostic naming the line.
        const result = parse("show 无人");

        expect(rows(result)[0]).toMatchObject({ kind: "invalid", payload: { source: "show 无人" } });
        expect(result.diagnostics).toEqual([{ line: 1, column: 1, reason: "unknownStatement" }]);
    });

    it("splits dialogue at the first unescaped separator and keeps later ones as text", () => {
        const result = parse("爱丽丝: 听着: 别回头。");

        expect(result.diagnostics).toEqual([]);
        expect(rows(result)[0].payload).toEqual({
            action: "dialogue",
            characterId: "char-alice",
            text: { textId: expect.any(String), value: "听着: 别回头。", role: "dialogue" },
        });
    });

    it("keeps a speaker no character answers to as a bare name", () => {
        const result = parse("？？？: 谁在那里。");

        expect(result.diagnostics).toEqual([]);
        expect(rows(result)[0].payload).toMatchObject({ action: "dialogue", speakerName: "？？？" });
    });

    it("reads the per-line dialogue modifiers that sit before the separator", () => {
        const result = parse("爱丽丝 voice evening_theme pause click: 你也留到这么晚啊。");

        expect(result.diagnostics).toEqual([]);
        expect(rows(result)[0].payload).toMatchObject({
            action: "dialogue",
            characterId: "char-alice",
            voiceAssetId: "asset-bgm",
            pauseAfter: true,
        });
    });

    it("reads an escaped separator as text, not as a speaker", () => {
        const result = parse("他说\\: 你好");

        expect(rows(result)[0].payload).toMatchObject({ action: "narration" });
    });

    it("reads a note row", () => {
        const result = parse("# 这里以后要补一段回忆闪回");

        expect(rows(result)[0]).toMatchObject({
            kind: "note",
            payload: { text: { value: "这里以后要补一段回忆闪回", role: "note" } },
        });
    });

    it("reads the two prefixes apart: one disabled row, one that never parsed", () => {
        const result = parse("~ wait 1.5", "~~ /set gold");

        expect(rows(result)[0]).toMatchObject({ kind: "action", disabled: true, payload: { action: "wait" } });
        expect(rows(result)[1]).toMatchObject({ kind: "invalid", payload: { source: "/set gold" } });
        expect(rows(result)[1].disabled).toBeUndefined();
    });
});

// --- Structure ------------------------------------------------------------------------------------------

describe("structure", () => {
    it("hangs the branches of a condition off one container, the way the document stores them", () => {
        const result = parse(
            "var trust: number = 0",
            "if trust > 0:",
            "  wait click",
            "elif trust == 0:",
            "  wait click",
            "else:",
            "  wait click",
        );

        expect(result.diagnostics).toEqual([]);
        const roots = result.rootBlockIds.map((id) => result.blocks[id]);
        expect(roots.map((block) => block.kind)).toEqual(["declaration", "control"]);
        expect(roots[1].payload).toEqual({ control: "condition" });
        expect(roots[1].childrenIds.map((id) => result.blocks[id].payload)).toMatchObject([
            { control: "conditionBranch", branch: "if" },
            { control: "conditionBranch", branch: "elseIf" },
            { control: "conditionBranch", branch: "else" },
        ]);
    });

    it("reports an else with no if above it", () => {
        const result = parse("else:", "  wait click");

        expect(result.diagnostics).toEqual([{ line: 1, column: 1, reason: "danglingBranch" }]);
    });

    it("reads a menu's children as its options, with their modifiers", () => {
        const result = parse(
            "var trust: number = 0",
            "menu 要说点什么吗？:",
            "  「其实我在等你。」 show if trust > 0 enable if trust == 0:",
            "    wait click",
        );

        expect(result.diagnostics).toEqual([]);
        const option = rows(result)[2];
        expect(option.payload).toMatchObject({
            action: "choiceOption",
            text: { value: "「其实我在等你。」", role: "choiceText" },
            hiddenWhen: { kind: "expression", expression: { source: "trust > 0" } },
            disabledWhen: { kind: "expression", expression: { source: "trust == 0" } },
        });
        expect(option.childrenIds).toHaveLength(1);
    });

    it("reads the scene header's name and nests by indentation", () => {
        const result = parse("scene '走廊 · 傍晚':", "", "  menu:", "    「说吧。」:", "      wait click");

        expect(result.name).toBe("走廊 · 傍晚");
        expect(rows(result).map((block) => block.kind)).toEqual(["nodeAction", "nodeAction", "action"]);
    });

    it("reports indentation that skips a level rather than guessing at the tree", () => {
        const result = parse("wait click", "      wait click");

        expect(result.diagnostics).toEqual([{ line: 2, column: 7, reason: "badIndent" }]);
        expect(rows(result)).toHaveLength(2);
    });

    it("gives every block a UUID, which is what the store demands", () => {
        const result = parse("wait click", "menu:", "  「说吧。」:");

        for (const id of Object.keys(result.blocks)) {
            expect(isValidStoryEntityId(id)).toBe(true);
        }
    });
});

// --- Names ------------------------------------------------------------------------------------------------

describe("names", () => {
    it("refuses a name nothing answers to rather than storing the text as an id", () => {
        const result = parse("jump '不存在的场景'");

        // One verb is spelled `jump`, so its own refusal is the message - far better to read than
        // "this is not a statement".
        expect(rows(result)[0].kind).toBe("invalid");
        expect(result.diagnostics).toEqual([{ line: 1, column: 1, reason: "unknownName", detail: "scene" }]);
    });

    it("refuses a name two things answer to", () => {
        const result = parse("show 双子 smile");

        expect(rows(result)[0].kind).toBe("invalid");
        expect(result.diagnostics).toEqual([{ line: 1, column: 1, reason: "ambiguousName", detail: "character" }]);
    });

    it("resolves a variable declared further down the same text", () => {
        const result = parse("set trust = 100", "var trust: number = 0");

        expect(result.diagnostics).toEqual([]);
        const declaration = rows(result)[1];
        expect(rows(result)[0].payload).toEqual({
            action: "setVariable",
            target: { scope: "scene", variableId: declaration.id },
            value: 100,
        });
    });
});

// --- The seven verbs spelled `show` ----------------------------------------------------------------------------

describe("one keyword, seven statements", () => {
    // The default dialect spells `characterEnter`, `imageShow`, `textShow`, `layerShow`, `videoShow`,
    // `vfxShow` and `displayableShow` all as `show`, and no arrangement of prepositions tells them
    // apart. What does is the subject: what the name turns out to BE decides which row was meant.
    const stage = [
        "image create bird corridor_dusk",
        "text create title \"第一章\"",
        "layer create sky zindex 5",
        "video create op corridor_dusk",
        "vfx create petals corridor_dusk",
    ];

    const lastPayload = (line: string): unknown => {
        const result = parse(...stage, line);
        expect(result.diagnostics).toEqual([]);
        const all = rows(result);
        return all[all.length - 1].payload;
    };

    it("reads a character", () => {
        expect(lastPayload("show 爱丽丝 smile at left")).toMatchObject({ action: "character", operation: "enter", pose: "pose-smile" });
    });

    it("reads an image", () => {
        expect(lastPayload("show bird at left")).toMatchObject({ action: "image", operation: "show", objectName: "bird" });
    });

    it("reads a stage text", () => {
        expect(lastPayload("show title")).toMatchObject({ action: "text", operation: "show", objectName: "title" });
    });

    it("reads a layer", () => {
        expect(lastPayload("show sky")).toMatchObject({ action: "layer", operation: "show", objectName: "sky" });
    });

    it("reads a video", () => {
        expect(lastPayload("show op")).toMatchObject({ action: "video", operation: "show", objectName: "op" });
    });

    it("reads a vfx", () => {
        expect(lastPayload("show petals over 0.5")).toMatchObject({ action: "vfx", operation: "show", objectName: "petals" });
    });

    it("reads a stage singleton, which only the raw channel can address", () => {
        expect(lastPayload("show @background")).toMatchObject({
            action: "displayable",
            operation: "show",
            target: { builtin: "background" },
        });
    });

    it("refuses a subject that is nothing at all", () => {
        const result = parse("show 谁");

        expect(rows(result)[0].kind).toBe("invalid");
    });
});

// --- The one declaration that is not the first name on its line ---------------------------------------------------

describe("a sound handle", () => {
    it("binds a control row to the row that played the sound", () => {
        // A sound is named at the TAIL of its line, which is why it needs a reading of its own: the
        // token after the keyword is the channel, not the handle.
        const result = parse("play sound evening_theme as piano", "volume piano 0.5");

        expect(result.diagnostics).toEqual([]);
        const [played, turned] = rows(result);
        expect(played.payload).not.toHaveProperty("target");
        expect(turned.payload).toMatchObject({
            action: "audio",
            operation: "setVolume",
            objectName: "piano",
            target: { name: "piano", label: "piano", sourceBlockId: played.id },
        });
    });

    it("addresses the music channel through its built-in, which no row declares", () => {
        // A scene can state its music on its own record, so `volume bgm` addresses the same handle
        // whether or not this script holds the row that opened it. Binding it to a row would give one
        // channel two identities.
        const result = parse("play bgm evening_theme", "volume bgm 0.5");

        expect(result.diagnostics).toEqual([]);
        const [opened, turned] = rows(result);
        expect(opened.payload).not.toHaveProperty("target");
        expect(turned.payload).toMatchObject({ operation: "setVolume", target: { builtin: "bgm", name: "bgm" } });
    });

    it("keeps a handle no row in the script played as a bare name", () => {
        const result = parse("volume piano 0.5");

        expect(result.diagnostics).toEqual([]);
        expect(rows(result)[0].payload)
            .toEqual({ action: "audio", operation: "setVolume", objectName: "piano", volume: 0.5 });
    });

    it("does not shadow a stage object that answers to the same word", () => {
        // Sounds and displayables are separate registries in the compiler, so they are separate here
        // too. One table would make `show rain` fail because a `rain` sound was played above it.
        const result = parse(
            "image create rain corridor_dusk",
            "play sound evening_theme as rain",
            "show rain",
            "volume rain 0.5",
        );

        expect(result.diagnostics).toEqual([]);
        const [image, played, shown, turned] = rows(result);
        expect(shown.payload).toMatchObject({ action: "image", operation: "show", target: { sourceBlockId: image.id } });
        expect(turned.payload).toMatchObject({ action: "audio", target: { sourceBlockId: played.id } });
    });
});

// --- The table itself -------------------------------------------------------------------------------------------

describe("the dialect validator", () => {
    // A table that makes two statements indistinguishable is a bug in the table, and it should be
    // found by looking at the table rather than by a scene coming back wrong. The default dialect has
    // several on purpose - seven verbs are spelled `show` - and the parser resolves them by resolving
    // the subject. This pins the set, so a new collision has to be looked at.
    it("finds the verb pairs no line can tell apart on shape alone", () => {
        const conflicts = findNarralangDialectConflicts(NARRALANG_DEFAULT_DIALECT);

        expect([...new Set(conflicts.map((conflict) => conflict.keyword))]).toEqual(["show", "hide", "transform"]);
        expect(conflicts.filter((conflict) => conflict.reason === "identical").map((conflict) => conflict.verbs)).toEqual([
            ["textShow", "displayableShow"],
            ["layerShow", "videoShow"],
            ["characterExit", "imageHide"],
            ["textHide", "displayableHide"],
            ["layerHide", "videoHide"],
            ["layerTransform", "displayableTransform"],
        ]);
    });

    it("finds a collision a dialect introduces by renaming a verb", () => {
        const collided = {
            ...NARRALANG_DEFAULT_DIALECT,
            verbs: { ...NARRALANG_DEFAULT_DIALECT.verbs, break: { keyword: "cut", slots: [] } },
        };

        expect(findNarralangDialectConflicts(collided)).toContainEqual({
            keyword: "cut",
            verbs: ["break", "cut"],
            reason: "subsumed",
        });
    });
});

// --- Never throwing ---------------------------------------------------------------------------------------------

describe("robustness", () => {
    it("reports rather than throws on anything at all", () => {
        const nonsense = [
            "",
            "   ",
            ":",
            "\\",
            "show",
            "set = = =",
            "menu:",
            "        「说吧。」:",
            "var : =",
            "{i}unclosed",
            "# ",
            "~~",
            "'unterminated",
        ];

        for (const line of nonsense) {
            expect(() => parseNarralangScene(line, lookups)).not.toThrow();
        }
        expect(() => parseNarralangScene(nonsense.join("\n"), lookups)).not.toThrow();
    });

    it("reports a rich-text tag the dialect does not name", () => {
        const result = parse("这里有 {blink}一个不存在的标签{/blink}");

        expect(result.diagnostics.map((diagnostic) => diagnostic.reason)).toEqual(["badTag", "badTag"]);
        expect(result.diagnostics[0].line).toBe(1);
    });

    it("keeps an expression that does not resolve, and says so", () => {
        const result = parse("if gold > 0:", "  wait click");

        expect(result.diagnostics).toEqual([{ line: 1, column: 1, reason: "badExpression", detail: "gold > 0" }]);
        expect(rows(result)[1].payload).toMatchObject({ control: "conditionBranch", branch: "if" });
    });
});
