import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { parseCommandLine } from "../../storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "../../storyCommandResolution";
import { getCommandSpec } from "../registry";
import { declarationFromArgs } from "./variables";

/**
 * The line → block contract, pinned end-to-end: parse → resolve → spec.build. This is the suite the
 * old `applyCommandArgs` tests became - it exercises the same seam through the specs, so a drifted
 * param name (now a compile error) or a broken dispatch (a runtime wrong-block) is caught here.
 */

const CONTEXT: StoryCommandContext = {
    images: [{ id: "i1", name: "forest_day" }, { id: "i2", name: "night" }],
    audio: [{ id: "a1", name: "theme" }, { id: "a2", name: "hit" }],
    videos: [{ id: "v1", name: "intro" }],
    characters: [{ id: "c1", name: "Alice" }],
    tempSpeakers: ["Zoe"],
    scenes: [{ id: "s1", name: "Chapter 2" }],
    variables: [
        { name: "gold", ref: { scope: "scene", variableId: "var_gold" }, valueType: "number", defaultValue: 10 },
        { name: "met", ref: { scope: "saved", variableId: "var_met" }, valueType: "boolean" },
        // A blueprint-style name with spaces: only addressable on the command line through `'…'`.
        { name: "boss hp", ref: { scope: "saved", variableId: "var_boss" }, valueType: "number", defaultValue: 3 },
    ],
    formsByCharacterId: { c1: ["smile", "angry"] },
    stageObjects: { image: ["hero"], text: ["title"], layer: ["overlay"], video: ["clip"], audio: ["music"] },
};

let nextId = 0;
const generateId = () => `id_${nextId++}`;

/** Parse, resolve and build one line; throws if any stage refuses - a test asserting a block implies a committable line. */
function build(source: string): StoryBlock {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    expect(line.issues).toEqual([]);
    const { args, issues } = resolveCommandLine(line, CONTEXT);
    expect(issues).toEqual([]);
    const spec = getCommandSpec(line.def.commandId);
    if (!spec?.build) {
        throw new Error(`no build on ${line.def.commandId}`);
    }
    return spec.build(args, { generateId, context: CONTEXT });
}

/** Resolution issues for a line - for asserting what must NOT commit. */
function issuesOf(source: string): string[] {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    return resolveCommandLine(line, CONTEXT).issues.map(issue => issue.code);
}

describe("scene commands", () => {
    it("/bg writes assetId XOR color, and maps the unified fade to a crossfade", () => {
        expect(build("/bg forest_day t=fade d=0.5")).toMatchObject({
            kind: "action",
            payload: { action: "setBackground", assetId: "i1", color: undefined, transition: { kind: "dissolve", durationMs: 500 } },
        });
        expect(build("/bg #1a1a1a")).toMatchObject({ payload: { color: "#1a1a1a", assetId: undefined } });
    });

    it("/bg rejects a word its context does not support", () => {
        // zoom is a reveal word; the scene context must say so rather than store it.
        expect(parseCommandLine("/bg forest_day t=zoom")).toMatchObject({ issues: [{ code: "badValue" }] });
    });

    it("/jump resolves the scene and takes a scene transition", () => {
        expect(build("/jump \"Chapter 2\" t=black")).toMatchObject({
            kind: "jump",
            payload: { targetSceneId: "s1", transition: { kind: "throughColor" } },
        });
    });

    it("/wait defaults to a click and reads seconds as milliseconds", () => {
        expect(build("/wait")).toMatchObject({ payload: { action: "wait", mode: "click" } });
        expect(build("/wait click")).toMatchObject({ payload: { mode: "click" } });
        expect(build("/wait 1.5")).toMatchObject({ payload: { mode: "duration", durationMs: 1500 } });
    });
});

describe("generic verbs (bible B3)", () => {
    it("/show dispatches on the target: a character enters", () => {
        expect(build("/show Alice smile at=left t=fade d=0.3")).toMatchObject({
            kind: "action",
            payload: {
                action: "character",
                operation: "enter",
                characterId: "c1",
                formName: "smile",
                transform: { preset: "left", durationMs: 300 },
                transition: { kind: "fadeIn" },
            },
        });
    });

    it("/show dispatches on the target: an image reveals through its transform preset", () => {
        expect(build("/show hero t=fade d=0.2")).toMatchObject({
            payload: { action: "image", operation: "show", objectName: "hero", transform: { preset: "fadeIn", durationMs: 200 } },
        });
    });

    it("/hide is direction-aware: the same word fades OUT", () => {
        expect(build("/hide hero t=fade")).toMatchObject({
            payload: { action: "image", operation: "hide", objectName: "hero", transform: { preset: "fadeOut" } },
        });
        expect(build("/hide Alice")).toMatchObject({ payload: { action: "character", operation: "exit" } });
    });

    it("/show reaches text, video and layer targets too", () => {
        expect(build("/show title")).toMatchObject({ payload: { action: "text", operation: "show", objectName: "title" } });
        expect(build("/show clip")).toMatchObject({ payload: { action: "video", operation: "show", objectName: "clip" } });
        expect(build("/show overlay")).toMatchObject({ payload: { action: "displayable", operation: "show", target: { kind: "layer", name: "overlay" } } });
    });

    it("rejects a target nothing answers to, and an unsupported word for the resolved context", () => {
        expect(issuesOf("/show nobody")).toEqual(["unknownTarget"]);
        expect(issuesOf("/show Alice t=zoom")).toEqual(["unsupportedOption"]);
        expect(issuesOf("/show hero smile")).toEqual(["unknownForm"]);
    });

    it("/swap replaces an image's source or a text's words, by what the target is", () => {
        expect(build("/swap hero night")).toMatchObject({
            payload: { action: "image", operation: "setSource", objectName: "hero", assetId: "i2" },
        });
        expect(build("/swap title New words here")).toMatchObject({
            payload: { action: "text", operation: "setText", objectName: "title", text: "New words here" },
        });
        expect(issuesOf("/swap hero nosuchimage")).toEqual(["unknownAsset"]);
    });

    it("/play plays a video by name", () => {
        expect(build("/play clip")).toMatchObject({ payload: { action: "video", operation: "play", objectName: "clip" } });
    });
});

describe("dialogue", () => {
    it("/say binds a real character by id and a bare name as a temp speaker", () => {
        expect(build("/say Alice 你好 世界")).toMatchObject({
            kind: "nodeAction",
            payload: { action: "dialogue", characterId: "c1", speakerName: undefined, text: { value: "你好 世界" } },
        });
        expect(build("/say Zoe hi")).toMatchObject({
            payload: { characterId: undefined, speakerName: "Zoe" },
        });
    });
});

describe("media objects", () => {
    it("/image auto-names from the asset filename", () => {
        expect(build("/image forest_day at=left")).toMatchObject({
            payload: { action: "image", operation: "create", objectName: "forest_day", assetId: "i1", transform: { preset: "left" } },
        });
    });

    it("/text auto-names with a deduped default and carries its content", () => {
        expect(build("/text Hello there")).toMatchObject({
            payload: { action: "text", operation: "create", objectName: "text", text: "Hello there" },
        });
    });

    it("/video reads the bare muted flag (bible B5)", () => {
        expect(build("/video intro muted")).toMatchObject({
            payload: { action: "video", operation: "create", objectName: "intro", assetId: "v1", muted: true },
        });
    });

    it("/font sets one thing per block and faults on both", () => {
        expect(build("/font title 48")).toMatchObject({ payload: { operation: "setFontSize", fontSize: 48, objectName: "title" } });
        expect(build("/font title color=#ff0000")).toMatchObject({ payload: { operation: "setFontColor", fontColor: "#ff0000" } });
        expect(issuesOf("/font title 48 color=#ff0000")).toEqual(["conflictingParams"]);
    });
});

describe("sound (bible B4: target defaults to bgm)", () => {
    it("/bgm sets the music with its flags", () => {
        expect(build("/bgm theme fade=1 loop")).toMatchObject({
            payload: { action: "audio", operation: "setBgm", assetId: "a1", fadeMs: 1000, loop: true },
        });
    });

    it("/sound auto-names from the file so /stop can address it", () => {
        expect(build("/sound hit vol=0.5")).toMatchObject({
            payload: { action: "audio", operation: "playSound", objectName: "hit", assetId: "a2", volume: 0.5 },
        });
    });

    it("/vol with no target turns down the music channel", () => {
        expect(build("/vol 0.5")).toMatchObject({ payload: { action: "audio", operation: "setVolume", objectName: "bgm", volume: 0.5 } });
        expect(build("/vol music 0.2 fade=0.5")).toMatchObject({ payload: { objectName: "music", volume: 0.2, fadeMs: 500 } });
    });

    it("the whole control family defaults to bgm", () => {
        expect(build("/stop")).toMatchObject({ payload: { operation: "stopSound", objectName: "bgm" } });
        expect(build("/pause")).toMatchObject({ payload: { operation: "pauseSound", objectName: "bgm" } });
        expect(build("/resume music")).toMatchObject({ payload: { operation: "resumeSound", objectName: "music" } });
        expect(build("/mute")).toMatchObject({ payload: { operation: "muteSound", muted: true, objectName: "bgm" } });
        expect(build("/unmute")).toMatchObject({ payload: { operation: "muteSound", muted: false, objectName: "bgm" } });
        expect(build("/rate 1.5")).toMatchObject({ payload: { operation: "setRate", rate: 1.5, objectName: "bgm" } });
    });
});

describe("variables", () => {
    it("/set folds a constant back into value and keeps an expression as a tree", () => {
        expect(build("/set gold 100")).toMatchObject({
            payload: { action: "setVariable", target: { scope: "scene", variableId: "var_gold" }, value: 100, expression: undefined },
        });
        expect(build("/set gold gold + 1")).toMatchObject({
            payload: { expression: { source: "gold + 1", ast: { kind: "binary", op: "+" } } },
        });
    });

    it("/set desugars a compound assignment against its target", () => {
        expect(build("/set gold += 5")).toMatchObject({
            payload: { expression: { source: "gold + (5)" } },
        });
    });

    it("/set addresses a name with spaces through single quotes, on either side of the assignment", () => {
        expect(build("/set 'boss hp' 5")).toMatchObject({
            payload: { action: "setVariable", target: { scope: "saved", variableId: "var_boss" }, value: 5, expression: undefined },
        });
        expect(build("/set gold 'boss hp' + 1")).toMatchObject({
            payload: { target: { variableId: "var_gold" }, expression: { source: "'boss hp' + 1", ast: { kind: "binary", op: "+" } } },
        });
    });

    it("/set desugars a compound assignment against a spaced name by re-quoting it", () => {
        // `boss hp + (2)` would re-lex as two identifiers; the desugared source must spell the name
        // the way the expression lexer reads one reference back.
        expect(build("/set 'boss hp' += 2")).toMatchObject({
            payload: { target: { variableId: "var_boss" }, expression: { source: "'boss hp' + (2)" } },
        });
    });

    it("/inc defaults its step to 1; /toggle negates; /reset snapshots the declared default", () => {
        expect(build("/inc gold")).toMatchObject({ payload: { expression: { source: "gold + (1)" } } });
        expect(build("/dec gold 2")).toMatchObject({ payload: { expression: { source: "gold - (2)" } } });
        expect(build("/toggle met")).toMatchObject({ payload: { target: { variableId: "var_met" }, expression: { source: "!met" } } });
        expect(build("/reset gold")).toMatchObject({ payload: { value: 10, expression: undefined } });
    });

    it("declarationFromArgs pins the whole line to the declaration it produces", () => {
        // The bug class this guards: a default read under the wrong kind silently declaring the
        // wrong type. `/local gold 100` must be a NUMBER with default 100, never a boolean.
        const declare = (source: string) => {
            const line = parseCommandLine(source);
            if (line.kind !== "command" || !line.def) {
                throw new Error("not a command");
            }
            return declarationFromArgs(resolveCommandLine(line, CONTEXT).args);
        };
        expect(declare("/local hp 100")).toEqual({ name: "hp", valueType: "number", defaultValue: 100, description: undefined });
        expect(declare("/var seen")).toEqual({ name: "seen", valueType: "boolean", defaultValue: undefined, description: undefined });
        expect(declare("/persis nickname type=string desc=\"player name\"")).toEqual({
            name: "nickname", valueType: "string", defaultValue: undefined, description: "player name",
        });
        // An explicit type= wins over what the default suggests.
        expect(declare("/local flag 1 type=bool")).toMatchObject({ valueType: "boolean", defaultValue: 1 });
        // A declaration into an occupied name is refused, not overwritten.
        expect(issuesOf("/local gold")).toEqual(["duplicateVariable"]);
    });

    it("a declaration builds a ROW whose id is the variable and whose key is its own id (v6)", () => {
        const block = build("/local hp 100");
        expect(block.kind).toBe("declaration");
        if (block.kind !== "declaration") throw new Error("expected declaration");
        expect(block.payload).toMatchObject({ scope: "scene", name: "hp", valueType: "number", defaultValue: 100 });
        expect(block.payload.storageKey).toBe(block.id);
        expect(build("/var seen").kind).toBe("declaration");
        expect(build("/persis nickname type=string")).toMatchObject({ kind: "declaration", payload: { scope: "persistent", valueType: "string" } });
    });
});

describe("logic and effects", () => {
    it("paramless containers build their control blocks", () => {
        expect(build("/parallel")).toMatchObject({ kind: "control", payload: { control: "parallel", mode: "all" } });
        expect(build("/race")).toMatchObject({ payload: { control: "race", mode: "any" } });
        expect(build("/sequence")).toMatchObject({ payload: { control: "sequence", mode: "do" } });
        expect(build("/repeat 3")).toMatchObject({ payload: { control: "repeat", times: 3 } });
    });

    it("/if builds the bare condition container - the expression rides to the scaffolded branch", () => {
        expect(build("/if gold >= 100")).toMatchObject({ kind: "control", payload: { control: "condition" } });
        expect(issuesOf("/if gold + 1")).toEqual(["expressionNotBoolean"]);
    });

    it("/blink and /vignette read their knobs in seconds", () => {
        expect(build("/blink d=0.2 hold=0.1 color=#ffffff")).toMatchObject({
            payload: { action: "screenEffect", effect: "blink", durationMs: 200, holdMs: 100, color: "#ffffff" },
        });
        expect(build("/vignette opacity=0.5")).toMatchObject({ payload: { effect: "vignette", opacity: 0.5 } });
    });

    it("/fx and /transform bind their displayable target and defer the rest to the inspector", () => {
        expect(getCommandSpec("fx")?.inspectorAfterCommit).toBe(true);
        expect(build("/fx hero")).toMatchObject({ payload: { action: "displayable", target: { kind: "image", name: "hero" } } });
        expect(build("/transform Alice d=0.4")).toMatchObject({
            payload: { action: "displayable", operation: "transform", target: { kind: "character", name: "Alice" }, durationMs: 400 },
        });
    });
});
