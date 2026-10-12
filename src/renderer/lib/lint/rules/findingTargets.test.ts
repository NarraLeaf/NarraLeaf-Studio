import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import type { AssetSet } from "@shared/types/assetSet";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import { setActiveProjectFonts } from "@shared/typography/projectFonts";
import type { FontCoverage } from "@shared/typography/fontCoverage";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
    BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LIST,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryAnimationAsset, type StoryDocument, type StoryScene } from "@shared/types/story";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION, type LocalizationUnit } from "@shared/types/localization";
import { VOICE_DOCUMENT_SCHEMA_VERSION, type VoiceUnit } from "@shared/types/voice";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { NETWORK_POLICY_ALLOWLIST } from "@shared/types/networkAllowlist";
import type { SaveSchemaField } from "@shared/types/saveSchema";
import { hashSourceText } from "@shared/utils/localizationText";
import { EMPTY_STORY_EXPRESSION_SCOPE, parseStoryExpression } from "@shared/utils/storyExpressionParser";
import { AssetType } from "../../workspace/services/assets/assetTypes";
import {
    buildReferenceIndex,
    extractCharacterAssetReferences,
    extractProjectFontReferences,
    extractStoryAnimationAssetReferences,
    extractUIDocumentAssetReferences,
    extractVoiceAssetReferences,
    scanStoryAssetReferences,
    type ReferenceIndexGap,
} from "../../workspace/services/references/referenceModel";
import { createBlueprintFnRef } from "../../workspace/services/ui-editor/blueprint/fnCatalog";
import { ownerRefToIndexKey, surfaceMainOwnerKey, widgetMainOwnerKey } from "../../workspace/services/ui-editor/blueprint/ownerKeys";
import { widgetModuleRegistry } from "../../ui-editor/widget-modules/registryInstance";
import { resolveRuleOptions } from "../engine";
import type { LintAssetEntry, LintContext, LintStoryEntry } from "../context";
import { createTestLintContext } from "../testContext";
import type { LintFinding, LintRuleOptions, RegisteredLintRuleId } from "../types";
import { LINT_RULES } from "./index";
import { dialogueBlock, narrationBlock, sceneOf, singleSceneStories, storyEntryOf, textSegment } from "./text/testFixtures";

/**
 * Every finding opens the place it is about.
 *
 * A project check finding is a row the author clicks, and what the click does is the finding's
 * `target`. A rule that forgets one ships a row that does nothing; a rule that sets one too coarse
 * ships a row that opens a page and leaves the author to find the widget on it. Neither fails any
 * rule's own tests, because those ask about what the rule found, not about where it sends anyone.
 *
 * So every registered rule is run here against a fixture that makes it fire, and every finding is
 * held to two things: it has a target, and where the location names a widget or a row, the target
 * selects that same widget or row. The fixtures are a `Record` over the rule ids, so a rule added
 * without one does not compile - which is the point: the next rule cannot ship without a jump.
 *
 * {@link NOWHERE_TO_GO} lists the findings that genuinely have no place to open, each with why. Every
 * entry must be met by some fixture, so an entry that stops being needed is noticed and removed.
 * Known and not exercised here, for the same reason they have no target: a gap for a plugin's data
 * that would not load (no plugin has a place to open), a blueprint no owner record claims (no editor
 * reaches it), and a binding or a colour on a widget no page and no component holds (drawn nowhere).
 */

// --- What may have nowhere to go --------------------------------------------------------------------

/** The slices of the reference index that are whole kinds of document rather than one place. */
const WHOLE_SLICE_LOCATIONS: ReadonlySet<string> = new Set(["Blueprints", "Interface", "Characters", "Plugins"]);

const NOWHERE_TO_GO: readonly { id: string; why: string; matches: (finding: LintFinding) => boolean }[] = [
    {
        id: "index-not-built",
        // The reference index never finished building: it describes no part of the project, so the
        // finding is about the whole of it and names no place.
        why: "an index that never built is not anywhere",
        matches: finding => finding.ruleId === "assets/unused"
            && finding.messageKey === "lint.rule.assetsUnused.messageIndexNotBuilt",
    },
    {
        id: "slice-failed",
        // A whole slice of the index threw - every blueprint, the whole interface. The finding says
        // which kind of document; no one editor holds all of it.
        why: "a whole kind of document is not one place",
        matches: finding => finding.ruleId === "assets/unused"
            && finding.messageKey === "lint.rule.assetsUnused.messageIndexUnreadable"
            && WHOLE_SLICE_LOCATIONS.has(String(finding.messageParams?.location)),
    },
    {
        id: "dangling-id-without-site",
        // An id the index lists with no site using it. The index never stores one (a key exists
        // only because a site put it there); the branch is defensive, and the id is all it has.
        why: "a reference with no site names no place",
        matches: finding => finding.ruleId === "assets/missing" && finding.location.kind === "project",
    },
    {
        id: "colour-on-a-widget-nothing-draws",
        // A widget in the element pool that no page reaches and no parent leads to a page from: it is
        // drawn nowhere and no editor shows it.
        why: "an element no page holds has no editor",
        matches: finding => finding.ruleId === "brand/broken-link" && finding.location.kind === "project",
    },
];

// --- Shared builders -----------------------------------------------------------------------------

type BlockSpec = { id: string; kind: string; payload: unknown; disabled?: boolean; children?: BlockSpec[] };

function scene(id: string, name: string, specs: BlockSpec[], extra: Record<string, unknown> = {}): StoryScene {
    const blocks: Record<string, unknown> = {};
    const walk = (spec: BlockSpec, parentId: string | null): string => {
        const childrenIds = (spec.children ?? []).map(child => walk(child, spec.id));
        blocks[spec.id] = {
            id: spec.id,
            kind: spec.kind,
            parentId,
            childrenIds,
            payload: spec.payload,
            ...(spec.disabled ? { disabled: true } : {}),
        };
        return spec.id;
    };
    const rootBlockIds = specs.map(spec => walk(spec, null));
    return { id, name, runtimeName: name, rootBlockIds, blocks, ...extra } as unknown as StoryScene;
}

function story(
    id: string,
    name: string,
    scenes: StoryScene[],
    options: { entrySceneId?: string; dlcId?: string } = {},
): LintStoryEntry {
    const document = {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id,
        name,
        chapters: [{ id: `${id}-ch`, name: "Chapter", sceneIds: scenes.map(entry => entry.id) }],
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
        ...(options.entrySceneId ? { entrySceneId: options.entrySceneId } : {}),
    } as StoryDocument;
    return { id, name, document, ...(options.dlcId ? { dlcId: options.dlcId } : {}) };
}

const stories = (...entries: LintStoryEntry[]) => createTestLintContext({ stories: entries });

const narration = (id: string, value = "line"): BlockSpec => ({
    id,
    kind: "nodeAction",
    payload: { action: "narration", text: { textId: `text-${id}`, value, role: "narration" } },
});
const label = (id: string, name: string): BlockSpec => ({ id, kind: "control", payload: { control: "label", name } });
const goto = (id: string, targetLabel: string): BlockSpec => ({ id, kind: "control", payload: { control: "goto", targetLabel } });
const jump = (id: string, targetSceneId: string): BlockSpec => ({ id, kind: "jump", payload: { targetSceneId } });
const call = (id: string, targetSceneId: string): BlockSpec => ({ id, kind: "jump", payload: { targetSceneId, returnable: true } });
const ending = (id: string, name: string): BlockSpec => ({ id, kind: "control", payload: { control: "ending", name } });
const cut = (id: string): BlockSpec => ({ id, kind: "control", payload: { control: "cut", appTagId: "t-demo" } });
const action = (id: string, payload: Record<string, unknown>): BlockSpec => ({ id, kind: "action", payload });
const condition = (id: string, branches: BlockSpec[]): BlockSpec => ({ id, kind: "control", payload: { control: "condition" }, children: branches });
const branch = (id: string, arm: "if" | "else", children: BlockSpec[], payload: Record<string, unknown> = {}): BlockSpec => ({
    id,
    kind: "control",
    payload: { control: "conditionBranch", branch: arm, ...payload },
    children,
});
const declaration = (id: string, scope: "scene" | "saved" | "persistent", name: string, extra: Record<string, unknown> = {}): BlockSpec => ({
    id,
    kind: "declaration",
    payload: { scope, name, valueType: "number", storageKey: id, ...extra },
});
const expression = (source: string) => parseStoryExpression(source, EMPTY_STORY_EXPRESSION_SCOPE).expression;

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
    return { parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 10, height: 10 }, ...input } as UIElement;
}

function uiDocument(input: {
    surfaces: { id: string; name: string; kind?: "appSurface" | "stageSurface"; rootElementId: string; actions?: unknown }[];
    elements: UIElement[];
    components?: unknown[];
    extra?: Record<string, unknown>;
}): UIDocument {
    return {
        surfaces: input.surfaces.map(surface => ({ kind: "appSurface", ...surface })),
        elements: Object.fromEntries(input.elements.map(entry => [entry.id, entry])),
        ...(input.components ? { components: input.components } : {}),
        ...input.extra,
    } as unknown as UIDocument;
}

/** One page, "Title", whose root holds the given children. */
function onePage(...children: UIElement[]): UIDocument {
    return uiDocument({
        surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Title", rootElementId: "root" }],
        elements: [
            element({ id: "root", type: "nl.root", childrenIds: children.map(child => child.id) }),
            ...children.map(child => ({ ...child, parentId: child.parentId ?? "root" })),
        ],
    });
}

/** A component definition holding the given elements under its root. */
function component(id: string, name: string, children: UIElement[], params?: unknown[]) {
    return {
        id,
        name,
        rootElementId: `${id}-root`,
        ...(params ? { params } : {}),
        elements: Object.fromEntries([
            element({ id: `${id}-root`, type: "nl.container", childrenIds: children.map(child => child.id) }),
            ...children.map(child => ({ ...child, parentId: child.parentId ?? `${id}-root` })),
        ].map(entry => [entry.id, entry])),
    };
}

/** Owner key -> the one event graph that owner's blueprint holds. */
function blueprints(owners: Record<string, Record<string, BlueprintGraphIr>>): BlueprintDocument {
    const ownerRecords: Record<string, unknown> = {};
    const docs: Record<string, unknown> = {};
    Object.entries(owners).forEach(([ownerKey, events], index) => {
        const id = `bp${index}`;
        ownerRecords[ownerKey] = { blueprintId: id };
        docs[id] = {
            id,
            name: `Logic ${index}`,
            graphs: {
                events: Object.fromEntries(Object.entries(events).map(([graphId, graph]) => [graphId, { id: graphId, graph }])),
                functions: {},
            },
        };
    });
    return { ownerRecords, blueprints: docs } as unknown as BlueprintDocument;
}

const NO_GRAPHS = blueprints({});
const PAGE_OWNER = surfaceMainOwnerKey(MAIN_APP_SURFACE_ID);

function bootGraph(...nodes: { id: string; type: string; params?: Record<string, unknown> }[]): BlueprintGraphIr {
    return {
        nodes: Object.fromEntries([
            ["head", { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} }],
            ...nodes.map(node => [node.id, { params: {}, ...node }]),
        ]),
        edges: nodes.length > 0 ? [{ from: { nodeId: "head", port: "then" }, to: { nodeId: nodes[0]!.id, port: "in" } }] : [],
    } as BlueprintGraphIr;
}

function asset(id: string, overrides: Partial<LintAssetEntry> = {}): LintAssetEntry {
    return { id, type: AssetType.Image, name: `${id}.png`, ext: "png", meta: {}, tags: [], ...overrides };
}

function translationUnit(target: string, sourceText: string): LocalizationUnit {
    return { target, sourceHash: hashSourceText(sourceText), status: "translated" };
}

function voiceUnit(assetId: string, sourceText: string): VoiceUnit {
    return { assetId, sourceHash: hashSourceText(sourceText), status: "linked" };
}

function localization(units: Record<string, LocalizationUnit>) {
    return {
        sourceLocale: "en",
        targetLocales: ["ja"],
        documents: new Map([["ja", { schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, locale: "ja", units }]]),
    };
}

function voice(units: Record<string, VoiceUnit>) {
    return {
        voicedLocales: ["ja"],
        documents: new Map([["ja", { schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION, locale: "ja", units }]]),
        voiceChoices: false,
    };
}

/** A font that draws exactly these code points. */
function drawing(...codePoints: number[]): FontCoverage {
    const ranges = [...codePoints].sort((a, b) => a - b).map(point => [point, point] as const);
    return { ranges, count: ranges.length, codePages: [] };
}

const LATIN = drawing(...Array.from({ length: 0x5f }, (_, index) => 0x20 + index));

function fontProbe(coverage: Record<string, FontCoverage | "unreadable" | "collection">): Partial<LintContext["io"]> {
    return {
        probeFontCoverage: async assetId => {
            const found = coverage[assetId];
            if (found === "unreadable") {
                return { ok: false, reason: "malformed" };
            }
            if (found === "collection") {
                return { ok: false, reason: "unrenderable" };
            }
            return found ? { ok: true, coverage: found } : { ok: false, reason: "not-a-font" };
        },
    };
}

// --- Fixtures -----------------------------------------------------------------------------------

/** One run of a rule: a context, the options it runs with, and any module-level state it reads. */
type Case = {
    context: () => LintContext;
    options?: Record<string, string | number>;
    setup?: () => void;
    teardown?: () => void;
};

/** A missing asset's id, named from every kind of site the reference index has. */
const GONE = "gone-asset";

function referencesToGone(): LintContext {
    const sceneStory = story("s-refs", "Refs", [
        scene("sc-refs", "Kitchen", [action("bg", { action: "setBackground", assetId: GONE })]),
    ]);
    const art = element({ id: "art", type: "nl.image", name: "Art", props: { imageFill: { mode: "cover", assetId: GONE } } });
    const face = element({ id: "face", type: "nl.image", name: "Face", props: { imageFill: { mode: "cover", assetId: GONE } } });
    const interfaceDocument = {
        ...onePage(art),
        components: [component("card", "Card", [face])],
    } as unknown as UIDocument;
    interfaceDocument.surfaces[0]!.settings = { backgroundImage: { assetId: GONE } } as never;
    const references = [
        ...scanStoryAssetReferences(sceneStory.document, sceneStory.name).references,
        ...extractCharacterAssetReferences([{ id: "aoi", name: "Aoi", thumbnailAssetId: GONE, appearanceAssets: [] }]),
        ...extractUIDocumentAssetReferences(interfaceDocument).references,
        ...extractVoiceAssetReferences({ schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION, locale: "ja", units: { "text-line": voiceUnit(GONE, "Hello") } }),
        ...extractProjectFontReferences([{ assetId: GONE }], "Default fonts"),
        ...extractStoryAnimationAssetReferences({ id: "shake", name: "Shake", previewAssetId: GONE } as unknown as StoryAnimationAsset),
    ];
    const index = buildReferenceIndex(references);
    // The defensive branch: an id the index lists with nothing using it.
    index.set("gone-without-site", []);
    return createTestLintContext({
        stories: [sceneStory, ...singleSceneStories([narrationBlock("line", textSegment("text-line", "Hello", "narration"))])],
        characters: [{ id: "aoi", name: "Aoi", assetIds: [GONE] }],
        uiDocument: interfaceDocument,
        assetReferences: index,
    });
}

function gapsOfTheIndex(): LintContext {
    // A widget on a page whose picture is a URL this session did not mint: a gap the widget answers for.
    const banner = element({ id: "banner", type: "nl.image", name: "Banner", props: { backgroundImage: "app://fs/not-minted/banner.png" } });
    const gaps: ReferenceIndexGap[] = [
        ...extractUIDocumentAssetReferences(onePage(banner)).gaps,
        // Shaped as `ReferenceService` reports them.
        { reason: "documentUnreadable", slice: "story", location: "Route B", target: { kind: "storyEntry", storyId: "route-b", storyName: "Route B" } },
        { reason: "documentUnreadable", slice: "storyAnimation", location: "Shake", target: { kind: "storyMotion", animationId: "shake" } },
        { reason: "documentUnreadable", slice: "voice", location: "ja", target: { kind: "voiceLine", locale: "ja" } },
        { reason: "sliceFailed", slice: "design", location: "Default fonts", affects: ["font"], target: { kind: "projectPage", page: "design", part: "fonts" } },
        { reason: "sliceFailed", slice: "ui", location: "Interface" },
        { reason: "indexNotBuilt" },
    ];
    return createTestLintContext({ assets: [asset("a")], assetIndex: { complete: false, gaps } });
}

const DEMO: ProjectAppTag = { id: "t-demo", name: "Demo", overrides: {} };

function aliceSet(fallback: string): AssetSet {
    return {
        id: "set-alice",
        name: "Alice",
        type: AssetType.Image,
        filter: ["set:set-alice"],
        axis: { kind: "release", key: "release", residency: "build", values: ["main", DEMO.id], fallback },
    } as AssetSet;
}

/** The interface document of `blueprint/assembled-asset-name`: a list whose rows' pictures are bound to a field. */
function assembledNameProject(): LintContext {
    const page = "page-extra";
    const elements = [
        element({ id: "root", type: "nl.container", childrenIds: ["list"] }),
        element({ id: "list", type: "nl.list", name: "Grid", parentId: "root", childrenIds: ["row-art"] }),
        element({
            id: "row-art",
            type: "nl.image",
            name: "Row art",
            parentId: "list",
            valueBindings: { "imageFill.assetId": { kind: "listItemField", fieldId: "image" } },
        } as Partial<UIElement> & { id: string; type: string }),
    ];
    const owner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: page, elementId: "list" };
    const fill = {
        nodes: {
            init: { id: "init", type: "blueprint.event.head.init", params: {} },
            listRef: { id: "listRef", type: "blueprint.element.ref", params: { surfaceId: page, elementId: "list", elementType: "nl.list" } },
            fill: { id: "fill", type: "blueprint.element.list.setItems", params: {} },
            name: { id: "name", type: "blueprint.string.concat", params: { a: "b1a0c227-b4db-4156-", b: "875d-d2809aaa4c48" } },
            row: { id: "row", type: "blueprint.data.jsonMakeObject", params: { __jsonObjectInputPins: ["field_1_name", "field_1_value"], field_1_name: "image" } },
            rows: { id: "rows", type: "blueprint.data.jsonMakeArray", params: { __jsonArrayInputPins: ["item_1"] } },
        },
        edges: [
            ["init", "then", "fill", "in"],
            ["listRef", "element", "fill", "list"],
            ["rows", "result", "fill", "items"],
            ["name", "result", "row", "field_1_value"],
            ["row", "result", "rows", "item_1"],
        ].map(([from, fromPort, to, toPort]) => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort } })),
    };
    return createTestLintContext({
        uiDocument: uiDocument({ surfaces: [{ id: page, name: "Extra", rootElementId: "root" }], elements }),
        blueprintDocument: {
            ownerRecords: { [ownerRefToIndexKey(owner)]: { blueprintId: "bp-grid" } },
            blueprints: { "bp-grid": { id: "bp-grid", name: "Grid", owner, graphs: { events: { fill: { id: "fill", graph: fill } }, functions: {} } } },
        } as unknown as BlueprintDocument,
    });
}

const CHAPTER_FIELD: SaveSchemaField = {
    id: "f-chapter",
    name: "Chapter",
    valueType: "string",
    storageKey: "chapter",
    defaultValue: "Prologue",
    order: 0,
};

const ADVANCE: UIInputActionDef = { id: "advance", name: "Advance", bindings: [{ kind: "pointer", gesture: "click" }] };

const AFFECTION = { scope: "saved" as const, variableId: "affection" };

const FIXTURES: Record<RegisteredLintRuleId, Case[]> = {
    // --- assets ---
    "assets/unused": [
        { context: () => createTestLintContext({ assets: [asset("orphan")] }) },
        { context: gapsOfTheIndex },
    ],
    "assets/missing": [{ context: referencesToGone }],
    "assets/unreadable": [{ context: () => createTestLintContext({ assets: [asset("lost")] }) }],
    "assets/oversized": [{
        context: () => createTestLintContext({
            assets: [asset("cover", { meta: { size: 4 * 1024 * 1024 } })],
            assetReferences: new Map([["cover", [{ id: "ui:w1:cover", assetId: "cover", kind: "uiElement", label: "Art", field: "imageFill" }]]]),
        }),
        options: { maxMegabytes: 1 },
    }],
    "assets/group-incomplete": [
        { context: () => createTestLintContext({ assets: [asset("a", { tags: ["set:set-alice", "release:main"] })], appTags: [RELEASE_APP_TAG, DEMO], assetSets: [aliceSet(DEMO.id)] }) },
        // A declaration fault, which is reported instead of the set's holes.
        { context: () => createTestLintContext({ appTags: [RELEASE_APP_TAG, DEMO], assetSets: [{ ...aliceSet("main"), axis: { ...aliceSet("main").axis, values: [] } } as AssetSet] }) },
    ],

    // --- portability ---
    "portability/media-format": [{
        context: () => createTestLintContext({ assets: [asset("bgm", { type: AssetType.Audio, name: "theme.ogg", ext: "ogg" })], buildPlatforms: ["ios"] }),
    }],
    "portability/vfx-alpha": [{
        context: () => createTestLintContext({
            stories: [story("s1", "Chapter 1", [scene("sc1", "Rooftop", [action("row-1", { action: "vfx", operation: "create", objectName: "petals", assetId: "petals" })])])],
            assets: [asset("petals", { type: AssetType.Video, name: "petals.webm", ext: "webm" })],
            buildPlatforms: ["ios"],
            io: { exists: async () => true, probeVideoAlpha: async () => ({ ok: true, carriesAlpha: true }) },
        }),
    }],

    // --- network ---
    "network/fetch-disallowed": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({ [PAGE_OWNER]: { boot: bootGraph({ id: "fetch", type: BLUEPRINT_NODE_TYPE_NETWORK_FETCH }) } }),
        }),
    }],
    "network/fetch-not-allowlisted": [{
        context: () => createTestLintContext({
            network: { allowHttp: true, allowRemoteResource: false, allowRemoteScript: false, policy: NETWORK_POLICY_ALLOWLIST, allowlist: ["https://ok.example.com/*"] },
            blueprintDocument: blueprints({
                [PAGE_OWNER]: { boot: bootGraph({ id: "fetch", type: BLUEPRINT_NODE_TYPE_NETWORK_FETCH, params: { url: "https://elsewhere.example.net/data" } }) },
            }),
        }),
    }],

    // --- story ---
    "story/invalid-command": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [{ id: "b1", kind: "invalid", payload: { source: "/se " } }])])) }],
    "story/goto-missing": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [goto("b1", "retry")])])) }],
    "story/label-duplicate": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [label("b1", "retry"), label("b2", "retry")])])) }],
    "story/label-unused": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [label("b1", "retry"), narration("b2")])])) }],
    "story/jump-missing": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [jump("b1", "gone")])])) }],
    "story/empty-choice": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [{ id: "b1", kind: "nodeAction", payload: { action: "choice" } }])])) }],
    "story/dead-end": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [
            condition("c1", [branch("br1", "if", [jump("j1", "sc1")]), branch("br2", "else", [narration("n1")])]),
        ])])),
    }],
    "story/call-cycle": [{
        context: () => stories(story("s1", "Main", [
            scene("sc1", "Prologue", [call("b1", "sc2"), narration("b2")]),
            scene("sc2", "Interlude", [call("b3", "sc1")]),
        ])),
    }],
    "story/unreachable-scene": [{
        context: () => stories(story("s1", "Main", [
            scene("sc1", "Prologue", [jump("b1", "sc2")]),
            scene("sc2", "Chapter 1", [narration("b2")]),
            scene("sc3", "Cut", [narration("b3")]),
        ], { entrySceneId: "sc1" })),
    }],
    "story/empty-scene": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [])])) }],
    "story/app-tag-unknown": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [
            condition("c1", [branch("b1", "if", [], { condition: { kind: "expression", expression: expression("AppTag == \"Demo\"") } })]),
        ])])),
    }],
    "story/cut-point-orphan": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [narration("n1"), cut("c1")])])) }],
    "story/cut-point-unreachable": [{
        context: () => stories(story("s1", "Main", [
            scene("sc1", "Prologue", [narration("n1")]),
            scene("sc2", "Orphan", [narration("n2"), cut("c1"), narration("n3")]),
        ], { entrySceneId: "sc1" })),
    }],
    "story/rows-after-ending": [{ context: () => stories(story("s1", "Main", [scene("sc1", "Finale", [ending("e1", "True End"), narration("n1")])])) }],
    "story/quit-page-missing": [{
        context: () => createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Hub", [{ id: "q1", kind: "control", payload: { control: "quit", surfaceId: "gone" } }])])],
            uiDocument: uiDocument({ surfaces: [{ id: "map", name: "Map", rootElementId: "map-root" }], elements: [element({ id: "map-root", type: "nl.root" })] }),
        }),
    }],
    "story/input-action-missing": [{
        context: () => createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Chase", [action("w1", { action: "input", operation: "wait", actionId: "gone" })])])],
            uiDocument: uiDocument({ surfaces: [], elements: [], extra: { actions: {} } }),
        }),
    }],
    "story/input-locked-dialogue": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Cutscene", [
            action("l1", { action: "input", operation: "lock" }),
            narration("n1"),
        ])])),
    }],
    "story/ending-name-duplicate": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "A", [ending("e1", "Bad End")]), scene("sc2", "B", [ending("e2", "Bad End")])])),
    }],
    "story/stage-object-missing": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Opening", [action("show", { action: "image", operation: "show", objectName: "poster" })])])),
    }],
    "story/stage-object-duplicate": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Opening", [
            action("first", { action: "image", operation: "create", objectName: "poster", assetId: "asset-image" }),
            action("second", { action: "image", operation: "create", objectName: "poster", assetId: "asset-image" }),
        ])])),
    }],
    "story/video-control-after-end": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Opening", [
            action("play", { action: "video", operation: "play", objectName: "festival", assetId: "asset-festival" }),
            action("stop", { action: "video", operation: "stop", objectName: "festival" }),
        ])])),
    }],
    "story/declared-never-shown": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Opening", [
            action("create", { action: "image", operation: "create", objectName: "poster", assetId: "asset-image" }),
        ])])),
    }],
    "story/character-missing": [{
        context: () => createTestLintContext({
            characters: [{ id: "char-alice", name: "Alice", assetIds: [] }],
            stories: [story("s1", "Main", [scene("sc1", "Opening", [action("enter", { action: "character", operation: "enter", characterId: "char-bob" })])])],
        }),
    }],
    "story/transition-unavailable": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [
            action("b1", { action: "setBackground", assetId: "asset-bg", transition: { kind: "maskFade", durationMs: 400 } }),
        ])])),
    }],
    "story/background-unchanged": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [
            action("b1", { action: "setBackground", assetId: "asset-cafe", transition: { kind: "dissolve", durationMs: 500 } }),
            narration("n1"),
        ], { defaultBackgroundAssetId: "asset-cafe" })])),
    }],

    // --- blueprint ---
    "blueprint/reference-missing": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({ [PAGE_OWNER]: { boot: bootGraph({ id: "go", type: BLUEPRINT_NODE_TYPE_PAGE_GO, params: { surfaceId: "deleted" } }) } }),
            uiDocument: onePage(),
        }),
    }],
    "blueprint/element-ref-missing": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({
                [PAGE_OWNER]: {
                    click: {
                        nodes: {
                            head: {
                                id: "head",
                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                                params: { surfaceId: "surface-elsewhere", elementId: "element-elsewhere", elementType: "nl.button" },
                            },
                        },
                        edges: [],
                    } as unknown as BlueprintGraphIr,
                },
            }),
            uiDocument: onePage(element({ id: "button-here", type: "nl.button" })),
        }),
    }],
    "blueprint/fn-target-missing": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({
                [PAGE_OWNER]: {
                    main: {
                        nodes: {
                            call: {
                                id: "call",
                                type: BLUEPRINT_NODE_TYPE_FN_CALL,
                                params: {
                                    [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef("bp-elsewhere", "head-elsewhere"),
                                    [BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT]: { name: "Refresh", params: [], returns: [] },
                                    [BLUEPRINT_NODE_PARAM_FN_NAME]: "Refresh",
                                },
                            },
                        },
                        edges: [],
                    } as unknown as BlueprintGraphIr,
                },
            }),
        }),
    }],
    "blueprint/unreachable-node": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({ [PAGE_OWNER]: { boot: {
                nodes: {
                    head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                    orphan: { id: "orphan", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
                },
                edges: [],
            } as unknown as BlueprintGraphIr } }),
        }),
    }],
    "blueprint/empty-event": [{
        // A layer with nothing in it at all, and one whose head runs nothing.
        context: () => createTestLintContext({
            blueprintDocument: blueprints({ [PAGE_OWNER]: { empty: {} as BlueprintGraphIr, stub: bootGraph() } }),
        }),
    }],
    "blueprint/dlc-entrance-unguarded": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({
                [PAGE_OWNER]: { boot: bootGraph({ id: "start", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params: { storyId: "story-dlc", sceneId: "scene-1" } }) },
            }),
            stories: [story("story-dlc", "Summer", [scene("scene-1", "Beach", [ending("e1", "Sunrise")])], { dlcId: "summer" })],
        }),
    }],
    "blueprint/unknown-node": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({ [PAGE_OWNER]: { boot: bootGraph({ id: "mystery", type: "com.example.plugin.doThing" }) } }),
        }),
    }],
    "blueprint/assembled-asset-name": [{ context: assembledNameProject }],
    "blueprint/save-field-empty": [{
        setup: () => setActiveSaveSchemaFields([CHAPTER_FIELD]),
        teardown: () => setActiveSaveSchemaFields([]),
        context: () => createTestLintContext({
            blueprintDocument: blueprints({ [PAGE_OWNER]: { boot: bootGraph({ id: "save", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE, params: { id: "slot-1" } }) } }),
        }),
    }],
    "blueprint/start-scene-foreign": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({
                [PAGE_OWNER]: { boot: bootGraph({ id: "start", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params: { storyId: "story-prologue", sceneId: "courtroom" } }) },
            }),
            stories: [
                story("story-prologue", "Prologue", [scene("corridor", "The corridor", [narration("n1")])]),
                story("story-trial", "Class Trial", [scene("courtroom", "The courtroom", [narration("n2")])]),
            ],
        }),
    }],
    "blueprint/required-input-unwired": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({
                [PAGE_OWNER]: {
                    click: {
                        nodes: {
                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: {} },
                            setText: { id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "Hello" } },
                        },
                        edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "setText", port: "in" } }],
                    } as unknown as BlueprintGraphIr,
                },
            }),
        }),
    }],
    "blueprint/field-missing": [{
        context: () => createTestLintContext({
            blueprintDocument: blueprints({
                [PAGE_OWNER]: {
                    click: {
                        nodes: {
                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: {} },
                            endings: { id: "endings", type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS, params: {} },
                            first: { id: "first", type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST, params: {} },
                            read: {
                                id: "read",
                                type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
                                params: { struct: "nl.ending", field: "title" },
                            },
                            log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
                        },
                        edges: [
                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } },
                            { from: { nodeId: "endings", port: "endings" }, to: { nodeId: "first", port: "array" } },
                            { from: { nodeId: "first", port: "item" }, to: { nodeId: "read", port: "object" } },
                            { from: { nodeId: "read", port: "value" }, to: { nodeId: "log", port: "value" } },
                        ],
                    } as unknown as BlueprintGraphIr,
                },
            }),
        }),
    }],

    "blueprint/page-param-missing": [{
        context: () => {
            const blueprintDocument = blueprints({
                [PAGE_OWNER]: {
                    click: {
                        nodes: {
                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: {} },
                            read: { id: "read", type: BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM, params: { paramId: "gone" } },
                            log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
                        },
                        edges: [
                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } },
                            { from: { nodeId: "read", port: "value" }, to: { nodeId: "log", port: "value" } },
                        ],
                    } as unknown as BlueprintGraphIr,
                },
            });
            // The page a blueprint belongs to is read off its owner, which the helper leaves out.
            (blueprintDocument.blueprints.bp0 as { owner?: unknown }).owner = { kind: "surfaceMain", surfaceId: MAIN_APP_SURFACE_ID };
            return createTestLintContext({ uiDocument: onePage(), blueprintDocument });
        },
    }],
    "blueprint/list-shape-mismatch": [{
        context: () => createTestLintContext({
            uiDocument: onePage(element({ id: "endings", type: "nl.list", props: { itemStructId: "nl.ending" } })),
            blueprintDocument: blueprints({
                [PAGE_OWNER]: {
                    click: {
                        nodes: {
                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: {} },
                            saves: { id: "saves", type: BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LIST, params: {} },
                            list: {
                                id: "list",
                                type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                                params: { surfaceId: MAIN_APP_SURFACE_ID, elementId: "endings", elementType: "nl.list" },
                            },
                            fill: { id: "fill", type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS, params: {} },
                        },
                        edges: [
                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "saves", port: "in" } },
                            { from: { nodeId: "saves", port: "next" }, to: { nodeId: "fill", port: "in" } },
                            { from: { nodeId: "saves", port: "entries" }, to: { nodeId: "fill", port: "items" } },
                            { from: { nodeId: "list", port: "element" }, to: { nodeId: "fill", port: "list" } },
                        ],
                    } as unknown as BlueprintGraphIr,
                },
            }),
        }),
    }],

    // --- ui ---
    "ui/page-unreachable": [{
        context: () => createTestLintContext({
            uiDocument: uiDocument({
                surfaces: [
                    { id: MAIN_APP_SURFACE_ID, name: "Title", rootElementId: "root-main" },
                    { id: "settings", name: "Settings", rootElementId: "root-settings" },
                ],
                elements: [element({ id: "root-main", type: "nl.root" }), element({ id: "root-settings", type: "nl.root" })],
            }),
            blueprintDocument: NO_GRAPHS,
        }),
    }],
    "ui/empty-behavior": [{
        context: () => createTestLintContext({
            uiDocument: onePage(element({ id: "start", type: "nl.button", name: "Start", props: { label: "Play" } })),
            blueprintDocument: NO_GRAPHS,
        }),
    }],
    "ui/unknown-widget": [{
        // The rule stands down while no widget is registered at all, which is not a workspace.
        setup: () => widgetModuleRegistry.register({ type: "nl.root", displayName: "Root", icon: Box, createDefaultElement: () => ({ type: "nl.root" }), render: () => null } as never),
        teardown: () => widgetModuleRegistry.unregister("nl.root"),
        context: () => createTestLintContext({ uiDocument: onePage(element({ id: "badge", type: "acme.lab.badge" })) }),
    }],
    "ui/component-missing": [{
        context: () => createTestLintContext({
            uiDocument: onePage(element({ id: "slot", type: "nl.container", name: "Save Slot", extra: { componentLink: { componentId: "gone", linked: true } } })),
        }),
    }],
    "ui/frame-target-missing": [
        { context: () => createTestLintContext({ uiDocument: onePage(element({ id: "embed", type: UI_FRAME_ELEMENT_TYPE, props: { targetSurfaceId: "gone" } })) }) },
        // A Page widget inside a component definition, reported under the definition.
        {
            context: () => createTestLintContext({
                uiDocument: {
                    ...onePage(),
                    components: [component("card", "Card", [element({ id: "window", type: UI_FRAME_ELEMENT_TYPE, name: "Window", props: { targetSurfaceId: "gone" } })])],
                } as unknown as UIDocument,
            }),
        },
    ],
    "ui/frame-loop": [{
        context: () => createTestLintContext({ uiDocument: onePage(element({ id: "mirror", type: UI_FRAME_ELEMENT_TYPE, name: "Mirror", props: { targetSurfaceId: MAIN_APP_SURFACE_ID } })) }),
    }],
    "ui/list-item-field-missing": [{
        context: () => createTestLintContext({
            uiDocument: uiDocument({
                surfaces: [{ id: "page", name: "Page", rootElementId: "root" }],
                elements: [
                    element({ id: "root", type: "nl.root", childrenIds: ["list"] }),
                    element({ id: "list", type: "nl.list", parentId: "root", childrenIds: ["row"], props: { itemStructId: "s1" } }),
                    element({
                        id: "row",
                        type: "nl.text",
                        parentId: "list",
                        extra: { listSlot: "itemTemplate" },
                        valueBindings: { text: { kind: "listItemField", fieldId: "f-gone" } },
                    } as Partial<UIElement> & { id: string; type: string }),
                ],
                extra: { structs: { s1: { id: "s1", fields: [{ id: "f-title", key: "title", type: "string" }] } } },
            }),
        }),
    }],
    "ui/page-prop-undeclared": [{
        context: () => createTestLintContext({
            uiDocument: onePage(element({
                id: "rows",
                type: "nl.list",
                name: "Buttons",
                props: { itemsBinding: { kind: "pageProp", key: "buttons" } },
            })),
        }),
    }],
    "ui/page-param-unknown": [{
        context: () => createTestLintContext({
            uiDocument: uiDocument({
                surfaces: [
                    { id: MAIN_APP_SURFACE_ID, name: "Title", rootElementId: "root" },
                    {
                        id: "confirm",
                        name: "Confirm",
                        rootElementId: "confirm-root",
                        params: [{ id: "message", name: "message", type: "string" }],
                    } as { id: string; name: string; rootElementId: string },
                ],
                elements: [
                    element({ id: "root", type: "nl.root", childrenIds: ["embed"] }),
                    element({
                        id: "embed",
                        type: UI_FRAME_ELEMENT_TYPE,
                        name: "Embed",
                        parentId: "root",
                        props: { targetSurfaceId: "confirm", params: { question: "Quit?" } },
                    }),
                    element({ id: "confirm-root", type: "nl.root" }),
                ],
            }),
        }),
    }],
    "ui/page-text-param-missing": [{
        context: () => createTestLintContext({
            uiDocument: onePage(element({
                id: "message",
                type: "nl.text",
                name: "Message",
                props: { text: "Sample" },
                valueBindings: { text: { kind: "pageParam", paramId: "message" } },
            } as Partial<UIElement> & { id: string; type: string })),
        }),
    }],
    "ui/page-param-list-mismatch": [{
        context: () => createTestLintContext({
            uiDocument: uiDocument({
                surfaces: [{
                    id: MAIN_APP_SURFACE_ID,
                    name: "Title",
                    rootElementId: "root",
                    params: [{ id: "buttons", name: "buttons", type: "string" }],
                } as { id: string; name: string; rootElementId: string }],
                elements: [
                    element({ id: "root", type: "nl.root", childrenIds: ["rows"] }),
                    element({
                        id: "rows",
                        type: "nl.list",
                        name: "Buttons",
                        parentId: "root",
                        props: { itemsBinding: { kind: "pageProp", key: "buttons" } },
                    }),
                ],
            }),
        }),
    }],
    "ui/component-param-missing": [{
        context: () => createTestLintContext({
            uiDocument: {
                ...onePage(),
                components: [component("nav", "Nav item", [element({
                    id: "nav-label",
                    type: "nl.text",
                    name: "Label",
                    props: { text: "Sample" },
                    valueBindings: { text: { kind: "componentParam", paramId: "label" } },
                } as Partial<UIElement> & { id: string; type: string })], [])],
            } as unknown as UIDocument,
        }),
    }],
    "ui/gesture-answered-twice": [{
        context: () => createTestLintContext({
            uiDocument: uiDocument({
                surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Title", rootElementId: "root", actions: [{ actionId: "advance" }] }],
                elements: [element({ id: "root", type: "nl.root", childrenIds: ["hit"] }), element({ id: "hit", type: "nl.container", name: "Hit area", parentId: "root" })],
                extra: { actions: { advance: ADVANCE } },
            }),
            blueprintDocument: blueprints({
                [widgetMainOwnerKey(MAIN_APP_SURFACE_ID, "hit")]: { click: { nodes: { h: { id: "h", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK } }, edges: [] } as unknown as BlueprintGraphIr },
            }),
        }),
    }],
    "ui/list-text-untranslated": [{
        context: () => createTestLintContext({
            uiDocument: uiDocument({
                surfaces: [{ id: "page", name: "Page", rootElementId: "root" }],
                elements: [
                    element({ id: "root", type: "nl.root", childrenIds: ["list"] }),
                    element({
                        id: "list",
                        type: "nl.list",
                        name: "Chapters",
                        parentId: "root",
                        childrenIds: ["row"],
                        props: { itemStructId: "chapter", items: [{ title: "Chapter one" }, { title: "Chapter two" }] },
                    }),
                    element({
                        id: "row",
                        type: "nl.text",
                        parentId: "list",
                        extra: { listSlot: "itemTemplate" },
                        props: { text: "Title" },
                        valueBindings: { text: { kind: "listItemField", fieldId: "f-title" } },
                    } as Partial<UIElement> & { id: string; type: string }),
                ],
                extra: { structs: { chapter: { id: "chapter", fields: [{ id: "f-title", key: "title", type: "string" }] } } },
            }),
            blueprintDocument: NO_GRAPHS,
            localization: { sourceLocale: "en", targetLocales: ["zh"], documents: new Map() },
        }),
    }],
    "ui/localization-key-missing": [{
        context: () => createTestLintContext({
            uiDocument: onePage(element({ id: "label", type: "nl.text", name: "Greeting", props: { text: "Old words", localizationKey: "menu.removed" } })),
            localizationKeys: new Map([["menu.start", "Start"]]),
        }),
    }],

    // --- variables ---
    "variables/undeclared": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [action("b1", { action: "setVariable", target: { scope: "scene", variableId: "v1" }, value: 1 })])])),
    }],
    "variables/unused": [
        { context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [declaration("d1", "scene", "flag")])])) },
        // A registry entry, which no row declares: its row is in the Variables panel.
        { context: () => createTestLintContext({ variableRegistry: [{ id: "reg-1", name: "Playthroughs", scope: "persistent", valueType: "number", storageKey: "pk-1" }] }) },
    ],
    "variables/name-collision": [
        {
            context: () => createTestLintContext({
                stories: [story("s1", "Main", [scene("sc1", "Prologue", [declaration("d1", "saved", "Affection", { storageKey: "sk-1" })])])],
                savedNameCollisions: [{ name: "Affection", storageKeys: ["sk-1", "reg-1"] }],
            }),
        },
        // No story row carries the key that was read: the registry half of the clash is the place.
        {
            context: () => createTestLintContext({
                variableRegistry: [{ id: "reg-entry", name: "Playthroughs", scope: "persistent", valueType: "number", storageKey: "reg-1" }],
                persistentNameCollisions: [{ name: "Playthroughs", storageKeys: ["pk-1", "reg-1"] }],
            }),
        },
    ],
    "variables/random-outside-assignment": [{
        context: () => stories(story("s1", "Main", [scene("sc1", "Prologue", [
            condition("c1", [branch("br1", "if", [], { condition: { kind: "expression", expression: { source: "random() < 0.5", ast: { kind: "binary", op: "<", left: { kind: "call", fn: "random", args: [] }, right: { kind: "literal", value: 0.5 } } } } })]),
        ])])),
    }],
    "variables/read-never-written": [{
        context: () => stories(story("s1", "Story", [scene("a", "A", [
            declaration("affection", "saved", "affection"),
            condition("if1", [branch("b1", "if", [], { condition: { kind: "expression", expression: { source: "affection >= 1", ast: { kind: "binary", op: ">=", left: { kind: "var", target: AFFECTION, name: "affection" }, right: { kind: "literal", value: 1 } } } } })]),
        ])])),
    }],
    "variables/condition-never-holds": [{
        context: () => stories(story("s1", "Story", [
            scene("a", "A", [
                declaration("affection", "saved", "affection", { defaultValue: 0 }),
                action("w1", { action: "setVariable", target: AFFECTION, value: 0, expression: { source: "affection + (2)", ast: { kind: "binary", op: "+", left: { kind: "var", target: AFFECTION, name: "affection" }, right: { kind: "literal", value: 2 } } } }),
                jump("j1", "end"),
            ]),
            scene("end", "End", [
                condition("if1", [branch("br1", "if", [], { condition: { kind: "expression", expression: { source: "affection >= 50", ast: { kind: "binary", op: ">=", left: { kind: "var", target: AFFECTION, name: "affection" }, right: { kind: "literal", value: 50 } } } } })]),
            ]),
        ], { entrySceneId: "a" })),
    }],

    // --- text ---
    "text/overlong": [{ context: () => createTestLintContext({ stories: singleSceneStories([narrationBlock("b1", textSegment("t-1", "word ".repeat(40), "narration"))]) }) }],
    "text/empty": [{ context: () => createTestLintContext({ stories: singleSceneStories([narrationBlock("b1", textSegment("t-1", "   ", "narration"))]) }) }],

    // --- localization ---
    "localization/missing": [
        { context: () => createTestLintContext({ stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "We should go home.", "dialogue"))]), localization: localization({}) }) },
        // The interface's words: a widget's own, and a named key's.
        {
            context: () => createTestLintContext({
                uiDocument: onePage(
                    element({ id: "title", type: "nl.text", name: "Game title", props: { text: "Summer Rain" } }),
                    element({ id: "save", type: "nl.button", props: { label: "Save", localizationKey: "nav.save" } }),
                ),
                localizationKeys: new Map([["nav.save", "Save"]]),
                localization: localization({}),
            }),
        },
    ],
    "localization/stale": [{
        context: () => createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))]),
            localization: localization({ "t-1": translationUnit("家に帰ろう。", "We should go home.") }),
        }),
    }],
    "localization/markup": [{
        context: () => createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "We should go home.", "dialogue", [
                { text: "We should go " },
                { text: "home", marks: { emphasis: "dot" } },
                { text: "." },
            ]))]),
            localization: localization({ "t-1": translationUnit("家に帰ろう。", "We should go home.") }),
        }),
    }],
    "localization/orphan": [{
        context: () => createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "Line", "dialogue"))]),
            localization: localization({ "t-deleted": translationUnit("消えた行", "a line that no longer exists") }),
        }),
    }],

    // --- voice ---
    "voice/missing": [{
        context: () => createTestLintContext({ stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "Hello.", "dialogue"))]), voice: voice({}) }),
    }],
    "voice/stale": [{
        context: () => createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))]),
            voice: voice({ "t-1": voiceUnit("take-1", "We should go home.") }),
        }),
    }],
    "voice/orphan": [{
        context: () => createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", "Hello.", "dialogue"))]),
            voice: voice({ "t-gone": voiceUnit("take-1", "Gone.") }),
        }),
    }],

    // --- brand ---
    "brand/broken-link": [{
        setup: () => setActiveBrandPalette(BUILTIN_BRAND_COLORS),
        teardown: () => setActiveBrandPalette(BUILTIN_BRAND_COLORS),
        context: () => createTestLintContext({
            uiDocument: {
                ...onePage(element({ id: "start", type: "nl.button", name: "Start", style: { backgroundColor: "nlbrand:nope" } } as never)),
                components: [component("badge", "Badge", [element({ id: "badge-face", type: "nl.container", name: "Face", style: { backgroundColor: "nlbrand:nope" } } as never)])],
                elements: {
                    ...onePage(element({ id: "start", type: "nl.button", name: "Start", style: { backgroundColor: "nlbrand:nope" } } as never)).elements,
                    // In the pool, under no page and with no parent: drawn nowhere.
                    lost: element({ id: "lost", type: "nl.text", style: { color: "nlbrand:nope" } } as never),
                },
            } as unknown as UIDocument,
        }),
    }],

    // --- typography ---
    "typography/glyph-coverage": [
        {
            // Every kind of text a player reads, each carrying a character a Latin face cannot draw.
            setup: () => setActiveProjectFonts([{ assetId: "latin" }]),
            teardown: () => setActiveProjectFonts([]),
            context: () => createTestLintContext({
                stories: [storyEntryOf("s1", "Story", [sceneOf("sc1", "廊下", [dialogueBlock("b1", textSegment("t1", "こ", "dialogue"))])])],
                characters: [{ id: "aoi", name: "あおい", assetIds: [] }],
                localizationKeys: new Map([["menu.start", "はじめる"]]),
                uiDocument: onePage(element({ id: "label", type: "nl.text", name: "Label", props: { text: "設定" } })),
                io: fontProbe({ latin: LATIN }),
            }),
        },
        {
            // More characters missing than the report lists: the rest are counted in one finding.
            setup: () => setActiveProjectFonts([{ assetId: "latin" }]),
            teardown: () => setActiveProjectFonts([]),
            options: { maxCharacters: 1 },
            context: () => createTestLintContext({
                stories: [storyEntryOf("s1", "Story", [sceneOf("sc1", "", [dialogueBlock("b1", textSegment("t1", "こんにちは", "dialogue"))])])],
                io: fontProbe({ latin: LATIN }),
            }),
        },
        {
            // A font whose bytes do not parse, and one in a format nothing draws with.
            setup: () => setActiveProjectFonts([{ assetId: "broken" }]),
            teardown: () => setActiveProjectFonts([]),
            context: () => createTestLintContext({
                stories: [storyEntryOf("s1", "Story", [sceneOf("sc1", "", [dialogueBlock("b1", textSegment("t1", "Hi", "dialogue"))])])],
                assets: [asset("broken", { type: AssetType.Font, name: "Wrecked Serif.ttf", ext: "ttf" })],
                io: fontProbe({ broken: "unreadable" }),
            }),
        },
        {
            setup: () => setActiveProjectFonts([{ assetId: "collection" }, { assetId: "latin" }]),
            teardown: () => setActiveProjectFonts([]),
            context: () => createTestLintContext({
                stories: [storyEntryOf("s1", "Story", [sceneOf("sc1", "", [dialogueBlock("b1", textSegment("t1", "Hi", "dialogue"))])])],
                assets: [asset("collection", { type: AssetType.Font, name: "MS Gothic.ttc", ext: "ttc" })],
                io: fontProbe({ collection: "collection", latin: LATIN }),
            }),
        },
    ],
    "typography/locale-no-font": [{
        setup: () => setActiveProjectFonts([{ assetId: "kana", locales: ["ja"] }]),
        teardown: () => setActiveProjectFonts([]),
        context: () => createTestLintContext({ localization: { sourceLocale: "en", targetLocales: ["ja"], documents: new Map() } }),
    }],
};

// --- The check ----------------------------------------------------------------------------------

/**
 * Where the location names a widget or a row, the target must select that same widget or row: a
 * target that opens the right page and selects nothing is the half-landing this exists to stop.
 */
function expectTargetSelectsTheLocation(finding: LintFinding): void {
    const { location, target } = finding;
    const where = `${finding.ruleId} (${finding.messageKey})`;
    if (!target) {
        return;
    }
    if ((location.kind === "surface" && target.kind === "uiSurface") || (location.kind === "component" && target.kind === "uiComponent")) {
        if (location.elementId) {
            expect(target.elementId, `${where} names a widget its click does not select`).toBe(location.elementId);
        }
    }
    if (location.kind === "story" && location.blockId && target.kind === "storyBlock") {
        expect(target.blockId, `${where} names a row its click does not open`).toBe(location.blockId);
    }
}

describe("every finding opens the place it is about", () => {
    const allowancesUsed = new Set<string>();

    for (const rule of LINT_RULES) {
        it(`${rule.id}: fires on its fixture, and every finding has somewhere to open`, async () => {
            const cases = FIXTURES[rule.id as RegisteredLintRuleId];
            expect(cases, `${rule.id} has no fixture`).toBeDefined();
            const findings: LintFinding[] = [];
            for (const entry of cases) {
                entry.setup?.();
                try {
                    const options: LintRuleOptions = resolveRuleOptions(rule, entry.options);
                    findings.push(...(await rule.run(entry.context(), options)));
                } finally {
                    entry.teardown?.();
                }
            }

            expect(findings.length, `${rule.id} made no finding: its fixture no longer exercises it`).toBeGreaterThan(0);
            for (const finding of findings) {
                expectTargetSelectsTheLocation(finding);
                if (finding.target) {
                    continue;
                }
                const allowance = NOWHERE_TO_GO.find(candidate => candidate.matches(finding));
                expect(
                    allowance,
                    `${rule.id} made a finding with nowhere to open: ${JSON.stringify({ messageKey: finding.messageKey, location: finding.location })}`,
                ).toBeDefined();
                allowancesUsed.add(allowance!.id);
            }
        });
    }

    it("needs every entry of its allow-list", () => {
        // Registered last, so every rule above has run. An entry no fixture meets is either stale -
        // the finding gained a place to open, and the entry should go - or untested.
        expect(NOWHERE_TO_GO.map(entry => entry.id).filter(id => !allowancesUsed.has(id))).toEqual([]);
    });
});
