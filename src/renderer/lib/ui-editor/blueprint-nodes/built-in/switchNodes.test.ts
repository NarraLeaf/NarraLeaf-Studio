/**
 * Switch node behaviour, with one deliberate focus: `Toggle` is an exec node that publishes a
 * data output, and that combination fails silently (see `graphParamResolvers.test.ts`). Asserting
 * that the node ran proves nothing, so every toggle case here pipes the `checked` pin into a
 * Local Set and reads the local back.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_NODE_TYPE_ELEMENT_REF,
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_SET_CHECKED,
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TOGGLE,
  BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
  BLUEPRINT_NODE_TYPE_LOCAL_SET,
  BLUEPRINT_NODE_TYPE_SWITCH_GET_CHECKED,
  BLUEPRINT_NODE_TYPE_SWITCH_SET_CHECKED,
  BLUEPRINT_NODE_TYPE_SWITCH_TOGGLE,
  BLUEPRINT_NODE_TYPE_SWITCH_TURN_OFF,
  BLUEPRINT_NODE_TYPE_SWITCH_TURN_ON
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue } from "./graphParamResolvers";
import {
  ELEMENT_REF_PARAM_ELEMENT_ID,
  ELEMENT_REF_PARAM_ELEMENT_TYPE,
  ELEMENT_REF_PARAM_SURFACE_ID
} from "./elementRefUtils";

type SwitchStore = Record<string, boolean>;

function createSwitchHostAdapter(store: SwitchStore): UIHostAdapter {
  return {
    host: "player",
    blueprintRuntime: {
      surfaceId: "surface",
      hostApi: {
        widget: {
          getSwitchProperties: (elementId: string) => ({ checked: store[elementId] ?? false }),
          setSwitchProperties: async (elementId: string, patch: { checked?: boolean }) => {
            if (patch.checked !== undefined) {
              store[elementId] = patch.checked;
            }
          }
        }
      }
    }
  } as unknown as UIHostAdapter;
}

const SELF_OWNER = { surfaceId: "surface", elementId: "switch-self", blueprintId: "bp" };

/** Toggle -> Local Set, so the assertion is on the captured value, not on "the node ran". */
function toggleIntoLocalGraph(toggleType: string, elementRef: boolean) {
  const nodes: Record<string, { id: string; type: string; params?: Record<string, unknown> }> = {
    toggle: { id: "toggle", type: toggleType, params: {} },
    capture: {
      id: "capture",
      type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
      params: { variableId: "captured" }
    }
  };
  const edges = [
    { from: { nodeId: "toggle", port: "next" }, to: { nodeId: "capture", port: "in" } },
    { from: { nodeId: "toggle", port: "checked" }, to: { nodeId: "capture", port: "value" } }
  ];
  if (elementRef) {
    nodes.ref = {
      id: "ref",
      type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
      params: {
        [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
        [ELEMENT_REF_PARAM_ELEMENT_ID]: "switch-other",
        [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.switch"
      }
    };
    edges.push({
      from: { nodeId: "ref", port: "element" },
      to: { nodeId: "toggle", port: "switch" }
    });
  }
  return {
    id: "toggleGraph",
    entries: { main: { start: { nodeId: "toggle", port: "in" } } },
    nodes,
    edges
  };
}

describe("switch blueprint nodes", () => {
  it("publishes the post-toggle value on the self Toggle node's `checked` pin", async () => {
    registerCoreBlueprintNodes();
    const store: SwitchStore = { "switch-self": false };

    const localsFromOff: Record<string, unknown> = {};
    await executeGraph({
      graph: toggleIntoLocalGraph(BLUEPRINT_NODE_TYPE_SWITCH_TOGGLE, false),
      entry: { start: { nodeId: "toggle", port: "in" } },
      hostAdapter: createSwitchHostAdapter(store),
      blueprintLocals: localsFromOff,
      executionOwner: SELF_OWNER
    });
    expect(store["switch-self"]).toBe(true);
    expect(localsFromOff.captured).toBe(true);

    const localsFromOn: Record<string, unknown> = {};
    await executeGraph({
      graph: toggleIntoLocalGraph(BLUEPRINT_NODE_TYPE_SWITCH_TOGGLE, false),
      entry: { start: { nodeId: "toggle", port: "in" } },
      hostAdapter: createSwitchHostAdapter(store),
      blueprintLocals: localsFromOn,
      executionOwner: SELF_OWNER
    });
    expect(store["switch-self"]).toBe(false);
    expect(localsFromOn.captured).toBe(false);
  });

  it("publishes the post-toggle value on the Element Toggle node's `checked` pin", async () => {
    registerCoreBlueprintNodes();
    const store: SwitchStore = { "switch-self": false, "switch-other": true };

    const locals: Record<string, unknown> = {};
    await executeGraph({
      graph: toggleIntoLocalGraph(BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TOGGLE, true),
      entry: { start: { nodeId: "toggle", port: "in" } },
      hostAdapter: createSwitchHostAdapter(store),
      blueprintLocals: locals,
      executionOwner: SELF_OWNER
    });
    // The element ref wins over the execution owner, and only it moves.
    expect(store["switch-other"]).toBe(false);
    expect(store["switch-self"]).toBe(false);
    expect(locals.captured).toBe(false);
  });

  it("writes through Set Checked, Turn On and Turn Off", async () => {
    registerCoreBlueprintNodes();
    const store: SwitchStore = { "switch-self": false };
    const hostAdapter = createSwitchHostAdapter(store);

    await executeGraph({
      graph: {
        id: "setChecked",
        entries: { main: { start: { nodeId: "set", port: "in" } } },
        nodes: {
          set: { id: "set", type: BLUEPRINT_NODE_TYPE_SWITCH_SET_CHECKED, params: {} },
          literal: {
            id: "literal",
            type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
            params: { value: true }
          }
        },
        edges: [
          { from: { nodeId: "literal", port: "value" }, to: { nodeId: "set", port: "checked" } }
        ]
      },
      entry: { start: { nodeId: "set", port: "in" } },
      hostAdapter,
      executionOwner: SELF_OWNER
    });
    expect(store["switch-self"]).toBe(true);

    await executeGraph({
      graph: {
        id: "turnOff",
        entries: { main: { start: { nodeId: "off", port: "in" } } },
        nodes: { off: { id: "off", type: BLUEPRINT_NODE_TYPE_SWITCH_TURN_OFF, params: {} } },
        edges: []
      },
      entry: { start: { nodeId: "off", port: "in" } },
      hostAdapter,
      executionOwner: SELF_OWNER
    });
    expect(store["switch-self"]).toBe(false);

    await executeGraph({
      graph: {
        id: "turnOn",
        entries: { main: { start: { nodeId: "on", port: "in" } } },
        nodes: { on: { id: "on", type: BLUEPRINT_NODE_TYPE_SWITCH_TURN_ON, params: {} } },
        edges: []
      },
      entry: { start: { nodeId: "on", port: "in" } },
      hostAdapter,
      executionOwner: SELF_OWNER
    });
    expect(store["switch-self"]).toBe(true);
  });

  it("reads the runtime state through the pure Get Checked node", () => {
    registerCoreBlueprintNodes();
    const hostAdapter = createSwitchHostAdapter({ "switch-self": true });

    expect(
      resolveDataPinValue(
        {
          nodes: { get: { type: BLUEPRINT_NODE_TYPE_SWITCH_GET_CHECKED, params: {} } },
          edges: []
        },
        "get",
        "checked",
        {},
        undefined,
        0,
        { hostAdapter, executionOwner: SELF_OWNER }
      )
    ).toBe(true);
  });

  it("refuses an Element Set Checked whose ref is not a switch", async () => {
    registerCoreBlueprintNodes();
    const store: SwitchStore = {};

    await expect(
      executeGraph({
        graph: {
          id: "wrongType",
          entries: { main: { start: { nodeId: "set", port: "in" } } },
          nodes: {
            ref: {
              id: "ref",
              type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
              params: {
                [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                [ELEMENT_REF_PARAM_ELEMENT_ID]: "not-a-switch",
                [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.slider"
              }
            },
            set: { id: "set", type: BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_SET_CHECKED, params: {} }
          },
          edges: [
            { from: { nodeId: "ref", port: "element" }, to: { nodeId: "set", port: "switch" } }
          ]
        },
        entry: { start: { nodeId: "set", port: "in" } },
        hostAdapter: createSwitchHostAdapter(store),
        executionOwner: SELF_OWNER
      })
    ).rejects.toThrow("nl.switch");
    expect(store).toEqual({});
  });
});
