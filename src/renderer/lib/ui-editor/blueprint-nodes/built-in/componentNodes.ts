/**
 * Nodes that read the component instance a blueprint is currently running for.
 *
 * A component's blueprint is shared by every placement of it, so anything written into the graph is
 * the same for all of them. Params are the one thing that is not, and this is the node that reads
 * them; without it a component is only worth placing once.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM } from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";

/** Dynamic select source id for the declared params of the component being edited. */
export const BLUEPRINT_COMPONENT_PARAM_OPTIONS_SOURCE = "componentParams";

export const componentBlueprintNodes: BlueprintNodeDef[] = [
  {
    type: BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    displayName: "Get Component Param",
    category: "Component",
    keywords: ["component", "param", "parameter", "instance", "input", "property"],
    graphKinds: ["event", "macro"],
    isPure: true,
    // Only a component's own widget blueprint has an instance to ask. A page's widget has no
    // placement behind it, and a value graph is not keyed per instance (see the params notes in
    // BlueprintValueRuntimeStore), so offering the node there would read the wrong thing.
    scope: { ownerKinds: ["componentWidgetMain"] },
    pins: [{ id: "value", kind: "output", semantic: "data", valueType: "string", label: "Value" }],
    inspectorParams: [
      {
        key: "paramId",
        label: "Param",
        kind: "select",
        dynamicOptionsSource: BLUEPRINT_COMPONENT_PARAM_OPTIONS_SOURCE,
        emptyOptionLabel: "None"
      }
    ],
    // Output resolution lives in graphParamResolvers; a pure node's `execute` never publishes.
    execute: () => ({})
  }
];
