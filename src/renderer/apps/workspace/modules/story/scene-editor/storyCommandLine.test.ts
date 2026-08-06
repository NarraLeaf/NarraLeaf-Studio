import { afterEach, describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";
import { getCommandSpec } from "./commands/registry";
import { projectStoryCommandLine, type StoryCommandLineLookups } from "./storyCommandLine";
import { storyCommandLineParts } from "./StoryCommandLineView";

/**
 * The row reads back as the line that made it.
 *
 * Two things are asserted, and the second is the one that matters: the line LOOKS right (a handful of
 * shapes, in both command languages), and the line PARSES BACK to the same payload. A projection that
 * only looked right would be free to invent a spelling no author could type; the round trip is what
 * makes "the row shows the command" a fact rather than a resemblance.
 */

const CONTEXT: StoryCommandContext = {
    images: [{ id: "i1", name: "forest_day" }, { id: "i2", name: "night" }],
    audio: [{ id: "a1", name: "theme" }, { id: "a2", name: "hit" }],
    videos: [{ id: "v1", name: "intro" }],
    characters: [{ id: "c1", name: "Alice" }, { id: "c2", name: "Doll" }],
    tempSpeakers: [],
    scenes: [{ id: "s1", name: "Chapter 2" }],
    choiceOptions: [],
    valueBlueprints: [],
    audioTracks: [
        { id: "bgm", name: "Music" },
        { id: "sound", name: "SFX" },
        { id: "voice", name: "Voice" },
        { id: "t_amb", name: "Ambience" },
    ],
    labels: ["intro", "after refusal"],
    variables: [
        { name: "gold", ref: { scope: "scene", variableId: "var_gold" }, valueType: "number", defaultValue: 10 },
    ],
    appearanceByCharacterId: { c1: [{ id: "t1", name: "smile" }, { id: "t2", name: "angry" }], c2: [] },
    puppetCharacterIds: ["c2"],
    puppetByCharacterId: {
        c2: { motions: ["run"], expressions: ["smile"], skins: ["winter"], params: [{ id: "ParamAngleX", min: -30, max: 30, default: 0 }] },
    },
    stageObjects: { image: ["hero"], text: ["title"], layer: ["overlay"], video: ["clip"], audio: ["music"], vfx: ["petals"] },
};

/** The scene the rows live in — it holds the `gold` declaration a `/set` row's variable ref resolves against. */
const SCENE: StoryScene = {
    id: "s1",
    name: "Chapter 2",
    blocks: {
        var_gold: {
            id: "var_gold",
            parentId: null,
            childrenIds: [],
            kind: "declaration",
            payload: { scope: "scene", name: "gold", valueType: "number", defaultValue: 10, storageKey: "var_gold" },
        },
    },
    rootIds: ["var_gold"],
} as unknown as StoryScene;

const LOOKUPS: StoryCommandLineLookups = {
    character: id => (CONTEXT.characters.find(entry => entry.id === id) ?? null),
    assetName: id => [...CONTEXT.images, ...CONTEXT.audio, ...CONTEXT.videos].find(entry => entry.id === id)?.name ?? null,
    audioTrackName: id => CONTEXT.audioTracks.find(entry => entry.id === id)?.name ?? null,
    appearanceName: (characterId, refId) => CONTEXT.appearanceByCharacterId[characterId]?.find(ref => ref.id === refId)?.name ?? null,
    appearanceOptions: characterId => CONTEXT.appearanceByCharacterId[characterId] ?? [],
    commandContext: CONTEXT,
    scene: SCENE,
    scenes: { s1: SCENE },
};

let nextId = 0;
const generateId = () => `id_${nextId++}`;

/** Parse → resolve → build, the exact path Enter takes. Throws if the line would not commit. */
function build(source: string): StoryBlock {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    expect(line.issues, source).toEqual([]);
    const { args, issues } = resolveCommandLine(line, CONTEXT);
    expect(issues, source).toEqual([]);
    const spec = getCommandSpec(line.def.commandId);
    if (!spec?.build) {
        throw new Error(`no build on ${line.def.commandId}`);
    }
    return spec.build(args, { generateId, context: CONTEXT });
}

function project(source: string): string {
    const line = projectStoryCommandLine(build(source), LOOKUPS);
    if (!line) {
        throw new Error(`no command line for: ${source}`);
    }
    return line.source;
}

afterEach(() => {
    // The command vocabulary follows the interface locale unless the author pinned it, so setting the
    // one locale is what a test does — and restoring the preference is what keeps the tables clean.
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

describe("projectStoryCommandLine", () => {
    it("writes the line the author typed, spelled out in full", () => {
        // The abbreviations an author may TYPE are not what the row reads back: the key is written in
        // whatever spelling the command language offers, and the seconds are the seconds.
        expect(project("/hide Alice t=fade d=1")).toBe("/hide Alice t=fade d=1s");
        expect(project("/bg forest_day t=fade d=0.5")).toBe("/bg forest_day t=fade d=0.5s");
        expect(project("/show Alice at=left d=0.3")).toBe("/show Alice at=left d=0.3s");
        expect(project("/wait 1.5")).toBe("/wait 1.5s");
        expect(project("/wait click")).toBe("/wait click");
    });

    it("says it in the command language, keys and values and all", () => {
        i18nStore.setLocale("zh");
        // The line the request asked for: nothing abbreviated, nothing in a language the author is not
        // writing in — and `持续时间=1` is a spelling their own parser accepts.
        // `转场=淡出` is the block's own transform preset — the field the engine plays and the field
        // the inspector's 变换 → 预设 edits, spelled with the inspector's own word so the two surfaces
        // read alike. `/hide`'s default block carries a fade-out.
        expect(project("/hide Alice d=1")).toBe("/隐藏 Alice 转场=淡出 持续时间=1秒");
        // Both spellings reach the same option: the word the row now shows, and the vocabulary's own
        // word an author may already have typed.
        expect(build("/隐藏 Alice 转场=淡出").payload).toEqual(build("/hide Alice t=fade").payload);
        expect(build("/隐藏 Alice 转场=淡变").payload).toEqual(build("/hide Alice t=fade").payload);
        // And the unit it prints is one the parser takes back — `持续时间=1秒` builds the same block
        // `d=1` did, which is the whole reason the unit is a vocabulary entry rather than a suffix
        // glued on at render time.
        expect(build("/隐藏 Alice 持续时间=1秒").payload).toEqual(build("/hide Alice d=1").payload);
        // A whole-screen fade IS a crossfade, and the inspector's transition dropdown calls it 溶解 —
        // so the row does too. The unified word `淡变` still parses; it is just not what is shown.
        expect(project("/bg forest_day t=fade")).toBe("/背景 forest_day 转场=溶解");
        expect(project("/camera zoom 2 d=0.4")).toBe("/镜头 缩放 2 持续时间=0.4秒");
    });

    it("keeps the canonical trigger — swapping in the author's is the view's job", () => {
        expect(project("/hide Alice").startsWith("/")).toBe(true);
    });

    it("quotes a value the tokenizer would otherwise split — and never a greedy one", () => {
        expect(project("/jump 'Chapter 2'")).toBe("/jump 'Chapter 2'");
        // `/label`'s name is greedy: it takes the rest of the line, so quoting it would put the quotes
        // INTO the label. The round trip below is what catches that either way round.
        expect(project("/label after refusal")).toBe("/label after refusal");
    });

    it("names the appearance a row asks for, never its id", () => {
        // `/face Alice smile` stores `pose: "t1"`. The row has to say `smile` — the word the author
        // typed — and an id must never reach it.
        expect(project("/face Alice smile")).toBe("/face Alice smile");
        expect(project("/show Alice smile")).toBe("/show Alice smile at=center d=0.3s");
        expect(projectStoryCommandLine(build("/face Alice smile"), { ...LOOKUPS, appearanceName: () => null })?.source).toBe("/face Alice");
    });

    it("never prints an id", () => {
        // A character row stores a characterId and a background row an assetId; both resolve to names,
        // and an unresolvable one falls back to a phrase rather than leaking the id.
        expect(project("/show Alice")).toBe("/show Alice at=center d=0.3s");
        expect(project("/bg night")).toBe("/bg night");
        const orphan = projectStoryCommandLine(build("/bg night"), { ...LOOKUPS, assetName: () => null });
        expect(orphan?.source).not.toContain("i2");
    });

    it("marks the editable values by where they sit", () => {
        const line = projectStoryCommandLine(build("/hide Alice t=fade d=1"), LOOKUPS);
        expect(line).not.toBeNull();
        const at = (edit: { span: { start: number; end: number } }) => line!.source.slice(edit.span.start, edit.span.end);
        // The subject is one of them: which character this hides is as much a choice as how.
        expect(line!.edits.map(at)).toEqual(["Alice", "fade", "1s"]);
        expect(line!.edits.map(edit => edit.control.kind)).toEqual(["choice", "enum", "number"]);
    });

    it("marks the character's face onto the name, and onto nothing else", () => {
        const faces = (source: string) => projectStoryCommandLine(build(source), LOOKUPS)!.ornaments;
        const line = projectStoryCommandLine(build("/show Alice smile at=left d=0.3"), LOOKUPS)!;
        expect(line.ornaments).toEqual([{ at: line.source.indexOf("Alice"), kind: "character", id: "c1" }]);
        // Every character command, whichever slot it names its subject in (`target` vs `character`).
        expect(faces("/move Alice at=right").map(mark => mark.id)).toEqual(["c1"]);
        expect(faces("/face Alice smile").map(mark => mark.id)).toEqual(["c1"]);
        // And nowhere else: a scene, an asset or a variable is not somebody.
        expect(faces("/bg night")).toEqual([]);
        expect(faces("/wait 1.5")).toEqual([]);
    });

    it("puts the face where the renderer will look for it — the start of a coloured part", () => {
        // The way this fails is invisible: an offset landing mid-token simply draws no face, and the
        // row goes on reading correctly without one. So the join is asserted directly, in the command
        // language too — a localized verb moves every offset on the line.
        i18nStore.setLocale("zh");
        const line = projectStoryCommandLine(build("/show Alice at=left"), LOOKUPS)!;
        const parts = storyCommandLineParts(line.source, line.edits);
        const starts = parts.map(part => part.pieces[0]?.start);
        expect(line.source).toContain("显示");
        expect(starts).toContain(line.ornaments[0]?.at);
        expect(line.source.slice(line.ornaments[0]!.at)).toMatch(/^Alice/);
    });

    it("keeps the whole value clickable, unit and all", () => {
        // The affordance fails INVISIBLY — a quick value that stops matching still renders, just as
        // plain text nobody can click. So the grouping is asserted directly: one part, carrying the
        // param, covering both the number and its unit.
        const line = projectStoryCommandLine(build("/hide Alice d=1"), LOOKUPS)!;
        const parts = storyCommandLineParts(line.source, line.edits);
        const editable = parts.filter(part => part.edit);
        // The subject, the transition word and the duration; the duration spans two coloured pieces.
        expect(editable.map(part => part.pieces.map(piece => piece.text).join(""))).toEqual(["Alice", "fade", "1s"]);
        const duration = editable[2];
        expect(duration.edit!.control.kind).toBe("number");
        // Its pieces keep their own roles inside the token: the number reads as a value, the unit
        // recedes with the scaffold.
        expect(duration.pieces.map(piece => piece.role)).toEqual(["value", "scaffold"]);
        // Joining every part back reproduces the line — no piece is dropped by the grouping.
        expect(parts.flatMap(part => part.pieces).map(piece => piece.text).join("")).toBe(line.source);
    });

    it("prints the values alone when the author asked for it, and only the keys go", () => {
        // `editor.hideParamNames`. The row is the only surface that may do this — the live field is a
        // mirror over a textarea — and it is a DISPLAY cut: `line.source` is untouched, which is why
        // the assertions below can compare the two renderings of one projection.
        const line = projectStoryCommandLine(build("/hide Alice d=1"), LOOKUPS)!;
        const text = (hide: boolean) =>
            storyCommandLineParts(line.source, line.edits, hide).flatMap(part => part.pieces).map(piece => piece.text).join("");
        expect(text(false)).toBe("/hide Alice t=fade d=1s");
        // The keys go; the spaces between the tokens, the unit and every value stay.
        expect(text(true)).toBe("/hide Alice fade 1s");
        expect(line.source).toBe("/hide Alice t=fade d=1s");
    });

    it("keeps every value clickable with the keys hidden", () => {
        // The failure this guards is silent: the edit spans are offsets into the FULL source, so a cut
        // that shifted them would leave the row looking right and quietly stop opening its editors.
        const line = projectStoryCommandLine(build("/hide Alice d=1"), LOOKUPS)!;
        const editable = storyCommandLineParts(line.source, line.edits, true).filter(part => part.edit);
        expect(editable.map(part => part.pieces.map(piece => piece.text).join(""))).toEqual(["Alice", "fade", "1s"]);
    });

    it("keeps a bare flag when the keys are hidden — there is no value behind it", () => {
        // A boolean written as `loop=true` loses its key like any other modifier; what must not happen
        // is an arg vanishing outright, which is what dropping a flag's own word would do.
        const line = projectStoryCommandLine(build("/bgm theme loop=true"), LOOKUPS)!;
        const text = storyCommandLineParts(line.source, line.edits, true).flatMap(part => part.pieces).map(piece => piece.text).join("");
        expect(line.source).toContain("loop=true");
        expect(text).toBe("/bgm theme true");
    });

    it("says nothing for a row no command owns", () => {
        // Prose is prose, and a declaration reads as `gold: number = 100` — a shape no line has.
        const narration: StoryBlock = {
            id: "n1", parentId: null, childrenIds: [], kind: "nodeAction",
            payload: { action: "narration", text: { value: "hello", textId: "t1", role: "narration" } },
        };
        expect(projectStoryCommandLine(narration, LOOKUPS)).toBeNull();
        expect(projectStoryCommandLine(build("/local hp 100"), LOOKUPS)).toBeNull();
    });

    /**
     * The other half of the contract: an inline edit writes what the line would have said.
     *
     * Asserted by round trip rather than by poking at payload fields, because that is the property
     * that matters — a writer that patched the wrong field would produce a row whose line no longer
     * says what was just chosen, and it would say so here.
     */
    it("writes an edited value back where the line reads it from", () => {
        // Addressed by the value being changed rather than by position: a row's editable values are
        // whatever it carries, and pinning them to an index would make this test about the order.
        const edited = (source: string, current: string, next: string): string => {
            const block = build(source);
            const line = projectStoryCommandLine(block, LOOKUPS)!;
            const edit = line.edits.find(entry => entry.value === current);
            if (!edit) {
                throw new Error(`${source} has no editable value "${current}" (has ${line.edits.map(e => e.value).join(", ")})`);
            }
            return projectStoryCommandLine({ ...block, payload: edit.apply(next) } as StoryBlock, LOOKUPS)!.source;
        };
        // Enums: the word chosen is the word the row reads back.
        expect(edited("/hide Alice t=fade d=1", "fade", "circle")).toBe("/hide Alice t=circle d=1s");
        expect(edited("/show Alice at=left", "left", "right")).toBe("/show Alice at=right d=0.3s");
        expect(edited("/bg forest_day t=fade", "fade", "blinds")).toBe("/bg forest_day t=blinds");
        // Numbers, in the seconds the line is written in — 2 seconds, not 2 milliseconds.
        expect(edited("/hide Alice d=1", "1", "2.5")).toBe("/hide Alice t=fade d=2.5s");
        expect(edited("/wait 1", "1", "3")).toBe("/wait 3s");
        expect(edited("/camera zoom 2", "2", "1.5")).toBe("/camera zoom 1.5 d=0.6s");
        // Flags and the rest of the vocabulary.
        expect(edited("/bgm theme loop", "true", "false")).toBe("/bgm theme loop=false");
        expect(edited("/bgm theme vol=0.6", "0.6", "0.2")).toBe("/bgm theme vol=0.2");
        expect(edited("/font title color=#ffcc00", "#ffcc00", "#102030")).toBe("/font title color=#102030");
        // A closed list the grammar cannot hold: this character's own looks, written back by id.
        expect(edited("/face Alice smile", "t1", "t2")).toBe("/face Alice angry");
        // The SUBJECT too: which character, which asset, which object on stage.
        expect(edited("/hide Alice", "c1", "c2")).toBe("/hide Doll t=fade d=0.25s");
        expect(edited("/bg forest_day", "i1", "i2")).toBe("/bg night");
        expect(edited("/vol music 0.5", "music", "bgm")).toBe("/vol bgm 0.5 fade=0.25s");
        expect(edited("/goto intro", "intro", "after refusal")).toBe("/goto 'after refusal'");
        // A look belongs to the character that had it, so swapping the character drops it.
        expect(edited("/face Alice smile", "c1", "c2")).toBe("/face Doll");
        // A vignette's own defaults fill the three values before its opacity, so this one is asked
        // for by a number none of them share.
        expect(edited("/vignette opacity=0.45", "0.45", "0.9")).toBe("/vignette d=0.3s hold=0.6s color=#000000 opacity=0.9");
    });

    it("offers exactly the options the grammar declares, and no writer where nothing can be edited", () => {
        const controls = (source: string) => projectStoryCommandLine(build(source), LOOKUPS)!.edits.map(edit => edit.control);
        const transition = controls("/hide Alice t=fade")[1];
        // Not a hand-written list: `/hide`'s own `t=` option set, which is why a spec growing a word
        // grows this menu on the same day.
        expect(transition.kind === "enum" && transition.options.map(option => option.value)).toContain("circle");
        // The name a create row DEFINES is what later rows address, so it is never offered — only its
        // asset is (one `choice`, for `night`; the `name=sky` beside it carries no control).
        const created = projectStoryCommandLine(build("/image night name=sky"), LOOKUPS)!;
        expect(created.edits.filter(edit => edit.control.kind === "choice").map(edit => edit.value)).toEqual(["i2"]);
        // A free-typed label is prose: `/rename`'s new name has no list and no control.
        const renamed = projectStoryCommandLine(build("/rename Alice The Stranger"), LOOKUPS)!;
        expect(renamed.edits.map(edit => edit.value)).toEqual(["c1"]);
    });

    /**
     * The contract: every line below survives block → line → block. A projection that drifts from what
     * the parser accepts fails here rather than in a scene, on an author who cannot see why their row
     * says something they cannot type.
     */
    it("round-trips: what the row prints rebuilds the row", () => {
        for (const source of [
            "/bg forest_day",
            "/bg forest_day t=fade d=0.5",
            "/show Alice",
            "/show Alice at=center d=0.4",
            "/hide Alice t=fade d=1",
            "/move Alice at=left d=0.4",
            "/face Doll smile",
            "/face Alice smile",
            "/show Alice smile at=left",
            "/motion Doll run",
            "/skin Doll winter",
            "/param Doll ParamAngleX 12",
            "/rename Alice The Stranger",
            "/bgm theme vol=0.6 fade=1 loop",
            "/sound hit vol=0.8 track=Ambience",
            "/vol music 0.5 fade=1",
            "/rate music 1.25",
            "/stop music fade=1",
            "/pause music",
            "/resume music",
            "/mute music",
            "/unmute music",
            "/seek clip 12",
            "/image night name=sky at=center",
            "/image night name=sky t=fade d=0.4",
            "/text name=title at=center Chapter One",
            "/swap hero night",
            "/swap title A new title",
            "/font title 24",
            "/font title color=#ffcc00",
            "/video intro name=cutscene muted",
            "/play clip",
            "/layer overlay z=10",
            "/vfx intro name=petals opacity=0.5 d=0.8",
            "/camera zoom 2",
            "/camera pan left",
            "/camera rotate 15 d=0.5",
            "/camera darken 0.4",
            "/camera reset",
            "/blink d=0.2 hold=0.1",
            "/vignette d=0.5 opacity=0.6",
            "/nvl t=fade d=0.4",
            "/wait 1.5",
            "/wait click",
            "/set gold 100",
            "/jump 'Chapter 2' t=fade d=0.6",
            "/goto intro",
            "/label after refusal",
            "/transform hero d=0.5",
            "/hide petals d=0.5",
            "/show title t=fade d=0.2",
        ]) {
            const first = build(source);
            const line = projectStoryCommandLine(first, LOOKUPS);
            expect(line, source).not.toBeNull();
            expect(build(line!.source).payload, `${source} → ${line!.source}`).toEqual(first.payload);
        }
    });

    it("round-trips in Chinese too — the localized line is a line the parser takes", () => {
        i18nStore.setLocale("zh");
        for (const source of ["/hide Alice t=fade d=1", "/bg forest_day t=fade d=0.5", "/camera pan left", "/bgm theme vol=0.6 loop"]) {
            const first = build(source);
            const line = projectStoryCommandLine(first, LOOKUPS);
            expect(build(line!.source).payload, `${source} → ${line!.source}`).toEqual(first.payload);
        }
    });
});
