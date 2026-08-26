/**
 * Every place the starter template asks before it takes something away.
 *
 * There are ten of them. There were thirty-one, most of them one shape copied twelve times across
 * the save and load pages; those pages place one component twelve times now, so the shape is
 * asserted once and the count is what says nobody added an eleventh prompt somewhere else.
 *
 * What each one has to prove is not "a Show Confirm exists in this graph" - these graphs hold fifty
 * nodes and a stray one would satisfy that - but that the click reaches the confirm through the
 * branch that decides whether the question is worth asking, and that answering it lands on the very
 * node the click used to reach directly. The condition matters as much as the prompt: a confirm
 * that fires unconditionally is one players learn to click through, which costs the mechanism
 * exactly when it matters.
 *
 * Node types and pin ids come from the real catalogue, so renaming either breaks this rather than
 * leaving the template pointing at something that no longer exists.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS,
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
    BLUEPRINT_NODE_TYPE_STRING_EQUALS,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    program: { graphs: { events: Record<string, { graph: Graph }> } };
};
type Surface = { id: string; name: string };
type UIDoc = { surfaces: Surface[]; elements: Record<string, { id: string; name: string }> };
/** The node feeding one data input, resolved and type-checked. */
type GraphSource = (toId: string, port: string, type: string) => GraphNode;

/**
 * Nodes that decorate the route without deciding anything, and are stepped over on the way through.
 *
 * A sound cue sits ahead of the logic so it is heard even when the click navigates away; the three
 * `Get Text` lookups sit ahead of a question because that is where its words come from. Neither
 * changes which node the press ends up running, and this file is about the question, not about
 * them - the cues have `starterSoundCues.test.ts`, and the words are asserted on the pins below.
 */
const PASSED_THROUGH: readonly string[] = [BLUEPRINT_NODE_TYPE_SOUND_PLAY, BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT];

function readTemplate(file: string): unknown {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui", file), "utf-8"),
    );
}

const document = readTemplate("uidoc.json") as UIDoc;
const blueprints = Object.values(
    (readTemplate("uigraphs.json") as { blueprintDocument: { blueprints: Record<string, Blueprint> } })
        .blueprintDocument.blueprints,
);
const confirmSurfaceId = document.surfaces.find(surface => surface.name === "Confirm")!.id;

/**
 * The event graph on the blueprint that answers for an element, with lookups over it - or, when the
 * blueprint carries more than one layer, the one holding `headType`. Layers are how an author keeps
 * two unrelated things a widget answers apart, so insisting on a single layer would fail the moment
 * one gained a second without anything about the wiring under test having changed.
 */
function graphFor(elementId: string, headType?: string) {
    const blueprint = blueprints.find(
        candidate =>
            (candidate.owner.kind === "widgetMain" || candidate.owner.kind === "componentWidgetMain")
            && candidate.owner.elementId === elementId,
    );
    expect(blueprint, `no blueprint answers for element ${elementId}`).toBeDefined();
    const graphs = Object.values(blueprint!.program.graphs.events).filter(
        candidate => !headType || Object.values(candidate.graph.nodes).some(node => node.type === headType),
    );
    expect(graphs, `${elementId} has ${graphs.length} graphs answering ${headType ?? "anything"}`).toHaveLength(1);
    const { nodes, edges } = graphs[0]!.graph;

    /**
     * The node an exec output leads to, asserted to be the only one and of the expected type.
     *
     * Anything in {@link PASSED_THROUGH} on the way is stepped over rather than asserted on.
     */
    const step = (fromId: string, port: string, type: string): GraphNode => {
        let currentId = fromId;
        let currentPort = port;
        for (;;) {
            const out = edges.filter(edge => edge.from.nodeId === currentId && edge.from.port === currentPort);
            expect(out, `${currentId}.${currentPort} leads to ${out.length} nodes`).toHaveLength(1);
            const target = nodes[out[0]!.to.nodeId]!;
            if (PASSED_THROUGH.includes(target?.type) && type !== target?.type) {
                currentId = target.id;
                currentPort = "next";
                continue;
            }
            expect(target?.type, `${currentId}.${currentPort} leads to ${target?.type}`).toBe(type);
            return target;
        }
    };
    /** The node feeding a data input, asserted to be the only one and of the expected type. */
    const source = (toId: string, port: string, type: string): GraphNode => {
        const incoming = edges.filter(edge => edge.to.nodeId === toId && edge.to.port === port);
        expect(incoming, `${toId}.${port} is fed by ${incoming.length} nodes`).toHaveLength(1);
        const from = nodes[incoming[0]!.from.nodeId]!;
        expect(from?.type, `${toId}.${port} is fed by ${from?.type}`).toBe(type);
        return from;
    };
    const leadsTo = (fromId: string, port: string, toId: string): boolean =>
        edges.some(edge => edge.from.nodeId === fromId && edge.from.port === port && edge.to.nodeId === toId);
    const only = (type: string): GraphNode => {
        const found = Object.values(nodes).filter(node => node.type === type);
        expect(found, `expected one ${type}, found ${found.length}`).toHaveLength(1);
        return found[0]!;
    };
    return { nodes, edges, step, source, leadsTo, only };
}

/**
 * The words themselves, which no longer sit on the node.
 *
 * Each prompt pin is fed by a `Get Text`, so what a question says is a key away: the key's source
 * text is the sentence, and a target in every language the template ships is what makes the
 * question askable in that language at all. Asserting the sentence through the key rather than off
 * the node keeps the old claim - this question says exactly this - and adds the one the literals
 * could never make, that it says it in three languages.
 */
type LocalizationKeys = { keys: Record<string, { sourceText: string }> };
type LocalizationBundle = { units: Record<string, { target?: string }> };

function readLocalization(file: string): unknown {
    return JSON.parse(
        fs.readFileSync(
            path.join(process.cwd(), "resources/templates/skeleton/content/editor/localization", file),
            "utf-8",
        ),
    );
}

const localizationKeys = readLocalization("keys.json") as LocalizationKeys;
const TARGET_LOCALES = ["ja", "zh-CN"] as const;
const localeBundles = new Map<string, LocalizationBundle>(
    TARGET_LOCALES.map(locale => [locale, readLocalization(`${locale}.json`) as LocalizationBundle]),
);

function assertSays(source: GraphSource, confirm: GraphNode, pin: string, sentence: string): void {
    // Nothing left on the node: a literal here would win in one language and be wrong in the others.
    expect(confirm.params?.[pin], `${confirm.id}.${pin} still carries a literal`).toBeUndefined();
    const lookup = source(confirm.id, pin, BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT);
    const key = String(lookup.params?.key ?? "");
    expect(localizationKeys.keys[key], `${key} is not a declared key`).toBeDefined();
    expect(localizationKeys.keys[key]!.sourceText).toBe(sentence);
    for (const locale of TARGET_LOCALES) {
        const unit = localeBundles.get(locale)!.units[`key:${key}`];
        expect(unit?.target?.trim(), `${key} has nothing to say in ${locale}`).toBeTruthy();
    }
}

/**
 * The prompt itself: the page it puts up, the words on it, and the branch its first answer takes.
 *
 * Pins are resolved for the node's own params rather than the bare definition, because the answers
 * are pins the author added - reading them off the definition would assert nothing about whether
 * the template's stored pin list produces the ports it wires.
 */
function assertPrompt(source: GraphSource, confirm: GraphNode, message: string, answer: string): void {
    registerCoreBlueprintNodes();
    expect(confirm.params?.surfaceId).toBe(confirmSurfaceId);
    assertSays(source, confirm, "message", message);
    assertSays(source, confirm, "button_1_label", answer);
    // The way out. Every question the template asks offers one, and it is never the destructive one.
    assertSays(source, confirm, "button_2_label", "Cancel");
    const pins = blueprintNodeRegistry
        .resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_LAYER_CONFIRM, confirm.params)
        .pins.map(pin => pin.id);
    expect(pins).toEqual(expect.arrayContaining(["in", "message", "button_1_label", "button_1_pressed", "dismissed"]));
}

/** The four nav buttons that go back to the title, by the page each one sits on. */
const TITLE_BUTTONS: readonly { page: string; elementId: string }[] = [
    { page: "Log", elementId: "d68d4baa-b176-426a-874d-a9c66269e0da" },
    { page: "Config", elementId: "0f7bed84-816e-4cfd-b840-72ffe92356af" },
    { page: "Load", elementId: "3b48abce-4359-40fc-ad3e-808cc8dc7f05" },
    { page: "Save", elementId: "8bad6736-b4c1-4eaf-94e0-3b2fe0b07dc5" },
];

/**
 * The card the twelve save and load slots are all placements of.
 *
 * There used to be twelve element ids here and three `it.each` sweeps over them, because the
 * template held twelve copies of one graph and a copy quietly wired straight through would have
 * read, on its own page, like a page nobody got round to. The copies are gone: the pages place one
 * component twelve times, and which slot a placement is - and whether it saves or loads - are its
 * two params. So the sweep collapses into the assertions below, and what stops a slot drifting is
 * no longer a test but the fact that there is nothing left to drift from.
 */
const SLOT_CARD = "387326a1-5514-4ee2-9d73-48fbe03de0b8";

/**
 * The slot id a node is reading, as the card now states it.
 *
 * Every place that used a literal "3" reads the `slot` param instead - that is the whole of what
 * made the twelve copies different from one another.
 */
function expectReadsSlotParam(source: GraphSource, toId: string, port: string): void {
    const param = source(toId, port, BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM);
    expect(param.params?.paramId).toBe("slot");
}

describe("the questions the starter template asks before it takes something away", () => {
    it("asks them in ten places and nowhere else", () => {
        const asking = blueprints.flatMap(blueprint =>
            Object.values(blueprint.program.graphs.events).flatMap(event =>
                Object.values(event.graph.nodes)
                    .filter(node => node.type === BLUEPRINT_NODE_TYPE_LAYER_CONFIRM)
                    .map(node => `${blueprint.owner.elementId ?? blueprint.id}:${node.id}`),
            ),
        );
        // Counted rather than sampled: the suites below each know which of these they mean, and
        // this is what says nobody added an eleventh prompt outside them. It was thirty-one while
        // the save card existed twelve times over; the card asks its three questions once now.
        expect(asking).toHaveLength(10);
    });

    it.each(TITLE_BUTTONS)(
        "asks before leaving the $page page for the title, and only while a game is running",
        ({ elementId }) => {
            const { step, source, leadsTo, only } = graphFor(elementId);
            const click = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
            const branch = step(click.id, "then", BLUEPRINT_NODE_TYPE_FLOW_IF);
            source(branch.id, "condition", BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME);

            const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
            assertPrompt(source, confirm, "Return to the title screen? Unsaved progress is lost.", "Return to title");

            // The two ways out are genuinely different acts, and each has to be the right one.
            //
            // Answering yes ends the playthrough: `Quit Game` tears the session down and lands on
            // the title. `Go Page` here would leave the story running underneath - music still
            // playing, the title screen drawn as one more overlay over it - and the next New Game
            // would start a second run alongside the first.
            const quit = step(confirm.id, "button_1_pressed", BLUEPRINT_NODE_TYPE_GAME_QUIT);
            expect(quit.params?.surfaceId).toBe("narraleaf-studio:main-surface");

            // Opened from the title with no game running, there is nothing to quit: the way back is
            // to empty the page stack, whose root IS the title. `Go Page` naming the title would
            // push a second copy of it on top of the page the player is standing on.
            const go = step(branch.id, "false", BLUEPRINT_NODE_TYPE_PAGE_GO);
            expect(go.params?.surfaceId ?? "").toBe("");
            expect(leadsTo(confirm.id, "button_1_pressed", go.id)).toBe(false);
        },
    );

    /**
     * The click, which is now two acts behind one gesture.
     *
     * The card is placed on the Save page as `mode: "save"` and on the Load page as `mode: "load"`,
     * so the press branches on that param before it does anything. Both sides are walked from here
     * because they are one graph: a change that broke the load half while leaving the save half
     * standing would otherwise pass on the strength of the half it did not touch.
     */
    function slotClickBranch() {
        const graph = graphFor(SLOT_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const click = graph.only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const mode = graph.step(click.id, "then", BLUEPRINT_NODE_TYPE_FLOW_IF);
        const isSave = graph.source(mode.id, "condition", BLUEPRINT_NODE_TYPE_STRING_EQUALS);
        expect(graph.source(isSave.id, "a", BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM).params?.paramId).toBe("mode");
        expect(isSave.params?.b).toBe("save");
        return { ...graph, mode };
    }

    it("asks before overwriting a save, and only when that slot holds one", () => {
        const { step, source, leadsTo, mode } = slotClickBranch();

        // The gate reads the same question the card's own refresh asks: is this id among the saves
        // that exist? An empty slot is written without a word.
        const listIds = step(mode.id, "true", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
        const branch = step(listIds.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
        const contains = source(branch.id, "condition", BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS);
        expect(source(contains.id, "array", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS).id).toBe(listIds.id);
        expectReadsSlotParam(source, contains.id, "item");

        const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(source, confirm, "This slot already holds a save. Overwrite it?", "Overwrite");

        const write = step(branch.id, "false", BLUEPRINT_NODE_TYPE_PERSISTENT_GET);
        expect(leadsTo(confirm.id, "button_1_pressed", write.id)).toBe(true);
    });

    it("asks before loading a save over a running game, and not from the title", () => {
        const { step, source, leadsTo, mode } = slotClickBranch();

        // The slot-exists branch was already here; the question goes inside it, so pressing an
        // empty slot still does nothing at all.
        const listIds = step(mode.id, "false", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
        const exists = step(listIds.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
        const contains = source(exists.id, "condition", BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS);
        expectReadsSlotParam(source, contains.id, "item");

        const branch = step(exists.id, "true", BLUEPRINT_NODE_TYPE_FLOW_IF);
        source(branch.id, "condition", BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME);

        const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(source, confirm, "Load this save? Unsaved progress is lost.", "Load");

        const load = step(branch.id, "false", BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD);
        expect(leadsTo(confirm.id, "button_1_pressed", load.id)).toBe(true);
    });

    // A right click deletes the slot under the cursor, and it is the one act here that nothing can
    // put back - the save screen can rewrite a slot, but a deleted one is gone. It does not branch
    // on the mode: both pages delete, which is why the card can answer for both with one path.
    it("asks before deleting a save, and only when that slot holds one", () => {
        const { step, source, leadsTo, only, nodes } = graphFor(SLOT_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
        const rightClick = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);

        // Same gate as the overwrite: an empty slot has nothing to lose, so it is deleted - which
        // deletes nothing - without a word.
        const listIds = step(rightClick.id, "then", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
        const branch = step(listIds.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
        const contains = source(branch.id, "condition", BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS);
        expectReadsSlotParam(source, contains.id, "item");

        const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(source, confirm, "Delete this save? It cannot be brought back.", "Delete");

        // Unlike the other shapes there is no false branch to the act: a slot with nothing in it is
        // left alone rather than deleted quietly.
        const remaining = Object.values(nodes).filter(node => node.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE);
        expect(remaining).toHaveLength(1);
        expect(leadsTo(confirm.id, "button_1_pressed", remaining[0]!.id)).toBe(true);
    });

    it("asks before going back to a line in the log, because everything after it is undone", () => {
        const { step, source, leadsTo, only } = graphFor(
            "5aab5352-98e9-4d9e-af03-1938fa5b5032",
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
        );
        const itemClick = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const confirm = step(itemClick.id, "then", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(source, confirm, "Go back to this line? Everything after it is undone.", "Go back");

        // Unconditional on purpose: every row in the log is behind the play head, so there is always
        // something after it to lose.
        const restore = Object.values(
            graphFor("5aab5352-98e9-4d9e-af03-1938fa5b5032", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK).nodes,
        ).filter(
            node => node.type === BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
        );
        expect(restore).toHaveLength(1);
        expect(leadsTo(confirm.id, "button_1_pressed", restore[0].id)).toBe(true);
    });

    it("asks before quitting, because the window closing is not something a click can take back", () => {
        const { step, source, leadsTo, only } = graphFor("281a47c0-277d-4ffb-83b9-8bee6a984480");
        const click = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const confirm = step(click.id, "then", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(source, confirm, "Quit the game?", "Quit");
        const quit = only(BLUEPRINT_NODE_TYPE_PAGE_QUIT);
        expect(leadsTo(confirm.id, "button_1_pressed", quit.id)).toBe(true);
    });

    it("asks before loading an auto save over a running game, and not from the title", () => {
        const { step, source, leadsTo, only } = graphFor("3d379905-7bf0-4070-b528-d2098ce9034e");
        const itemClick = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const branch = step(itemClick.id, "then", BLUEPRINT_NODE_TYPE_FLOW_IF);
        source(branch.id, "condition", BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME);

        const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(source, confirm, "Load this auto save? The game you are in is left behind.", "Load");

        const load = step(branch.id, "false", BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD);
        expect(leadsTo(confirm.id, "button_1_pressed", load.id)).toBe(true);
    });
});
