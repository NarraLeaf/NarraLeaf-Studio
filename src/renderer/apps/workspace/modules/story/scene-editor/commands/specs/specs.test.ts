import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { BUILTIN_AUDIO_TRACKS, resolveAudioTrack } from "@shared/types/audioTrack";
import { getQuickParams } from "@/lib/story/storyQuickParamsModel";
import { canCommit, parseCommandLine } from "../../storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "../../storyCommandResolution";
import { getCommandDef, getCommandSpec, listCommandSpecs } from "../registry";
import { opensInspectorAfterCommit } from "../spec";
import { declarationFromArgs } from "./variables";

/**
 * The line → block contract, pinned end-to-end: parse → resolve → spec.build. This is the suite the
 * old `applyCommandArgs` tests became - it exercises the same seam through the specs, so a drifted
 * param name (now a compile error) or a broken dispatch (a runtime wrong-block) is caught here.
 */

const CONTEXT: StoryCommandContext = {
    images: [{ id: "i1", name: "forest_day" }, { id: "i2", name: "night" }, { id: "i3", name: "spiral" }],
    audio: [{ id: "a1", name: "theme" }, { id: "a2", name: "hit" }],
    videos: [{ id: "v1", name: "intro" }],
    // Alice is drawn by Studio; Doll is drawn by a runtime the author supplied, so she has no
    // authoring-time differentials at all - the two together are what the `/face` union has to serve.
    characters: [{ id: "c1", name: "Alice" }, { id: "c2", name: "Doll" }],
    tempSpeakers: ["Zoe"],
    scenes: [{ id: "s1", name: "Chapter 2" }],
    choiceOptions: [{ id: "o1", name: "Refuse her" }, { id: "o2", name: "Say yes" }],
    valueBlueprints: [{ id: "bp1", name: "Bonus" }, { id: "bp2", name: "Story Value" }],
    // The three seeded buses under the ids the engine's channels have always had, plus one bus of
    // the author's own - a line written against a track that is NOT the fallback for its shape is
    // the only way `track=` is observable in a payload at all.
    audioTracks: [
        { id: "bgm", name: "Music" },
        { id: "sound", name: "SFX" },
        { id: "voice", name: "Voice" },
        { id: "t_amb", name: "Ambience" },
    ],
    labels: ["intro", "after refusal"],
    appTags: [{ id: "release", name: "main" }, { id: "demo", name: "Demo" }],
    variables: [
        { name: "gold", ref: { scope: "scene", variableId: "var_gold" }, valueType: "number", defaultValue: 10 },
        { name: "met", ref: { scope: "saved", variableId: "var_met" }, valueType: "boolean" },
        // A blueprint-style name with spaces: only addressable on the command line through `'…'`.
        { name: "boss hp", ref: { scope: "saved", variableId: "var_boss" }, valueType: "number", defaultValue: 3 },
    ],
    appearanceByCharacterId: { c1: [{ id: "t1", name: "smile" }, { id: "t2", name: "angry" }], c2: [] },
    puppetCharacterIds: ["c2"],
    // Doll's model has described itself. A name off these lists still resolves and still builds - the
    // list is what the editor OFFERS, never a gate, because the same project opened on a machine with
    // no runtime installed has no list at all and must stay writable.
    puppetByCharacterId: {
        c2: {
            motions: ["run", "walk", "idle"],
            expressions: ["smile", "angry"],
            skins: ["winter", "summer"],
            params: [{ id: "ParamAngleX", min: -30, max: 30, default: 0 }],
        },
    },
    stageObjects: { image: ["hero"], text: ["title"], layer: ["overlay"], video: ["clip"], audio: ["music"], vfx: ["petals"] },
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

    it("/bg takes a rule image, and naming one is what says which engine plays it", () => {
        // No `t=rule` on the line: the picture implies the engine, which is the whole reason
        // `rule=` is a slot of its own rather than a spelling of `t=`.
        expect(build("/bg forest_day rule=spiral d=1.2")).toMatchObject({
            payload: {
                action: "setBackground",
                assetId: "i1",
                transition: { kind: "ruleReveal", ruleAssetId: "i3", durationMs: 1200 },
            },
        });
        // The word still parses on its own, for a row that picks its picture on the right.
        expect(build("/bg forest_day t=rule")).toMatchObject({
            payload: { transition: { kind: "ruleReveal" } },
        });
    });

    it("/jump takes a rule image too", () => {
        expect(build("/jump \"Chapter 2\" rule=spiral")).toMatchObject({
            kind: "jump",
            payload: { transition: { kind: "ruleReveal", ruleAssetId: "i3" } },
        });
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

describe("generic verbs", () => {
    it("/show dispatches on the target: a character enters", () => {
        // `at=` wins when both are given. Since v18 the two no longer fight over one field - a
        // placement is a position and a fade is an opacity - but the rule stands: the placement is the
        // more specific instruction, and `withPlacementTransform` clears the channels the vocabulary
        // owns, so the row states one look and the line prints the word that produced it.
        expect(build("/show Alice smile pos=left in=fade d=0.3")).toMatchObject({
            kind: "action",
            payload: {
                action: "character",
                operation: "enter",
                characterId: "c1",
                pose: "t1",
                transform: { to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 300 },
            },
        });
    });

    it("a character enters and leaves through its TRANSFORM, which is the field the engine plays", () => {
        // Not `transition`: `enter` compiles to `char(src).show(transform)` and `exit` to
        // `hide(transform)`, so a transition ref written here would be a setting nothing reads — and
        // the inspector, which edits the transform, would show a different answer than the row.
        expect(build("/show Alice in=fade")).toMatchObject({
            payload: { action: "character", operation: "enter", transform: { to: { opacity: 1 } } },
        });
        expect(build("/hide Alice out=fade")).toMatchObject({
            payload: { action: "character", operation: "exit", transform: { to: { opacity: 0 } } },
        });
        expect(build("/hide Alice out=fade").payload).not.toHaveProperty("transition.kind", "fadeIn");
    });

    it("/show dispatches on the target: an image reveals through its transform props", () => {
        expect(build("/show hero in=fade d=0.2")).toMatchObject({
            payload: { action: "image", operation: "show", objectName: "hero", transform: { to: { opacity: 1 }, durationMs: 200 } },
        });
    });

    it("/hide is direction-aware: the same word fades OUT", () => {
        expect(build("/hide hero out=fade")).toMatchObject({
            payload: { action: "image", operation: "hide", objectName: "hero", transform: { to: { opacity: 0 } } },
        });
        expect(build("/hide Alice")).toMatchObject({ payload: { action: "character", operation: "exit" } });
    });

    it("the row token reads back the `d=` the author typed, for a character and an image alike", () => {
        // The seam that drifted: the spec wrote `d=` to the transform while the row token read it off
        // the transition, so every character row printed "0s". Asserted end to end — parse, resolve,
        // build, then project — because neither half is wrong on its own, only the pair.
        const ms = (source: string) => getQuickParams(build(source)).find(param => param.id === "d")?.value;
        expect(ms("/hide Alice out=fade d=2")).toMatchObject({ kind: "duration", ms: 2000 });
        expect(ms("/show Alice pos=left d=0.3")).toMatchObject({ kind: "duration", ms: 300 });
        // Known boundary, asserted so it is a decision and not a surprise: a stage object resolves to
        // an image/text/displayable payload, and `getQuickParams` has no branch for those, so `d=` is
        // stored on the transform (see the `/hide hero` case above) but earns no inline token yet.
        expect(ms("/hide hero out=fade d=1.5")).toBeUndefined();
    });

    it("/show reaches text, video and layer targets too", () => {
        expect(build("/show title")).toMatchObject({ payload: { action: "text", operation: "show", objectName: "title" } });
        expect(build("/show clip")).toMatchObject({ payload: { action: "video", operation: "show", objectName: "clip" } });
        expect(build("/show overlay")).toMatchObject({ payload: { action: "displayable", operation: "show", target: { kind: "layer", name: "overlay" } } });
    });

    it("rejects a target nothing answers to, and an unsupported word for the resolved context", () => {
        expect(issuesOf("/show nobody")).toEqual(["unknownTarget"]);
        // Every subject `/show` reaches now animates through the SAME reveal table, so a word outside
        // it is refused by the grammar itself rather than surviving to resolution: `zoom` reaches a
        // character exactly as it reaches an image, and `blinds` (a whole-screen transition) reaches
        // neither.
        expect(issuesOf("/show Alice in=zoom")).toEqual([]);
        expect(parseCommandLine("/show Alice in=blinds")).toMatchObject({ issues: [{ code: "badValue" }] });
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

    it("/rename writes the new speaker label and nothing else", () => {
        // Greedy, because the reveal a rename exists for is often a phrase ("the man in grey"), and
        // no portrait state comes along: a rename row carries no transform and no transition.
        expect(build("/rename Alice the man in grey")).toMatchObject({
            kind: "action",
            payload: { action: "character", operation: "setName", characterId: "c1", displayName: "the man in grey" },
        });
        expect(build("/rename Alice ？？？")).toMatchObject({ payload: { displayName: "？？？" } });
        expect(build("/setname Alice X")).toMatchObject({ payload: { operation: "setName", displayName: "X" } });
        // Both halves are core (B9): a rename with no name to show would commit nothing meaningful.
        expect(getCommandSpec("rename")?.params.character.core).toBe(true);
        expect(getCommandSpec("rename")?.params.name.core).toBe(true);
    });
});

/**
 * The three state channels of a character an author's own runtime draws.
 *
 * The taxonomy claim under test: expression is NOT a new command (it is `/face`, whose one slot now
 * answers for all three appearance kinds), motion and skin ARE - nothing in the vocabulary named
 * them - and `setParam` / `setSlot` / `command` are not on the line at all.
 */
describe("puppet state channels", () => {
    it("/face keeps its slot and stores a runtime name verbatim, with no id to store", () => {
        // Same verb, same slot, third kind of answer: a pose id, a tag id, or a name the model owns.
        expect(build("/face Alice smile")).toMatchObject({
            payload: { action: "character", operation: "expression", characterId: "c1", pose: "t1" },
        });
        expect(build("/face Alice smile").payload).not.toHaveProperty("puppetName");
        const doll = build("/face Doll smile");
        expect(doll).toMatchObject({
            payload: { action: "character", operation: "expression", characterId: "c2", puppetName: "smile" },
        });
        expect(doll.payload).not.toHaveProperty("pose");
        expect(doll.payload).not.toHaveProperty("tags");
        // A name no branch can check is still not a free-for-all: the character must resolve.
        expect(issuesOf("/face Nobody smile")).toEqual(["unknownCharacter"]);
    });

    it("/face takes a transition, and writes it on the ref the swap actually plays", () => {
        // `expression` is the one character operation the engine plays a `StoryTransitionRef` on -
        // it compiles to `char(src, transition)`. So `d=` is THAT ref's duration; the transform's
        // duration is the entrance/exit timing, and a swap that wrote it would edit a live-looking
        // field nothing on stage reads.
        expect(build("/face Alice smile t=wipe d=0.4")).toMatchObject({
            payload: {
                action: "character",
                operation: "expression",
                characterId: "c1",
                pose: "t1",
                transition: { kind: "softWipe", durationMs: 400 },
            },
        });
        expect(build("/face Alice smile t=wipe d=0.4").payload).not.toHaveProperty("transform");
        // `fade` on a swap is a fade-in, not the crossfade it is on a `/bg`: `Dissolve` half-fades
        // both frames at once and shows the background through the middle, while `FadeIn` leaves the
        // outgoing frame fully opaque and brings the new one up over it. The crossfade is still
        // reachable - by name.
        expect(build("/face Alice smile t=fade")).toMatchObject({ payload: { transition: { kind: "fadeIn" } } });
        expect(build("/face Alice smile t=dissolve")).toMatchObject({ payload: { transition: { kind: "dissolve" } } });
        // No `t=`, no ref: a row that says nothing about the swap must not gain a field.
        expect(build("/face Alice smile").payload).not.toHaveProperty("transition");
    });

    it("refuses a transition on a puppet, whose expression has no second frame", () => {
        // A puppet's expression compiles to `puppet.setExpression(name)` - the backend owns the inside
        // of the box, and nothing in that call takes a transition. The key is the mistake, not the
        // character, so the report names the key.
        expect(issuesOf("/face Doll smile t=wipe")).toEqual(["unsupportedParam"]);
        expect(issuesOf("/face Doll smile d=0.4")).toEqual(["unsupportedParam"]);
        expect(issuesOf("/face Doll smile t=wipe d=0.4")).toEqual(["unsupportedParam", "unsupportedParam"]);
        // The verb itself is untouched on both kinds of character.
        expect(issuesOf("/face Doll smile")).toEqual([]);
        expect(issuesOf("/face Alice smile t=wipe d=0.4")).toEqual([]);
    });

    it("/motion and /skin write their own operation and nothing else", () => {
        expect(build("/motion Doll run")).toMatchObject({
            kind: "action",
            payload: { action: "character", operation: "setMotion", characterId: "c2", puppetName: "run" },
        });
        expect(build("/skin Doll winter")).toMatchObject({
            payload: { action: "character", operation: "setSkin", characterId: "c2", puppetName: "winter" },
        });
        expect(build("/anim Doll walk")).toMatchObject({ payload: { operation: "setMotion", puppetName: "walk" } });
        expect(build("/costume Doll summer")).toMatchObject({ payload: { operation: "setSkin", puppetName: "summer" } });
        // No transform, no transition, no stage name: these address the inside of the box.
        expect(build("/motion Doll run").payload).not.toHaveProperty("transform");
    });

    it("naming nothing is the request to clear - the engine's null, not an unfilled slot", () => {
        expect(build("/motion Doll")).toMatchObject({ payload: { operation: "setMotion", characterId: "c2" } });
        expect(build("/motion Doll").payload).not.toHaveProperty("puppetName");
        expect(getCommandSpec("motion")?.params.name.core).toBeUndefined();
        expect(getCommandSpec("skin")?.params.name.core).toBeUndefined();
    });

    it("refuses a character Studio draws itself, on the slot that is actually wrong", () => {
        expect(issuesOf("/motion Alice run")).toEqual(["notPuppetCharacter"]);
        expect(issuesOf("/skin Alice winter")).toEqual(["notPuppetCharacter"]);
        expect(issuesOf("/param Alice ParamAngleX 12")).toEqual(["notPuppetCharacter"]);
    });

    it("writes a parameter row as a map, because one gesture is several parameters", () => {
        // The engine's `setParam` merges, so N entries from one row are exactly the row's intent - and
        // a head turn is three parameters, which one-pair-per-row would have made three rows of.
        expect(build("/param Doll ParamAngleX 12")).toMatchObject({
            kind: "action",
            payload: { action: "character", operation: "setParams", characterId: "c2", params: { ParamAngleX: 12 } },
        });
        // Negative and fractional values reach the payload intact: a rig parameter is continuous, and
        // its range is the model's (`-30…30` here), not a 0-1 convention.
        expect(build("/param Doll ParamAngleX -7.5")).toMatchObject({ payload: { params: { ParamAngleX: -7.5 } } });
        // No transform, no transition, no stage name: like its three siblings, it addresses the inside.
        expect(build("/param Doll ParamAngleX 12").payload).not.toHaveProperty("transform");
    });

    it("requires the id and the value, because a parameter has no meaningful clear", () => {
        // `/motion Doll` is a legal line - it clears the channel. A parameter's absent key means "keep
        // the model's own default", so a row naming an id with no value would ask for nothing at all.
        expect(getCommandSpec("param")?.params.id.core).toBe(true);
        expect(getCommandSpec("param")?.params.value.core).toBe(true);
    });

    it("still gives the unlistable end no token at all", () => {
        // `PuppetDescription` enumerates motions, expressions, skins and params - never slots, never
        // commands. `param` earned its token when `describe()` landed and gave it a shape (an id from a
        // list, a number inside the model's own range). A slot has no bounds and a command's name plus
        // payload belong to the backend, so both would still be free text pretending to be a command.
        // They unblock the same way params did: a list to pick from.
        const tokens = listCommandSpecs().flatMap(spec => [spec.token, ...(spec.aliases ?? [])]);
        for (const forbidden of ["slot", "cmd", "command", "puppet"]) {
            expect(tokens, forbidden).not.toContain(forbidden);
        }
    });
});

describe("media objects", () => {
    it("/image auto-names from the asset filename", () => {
        expect(build("/image forest_day pos=left")).toMatchObject({
            payload: { action: "image", operation: "create", objectName: "forest_day", assetId: "i1", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } } } },
        });
    });

    it("/text auto-names with a deduped default and carries its content", () => {
        expect(build("/text Hello there")).toMatchObject({
            payload: { action: "text", operation: "create", objectName: "text", text: "Hello there" },
        });
    });

    it("/video reads the bare muted flag", () => {
        expect(build("/video intro muted")).toMatchObject({
            payload: { action: "video", operation: "create", objectName: "intro", assetId: "v1", muted: true },
        });
    });

    it("/font sets one thing per block and faults on both", () => {
        expect(build("/font title 48")).toMatchObject({ payload: { operation: "setFontSize", fontSize: 48, objectName: "title" } });
        expect(build("/font title color=#ff0000")).toMatchObject({ payload: { operation: "setFontColor", fontColor: "#ff0000" } });
        expect(issuesOf("/font title 48 color=#ff0000")).toEqual(["conflictingParams"]);
    });

    it("/front raises one displayable, and states nothing else", () => {
        expect(build("/front hero")).toMatchObject({
            kind: "action",
            payload: { action: "displayable", operation: "bringToFront", target: { kind: "image", name: "hero" } },
        });
        expect(build("/front title")).toMatchObject({
            payload: { action: "displayable", operation: "bringToFront", target: { kind: "text", name: "title" } },
        });
        expect(build("/front Alice")).toMatchObject({
            payload: { action: "displayable", operation: "bringToFront", target: { kind: "character", name: "Alice" } },
        });
        // No duration, no bag: the raise is one frame, and the payload carries neither.
        expect(Object.keys(build("/front hero").payload).sort()).toEqual(["action", "operation", "target"]);
        expect(Object.keys(getCommandSpec("front")?.params ?? {})).toEqual(["target"]);
    });

    it("/front names what it found when the target is a kind it cannot raise", () => {
        // The `refuses` half, exactly as `/transform` does it: a layer, a video and an ambience
        // overlay are on stage under names the author can see, so the slot resolves them in order to
        // report them - answering "nothing on stage is named overlay" would be a lie.
        for (const line of ["/front overlay", "/front clip", "/front petals"]) {
            expect(issuesOf(line)).toEqual(["unsupportedTarget"]);
        }
        // ...and a name nothing answers to is still the other message: check the spelling.
        expect(issuesOf("/front nobody")).toEqual(["unknownTarget"]);
        // The refused kinds are refused, never quietly accepted into a payload that cannot hold them.
        const target = getCommandSpec("front")?.params.target.type;
        const accepts = (Array.isArray(target) ? target : [target]).flatMap(type =>
            type && type.kind === "target" ? [...type.accepts] : []);
        expect(accepts).toEqual(["image", "text", "character"]);
    });
});

describe("sound (target defaults to bgm)", () => {
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

    it("track= resolves a track NAME to the id the payload stores", () => {
        expect(build("/bgm theme track=Ambience")).toMatchObject({
            payload: { action: "audio", operation: "setBgm", assetId: "a1", audioTrackId: "t_amb" },
        });
        // The seeded buses carry the engine's own channel names as ids now, so naming "SFX" stores
        // `sound` - the bus id, which is what `Sound.config.type` receives.
        expect(build("/sound hit track=SFX")).toMatchObject({
            payload: { action: "audio", operation: "playSound", audioTrackId: "sound" },
        });
    });

    it("the id a line stores resolves to a bus, and a v1 id still resolves through the alias", () => {
        // The full chain the round is about: line -> payload id -> bus. `track=` writes an id, and
        // that id is what the compiler routes to, so the resolution has to be pinned here rather
        // than only where the payload is read.
        const tracks = [
            ...BUILTIN_AUDIO_TRACKS,
            { id: "t_amb", name: "Ambience", parentId: "bgm", volume: 0.6, loop: true },
        ];
        const stored = build("/sound hit track=SFX");
        const trackId = stored.kind === "action" && stored.payload.action === "audio"
            ? stored.payload.audioTrackId
            : undefined;
        expect(resolveAudioTrack(tracks, trackId, "sound").id).toBe("sound");

        // v1 seeded its tracks under `music` / `sfx`, and stories written then still hold those ids.
        // They are never rewritten - resolution knows the old spellings instead.
        expect(resolveAudioTrack(tracks, "sfx", "bgm").id).toBe("sound");
        expect(resolveAudioTrack(tracks, "music", "sound").id).toBe("bgm");
        // A live track always wins over an alias: an author who really made a track called `music`
        // gets theirs, not the seeded bus the old id used to mean.
        const withOwnMusic = [...tracks, { id: "music", name: "My Music", parentId: null, volume: 1, loop: false }];
        expect(resolveAudioTrack(withOwnMusic, "music", "sound").name).toBe("My Music");
    });

    it("a track nobody has is reported rather than silently landing on the fallback", () => {
        // The line would still compile - `resolveAudioTrack` always answers - but it would answer with
        // a different mix from the one written down, which is exactly the silence this round ends.
        expect(issuesOf("/bgm theme track=Nope")).toEqual(["unknownAudioTrack"]);
    });

    it("an omitted track writes no key at all, so the built-in for the bus answers", () => {
        // Not merely "undefined": an absent key is what makes a row written before tracks existed and
        // a row written today byte-identical, which is why there is no migration to arrange.
        for (const line of ["/bgm theme", "/sound hit"]) {
            const block = build(line);
            expect(block.kind === "action" && block.payload).not.toHaveProperty("audioTrackId");
        }
    });

    it("fade reaches /sound, /pause and /resume - the compiler always honoured it", () => {
        expect(build("/sound hit fade=0.25")).toMatchObject({
            payload: { action: "audio", operation: "playSound", fadeMs: 250 },
        });
        expect(build("/pause music fade=0.5")).toMatchObject({
            payload: { action: "audio", operation: "pauseSound", objectName: "music", fadeMs: 500 },
        });
        expect(build("/resume music fade=1.5")).toMatchObject({
            payload: { action: "audio", operation: "resumeSound", objectName: "music", fadeMs: 1500 },
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

    it("/stop /pause /resume dispatch on what the target turned out to be", () => {
        // The B4 default and the B3 dispatch have to coexist: nothing after the token still means the
        // music channel, and only a NAMED target that resolves to a video reaches the video payload.
        expect(build("/pause")).toMatchObject({ payload: { action: "audio", operation: "pauseSound", objectName: "bgm" } });
        expect(build("/pause music")).toMatchObject({ payload: { action: "audio", operation: "pauseSound", objectName: "music" } });
        expect(build("/pause clip")).toMatchObject({ payload: { action: "video", operation: "pause", objectName: "clip" } });
        expect(build("/resume clip")).toMatchObject({ payload: { action: "video", operation: "resume", objectName: "clip" } });
        expect(build("/stop clip")).toMatchObject({ payload: { action: "video", operation: "stop", objectName: "clip" } });
    });

    it("/seek names its clip and stores seconds as milliseconds", () => {
        expect(build("/seek clip 3")).toMatchObject({
            kind: "action",
            payload: { action: "video", operation: "seek", objectName: "clip", timeMs: 3000 },
        });
        // Still not omissible, even now that a sound can answer it: "/seek 3" reads as three seconds
        // into *what*, and unlike /vol the subject is not overwhelmingly the music channel.
        expect(getCommandSpec("seek")?.params.target.core).toBe(true);
        expect(getCommandSpec("seek")?.params.target.skippable).toBeUndefined();
    });

    it("/seek dispatches to audio when the target is a sound", () => {
        // Same dispatch-on-target shape as /stop and /pause: one token, two payloads.
        expect(build("/seek music 30")).toMatchObject({
            kind: "action",
            payload: { action: "audio", operation: "seekSound", objectName: "music", timeMs: 30000 },
        });
        // A name that resolves to nothing on stage falls back to audio, so /seek bgm reaches the
        // reserved music channel without the author having created a named sound first.
        expect(build("/seek bgm 12")).toMatchObject({
            payload: { action: "audio", operation: "seekSound", objectName: "bgm", timeMs: 12000 },
        });
    });
});

describe("variables", () => {
    /** Parse, resolve, and read back the declaration a line produces - the seam every test below asserts on. */
    const declare = (source: string) => {
        const line = parseCommandLine(source);
        if (line.kind !== "command" || !line.def) {
            throw new Error(`not a command: ${source}`);
        }
        return declarationFromArgs(resolveCommandLine(line, CONTEXT).args);
    };

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
        expect(declare("/local hp 100")).toEqual({ name: "hp", valueType: "number", defaultValue: 100, description: undefined });
        expect(declare("/local seen")).toEqual({ name: "seen", valueType: "boolean", defaultValue: undefined, description: undefined });
        expect(declare("/local nickname type=string desc=\"player name\"")).toEqual({
            name: "nickname", valueType: "string", defaultValue: undefined, description: "player name",
        });
        // An explicit type= wins over what the default suggests.
        expect(declare("/local flag 1 type=bool")).toMatchObject({ valueType: "boolean", defaultValue: 1 });
        // A declaration into an occupied name is refused, not overwritten.
        expect(issuesOf("/local gold")).toEqual(["duplicateVariable"]);
        // `AppTag` is the build variant to every expression, so a variable could never be read by
        // its bare name. Refused at the declaration rather than at the first line that uses it.
        expect(issuesOf("/local AppTag")).toEqual(["reservedVariableName"]);
        expect(issuesOf("/local apptag")).toEqual(["reservedVariableName"]);
    });

    /**
     * A bracketed default is read as the structure it spells, so `type=json` and the stored value stop
     * disagreeing: `/local inv "[1, 2]" type=json` used to declare a json variable holding the STRING
     * "[1, 2]", which is a silent wrong type in the one place the author cannot see it.
     *
     * The reading is deliberately narrow, and each way it could over-reach is pinned below: it must
     * not swallow prose that merely opens with a bracket, must not outrank an explicit `type=string`,
     * and must not become a foothold for evaluating anything - a constant reads nothing, which is the
     * whole reason the kind exists apart from `expression`.
     */
    it("reads a bracketed default as the list or object it spells", () => {
        expect(declare("/local inv \"[1, 2]\" type=json"))
            .toEqual({ name: "inv", valueType: "json", defaultValue: [1, 2], description: undefined });
        // An object needs its keys quoted, and `"` is the tokenizer's own grouping character - so the
        // spelling that survives is the single-quoted wrapper, inside which `"` is data (the rule the
        // tokenizer already documents for `'say "hi"'`). Same for a list of strings.
        expect(declare("/local cfg '{\"hp\": 3}' type=json")).toMatchObject({ defaultValue: { hp: 3 } });
        expect(declare("/local inv '[\"sword\", \"potion\"]'")).toMatchObject({ valueType: "json", defaultValue: ["sword", "potion"] });
        // The double-quoted spelling of the same thing loses the inner quotes to the tokenizer and so
        // is no longer JSON. It degrades to the string it now reads as rather than to an error - the
        // fallback doing its job on a case an author will hit.
        expect(declare("/local cfg \"{\\\"hp\\\": 3}\" type=json")).toMatchObject({ defaultValue: "{\\hp\\: 3}" });
        // With no `type=` at all the value is the only evidence, and a list says json by itself - the
        // arm `inferDeclaredType` has always ended on, reachable for the first time.
        expect(declare("/local inv \"[1, 2]\"")).toMatchObject({ valueType: "json", defaultValue: [1, 2] });
        expect(declare("/local cfg \"{}\"")).toMatchObject({ valueType: "json", defaultValue: {} });
        // The primitive readings are untouched: a bracket is the only new trigger.
        expect(declare("/local hp 100")).toMatchObject({ valueType: "number", defaultValue: 100 });
        expect(declare("/local met true")).toMatchObject({ valueType: "boolean", defaultValue: true });
    });

    it("leaves words that merely open with a bracket as the string they read as", () => {
        // `JSON.parse` throws on all of these; the fallback is the raw text, never an exception and
        // never a half-parsed value. An author's placeholder is not a broken list.
        expect(declare("/local note \"[draft]\"")).toMatchObject({ valueType: "string", defaultValue: "[draft]" });
        expect(declare("/local note \"[1, 2\"")).toMatchObject({ valueType: "string", defaultValue: "[1, 2" });
        expect(declare("/local note \"{unclosed\"")).toMatchObject({ valueType: "string", defaultValue: "{unclosed" });
        expect(declare("/local note \"[TODO] rewrite this\"")).toMatchObject({ defaultValue: "[TODO] rewrite this" });
    });

    it("lets an explicit type=string outrank how the value happens to read", () => {
        // The author said what they wanted. Storing the parsed list here would be the same class of
        // mismatch this change exists to remove, just pointing the other way - and the source text goes
        // back verbatim rather than re-serialized, so the stored string is the one that was typed.
        expect(declare("/local x \"[1, 2]\" type=string")).toMatchObject({ valueType: "string", defaultValue: "[1, 2]" });
        expect(declare("/local x \"[1,2]\" type=str")).toMatchObject({ valueType: "string", defaultValue: "[1,2]" });
        // Only `string` is undone: a declared bool keeps the value it was handed, as it always has.
        expect(declare("/local flag 1 type=bool")).toMatchObject({ valueType: "boolean", defaultValue: 1 });
    });

    it("still refuses to read or compute anything in a constant slot", () => {
        // `constant` exists to forbid exactly this (grammar: "a value that must not read anything").
        // Unquoted, the line cannot even parse - the value breaks at its space and the tail is an extra
        // positional, so Enter refuses it. Quoted, it parses and is stored as the CHARACTERS it is:
        // no call is made, no variable is read, and the declared type is string, not number.
        expect(canCommit(parseCommandLine("/local hp min(1, 2)"))).toBe(false);
        expect(parseCommandLine("/local hp min(1, 2)")).toMatchObject({ issues: [{ code: "extraPositional" }] });
        expect(declare("/local hp \"min(1, 2)\"")).toMatchObject({ valueType: "string", defaultValue: "min(1, 2)" });
        expect(declare("/local hp \"gold + 1\"")).toMatchObject({ valueType: "string", defaultValue: "gold + 1" });
    });

    it("a token is a spelling, never a thing a document records", () => {
        // §3.6 renamed the declaration tokens and the retirement round deleted two of them outright,
        // and neither could touch an existing scene: a document stores blocks, never a command id.
        // Proven rather than reasoned - build the same declaration through both of `/local`'s
        // spellings and compare everything but the freshly minted ids.
        //
        // The pair this used to run on was `/save` / `/var`, and the property it proved is exactly
        // what made deleting them cheap. `/local` and `/scenevar` are the pair left standing; the two
        // retired scopes can no longer be built from any line at all, which is the point of retiring
        // them, so their side is asserted where they still appear - the row read-back
        // (`storyCommandLine.test.ts`).
        const declaration = (source: string) => {
            const block = build(source);
            if (block.kind !== "declaration") {
                throw new Error(`expected a declaration from ${source}`);
            }
            return { ...block.payload, storageKey: "<id>" };
        };
        expect(declaration("/local chapter 10 type=number")).toEqual(declaration("/scenevar chapter 10 type=number"));
        expect(declaration("/local chapter 10 type=number").scope).toBe("scene");
        // No payload carries the token that produced it - the structural reason a rename is free.
        for (const source of ["/local chapter", "/scenevar chapter"]) {
            expect(Object.keys(build(source).payload).sort())
                .toEqual(["defaultValue", "description", "name", "scope", "storageKey", "valueType"]);
        }
        // `/swap` lost its two type-shaped aliases (§3.6) without losing a spelling of itself.
        expect(getCommandSpec("swap")?.aliases).toEqual(["src"]);
        expect(build("/src hero night")).toMatchObject({ payload: { operation: "setSource", assetId: "i2" } });
    });

    it("a declaration builds a ROW whose id is the variable and whose key is its own id (v6)", () => {
        const block = build("/local hp 100");
        expect(block.kind).toBe("declaration");
        if (block.kind !== "declaration") throw new Error("expected declaration");
        expect(block.payload).toMatchObject({ scope: "scene", name: "hp", valueType: "number", defaultValue: 100 });
        expect(block.payload.storageKey).toBe(block.id);
        expect(build("/local seen").kind).toBe("declaration");
        expect(build("/local nickname type=string")).toMatchObject({ kind: "declaration", payload: { scope: "scene", valueType: "string" } });
    });
});

describe("logic and effects", () => {
    it("paramless containers build their control blocks", () => {
        expect(build("/parallel")).toMatchObject({ kind: "control", payload: { control: "parallel", mode: "all" } });
        expect(build("/race")).toMatchObject({ payload: { control: "race", mode: "any" } });
        expect(build("/sequence")).toMatchObject({ payload: { control: "sequence", mode: "do" } });
        expect(build("/repeat 3")).toMatchObject({ payload: { control: "repeat", times: 3 } });
    });

    /**
     * The unquoted path, and the reason `/until` is a command instead of a word after `/repeat`.
     *
     * `/repeat until gold >= 10` cannot parse: the skippable rule only dispatches on closed value
     * sets, so `times` swallows the `until` token and faults instead of yielding to an expression
     * slot. A greedy positional on its own command claims the tail verbatim, which is what makes the
     * quotes unnecessary here - and conditions are almost always multi-token.
     */
    it("/until builds a conditional loop with no quotes and no count", () => {
        const block = build("/until gold >= 100");
        expect(block).toMatchObject({
            kind: "control",
            payload: { control: "repeat", until: { kind: "expression", expression: { source: "gold >= 100" } } },
        });
        expect((block as { payload: { times?: number } }).payload.times).toBeUndefined();
        expect(canCommit(parseCommandLine("/until gold >= 100"))).toBe(true);
        // Same block either way - `/until` is a spelling of the payload, not a second kind of loop.
        expect(block.payload).toEqual(build("/repeat until=\"gold >= 100\"").payload);
    });

    it("/until refuses a line with no condition, and a non-boolean one", () => {
        // Core: unlike `/repeat`, there is no count to fall back on, so an empty line would build a
        // group with no way to stop.
        expect(canCommit(parseCommandLine("/until"))).toBe(false);
        expect(issuesOf("/until gold + 1")).toEqual(["expressionNotBoolean"]);
    });

    it("/repeat until builds a conditional loop, and carries no count beside it", () => {
        const block = build("/repeat until=\"gold >= 100\"");
        expect(block).toMatchObject({
            kind: "control",
            payload: { control: "repeat", until: { kind: "expression", expression: { source: "gold >= 100" } } },
        });
        // The two forms are exclusive in the payload as well as on the line: the default block's
        // `times: 2` must not survive under an `until`, or the inspector would offer to edit a number
        // the compiler never reads.
        expect((block as { payload: { times?: number } }).payload.times).toBeUndefined();
        // A single-token condition needs no quotes; the same `expects: "boolean"` check applies.
        expect(build("/repeat until=met")).toMatchObject({ payload: { until: { kind: "expression" } } });
        expect(issuesOf("/repeat until=\"gold + 1\"")).toEqual(["expressionNotBoolean"]);
    });

    it("/repeat refuses a count and a stop condition on one line", () => {
        expect(issuesOf("/repeat 3 until=\"gold >= 100\"")).toEqual(["repeatTimesAndUntil"]);
    });

    it("/break builds the loop exit", () => {
        expect(build("/break")).toMatchObject({ kind: "control", payload: { control: "break" } });
    });

    /**
     * `core` is a per-param flag and cannot express "one of these two". While `times` carried it, a
     * `/repeat until=…` line parsed clean, resolved clean, built the right block - and Enter still
     * refused it, naming a slot the author had deliberately left empty. `build()` above never saw
     * that, because it asks the parser and the resolver and not the commit gate.
     */
    it("commits both repeat forms, and the bare container", () => {
        expect(canCommit(parseCommandLine("/repeat 3"))).toBe(true);
        expect(canCommit(parseCommandLine("/repeat until=\"gold >= 100\""))).toBe(true);
        expect(canCommit(parseCommandLine("/repeat"))).toBe(true);
        expect(canCommit(parseCommandLine("/break"))).toBe(true);
    });

    it("/if builds the bare condition container - the expression rides to the scaffolded branch", () => {
        expect(build("/if gold >= 100")).toMatchObject({ kind: "control", payload: { control: "condition" } });
        expect(issuesOf("/if gold + 1")).toEqual(["expressionNotBoolean"]);
    });

    it("/label marks a place and /goto only accepts one that exists", () => {
        expect(build("/label after refusal")).toMatchObject({
            kind: "control",
            payload: { control: "label", name: "after refusal" },
        });
        expect(build("/goto intro")).toMatchObject({ kind: "control", payload: { control: "goto", targetLabel: "intro" } });
        // Case-insensitive to type, but stored as declared - the compiler matches the same way.
        expect(build("/goto INTRO")).toMatchObject({ payload: { targetLabel: "intro" } });
        // The whole point of the label slot: a name that is not a label in this scene cannot commit,
        // so the author never gets a document whose engine build fails.
        expect(issuesOf("/goto nowhere")).toEqual(["unknownLabel"]);
    });

    it("/screen reads both gestures off one token, effect first", () => {
        expect(build("/screen blink d=0.2 hold=0.1 color=#ffffff")).toMatchObject({
            payload: { action: "screenEffect", effect: "blink", durationMs: 200, holdMs: 100, color: "#ffffff" },
        });
        expect(build("/screen vignette opacity=0.5")).toMatchObject({ payload: { effect: "vignette", opacity: 0.5 } });
        // The price of the merge, paid out loud: the union parses and the spec reports the half this
        // effect cannot honour, rather than writing a field nothing reads.
        expect(issuesOf("/screen vignette in=0.2")).toEqual(["unsupportedParam"]);
        expect(issuesOf("/screen blink inner=20")).toEqual(["unsupportedParam"]);
        // The effect is the required core: a bare `/screen` names no gesture and has nothing to commit.
        expect(getCommandSpec("screen")?.params.effect.core).toBe(true);
    });

    it("/transform camera reads the camera as a reserved target word", () => {
        expect(build("/transform camera zoom=1.5 d=0.8")).toMatchObject({
            kind: "action",
            payload: { action: "camera", operation: "transform", transform: { to: { zoom: 1.5 }, durationMs: 800 } },
        });
        expect(build("/transform camera pos=left d=0.6")).toMatchObject({
            payload: { action: "camera", operation: "transform", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 600 } },
        });
        // `pan=` is the same slot: the camera's own reading of the position channel.
        expect(build("/transform camera pan=right")).toMatchObject({ payload: { transform: { to: { position: { xalign: 0.75 } } } } });
        expect(build("/transform camera rot=-15")).toMatchObject({ payload: { transform: { to: { rotation: -15 } } } });
        expect(build("/reset camera d=0.6")).toMatchObject({ payload: { operation: "reset", durationMs: 600 } });
        // The retired `/camera darken 0.4` is `bright=0.6`: the engine's `darken(d)` IS
        // `brightness(1 - d)`, one CSS channel, so the prop vocabulary spells the channel.
        expect(build("/transform camera bright=0.6")).toMatchObject({
            payload: { transform: { to: { filter: { brightness: 0.6 } } } },
        });
        // The look library stays reachable by NAME, so the inspector can re-open on the grade.
        expect(build("/transform camera look=moonlight")).toMatchObject({
            payload: { transform: { to: { look: { preset: "moonlight" } } } },
        });
    });

    it("gives the camera every channel of the bag, in as many at once as the line states", () => {
        // The camera used to be the one subject that could state a SINGLE channel, because its payload
        // spelled one operation plus that operation's own field. v19 gave it the bag, so a row that
        // pans and zooms is one row rather than a reported conflict.
        expect(issuesOf("/transform camera zoom=2 rot=10")).toEqual([]);
        expect(build("/transform camera zoom=2 rot=10 opacity=0.5")).toMatchObject({
            payload: { transform: { to: { zoom: 2, rotation: 10, opacity: 0.5 } } },
        });
        // `color=` is still the exception, on every subject: it is `fontColor`, and only a text has one.
        expect(issuesOf("/transform camera color=#fff")).toEqual(["unsupportedParam"]);
        // Two writers of the one CSS filter channel is still refused, camera or not.
        expect(issuesOf("/transform camera look=moonlight blur=4")).toEqual(["conflictingParams"]);
    });

    it("/transform camera motion commits an unbound Story Motion ref and routes only that line to the inspector", () => {
        // A Story Motion is a binding no command line can name, so the line states the mode and the
        // inspector does the picking. Every other row is complete as typed, and yanking the caret out
        // of those would stop the author mid-flow - hence a predicate, not a spec-wide boolean.
        const shot = build("/transform camera motion");
        expect(shot).toMatchObject({
            kind: "action",
            payload: { action: "camera", operation: "transform", transform: { mode: "animation" } },
        });
        const spec = getCommandSpec("transform");
        expect(opensInspectorAfterCommit(spec, shot)).toBe(true);
        expect(opensInspectorAfterCommit(spec, build("/transform camera zoom=1.5"))).toBe(false);
        expect(opensInspectorAfterCommit(spec, build("/transform hero pos=left"))).toBe(false);
        // A displayable's Story Motion rides the same flag, on its own payload arm.
        expect(build("/transform hero motion")).toMatchObject({
            payload: { action: "displayable", transform: { mode: "animation" } },
        });
    });

    it("/vfx places a looping overlay and names it off the clip", () => {
        expect(build("/vfx intro")).toMatchObject({
            kind: "action",
            payload: { action: "vfx", operation: "create", objectName: "intro", assetId: "v1", loop: true },
        });
        expect(build("/vfx intro name=rain opacity=0.6 d=1.2")).toMatchObject({
            payload: { objectName: "rain", opacity: 0.6, durationMs: 1200 },
        });
        // Blend mode decides whether the material reads at all, so the create row opens the inspector.
        expect(getCommandSpec("vfx")?.inspectorAfterCommit).toBe(true);
    });

    it("the generic verbs reach a vfx with its own payload", () => {
        // Four capabilities, one new token: everything after placing the overlay is an existing verb.
        expect(build("/show petals d=0.8")).toMatchObject({
            payload: { action: "vfx", operation: "show", objectName: "petals", durationMs: 800 },
        });
        expect(build("/hide petals")).toMatchObject({ payload: { action: "vfx", operation: "hide", objectName: "petals" } });
        expect(build("/pause petals")).toMatchObject({ payload: { action: "vfx", operation: "pause" } });
        expect(build("/resume petals")).toMatchObject({ payload: { action: "vfx", operation: "resume" } });
        expect(build("/rate petals 0.5")).toMatchObject({ payload: { action: "vfx", operation: "setRate", rate: 0.5 } });
        // A verb the element does not have does not list it: a Vfx has no stop, so `/stop petals` is
        // not a vfx line - and with nothing on stage answering, it falls to the audio fallback kind.
        expect(build("/stop petals")).toMatchObject({ payload: { action: "audio", operation: "stopSound", objectName: "petals" } });
    });

    it("keeps a vfx out of every displayable slot - but says so instead of pretending it is not there", () => {
        // §7.2's hard rule, enforced twice over: `accepts` never lists vfx, and
        // `StoryDisplayableTargetKind` excludes it, so no payload could hold one either. What changed
        // in M2 is the REPORT - the kind sits in `refuses`, so the name resolves far enough to name
        // what it found rather than claiming nothing on stage answers to it.
        for (const id of ["transform", "reset"]) {
            const target = getCommandSpec(id)?.params.target.type;
            const accepts = (Array.isArray(target) ? target : [target]).flatMap(type =>
                type && type.kind === "target" ? [...type.accepts] : []);
            expect(accepts).not.toContain("vfx");
        }
        expect(issuesOf("/transform petals")).toEqual(["unsupportedTarget"]);
        expect(issuesOf("/reset petals")).toEqual(["unsupportedTarget"]);
        // A name nothing answers to is still the other message: check the spelling, not the verb.
        expect(issuesOf("/transform nobody")).toEqual(["unknownTarget"]);
    });

    it("/transform writes the prop bag and /reset clears it", () => {
        expect(build("/transform Alice d=0.4")).toMatchObject({
            payload: { action: "displayable", operation: "transform", target: { kind: "character", name: "Alice" }, transform: { durationMs: 400 } },
        });
        // Several filter names compose into the ONE structured record - the ergonomic the whole
        // redesign turns on, and what makes the next filter function a name rather than an operation.
        expect(build("/transform hero blur=4 gray=1")).toMatchObject({
            payload: { transform: { to: { filter: { blur: 4, grayscale: 1 } } } },
        });
        // Sugar and the raw escape hatch write one CSS channel, so one row may not carry both.
        expect(issuesOf("/transform hero blur=4 filter=\"drop-shadow(0 0 4px red)\"")).toEqual(["conflictingParams"]);
        expect(build("/transform hero filter=\"drop-shadow(0 0 4px red)\"")).toMatchObject({
            payload: { transform: { to: { filterRaw: "drop-shadow(0 0 4px red)" } } },
        });
        // No props means the whole bag; named props mean only those - the old `clearMask` and friends.
        expect(build("/reset hero")).toMatchObject({
            payload: { transform: { to: { zoom: 1, opacity: 1, filter: null, clipPath: null } } },
        });
        expect(build("/reset hero mask clip")).toMatchObject({
            payload: { transform: { to: { maskAssetId: null, clipPath: null } } },
        });
        expect(build("/reset hero mask clip").payload).not.toHaveProperty("transform.to.zoom");
        // One verb, two subjects: a variable resets to its declared default through the same word.
        expect(build("/reset gold")).toMatchObject({ payload: { action: "setVariable" } });
    });

    it("/transform reaches the built-in layers and the scene background by their reserved words", () => {
        expect(build("/transform backgroundLayer opacity=0.4")).toMatchObject({
            payload: { action: "displayable", target: { builtin: "backgroundLayer" }, transform: { to: { opacity: 0.4 } } },
        });
        expect(build("/transform background blur=6")).toMatchObject({
            payload: { target: { builtin: "background" }, transform: { to: { filter: { blur: 6 } } } },
        });
    });

    it("flip= states which way a sprite faces, absolutely — it is never a toggle", () => {
        // The compiler emits a STATIC transform, so a line meaning "the other way from whatever it is
        // now" could not be built. Both states are therefore spelled out, and saying either twice is
        // a no-op rather than an undo. `scaleY` is deliberately absent: a mirror is horizontal, and
        // restating a vertical scale would reset one an earlier row set.
        expect(build("/transform hero flip=on")).toMatchObject({
            payload: {
                action: "displayable",
                operation: "transform",
                target: { kind: "image", name: "hero" },
                transform: { to: { scaleX: -1 } },
            },
        });
        expect(build("/transform hero flip=on").payload).not.toHaveProperty("transform.to.scaleY");
        expect(build("/transform hero flip=off")).toMatchObject({ payload: { transform: { to: { scaleX: 1 } } } });
        expect(build("/transform Alice flip=on d=0.3")).toMatchObject({
            payload: { target: { kind: "character", name: "Alice" }, transform: { to: { scaleX: -1 }, durationMs: 300 } },
        });
    });

    it("leaves `flip` to /toggle, whose alias it already was", () => {
        // A token is what a stored line RE-PARSES as. `/flip met` was written against the boolean verb
        // long before a sprite could be mirrored, and it has to keep meaning that.
        expect(getCommandDef("flip")?.commandId).toBe("toggle");
    });
});

/**
 * The manual prints these lines as "here is how you write it". A documented line that no longer
 * parses is worse than no documentation, and grammar drifts — a param turning core, an enum losing a
 * word — would otherwise leave the examples wrong with nothing to notice it. Running them through the
 * same parse → resolve → build the editor uses makes that impossible: an example either works or the
 * suite is red.
 */
describe("manual examples", () => {
    const specs = listCommandSpecs();

    it("gives every command at least one worked line", () => {
        const missing = specs.filter(spec => !spec.examples || spec.examples.length === 0).map(spec => spec.token);
        expect(missing).toEqual([]);
    });

    it("names the command it documents", () => {
        for (const spec of specs) {
            for (const example of spec.examples ?? []) {
                const tokens = [spec.token, ...(spec.aliases ?? [])];
                expect(tokens.some(token => example === `/${token}` || example.startsWith(`/${token} `)), example).toBe(true);
            }
        }
    });

    it("parses, resolves and builds every one of them", () => {
        for (const spec of specs) {
            for (const example of spec.examples ?? []) {
                // `build` asserts zero parse and zero resolution issues on the way through.
                expect(build(example), example).toBeTruthy();
            }
        }
    });
});

/**
 * A glyph per command, and no glyph twice.
 *
 * The icon is not decoration: it is what the `/` menu, the action creator and a committed row's plate
 * draw beside the name, and it used to come from the command's GROUP - so a section of the menu was a
 * column of one repeated symbol, saying only what the section header already said. Per-command icons
 * are worth nothing if two commands share one, and a shared icon is exactly the mistake that is
 * invisible while authoring (two files, two imports, one symbol) and obvious to an author reading the
 * list, so it is pinned here rather than left to review.
 */
describe("command icons", () => {
    const specs = listCommandSpecs();

    it("gives every command a glyph of its own", () => {
        const byIcon = new Map<unknown, string[]>();
        for (const spec of specs) {
            expect(spec.icon, spec.token).toBeTruthy();
            byIcon.set(spec.icon, [...(byIcon.get(spec.icon) ?? []), spec.token]);
        }
        const shared = [...byIcon.values()].filter(tokens => tokens.length > 1);
        expect(shared).toEqual([]);
    });
});
