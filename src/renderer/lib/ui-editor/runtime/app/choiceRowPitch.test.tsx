// @vitest-environment jsdom
/**
 * A choice menu's rows sit one template height plus the item gap apart in a running game.
 *
 * The list draws its placeholder rows until the menu's options arrive, a render later. Every
 * placeholder is the declared shape at its empty values, so on a list keyed on `index` they all
 * carried the key `0`, and React - told four rows were one - never removed two of them when the real
 * rows replaced them. They stayed in the list, blank and full height, between the first option and
 * the second: two options came out three template heights apart. The canvas, which draws the
 * placeholders once and never swaps them, showed the pitch the author set, so the two disagreed.
 *
 * What runs is what a game runs short of the engine: the real slot shell and element tree, with the
 * options handed to the list from an effect after the first render, as the choice slot does. jsdom
 * has no layout, so the pitch is asserted through what decides it: the rows are adjacent children of
 * a flex column whose gap is the item gap, and each holds exactly the template at its height.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UIStageSurface,
} from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createRecordingCore, ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { AmbientSurfaceTargets } from "./ambientSurfaceEvents";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import {
    StageSlotSurfaceBody,
    stageSlotWidgetRuntimeKey,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const TEMPLATE_HEIGHT = 53;
const ITEM_GAP = 12;

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more: Partial<UIElement> = {}): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 400, height: 40, visible: true }, ...more };
}

const surface = {
    id: "choice",
    name: "Choice",
    host: "player",
    kind: "stageSurface",
    mount: { kind: "slot", slotId: "choice" },
    designSize: { width: 1920, height: 1080 },
    rootElementId: "root",
    settings: { backgroundColor: "transparent" },
} as unknown as UIStageSurface;

const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: element("root", "nl.root", null, ["options"], { layout: { x: 0, y: 0, width: 1920, height: 1080, visible: true } }),
        // Authored the way a list is when nobody fills in sample rows: no `items`, so the list draws
        // its placeholders until the menu's options arrive.
        options: element("options", "nl.choice.list", "root", ["option"], {
            layout: { x: 560, y: 0, width: 800, height: 1080, visible: true },
            props: { itemStructId: "nl.choiceItem", itemKeyFieldId: "index", itemGap: ITEM_GAP, repeatDirection: "vertical" },
        }),
        option: element("option", "nl.container", "options", ["label"], {
            layout: { x: 0, y: 0, width: 800, height: TEMPLATE_HEIGHT, visible: true },
            extra: { listSlot: "itemTemplate" },
        }),
        label: element("label", "nl.text", "option", [], {
            layout: { x: 0, y: 0, width: 800, height: TEMPLATE_HEIGHT, visible: true },
            props: { text: "Option" },
        }),
    },
} as unknown as UIDocument;

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
    ensureAnimationFramePolyfill();
});

afterEach(() => cleanup());

function slotOptions(widgetRuntimeStore: WidgetRuntimeStateStore): GameUiSlotHostOptions {
    const core = createRecordingCore([]);
    const blueprintDocument = blueprintDocumentOf([]);
    const bundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-10-11T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    } as unknown as DevModeBundle;
    return {
        sessionId: "session",
        core,
        bundle,
        rendererRegistry: new ElementRendererRegistry(BuiltinElementRenderers),
        lifecycleRef: { current: new SurfaceLifecycleOrchestrator() },
        makeStateAccessors: () => null,
        host: { widgetRuntimeStore, localizationConfig: null, voiceConfig: null } as unknown as GameHostCapabilities,
        startStory: async () => undefined,
        setWidgetPatchesByScope: () => undefined,
        widgetPatchesByScopeRef: { current: {} as WidgetPatchesByScope },
        ambientSurfaces: new AmbientSurfaceTargets(),
        stageKeyboardSurfaces: new AmbientSurfaceTargets(),
    } as unknown as GameUiSlotHostOptions;
}

/** The choice slot as a game draws it: the options reach the list from an effect, after the first render. */
function ChoiceMenu(props: { options: GameUiSlotHostOptions; store: WidgetRuntimeStateStore; choices: string[] }) {
    const { options, store, choices } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "choice" });
    useEffect(() => {
        store.setListItems(
            stageSlotWidgetRuntimeKey(runtime.runtimeScopeId, "options"),
            choices.map((text, index) => ({ text, index, disabled: false, voiceId: "" })),
        );
    }, [choices, runtime.runtimeScopeId, store]);
    return <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} navigable />;
}

async function drawMenu(choices: string[]) {
    const store = new WidgetRuntimeStateStore();
    const view = render(<ChoiceMenu options={slotOptions(store)} store={store} choices={choices} />);
    await act(async () => {
        for (let turn = 0; turn < 10; turn++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    });
    return view.container;
}

function rowsOf(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-ui-list-item-index]"));
}

describe("choice rows in a running game", () => {
    it("draws one row per option and nothing between them once the options replace the placeholders", async () => {
        const container = await drawMenu(["Stay", "Leave"]);
        const rows = rowsOf(container);

        expect(rows.map(row => row.getAttribute("data-ui-list-item-key"))).toEqual(["0", "1"]);
        expect(rows.map(row => row.getAttribute("data-ui-list-item-index"))).toEqual(["0", "1"]);
        // Adjacent in the flex column: no stale row is left between the first option and the second.
        expect(rows[0]!.nextElementSibling).toBe(rows[1]);
    });

    it("puts the rows one template height plus the item gap apart", async () => {
        const container = await drawMenu(["North", "South", "East"]);
        const rows = rowsOf(container);
        expect(rows).toHaveLength(3);

        const column = rows[0]!.parentElement!;
        expect(Array.from(column.children)).toEqual(rows);
        expect(column.style.flexDirection).toBe("column");
        expect(column.style.gap).toBe(`${ITEM_GAP}px`);
        for (const row of rows) {
            const drawn = Array.from(row.children).filter(child => child.hasAttribute("data-ui-element-id"));
            expect(drawn.map(child => child.getAttribute("data-ui-element-id"))).toEqual(["option"]);
            expect((drawn[0] as HTMLElement).style.height).toBe(`${TEMPLATE_HEIGHT}px`);
        }
    });

    it("keeps the rows apart when the options themselves repeat a key", async () => {
        const store = new WidgetRuntimeStateStore();
        const options = slotOptions(store);
        function SameKeys() {
            const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "choice" });
            useEffect(() => {
                store.setListItems(stageSlotWidgetRuntimeKey(runtime.runtimeScopeId, "options"), [
                    { text: "Up", index: 4, disabled: false, voiceId: "" },
                    { text: "Down", index: 4, disabled: false, voiceId: "" },
                ]);
            }, [runtime.runtimeScopeId]);
            return <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} navigable />;
        }
        const view = render(<SameKeys />);
        await act(async () => {
            for (let turn = 0; turn < 10; turn++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        });

        const rows = rowsOf(view.container);
        expect(rows.map(row => row.getAttribute("data-ui-list-item-key"))).toEqual(["4", "4#1"]);
        expect(rows[0]!.nextElementSibling).toBe(rows[1]);
    });
});
