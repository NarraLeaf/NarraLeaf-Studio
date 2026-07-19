import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "./storyActionCommands";
import { applyCommandArgs, declarationFromArgs } from "./storyCommandApply";
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
        { name: "gold", ref: { scope: "scene", variableId: "var-gold" }, valueType: "number", defaultValue: 50 },
        { name: "met", ref: { scope: "saved", variableId: "var-met" }, valueType: "boolean" },
    ],
    formsByCharacterId: { "chr-alice": ["smile", "angry"] },
    stageObjects: { image: ["hero"], text: ["title"], layer: [], video: ["clip"], audio: ["sound"] },
};

let counter = 0;
const nextId = () => `id-${++counter}`;

/** Type a line, resolve it against CONTEXT, and write the args onto a fresh block - the whole pipeline. */
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

/**
 * Parse and resolve only - no block. Declaration commands build nothing (and `createBlockForCommand`
 * throws for them by design), so their whole contract is in what resolution accepts and rejects.
 */
function issuesOf(source: string): string[] {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    return resolveCommandLine(line, CONTEXT).issues.map(issue => issue.code);
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

    it("leaves an unfilled command valid - the palette commits these too", () => {
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

    it("faults an unknown character - unlike a speaker, a portrait must resolve", () => {
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
        // The check the parser structurally cannot do - `100`'s legality depends on what `met` resolves to.
        expect(run("/set met 100").issues).toEqual(["expressionTypeMismatch"]);
        expect(run("/set gold true").issues).toEqual(["expressionTypeMismatch"]);
    });

    it("faults an undeclared variable", () => {
        expect(run("/set nope 1").issues).toEqual(["unknownVariable"]);
    });

    it("stores a computed right-hand side as an expression, leaving a literal a literal", () => {
        // The whole point of the change: adding one no longer needs a blueprint.
        expect(payload("/set gold gold + 1")).toMatchObject({
            target: { scope: "scene", variableId: "var-gold" },
            expression: { source: "gold + 1" },
        });
        // A bare literal must NOT grow an expression around it - old documents and the inspector's
        // literal editor both depend on `value` staying the storage for a constant.
        expect(payload("/set gold 100")).toMatchObject({ value: 100, expression: undefined });
    });

    it("type-checks a computed right-hand side, and declines where inference cannot decide", () => {
        expect(run("/set gold \"rich\"").issues).toEqual(["expressionTypeMismatch"]);
        expect(run("/set gold gold + 1").issues).toEqual([]);
        expect(run("/set met gold > 50").issues).toEqual([]);
        // A ternary with disagreeing branches infers `unknown`, which is deliberately allowed.
        expect(run("/set gold met ? 1 : \"none\"").issues).toEqual([]);
    });

    it("desugars compound assignment into the same tree the longhand builds", () => {
        expect(payload("/set gold += 1")).toMatchObject({ expression: { source: "gold + (1)" } });
        expect(payload("/set gold -= 5")).toMatchObject({ expression: { source: "gold - (5)" } });
    });

    it("supports the ternary, including chained without parentheses", () => {
        const { expression } = payload("/set gold gold > 100 ? 1 : gold > 50 ? 2 : 3") as { expression: { ast: { kind: string } } };
        expect(expression.ast.kind).toBe("ternary");
    });

    it("faults an expression that does not parse, naming the actual mistake", () => {
        expect(run("/set gold gold +").issues).toEqual(["expressionError"]);
        expect(run("/set gold nope + 1").issues).toEqual(["expressionError"]);
        expect(run("/set gold eval(\"x\")").issues).toEqual(["expressionError"]);
    });

    it("resolves a shadowed name by scope prefix", () => {
        expect(payload("/set gold saved.met ? 1 : 0")).toMatchObject({ expression: {} });
    });
});

describe("assignment sugar", () => {
    it("lowers /inc and /dec to a setVariable expression, defaulting the step to 1", () => {
        expect(payload("/inc gold")).toMatchObject({
            action: "setVariable",
            target: { scope: "scene", variableId: "var-gold" },
            expression: { source: "gold + (1)" },
        });
        expect(payload("/dec gold 5")).toMatchObject({ expression: { source: "gold - (5)" } });
    });

    it("lowers /toggle to a negation of the target", () => {
        expect(payload("/toggle met")).toMatchObject({
            target: { scope: "saved", variableId: "var-met" },
            expression: { source: "!met" },
        });
    });

    it("lowers /reset to the declared default, snapshotted as a literal", () => {
        // `gold` declares 50 in CONTEXT; `met` declares nothing, so it falls to its type's zero.
        expect(payload("/reset gold")).toMatchObject({ value: 50, expression: undefined });
        expect(payload("/reset met")).toMatchObject({ value: false, expression: undefined });
    });

    it("accepts an expression as the step", () => {
        expect(payload("/inc gold gold * 2")).toMatchObject({ expression: { source: "gold + (gold * 2)" } });
    });
});

describe("variable declarations", () => {
    it("parses all three scopes with the same shape", () => {
        for (const token of ["local", "var", "persis"]) {
            expect(issuesOf(`/${token} hp 100 type=number`)).toEqual([]);
        }
    });

    it("reads a bare word in the default slot as a string, not as a variable", () => {
        // `/local greeting hello` declares a default of "hello". The slot is a constant — a declaration
        // runs before any variable exists — so there is nothing here that could be a reference, and
        // treating it as one turned this ordinary line into an "undeclared variable" error.
        expect(issuesOf("/local greeting hello")).toEqual([]);
        expect(issuesOf("/local greeting \"hello world\"")).toEqual([]);
    });

    /** The whole line → the variable it declares. Resolution alone cannot show this; the bug lived here. */
    function declared(source: string) {
        const line = parseCommandLine(source);
        if (line.kind !== "command" || !line.def) {
            throw new Error(`not a command: ${source}`);
        }
        return declarationFromArgs(resolveCommandLine(line, CONTEXT).args);
    }

    it("carries the default through to the declaration, and takes its type from it", () => {
        // The regression this pins: `/local gold 100` once declared a *boolean* named gold with no
        // default, because the commit path still read the default slot as an expression after it had
        // become a constant. Resolution reported no issues, so only an end-to-end check caught it —
        // hence this test asserts the declaration, not the absence of errors.
        expect(declared("/local gold 100")).toEqual({ name: "gold", valueType: "number", defaultValue: 100, description: undefined });
        expect(declared("/var greeting hello")).toEqual({ name: "greeting", valueType: "string", defaultValue: "hello", description: undefined });
        expect(declared("/persis seen true")).toEqual({ name: "seen", valueType: "boolean", defaultValue: true, description: undefined });
    });

    it("falls back to a boolean flag when no default says otherwise", () => {
        expect(declared("/local met")).toEqual({ name: "met", valueType: "boolean", defaultValue: undefined, description: undefined });
    });

    it("lets an explicit type= override what the default would imply", () => {
        expect(declared("/local score 0 type=json")).toMatchObject({ valueType: "json", defaultValue: 0 });
    });

    it("carries a description", () => {
        expect(declared("/local gold 100 desc=\"pocket money\"")).toMatchObject({ description: "pocket money" });
    });

    it("declares nothing without a name", () => {
        expect(declared("/local")).toBe(null);
    });

    it("refuses a name already declared in the same scope", () => {
        expect(issuesOf("/local gold 1")).toEqual(["duplicateVariable"]);
        // Same name in a *different* scope is legal - that is what the scope prefixes exist to address.
        expect(issuesOf("/var gold 1")).toEqual([]);
    });
});

describe("/if", () => {
    it("resolves a boolean expression", () => {
        expect(run("/if gold >= 100").issues).toEqual([]);
    });

    it("refuses a condition that is not a comparison", () => {
        // Legal as an expression (a non-zero number is truthy), but almost always an unfinished line.
        expect(run("/if gold").issues).toEqual(["expressionNotBoolean"]);
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

describe("P1 - the rest of the palette", () => {
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

        it("accepts an object name not yet on stage - a reference need not resolve", () => {
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

        it("font routes to the op the typed field implies - size, else colour", () => {
            expect(payload("/font title 48")).toMatchObject({ operation: "setFontSize", objectName: "title", fontSize: 48 });
            expect(payload("/font title color=#ff0000")).toMatchObject({ operation: "setFontColor", objectName: "title", fontColor: "#ff0000" });
        });

        it("font faults rather than silently dropping the colour when both size and colour are given", () => {
            // One block runs one op, so honouring both is impossible - fault instead of losing the colour.
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
