/**
 * A widget node reads and writes the drawing it is running in, not the element it was authored on.
 *
 * One element id names a place in the document; it does not name a thing on screen. A list draws its
 * template once per row and a component draws its definition once per placement, so everything a
 * graph reads or writes has to carry the drawing too - the pairing `widgetAddress.ts` exists for.
 *
 * This is here because that pairing was adopted one node module at a time, and a module that was
 * missed cannot be spotted by reading it: an address with no drawing is the element id byte for
 * byte, so a template-addressed node is correct everywhere except inside a component instance or a
 * list row, and passes every test that does not put it in one.
 *
 * The assertions are deliberately not "which string did the host receive". Each family is seeded at
 * both addresses with different values, so a node that addresses the template reads the wrong value
 * back and leaves the drawing untouched - which is what an author sees, and what a call-argument
 * assertion would let through if the address were built correctly and then dropped downstream.
 *
 * One family is one row. A widget family added without its row is the mistake this file exists to
 * make loud.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
    BLUEPRINT_NODE_TYPE_SWITCH_GET_CHECKED,
    BLUEPRINT_NODE_TYPE_SWITCH_SET_CHECKED,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_INPUT_GET_VALUE,
    BLUEPRINT_NODE_TYPE_TEXT_INPUT_SET_VALUE,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../behavior-graph/GraphExecutor";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";
import { resolveDataPinValue } from "./built-in/graphParamResolvers";

const SURFACE_ID = "surface";
const ELEMENT_ID = "widget";
/** The drawing. A component placement and a list row both announce themselves this way. */
const INSTANCE_KEY = "placement-2";
const TEMPLATE_ADDRESS = ELEMENT_ID;
const DRAWING_ADDRESS = buildUIWidgetAddress(ELEMENT_ID, INSTANCE_KEY);

/** Widget props as the host holds them, keyed by address rather than by element. */
type PropStore = Record<string, Record<string, unknown>>;

type WidgetFamily = {
    /** The widget type, for the failure message. */
    name: string;
    /** The self-targeting setter, and the pin its value arrives on. */
    setterType: string;
    setterPin: string;
    /** The pure self-targeting getter, and the port the value leaves by. */
    getterType: string;
    getterPort: string;
    /** Distinguishable seeds, so reading the wrong address returns the wrong answer. */
    templateValue: unknown;
    drawingValue: unknown;
    /** What the setter is asked to write, distinct from both seeds. */
    written: unknown;
    /** Everything else the host must answer with for the family's readers to work. */
    extraProps?: Record<string, unknown>;
};

const FAMILIES: WidgetFamily[] = [
    {
        name: "nl.text",
        setterType: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
        setterPin: "text",
        getterType: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
        getterPort: "text",
        templateValue: "authored on the template",
        drawingValue: "this drawing",
        written: "written by the graph",
    },
    {
        name: "nl.textInput",
        setterType: BLUEPRINT_NODE_TYPE_TEXT_INPUT_SET_VALUE,
        setterPin: "value",
        getterType: BLUEPRINT_NODE_TYPE_TEXT_INPUT_GET_VALUE,
        getterPort: "value",
        templateValue: "template entry",
        drawingValue: "drawing entry",
        written: "typed here",
    },
    {
        name: "nl.slider",
        setterType: BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
        setterPin: "value",
        getterType: BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
        getterPort: "value",
        templateValue: 1,
        drawingValue: 2,
        written: 7,
        extraProps: { min: 0, max: 10, step: 1, normalizedValue: 0.2 },
    },
    {
        name: "nl.switch",
        setterType: BLUEPRINT_NODE_TYPE_SWITCH_SET_CHECKED,
        setterPin: "checked",
        getterType: BLUEPRINT_NODE_TYPE_SWITCH_GET_CHECKED,
        getterPort: "checked",
        templateValue: false,
        drawingValue: true,
        written: false,
    },
];

/** The prop each family's setter patch and getter output travel under. */
function propKey(family: WidgetFamily): string {
    return family.setterPin;
}

function seedStore(family: WidgetFamily): PropStore {
    const key = propKey(family);
    return {
        [TEMPLATE_ADDRESS]: { ...family.extraProps, [key]: family.templateValue, length: 0 },
        [DRAWING_ADDRESS]: { ...family.extraProps, [key]: family.drawingValue, length: 0 },
    };
}

/**
 * A host that keys by whatever string the node hands it.
 *
 * Every family shares one getter and one setter, because the point under test is the address and
 * not the payload - and because a per-family stub would let a family be added here without being
 * added to the table.
 */
function createHostAdapter(store: PropStore): UIHostAdapter {
    const get = (address: string) => store[address] ?? {};
    const set = async (address: string, patch: Record<string, unknown>) => {
        store[address] = { ...(store[address] ?? {}), ...patch };
    };
    const widget = {
        getTextProperties: get,
        setTextProperties: set,
        getTextInputProperties: get,
        setTextInputProperties: set,
        getSliderProperties: get,
        setSliderProperties: set,
        getSwitchProperties: get,
        setSwitchProperties: set,
    };
    return {
        host: "player",
        blueprintRuntime: { surfaceId: SURFACE_ID, hostApi: { widget } },
    } as unknown as UIHostAdapter;
}

const EXECUTION_OWNER = { surfaceId: SURFACE_ID, elementId: ELEMENT_ID, blueprintId: "bp" };

describe.each(FAMILIES)("$name inside a component placement", family => {
    it("writes to the drawing and leaves the template alone", async () => {
        registerCoreBlueprintNodes();
        const store = seedStore(family);

        await executeGraph({
            graph: {
                id: "write",
                entries: { main: { start: { nodeId: "set", port: "in" } } },
                nodes: {
                    set: { id: "set", type: family.setterType, params: { [family.setterPin]: family.written } },
                },
                edges: [],
            },
            entry: { start: { nodeId: "set", port: "in" } },
            hostAdapter: createHostAdapter(store),
            executionOwner: EXECUTION_OWNER,
            instanceKey: INSTANCE_KEY,
        });

        const key = propKey(family);
        expect(store[DRAWING_ADDRESS]?.[key]).toEqual(family.written);
        // The template is what every other placement of this component draws from. A write that
        // lands here is the "all six save slots showed the sixth" bug; a write that lands nowhere
        // is the same defect after the address existed but one module had not adopted it.
        expect(store[TEMPLATE_ADDRESS]?.[key]).toEqual(family.templateValue);
    });

    it("reads the drawing rather than the authored template", () => {
        registerCoreBlueprintNodes();
        const store = seedStore(family);

        const read = resolveDataPinValue(
            { nodes: { get: { type: family.getterType, params: {} } }, edges: [] },
            "get",
            family.getterPort,
            {},
            undefined,
            0,
            { hostAdapter: createHostAdapter(store), executionOwner: EXECUTION_OWNER, instanceKey: INSTANCE_KEY },
        );

        expect(read).toEqual(family.drawingValue);
    });
});

describe("a widget drawn only once", () => {
    it("keeps the keys it always had, so no stored project moves", () => {
        // The compatibility claim the whole address scheme rests on: with no drawing, an address is
        // the element id byte for byte. Worth an assertion of its own, because every test above
        // would still pass if that stopped being true.
        expect(buildUIWidgetAddress(ELEMENT_ID, undefined)).toBe(ELEMENT_ID);
        expect(buildUIWidgetAddress(ELEMENT_ID, "")).toBe(ELEMENT_ID);
    });
});
