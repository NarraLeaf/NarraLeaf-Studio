import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "./storyActionCommands";
import { applyCommandArgs } from "./storyCommandApply";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";

const CONTEXT: StoryCommandContext = {
    images: [{ id: "img-forest", name: "forest_day" }, { id: "img-rain", name: "city rain" }, { id: "img-dup", name: "twin" }, { id: "img-dup2", name: "twin" }],
    audio: [{ id: "aud-theme", name: "theme" }],
    videos: [],
    characters: [{ id: "chr-alice", name: "Alice" }],
    tempSpeakers: [],
    scenes: [{ id: "scn-2", name: "Chapter 2" }],
    variables: [
        { name: "gold", ref: { scope: "scene", variableId: "var-gold" }, valueType: "number" },
        { name: "met", ref: { scope: "saved", variableId: "var-met" }, valueType: "boolean" },
    ],
    formsByCharacterId: { "chr-alice": ["smile", "angry"] },
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
        expect(payload("/bg forest_day t=fade d=500")).toEqual({
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
        expect(payload("/bg forest_day d=250")).toMatchObject({ transition: { kind: "fadeIn", durationMs: 250 } });
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
        expect(payload("/show Alice form=smile at=left d=400")).toMatchObject({
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
        expect(payload("/wait 800")).toEqual({ action: "wait", mode: "duration", durationMs: 800 });
        expect(payload("/wait click")).toEqual({ action: "wait", mode: "click" });
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
        expect(payload("/bgm theme fade=800 loop=true")).toMatchObject({
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
