import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "./storyActionCommands";
import { applyCommandArgs } from "./storyCommandApply";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";

const CONTEXT: StoryCommandContext = {
    images: [{ id: "img-forest", name: "forest_day" }, { id: "img-rain", name: "city rain" }, { id: "img-dup", name: "twin" }, { id: "img-dup2", name: "twin" }, { id: "img-sky", name: "sky.png" }],
    audio: [{ id: "aud-theme", name: "theme" }],
    videos: [{ id: "vid-intro", name: "intro" }],
    characters: [{ id: "chr-alice", name: "Alice" }],
    tempSpeakers: [],
    scenes: [{ id: "scn-2", name: "Chapter 2" }],
    variables: [
        { name: "gold", ref: { scope: "scene", variableId: "var-gold" }, valueType: "number" },
        { name: "met", ref: { scope: "saved", variableId: "var-met" }, valueType: "boolean" },
    ],
    formsByCharacterId: { "chr-alice": ["smile", "angry"] },
    stageObjects: { image: ["hero"], text: ["title"], layer: [], video: ["clip"], audio: ["sound"] },
};

let counter = 0;
const nextId = () => `id-${++counter}`;

/** Type a line, resolve it against CONTEXT, and write the args onto a fresh block — the whole pipeline. */
function run(source: string): { block: StoryBlock; issues: string[] } {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    const { args, issues } = resolveCommandLine(line, CONTEXT);
    const commandId = line.def.commandId as ActionCommandId;
    const block = applyCommandArgs(createBlockForCommand(commandId, nextId), commandId, args);
    return { block, issues: issues.map(issue => issue.code) };
}

function payload(source: string) {
    const { block, issues } = run(source);
    expect(issues).toEqual([]);
    return block.payload as Record<string, unknown>;
}

describe("background", () => {
    it("binds an image by name and folds t/d into the transition", () => {
        expect(payload("/bg forest_day t=fade d=0.5")).toEqual({
            action: "setBackground",
            assetId: "img-forest",
            color: undefined,
            transition: { kind: "fadeIn", durationMs: 500 },
        });
    });

    it("takes a colour through the other branch of the union", () => {
        expect(payload("/bg #1a1a1a")).toMatchObject({ color: "#1a1a1a", assetId: undefined });
    });

    it("resolves a quoted name with spaces", () => {
        expect(payload("/bg \"city rain\"")).toMatchObject({ assetId: "img-rain" });
    });

    it("implies a transition when only a duration is given rather than dropping it", () => {
        expect(payload("/bg forest_day d=0.25")).toMatchObject({ transition: { kind: "fadeIn", durationMs: 250 } });
    });

    it("leaves an unfilled command valid — the palette commits these too", () => {
        expect(payload("/bg")).toEqual({ action: "setBackground" });
    });

    it("faults an image that does not exist", () => {
        expect(run("/bg nope").issues).toEqual(["unknownAsset"]);
    });

    it("refuses a name two assets share instead of silently picking one", () => {
        expect(run("/bg twin").issues).toEqual(["ambiguousName"]);
    });
});

describe("say", () => {
    it("binds a real character and clears any speaker name", () => {
        expect(payload("/say Alice 你好 世界")).toMatchObject({
            action: "dialogue",
            characterId: "chr-alice",
            speakerName: undefined,
            text: { role: "dialogue", value: "你好 世界" },
        });
    });

    it("keeps an unknown name as a temp speaker rather than failing", () => {
        expect(payload("/say Zoe hi")).toMatchObject({ speakerName: "Zoe", characterId: undefined });
    });

    it("is case-insensitive on the character name", () => {
        expect(payload("/say alice hi")).toMatchObject({ characterId: "chr-alice" });
    });
});

describe("show", () => {
    it("binds character, form, placement and duration", () => {
        expect(payload("/show Alice form=smile at=left d=0.4")).toMatchObject({
            action: "character",
            operation: "enter",
            characterId: "chr-alice",
            formName: "smile",
            transform: { preset: "left", durationMs: 400 },
        });
    });

    it("faults an unknown character — unlike a speaker, a portrait must resolve", () => {
        expect(run("/show Zoe").issues).toEqual(["unknownCharacter"]);
    });

    it("faults a form the resolved character does not have", () => {
        expect(run("/show Alice form=sad").issues).toEqual(["unknownForm"]);
    });
});

describe("wait", () => {
    it("splits the two semantics of the same command across `mode`", () => {
        expect(payload("/wait 0.8")).toEqual({ action: "wait", mode: "duration", durationMs: 800 });
        expect(payload("/wait click")).toEqual({ action: "wait", mode: "click" });
    });

    it("reads the author's number as seconds and stores milliseconds", () => {
        expect(payload("/wait 1")).toMatchObject({ durationMs: 1000 });
        expect(payload("/wait 0.5")).toMatchObject({ durationMs: 500 });
        // A whole-number arg is seconds, not the milliseconds this once meant.
        expect(payload("/wait 2")).toMatchObject({ durationMs: 2000 });
    });
});

describe("set", () => {
    it("binds the variable's ref, not its name", () => {
        expect(payload("/set gold 100")).toMatchObject({
            action: "setVariable",
            target: { scope: "scene", variableId: "var-gold" },
            value: 100,
        });
    });

    it("reads a boolean literal as a boolean", () => {
        expect(payload("/set met true")).toMatchObject({ target: { scope: "saved", variableId: "var-met" }, value: true });
    });

    it("catches the dependent type: a value the declared variable cannot hold", () => {
        // The check the parser structurally cannot do — `100`'s legality depends on what `met` resolves to.
        expect(run("/set met 100").issues).toEqual(["valueTypeMismatch"]);
        expect(run("/set gold true").issues).toEqual(["valueTypeMismatch"]);
    });

    it("faults an undeclared variable", () => {
        expect(run("/set nope 1").issues).toEqual(["unknownVariable"]);
    });
});

describe("jump / audio", () => {
    it("binds a scene by name", () => {
        expect(payload("/jump \"Chapter 2\"")).toMatchObject({ targetSceneId: "scn-2" });
    });

    it("faults an unknown scene", () => {
        expect(run("/jump nowhere").issues).toEqual(["unknownScene"]);
    });

    it("binds audio with fade and loop", () => {
        expect(payload("/bgm theme fade=0.8 loop=true")).toMatchObject({
            action: "audio", operation: "setBgm", assetId: "aud-theme", fadeMs: 800, loop: true,
        });
    });

    it("binds a sound's volume", () => {
        expect(payload("/sound theme vol=0.5")).toMatchObject({ operation: "playSound", assetId: "aud-theme", volume: 0.5 });
    });
});

describe("enum aliases", () => {
    it("normalizes the alias to the value the payload stores", () => {
        // The parser keeps `fade` verbatim; the payload can only hold `fadeIn`.
        expect(payload("/bg forest_day t=fade")).toMatchObject({ transition: { kind: "fadeIn" } });
        expect(payload("/bg forest_day t=circle")).toMatchObject({ transition: { kind: "maskCircle" } });
        expect(payload("/bg forest_day t=dissolve")).toMatchObject({ transition: { kind: "dissolve" } });
    });
});

describe("P1 — the rest of the palette", () => {
    it("expr: sets a character's form, positionally or by name", () => {
        // `/expr Alice angry` reads as one thought; `form=angry` still works (a positional stays named).
        expect(payload("/expr Alice angry")).toMatchObject({
            action: "character", operation: "expression", characterId: "chr-alice", formName: "angry",
        });
        expect(payload("/expr Alice form=smile")).toMatchObject({ formName: "smile" });
        // A portrait op, so an unknown character faults (unlike a speaker) and so does an absent form.
        expect(run("/expr Zoe").issues).toEqual(["unknownCharacter"]);
        expect(run("/expr Alice sad").issues).toEqual(["unknownForm"]);
    });

    it("menu: folds a greedy prompt into the choice segment", () => {
        expect(payload("/menu Pick a door")).toMatchObject({
            action: "choice", prompt: { role: "choicePrompt", value: "Pick a door" },
        });
    });

    it("repeat: takes an integer count", () => {
        expect(payload("/repeat 3")).toMatchObject({ control: "repeat", times: 3 });
        // Unfilled keeps the palette default rather than erroring.
        expect(payload("/repeat")).toMatchObject({ control: "repeat", times: 2 });
    });

    it("nvl: folds t/d into its transform-based transition", () => {
        expect(payload("/nvl t=fade d=0.4")).toMatchObject({ action: "nvl", transition: { preset: "fadeIn", durationMs: 400 } });
    });

    describe("image", () => {
        it("create leads with the asset (like /bg) and auto-names the object from its filename", () => {
            expect(payload("/image forest_day at=left d=0.3")).toMatchObject({
                action: "image", operation: "create", objectName: "forest_day", assetId: "img-forest",
                transform: { preset: "left", durationMs: 300 },
            });
        });

        it("strips the asset's extension when auto-naming", () => {
            expect(payload("/image sky.png")).toMatchObject({ objectName: "sky", assetId: "img-sky" });
        });

        it("takes an explicit name= that overrides the auto-derived name", () => {
            expect(payload("/image forest_day name=hero")).toMatchObject({ objectName: "hero", assetId: "img-forest" });
        });

        it("suffixes the auto-name when the derived name is already on stage", () => {
            const context = { ...CONTEXT, stageObjects: { ...CONTEXT.stageObjects, image: ["forest_day"] } };
            const line = parseCommandLine("/image forest_day");
            if (line.kind !== "command" || !line.def) {
                throw new Error("not a command");
            }
            const { args } = resolveCommandLine(line, context);
            const block = applyCommandArgs(createBlockForCommand("imageCreate", nextId), "imageCreate", args);
            expect((block.payload as Record<string, unknown>).objectName).toBe("forest_day2");
        });

        it("source swaps only the asset", () => {
            expect(payload("/imgsrc hero forest_day")).toMatchObject({ operation: "setSource", objectName: "hero", assetId: "img-forest" });
        });

        it("show picks an object on stage and folds the reveal (t=) and its timing (d=) into the transform", () => {
            expect(payload("/imgshow hero d=0.2")).toMatchObject({ operation: "show", objectName: "hero", transform: { preset: "fadeIn", durationMs: 200 } });
            expect(payload("/imgshow hero t=slideLeft d=0.3")).toMatchObject({ objectName: "hero", transform: { preset: "slideLeft", durationMs: 300 } });
        });

        it("accepts an object name not yet on stage — a reference need not resolve", () => {
            // `ghost` is in no stage list, but a reference is a free value (dynamic / cross-scene), so it
            // binds without an issue rather than faulting like an asset would.
            expect(run("/imgshow ghost").issues).toEqual([]);
            expect(payload("/imgshow ghost")).toMatchObject({ objectName: "ghost" });
        });

        it("still faults an image asset that does not exist", () => {
            expect(run("/image nope").issues).toEqual(["unknownAsset"]);
        });

        it("keeps the palette default name on a non-create op when none is typed", () => {
            expect(payload("/imgshow")).toMatchObject({ operation: "show", objectName: "image" });
        });
    });

    describe("text", () => {
        it("create leads with the greedy content and auto-names the overlay", () => {
            expect(payload("/text Hello world")).toMatchObject({ action: "text", operation: "create", objectName: "text", text: "Hello world" });
        });

        it("takes a leading name= handle before the greedy content", () => {
            expect(payload("/text name=title Hello world")).toMatchObject({ operation: "create", objectName: "title", text: "Hello world" });
        });

        it("set rewrites the content of a named overlay", () => {
            expect(payload("/settext title New copy")).toMatchObject({ operation: "setText", objectName: "title", text: "New copy" });
        });

        it("font routes to the op the typed field implies — size, else colour", () => {
            expect(payload("/font title 48")).toMatchObject({ operation: "setFontSize", objectName: "title", fontSize: 48 });
            expect(payload("/font title color=#ff0000")).toMatchObject({ operation: "setFontColor", objectName: "title", fontColor: "#ff0000" });
        });

        it("font faults rather than silently dropping the colour when both size and colour are given", () => {
            // One block runs one op, so honouring both is impossible — fault instead of losing the colour.
            expect(run("/font title 48 color=#ff0000").issues).toEqual(["conflictingParams"]);
        });
    });

    it("layer: creates a named layer with a z-index", () => {
        expect(payload("/layer overlay 5")).toMatchObject({ action: "layer", operation: "create", objectName: "overlay", zIndex: 5 });
    });

    describe("video", () => {
        it("create leads with the asset, auto-names, and takes muted", () => {
            expect(payload("/video intro muted=true")).toMatchObject({
                action: "video", operation: "create", objectName: "intro", assetId: "vid-intro", muted: true,
            });
        });

        it("takes an explicit name= that overrides the auto-derived name", () => {
            expect(payload("/video intro name=clip")).toMatchObject({ objectName: "clip", assetId: "vid-intro" });
        });

        it("play addresses the name", () => {
            expect(payload("/vidplay clip")).toMatchObject({ operation: "play", objectName: "clip" });
        });
    });

    describe("screen effects", () => {
        it("blink reads d/hold as seconds and a colour", () => {
            expect(payload("/blink d=0.2 hold=0.1 color=#000000")).toMatchObject({
                action: "screenEffect", effect: "blink", durationMs: 200, holdMs: 100, color: "#000000",
            });
        });

        it("vignette takes an opacity", () => {
            expect(payload("/vignette opacity=0.5")).toMatchObject({ effect: "vignette", opacity: 0.5 });
        });
    });

    describe("sound control", () => {
        it("stop targets a named handle, else the default", () => {
            expect(payload("/stop bgm")).toMatchObject({ action: "audio", operation: "stopSound", objectName: "bgm" });
            expect(payload("/stop")).toMatchObject({ operation: "stopSound", objectName: "sound" });
        });

        it("volume takes a positional value, a fade and an optional name", () => {
            expect(payload("/vol 0.3 fade=0.5")).toMatchObject({ operation: "setVolume", objectName: "sound", volume: 0.3, fadeMs: 500 });
            expect(payload("/vol 0.3 name=music")).toMatchObject({ objectName: "music", volume: 0.3 });
        });

        it("rate takes a positional multiplier", () => {
            expect(payload("/rate 1.5")).toMatchObject({ operation: "setRate", rate: 1.5 });
        });

        it("mute maps on/off to the boolean, defaulting muted", () => {
            expect(payload("/mute off")).toMatchObject({ operation: "muteSound", muted: false });
            expect(payload("/mute on")).toMatchObject({ muted: true });
            expect(payload("/mute")).toMatchObject({ muted: true });
        });
    });
});
