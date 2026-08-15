/**
 * The round trip: print a scene, parse the script, get the scene back.
 *
 * This is the acceptance test for the parser, and it is deliberately a property rather than a set of
 * golden strings: for every scene in the corpus, `parse(print(scene))` must be the block tree the
 * printer started from, ignoring identity - a parse mints new ids, and matching them back onto a
 * document is the text view's job, not the parser's.
 *
 * The same property is asserted through a second dialect that disagrees with the default about every
 * word, preposition, fence and marker. Passing both is what proves the parser reads the dialect table
 * rather than the default language: one table, walked in two directions.
 */

import { describe, expect, it } from "vitest";

import type {
    StoryBlock,
    StoryBlockId,
    StoryExpression,
    StoryScene,
    StoryTextSegment,
    StoryVariableRef,
} from "@shared/types/story";
import { isValidStoryEntityId } from "@shared/utils/storyId";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";

import { NARRALANG_DEFAULT_DIALECT, type NarralangDialect, type NarralangVerbSyntax } from "./narralangDialect";
import { printNarralangSceneWithDialect, type NarralangLookups } from "./narralangPrinter";
import { parseNarralangSceneWithDialect, type NarralangParseLookups } from "./narralangParse";
import type { NarralangVerb } from "./narralangShape";

// --- Fixtures -----------------------------------------------------------------------------------

function text(value: string, role: StoryTextSegment["role"], rich?: StoryTextSegment["rich"]): StoryTextSegment {
    return rich === undefined ? { textId: `t-${value}`, value, role } : { textId: `t-${value}`, value, role, rich };
}

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

// --- The project the corpus is written against ----------------------------------------------------

const CHARACTERS: Record<string, string> = { "char-alice": "爱丽丝", "char-doll": "人偶" };
const ASSETS: Record<string, string> = {
    "asset-bg": "corridor_dusk",
    "asset-bgm": "evening_theme",
    "asset-voice": "alice_01",
    "asset-door": "door_close",
    "asset-bird": "bird",
    "asset-op": "opening",
    "asset-petals": "petals",
    "asset-mask": "soft_mask",
};
const APPEARANCES: Record<string, { name: string; ref: { kind: "pose"; id: string } | { kind: "tag"; axisId: string; id: string } | { kind: "puppet" } }> = {
    "pose-smile": { name: "smile", ref: { kind: "pose", id: "pose-smile" } },
    "tag-uniform": { name: "uniform", ref: { kind: "tag", axisId: "axis-outfit", id: "tag-uniform" } },
    "tag-happy": { name: "happy", ref: { kind: "tag", axisId: "axis-mood", id: "tag-happy" } },
};
const MOTIONS: Record<string, string> = { "anim-shake": "handheld shake" };
const APP_TAGS: Record<string, string> = { "tag-demo": "Demo" };
const SCENES: Record<string, string> = { "scene-2": "天台 · 夜" };

const lookups: NarralangLookups = {
    character: (id) => (CHARACTERS[id] ? { name: CHARACTERS[id] } : null),
    assetName: (id) => ASSETS[id] ?? null,
    appearanceName: (_characterId, refId) => APPEARANCES[refId]?.name ?? null,
    motionName: (id) => MOTIONS[id] ?? null,
    appTagName: (id) => APP_TAGS[id] ?? null,
};

const byName = <T,>(table: Record<string, T>, pick: (entry: T) => string) => (name: string): string | null =>
    Object.entries(table).find(([, entry]) => pick(entry) === name)?.[0] ?? null;

const parseLookups: NarralangParseLookups = {
    characterId: byName(CHARACTERS, (value) => value),
    assetId: byName(ASSETS, (value) => value),
    motionId: byName(MOTIONS, (value) => value),
    appTagId: byName(APP_TAGS, (value) => value),
    sceneId: byName(SCENES, (value) => value),
    appearanceRef: (_characterId, name) => {
        // A puppet's state name is owned by the model, so anything the project cannot name is one.
        const found = Object.values(APPEARANCES).find((entry) => entry.name === name);
        return found ? found.ref : { kind: "puppet" };
    },
};

/** The scope the corpus's expressions are parsed under - the one the parser rebuilds from the text. */
function scopeFor(variables: readonly { name: string; ref: StoryVariableRef }[]) {
    return createStoryExpressionScope(variables);
}

function expr(source: string, variables: readonly { name: string; ref: StoryVariableRef }[] = []): StoryExpression {
    return parseStoryExpression(source, scopeFor(variables)).expression;
}

// --- A dialect that disagrees about everything -----------------------------------------------------

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

// --- Canonical form ---------------------------------------------------------------------------------

type CanonBlock = { kind: string; disabled?: true; payload: unknown; children: CanonBlock[] };

/**
 * A block tree with identity taken out.
 *
 * Every id minted inside the scene - block ids, the storage key a declaration takes from its own row,
 * the `sourceBlockId` a stage reference binds to, the `variableId` a ref carries - becomes the block's
 * position in the tree, so two trees agree exactly when they say the same thing about the same rows.
 * Ids that come from OUTSIDE (a character, an asset, a scene) are compared as they are: those the
 * parser had to resolve, and getting one wrong must fail.
 *
 * `textId` is dropped rather than relabelled: it names a segment, and a script does not carry it.
 */
function canonicalize(rootIds: readonly StoryBlockId[], blocks: Record<StoryBlockId, StoryBlock>): CanonBlock[] {
    const labels = new Map<string, string>();
    let next = 0;
    const label = (ids: readonly StoryBlockId[]): void => {
        for (const id of ids) {
            labels.set(id, `#${next}`);
            next += 1;
            label(blocks[id]?.childrenIds ?? []);
        }
    };
    label(rootIds);

    const map = (value: unknown): unknown => {
        if (typeof value === "string") {
            return labels.get(value) ?? value;
        }
        if (Array.isArray(value)) {
            return value.map(map);
        }
        if (value && typeof value === "object") {
            const out: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(value)) {
                if (key === "textId" || entry === undefined) {
                    continue;
                }
                out[key] = map(entry);
            }
            return out;
        }
        return value;
    };

    const walk = (ids: readonly StoryBlockId[]): CanonBlock[] =>
        ids.flatMap((id) => {
            const block = blocks[id];
            if (!block) {
                return [];
            }
            const canon: CanonBlock = {
                kind: block.kind,
                payload: map(block.payload),
                children: walk(block.childrenIds),
            };
            return [block.disabled ? { ...canon, disabled: true as const } : canon];
        });
    return walk(rootIds);
}

/** Print, parse, and demand the same tree back. Returns the script, so a failure can be read. */
function roundTrip(fixture: StoryScene, dialect: NarralangDialect): string {
    // The fixture is in `scenes` too: a persistent variable's name is resolved by scanning every
    // scene's declaration rows, so a scene missing from the table cannot name its own variables.
    const printed = printNarralangSceneWithDialect(fixture, { ...lookups, scenes: { ...SCENE_TABLE, "scene-1": fixture } }, dialect);
    expect(printed.issues).toEqual([]);
    const parsed = parseNarralangSceneWithDialect(printed.text, parseLookups, dialect);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.name).toBe(fixture.name);
    expect(canonicalize(parsed.rootBlockIds, parsed.blocks)).toEqual(canonicalize(fixture.rootBlockIds, fixture.blocks));
    for (const id of Object.keys(parsed.blocks)) {
        expect(isValidStoryEntityId(id)).toBe(true);
    }
    return printed.text;
}

const SCENE_TABLE: Record<string, StoryScene> = {
    "scene-2": { id: "scene-2", name: "天台 · 夜", runtimeName: "rooftop", rootBlockIds: [], blocks: {} },
};

// --- The corpus ---------------------------------------------------------------------------------------

const TRUST: StoryVariableRef = { scope: "scene", variableId: "b-var" };
const VARIABLES = [{ name: "trust", ref: TRUST }];

const corpus: Record<string, StoryScene> = {
    "prose, characters and a menu": scene([
        { id: "b1", kind: "action", payload: { action: "setBackground", assetId: "asset-bg", transition: { kind: "dissolve", durationMs: 500 } } },
        { id: "b2", kind: "nodeAction", payload: { action: "narration", text: text("夕阳把走廊染成橘色。", "narration") } },
        { id: "b3", kind: "action", payload: { action: "character", operation: "enter", characterId: "char-alice", pose: "pose-smile", transform: { preset: "left", durationMs: 300 } } },
        { id: "b4", kind: "nodeAction", payload: { action: "dialogue", characterId: "char-alice", text: text("你也留到这么晚啊。", "dialogue") } },
        { id: "b5", kind: "nodeAction", payload: { action: "dialogue", speakerName: "？？？", text: text("听着: 别回头。", "dialogue"), voiceAssetId: "asset-voice", pauseAfter: true } },
        { id: "b-var", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "b-var" } },
        { id: "b6", kind: "nodeAction", payload: { action: "choice", prompt: text("要说点什么吗？", "choicePrompt") }, children: ["b7", "b9"] },
        { id: "b7", kind: "nodeAction", payload: { action: "choiceOption", text: text("「其实我在等你。」", "choiceText") }, children: ["b8"] },
        { id: "b8", kind: "action", payload: { action: "setVariable", target: TRUST, value: null, expression: expr("trust + 1", VARIABLES) } },
        {
            id: "b9",
            kind: "nodeAction",
            payload: {
                action: "choiceOption",
                text: text("「只是忘了时间。」", "choiceText"),
                hiddenWhen: { kind: "expression", expression: expr("trust > 0", VARIABLES) },
                disabledWhen: { kind: "expression", expression: expr("trust < 3", VARIABLES) },
            },
        },
        { id: "b10", kind: "note", payload: { text: text("这里以后要补一段回忆闪回", "note") } },
        { id: "b11", kind: "action", payload: { action: "character", operation: "exit", characterId: "char-alice", transform: { preset: "fadeOut", durationMs: 300 } } },
    ] as never),

    "characters, every channel": scene([
        { id: "c1", kind: "action", payload: { action: "character", operation: "enter", characterId: "char-alice", tags: { "axis-outfit": "tag-uniform", "axis-mood": "tag-happy" }, transform: { preset: "left" }, transition: { kind: "fadeIn", durationMs: 300 } } },
        { id: "c2", kind: "action", payload: { action: "character", operation: "move", characterId: "char-alice", transform: { preset: "center", durationMs: 400, easing: "easeInOut" } } },
        { id: "c3", kind: "action", payload: { action: "character", operation: "expression", characterId: "char-alice", pose: "pose-smile" } },
        { id: "c4", kind: "action", payload: { action: "character", operation: "setName", characterId: "char-alice", displayName: "神秘的少女" } },
        { id: "c5", kind: "action", payload: { action: "character", operation: "setMotion", characterId: "char-doll", puppetName: "idle" } },
        { id: "c6", kind: "action", payload: { action: "character", operation: "setSkin", characterId: "char-doll", puppetName: "winter" } },
        { id: "c7", kind: "action", payload: { action: "character", operation: "setParams", characterId: "char-doll", params: { ParamAngleX: 12, ParamAngleY: -4 } } },
        // A placement fills the transform, so `with` here can only be the row's own transition - which is
        // what makes this line the one reading the builder accepts.
        { id: "c8", kind: "action", payload: { action: "character", operation: "exit", characterId: "char-alice", transform: { preset: "center" }, transition: { kind: "maskCircle", durationMs: 600 } } },
    ] as never),

    "audio, every verb": scene([
        { id: "a1", kind: "action", payload: { action: "audio", operation: "setBgm", assetId: "asset-bgm", volume: 0.7, fadeMs: 1500, loop: true, rate: 1.2 } },
        { id: "a2", kind: "action", payload: { action: "audio", operation: "playSound", assetId: "asset-door", objectName: "door" } },
        { id: "a3", kind: "action", payload: { action: "audio", operation: "setVolume", objectName: "door", volume: 0.3, fadeMs: 1000 } },
        { id: "a4", kind: "action", payload: { action: "audio", operation: "setRate", objectName: "door", rate: 1.5 } },
        { id: "a5", kind: "action", payload: { action: "audio", operation: "pauseSound", objectName: "door", fadeMs: 500 } },
        { id: "a6", kind: "action", payload: { action: "audio", operation: "resumeSound", objectName: "door", fadeMs: 500 } },
        { id: "a7", kind: "action", payload: { action: "audio", operation: "muteSound", objectName: "door", muted: true } },
        { id: "a8", kind: "action", payload: { action: "audio", operation: "muteSound", objectName: "door", muted: false } },
        { id: "a9", kind: "action", payload: { action: "audio", operation: "seekSound", objectName: "door", timeMs: 12000 } },
        { id: "a10", kind: "action", payload: { action: "audio", operation: "stopSound", objectName: "door", fadeMs: 500 } },
        { id: "a11", kind: "action", payload: { action: "audio", operation: "stopSound", fadeMs: 500 } },
    ] as never),

    "stage objects": scene([
        { id: "s1", kind: "action", payload: { action: "layer", operation: "create", objectName: "sky", zIndex: 5 } },
        { id: "s2", kind: "action", payload: { action: "image", operation: "create", objectName: "bird", assetId: "asset-bird", layer: { kind: "custom", sourceBlockId: "s1", name: "sky" }, autoFit: true, transform: { preset: "right" } } },
        { id: "s3", kind: "action", payload: { action: "image", operation: "setSource", objectName: "bird", color: "#101018" } },
        { id: "s4", kind: "action", payload: { action: "image", operation: "show", objectName: "bird", transform: { preset: "left", durationMs: 500 }, transition: { kind: "fadeIn", durationMs: 300 } } },
        { id: "s5", kind: "action", payload: { action: "image", operation: "hide", objectName: "bird", transform: { preset: "fadeOut", durationMs: 300 } } },
        { id: "s6", kind: "action", payload: { action: "text", operation: "create", objectName: "title", text: "第一章", layer: { kind: "default", layer: "background" }, transform: { preset: "center" } } },
        { id: "s7", kind: "action", payload: { action: "text", operation: "setText", objectName: "title", text: "第二章" } },
        { id: "s8", kind: "action", payload: { action: "text", operation: "setFontSize", objectName: "title", fontSize: 32 } },
        { id: "s9", kind: "action", payload: { action: "text", operation: "setFontColor", objectName: "title", fontColor: "#ffffff" } },
        { id: "s10", kind: "action", payload: { action: "text", operation: "show", objectName: "title", transform: { preset: "fadeIn", durationMs: 200 } } },
        { id: "s11", kind: "action", payload: { action: "text", operation: "hide", objectName: "title" } },
        { id: "s12", kind: "action", payload: { action: "layer", operation: "setZIndex", objectName: "sky", target: { kind: "custom", sourceBlockId: "s1", name: "sky" }, zIndex: 7 } },
        { id: "s13", kind: "action", payload: { action: "layer", operation: "transform", objectName: "sky", target: { kind: "custom", sourceBlockId: "s1", name: "sky" }, transform: { preset: "left", durationMs: 400 } } },
        { id: "s14", kind: "action", payload: { action: "video", operation: "create", objectName: "op", assetId: "asset-op", muted: true } },
        { id: "s15", kind: "action", payload: { action: "video", operation: "seek", objectName: "op", timeMs: 3000 } },
        { id: "s16", kind: "action", payload: { action: "video", operation: "play", objectName: "op" } },
        { id: "s17", kind: "action", payload: { action: "video", operation: "pause", objectName: "op" } },
        { id: "s18", kind: "action", payload: { action: "video", operation: "resume", objectName: "op" } },
        { id: "s19", kind: "action", payload: { action: "video", operation: "stop", objectName: "op" } },
        { id: "s20", kind: "action", payload: { action: "vfx", operation: "create", objectName: "petals", assetId: "asset-petals", blendMode: "screen", opacity: 0.6, fit: "cover", zIndex: 3, rate: 0.5, loop: false } },
        { id: "s21", kind: "action", payload: { action: "vfx", operation: "setRate", objectName: "petals", rate: 2 } },
        { id: "s22", kind: "action", payload: { action: "vfx", operation: "show", objectName: "petals", durationMs: 500 } },
        { id: "s23", kind: "action", payload: { action: "vfx", operation: "hide", objectName: "petals", durationMs: 500 } },
        { id: "s24", kind: "action", payload: { action: "vfx", operation: "pause", objectName: "petals" } },
        { id: "s25", kind: "action", payload: { action: "vfx", operation: "resume", objectName: "petals" } },
    ] as never),

    "the raw effect channel": scene([
        { id: "d1", kind: "action", payload: { action: "image", operation: "create", objectName: "bird", assetId: "asset-bird" } },
        { id: "d2", kind: "action", payload: { action: "displayable", operation: "transform", target: { kind: "image", name: "bird", sourceBlockId: "d1" }, transform: { preset: "right", durationMs: 500 } } },
        { id: "d3", kind: "action", payload: { action: "displayable", operation: "mask", target: { kind: "image", name: "bird", sourceBlockId: "d1" }, maskAssetId: "asset-mask", durationMs: 400 } },
        { id: "d4", kind: "action", payload: { action: "displayable", operation: "clearMask", target: { kind: "image", name: "bird", sourceBlockId: "d1" } } },
        { id: "d5", kind: "action", payload: { action: "displayable", operation: "clip", target: { kind: "image", name: "bird", sourceBlockId: "d1" }, clipPath: "circle(40%)" } },
        { id: "d6", kind: "action", payload: { action: "displayable", operation: "clearClip", target: { kind: "image", name: "bird", sourceBlockId: "d1" } } },
        { id: "d7", kind: "action", payload: { action: "displayable", operation: "filter", target: { kind: "image", name: "bird", sourceBlockId: "d1" }, filter: "blur(4px)", durationMs: 300, easing: "linear" } },
        { id: "d8", kind: "action", payload: { action: "displayable", operation: "clearFilter", target: { kind: "image", name: "bird", sourceBlockId: "d1" } } },
        { id: "d9", kind: "action", payload: { action: "displayable", operation: "backdrop", target: { builtin: "background", name: "Scene background", kind: "image" }, backdropFilter: "blur(8px)" } },
        { id: "d10", kind: "action", payload: { action: "displayable", operation: "blend", target: { builtin: "background", name: "Scene background", kind: "image" }, mixBlendMode: "multiply" } },
        { id: "d11", kind: "action", payload: { action: "displayable", operation: "darken", target: { kind: "image", name: "bird", sourceBlockId: "d1" }, darkness: 0.5 } },
        { id: "d12", kind: "action", payload: { action: "displayable", operation: "circleReveal", target: { kind: "image", name: "bird", sourceBlockId: "d1" }, durationMs: 600 } },
        { id: "d13", kind: "action", payload: { action: "displayable", operation: "circleClose", target: { kind: "image", name: "bird", sourceBlockId: "d1" } } },
        { id: "d14", kind: "action", payload: { action: "displayable", operation: "wipe", target: { kind: "image", name: "bird", sourceBlockId: "d1" } } },
        { id: "d15", kind: "action", payload: { action: "displayable", operation: "show", target: { builtin: "background", name: "Scene background", kind: "image" }, transform: { preset: "fadeIn", durationMs: 300 } } },
        { id: "d16", kind: "action", payload: { action: "displayable", operation: "hide", target: { builtin: "background", name: "Scene background", kind: "image" } } },
    ] as never),

    "camera, screen and scene verbs": scene([
        { id: "e1", kind: "action", payload: { action: "camera", operation: "pan", position: { xalign: 0.25, yalign: 0.5 }, durationMs: 800 } },
        { id: "e2", kind: "action", payload: { action: "camera", operation: "zoom", zoom: 1.4, durationMs: 1200 } },
        { id: "e3", kind: "action", payload: { action: "camera", operation: "rotate", rotation: 15 } },
        { id: "e4", kind: "action", payload: { action: "camera", operation: "darken", darkness: 0.4, durationMs: 500, easing: "easeIn" } },
        { id: "e5", kind: "action", payload: { action: "camera", operation: "reset", durationMs: 300 } },
        { id: "e6", kind: "action", payload: { action: "camera", operation: "motion", motion: { mode: "animation", animationId: "anim-shake" } } },
        { id: "e7", kind: "action", payload: { action: "screenEffect", effect: "blink", durationMs: 200, holdMs: 100, color: "#ffffff", opacity: 0.8, easing: "linear" } },
        { id: "e8", kind: "action", payload: { action: "screenEffect", effect: "vignette", durationMs: 1000, opacity: 0.6 } },
        { id: "e9", kind: "action", payload: { action: "nvl", transition: { preset: "fadeIn", durationMs: 400 } } },
        { id: "e10", kind: "action", payload: { action: "wait", mode: "duration", durationMs: 1500 } },
        { id: "e11", kind: "action", payload: { action: "wait", mode: "click" } },
        { id: "e12", kind: "action", payload: { action: "setBackground", color: "#101018" } },
        { id: "e13", kind: "jump", payload: { targetSceneId: "scene-2", transition: { kind: "dissolve", durationMs: 600 } } },
    ] as never),

    "control flow": scene([
        { id: "f-var", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "f-var" } },
        { id: "f1", kind: "control", payload: { control: "condition" }, children: ["f2", "f4", "f6"] },
        { id: "f2", kind: "control", payload: { control: "conditionBranch", branch: "if", condition: { kind: "expression", expression: expr("trust > 0", [{ name: "trust", ref: { scope: "scene", variableId: "f-var" } }]) } }, children: ["f3"] },
        { id: "f3", kind: "nodeAction", payload: { action: "narration", text: text("那……一起走？", "narration") } },
        { id: "f4", kind: "control", payload: { control: "conditionBranch", branch: "elseIf", condition: { kind: "expression", expression: expr("trust == 0", [{ name: "trust", ref: { scope: "scene", variableId: "f-var" } }]) } }, children: ["f5"] },
        { id: "f5", kind: "nodeAction", payload: { action: "narration", text: text("……", "narration") } },
        { id: "f6", kind: "control", payload: { control: "conditionBranch", branch: "else" }, children: ["f7"] },
        { id: "f7", kind: "nodeAction", payload: { action: "narration", text: text("那我先走了。", "narration") } },
        { id: "f8", kind: "control", payload: { control: "repeat", times: 3 }, children: ["f9"] },
        { id: "f9", kind: "control", payload: { control: "break" } },
        { id: "f10", kind: "control", payload: { control: "repeat", until: { kind: "expression", expression: expr("trust >= 10", [{ name: "trust", ref: { scope: "scene", variableId: "f-var" } }]) } }, children: ["f11"] },
        { id: "f11", kind: "action", payload: { action: "wait", mode: "click" } },
        { id: "f12", kind: "control", payload: { control: "parallel", mode: "allAsync" }, children: ["f13"] },
        { id: "f13", kind: "control", payload: { control: "sequence" }, children: ["f14"] },
        { id: "f14", kind: "control", payload: { control: "race" }, children: ["f15"] },
        { id: "f15", kind: "control", payload: { control: "label", name: "after refusal" } },
        { id: "f16", kind: "control", payload: { control: "goto", targetLabel: "after refusal" } },
        { id: "f17", kind: "control", payload: { control: "cut", appTagId: "tag-demo" } },
    ] as never),

    "declarations and data": scene([
        { id: "g1", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "g1" } },
        { id: "g2", kind: "declaration", payload: { scope: "saved", name: "met", valueType: "boolean", defaultValue: false, storageKey: "g2", description: "她对我的信任" } },
        { id: "g3", kind: "declaration", payload: { scope: "persistent", name: "player name", valueType: "string", defaultValue: "旅人", storageKey: "g3" } },
        { id: "g4", kind: "action", payload: { action: "setVariable", target: { scope: "scene", variableId: "g1" }, value: 100 } },
        { id: "g5", kind: "action", payload: { action: "setVariable", target: { scope: "saved", variableId: "g2" }, value: true } },
        { id: "g6", kind: "action", payload: { action: "setVariable", target: { scope: "persistent", variableId: "g3" }, value: "爱丽丝" } },
        {
            id: "g7",
            kind: "action",
            payload: {
                action: "setVariable",
                target: { scope: "scene", variableId: "g1" },
                value: null,
                expression: expr("trust + 1", [{ name: "trust", ref: { scope: "scene", variableId: "g1" } }]),
            },
        },
    ] as never),

    "rich text and escaping": scene([
        { id: "h-var", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "h-var" } },
        {
            id: "h1",
            kind: "nodeAction",
            payload: {
                action: "narration",
                text: text("重要，还有", "narration", [
                    { text: "重要", marks: { bold: true, italic: true, color: "#ff8080" } },
                    { pause: 400 },
                    { interpolation: { kind: "variable", target: { scope: "scene", variableId: "h-var" } } },
                    { text: "，还有", marks: { ruby: "かのじょ", cps: 8, fontSize: 32 } },
                    { pause: true },
                    { interpolation: { kind: "expression", expression: expr("trust + 1", [{ name: "trust", ref: { scope: "scene", variableId: "h-var" } }]) }, marks: { italic: true } },
                ]),
            },
        },
        { id: "h2", kind: "nodeAction", payload: { action: "narration", text: text("show me the money", "narration") } },
        { id: "h3", kind: "nodeAction", payload: { action: "narration", text: text("他说: 你好，她说: 再见", "narration") } },
        { id: "h4", kind: "nodeAction", payload: { action: "narration", text: text("# not a note", "narration") } },
        { id: "h5", kind: "nodeAction", payload: { action: "narration", text: text("大括号 {1} 与反斜杠 \\ 都在", "narration") } },
        { id: "h6", kind: "nodeAction", payload: { action: "narration", text: text(" 缩进过的一行 ", "narration") } },
        { id: "h7", kind: "note", payload: { text: text("注释里也有: 冒号", "note") } },
        {
            id: "h10",
            kind: "nodeAction",
            payload: {
                action: "narration",
                // A colour function and a ruby reading both hold spaces, which is what tore the tag
                // open before the argument learned to quote itself.
                text: text("彼女", "narration", [
                    { text: "彼女", marks: { color: "rgb(56, 189, 248)", ruby: "かの じょ" } },
                ]),
            },
        },
        { id: "h8", kind: "nodeAction", payload: { action: "choice" }, children: ["h9", "h11"] },
        { id: "h9", kind: "nodeAction", payload: { action: "choiceOption", text: text("问她:", "choiceText") } },
        // An option whose text opens with a keyword: prose, and it has to still be prose after a trip
        // through the printer.
        { id: "h11", kind: "nodeAction", payload: { action: "choiceOption", text: text("show me the money", "choiceText") } },
    ] as never),

    // Two escaping/printing gaps found on a real project, both of the same family: a value the
    // printer wrote verbatim that the reader could not take back.
    "prose ending in the speaker separator, and a json default": scene([
        // `他说:` printed bare and read back as a speaker with nothing to say - the separator escape
        // matched "separator + space" and a line merely ENDING in one slipped through.
        { id: "j1", kind: "nodeAction", payload: { action: "narration", text: text("他说:", "narration") } },
        { id: "j2", kind: "nodeAction", payload: { action: "narration", text: text("他说: 你好，她说: 再见", "narration") } },
        // `String(value)` on an object is `[object Object]` - not a value, not reversible, not readable.
        { id: "j3", kind: "declaration", payload: { scope: "scene", name: "inv", valueType: "json", defaultValue: [1, 2], storageKey: "j3" } },
        { id: "j4", kind: "declaration", payload: { scope: "scene", name: "flags", valueType: "json", defaultValue: { a: true }, storageKey: "j4" } },
    ] as never),

    "disabled rows and an invalid one": scene([
        { id: "i1", kind: "action", payload: { action: "wait", mode: "duration", durationMs: 1500 }, disabled: true },
        { id: "i2", kind: "nodeAction", payload: { action: "narration", text: text("这一行被关掉了", "narration") }, disabled: true },
        { id: "i3", kind: "nodeAction", payload: { action: "choice", prompt: text("要说点什么吗？", "choicePrompt") }, disabled: true, children: ["i4"] },
        { id: "i4", kind: "nodeAction", payload: { action: "choiceOption", text: text("「说吧。」", "choiceText") } },
    ] as never),
};

// --- The property ---------------------------------------------------------------------------------------

describe("print then parse", () => {
    for (const [name, fixture] of Object.entries(corpus)) {
        it(`gives back the same blocks: ${name}`, () => {
            roundTrip(fixture, NARRALANG_DEFAULT_DIALECT);
        });

        // The same property through a table that disagrees about every word, preposition, fence and
        // marker. One table, walked in two directions.
        it(`gives back the same blocks in a swapped dialect: ${name}`, () => {
            roundTrip(fixture, SHOUTED);
        });
    }
});

describe("print, parse, print", () => {
    // The weaker property, asserted on the same corpus: whatever the parse decided, printing it again
    // must produce the script it came from. It holds for rows whose payload identity cannot survive
    // the trip (a plain run split in two, a `value` a script never carries), which is why it is worth
    // asserting separately.
    for (const [name, fixture] of Object.entries(corpus)) {
        it(`is idempotent: ${name}`, () => {
            const first = printNarralangSceneWithDialect(
                fixture,
                { ...lookups, scenes: { ...SCENE_TABLE, "scene-1": fixture } },
                NARRALANG_DEFAULT_DIALECT,
            ).text;
            const parsed = parseNarralangSceneWithDialect(first, parseLookups, NARRALANG_DEFAULT_DIALECT);
            // The reparsed scene is what the second print reads its own names out of - a persistent
            // variable is named by scanning the scenes it is declared in, and those rows are new.
            const reparsed = { ...fixture, rootBlockIds: parsed.rootBlockIds, blocks: parsed.blocks };
            const again = printNarralangSceneWithDialect(
                reparsed,
                { ...lookups, scenes: { ...SCENE_TABLE, "scene-1": reparsed } },
                NARRALANG_DEFAULT_DIALECT,
            );
            expect(again.text).toBe(first);
            expect(again.issues).toEqual([]);
        });
    }
});
