/**
 * Switch widget nodes from the documented Blueprint catalog.
 * Comments in English per project convention.
 */

import {
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_GET_CHECKED,
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_SET_CHECKED,
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TOGGLE,
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TURN_OFF,
  BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TURN_ON,
  BLUEPRINT_NODE_TYPE_SWITCH_GET_CHECKED,
  BLUEPRINT_NODE_TYPE_SWITCH_SET_CHECKED,
  BLUEPRINT_NODE_TYPE_SWITCH_TOGGLE,
  BLUEPRINT_NODE_TYPE_SWITCH_TURN_OFF,
  BLUEPRINT_NODE_TYPE_SWITCH_TURN_ON
} from "@shared/types/blueprint/graph";
import { blueprintElementValueType } from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintSwitchPropertiesPatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { writeBlueprintNodeOutputValues } from "../nodeOutputValues";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const SWITCH_ELEMENT_TYPE = "nl.switch";
const SWITCH_MAGIC_TARGET: NonNullable<BlueprintNodeDef["magicElementTarget"]> = {
  inputPinId: "switch",
  elementTypes: [SWITCH_ELEMENT_TYPE]
};
const SWITCH_SCOPE: BlueprintNodeDef["scope"] = {
  ownerKinds: ["widgetMain"],
  widgetElementTypes: [SWITCH_ELEMENT_TYPE]
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = {
  id: "next",
  kind: "output",
  semantic: "exec",
  label: "Next"
};
const switchIn: BlueprintNodePinDef = {
  id: "switch",
  kind: "input",
  semantic: "data",
  valueType: blueprintElementValueType(SWITCH_ELEMENT_TYPE),
  label: "Switch"
};
const boolIn = (id: string, label: string): BlueprintNodePinDef => ({
  id,
  kind: "input",
  semantic: "data",
  valueType: "boolean",
  label,
  allowInlineLiteral: true
});
const out = (id: string, label: string): BlueprintNodePinDef => ({
  id,
  kind: "output",
  semantic: "data",
  valueType: "boolean",
  label
});

function readNode(input: {
  type: string;
  displayName: string;
  keywords: string[];
  pins: BlueprintNodePinDef[];
  target: "self" | "element";
}): BlueprintNodeDef {
  const elementTarget = input.target === "element";
  return {
    type: input.type,
    displayName: input.displayName,
    category: elementTarget ? "Element" : "Switch",
    keywords: input.keywords,
    graphKinds: [...READ_GRAPH_KINDS],
    isPure: true,
    pins: elementTarget ? [switchIn, ...input.pins] : input.pins,
    magicElementTarget: elementTarget ? SWITCH_MAGIC_TARGET : undefined,
    scope: elementTarget ? undefined : SWITCH_SCOPE,
    execute: () => ({})
  };
}

function writeNode(input: {
  type: string;
  displayName: string;
  keywords: string[];
  pins: BlueprintNodePinDef[];
  target: "self" | "element";
  execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
  const elementTarget = input.target === "element";
  return {
    type: input.type,
    displayName: input.displayName,
    category: elementTarget ? "Element" : "Switch",
    keywords: input.keywords,
    graphKinds: [...WRITE_GRAPH_KINDS],
    isPure: false,
    isLatent: true,
    pins: elementTarget
      ? [execIn, execNext, switchIn, ...input.pins]
      : [execIn, execNext, ...input.pins],
    magicElementTarget: elementTarget ? SWITCH_MAGIC_TARGET : undefined,
    scope: elementTarget ? undefined : SWITCH_SCOPE,
    execute: input.execute
  };
}

function runtimeSwitchRef(
  ctx: Parameters<BlueprintNodeDef["execute"]>[0],
  target: "self" | "element"
) {
  const api = requireHostApi(ctx);
  const ref = normalizeBlueprintElementRefValue(readPin(ctx, "switch"));
  if (ref) {
    if (ref.elementType !== SWITCH_ELEMENT_TYPE) {
      throw new BlueprintGraphExecutionError(
        "Switch node requires an nl.switch element",
        ctx.node.id
      );
    }
    const currentSurfaceId = ctx.executionOwner?.surfaceId;
    if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
      throw new BlueprintGraphExecutionError(
        "Switch node can only target the current Surface",
        ctx.node.id
      );
    }
    return { api, elementId: ref.elementId };
  }
  if (target === "element") {
    throw new BlueprintGraphExecutionError(
      "Switch Element node requires a Switch input",
      ctx.node.id
    );
  }
  const elementId = ctx.executionOwner?.elementId;
  if (!elementId) {
    throw new BlueprintGraphExecutionError("Switch node requires a Switch target", ctx.node.id);
  }
  return { api, elementId };
}

function readPin(ctx: Parameters<BlueprintNodeDef["execute"]>[0], pinId: string): unknown {
  return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
    hostAdapter: ctx.hostAdapter,
    eventPayload: ctx.eventPayload,
    listItemScope: ctx.listItemScope,
    instanceKey: ctx.instanceKey,
    executionOwner: ctx.executionOwner,
    valueExecution: ctx.valueExecution
  });
}

function toBooleanValue(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  return raw === "true" || raw === "1" || raw === 1;
}

async function patchCurrentSwitch(
  ctx: Parameters<BlueprintNodeDef["execute"]>[0],
  patch: BlueprintSwitchPropertiesPatch,
  target: "self" | "element"
) {
  const { api, elementId } = runtimeSwitchRef(ctx, target);
  await api.widget.setSwitchProperties(elementId, patch);
  return { nextPort: "next" };
}

/**
 * Toggle is an exec node with a data output, so the new value has to be published into the
 * per-execution output cache by hand; `graphParamResolvers` reads it back from there. Skip
 * either half and the pin silently resolves to `undefined` downstream.
 */
async function toggleCurrentSwitch(
  ctx: Parameters<BlueprintNodeDef["execute"]>[0],
  target: "self" | "element"
) {
  const { api, elementId } = runtimeSwitchRef(ctx, target);
  const current = api.widget.getSwitchProperties(elementId);
  const next = !current.checked;
  await api.widget.setSwitchProperties(elementId, { checked: next });
  if (ctx.blueprintLocals) {
    writeBlueprintNodeOutputValues(ctx.blueprintLocals, ctx.node.id, { checked: next });
  }
  return { nextPort: "next" };
}

export const switchBlueprintNodes: BlueprintNodeDef[] = [
  readNode({
    type: BLUEPRINT_NODE_TYPE_SWITCH_GET_CHECKED,
    displayName: "Get Checked",
    keywords: ["switch", "toggle", "get", "checked", "on", "off", "state"],
    pins: [out("checked", "Checked")],
    target: "self"
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_SWITCH_SET_CHECKED,
    displayName: "Set Checked",
    keywords: ["switch", "toggle", "set", "checked", "on", "off", "state"],
    pins: [boolIn("checked", "Checked")],
    target: "self",
    execute: (ctx) =>
      patchCurrentSwitch(ctx, { checked: toBooleanValue(readPin(ctx, "checked"), false) }, "self")
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_SWITCH_TOGGLE,
    displayName: "Toggle",
    keywords: ["switch", "toggle", "flip", "invert", "checked"],
    pins: [out("checked", "Checked")],
    target: "self",
    execute: (ctx) => toggleCurrentSwitch(ctx, "self")
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_SWITCH_TURN_ON,
    displayName: "Turn On",
    keywords: ["switch", "toggle", "on", "enable", "check"],
    pins: [],
    target: "self",
    execute: (ctx) => patchCurrentSwitch(ctx, { checked: true }, "self")
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_SWITCH_TURN_OFF,
    displayName: "Turn Off",
    keywords: ["switch", "toggle", "off", "disable", "uncheck"],
    pins: [],
    target: "self",
    execute: (ctx) => patchCurrentSwitch(ctx, { checked: false }, "self")
  }),
  readNode({
    type: BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_GET_CHECKED,
    displayName: "Get Switch Checked",
    keywords: ["switch", "element", "get", "checked", "on", "off", "state"],
    pins: [out("checked", "Checked")],
    target: "element"
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_SET_CHECKED,
    displayName: "Set Switch Checked",
    keywords: ["switch", "element", "set", "checked", "on", "off", "state"],
    pins: [boolIn("checked", "Checked")],
    target: "element",
    execute: (ctx) =>
      patchCurrentSwitch(
        ctx,
        { checked: toBooleanValue(readPin(ctx, "checked"), false) },
        "element"
      )
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TOGGLE,
    displayName: "Toggle Switch",
    keywords: ["switch", "element", "toggle", "flip", "invert", "checked"],
    pins: [out("checked", "Checked")],
    target: "element",
    execute: (ctx) => toggleCurrentSwitch(ctx, "element")
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TURN_ON,
    displayName: "Turn Switch On",
    keywords: ["switch", "element", "on", "enable", "check"],
    pins: [],
    target: "element",
    execute: (ctx) => patchCurrentSwitch(ctx, { checked: true }, "element")
  }),
  writeNode({
    type: BLUEPRINT_NODE_TYPE_ELEMENT_SWITCH_TURN_OFF,
    displayName: "Turn Switch Off",
    keywords: ["switch", "element", "off", "disable", "uncheck"],
    pins: [],
    target: "element",
    execute: (ctx) => patchCurrentSwitch(ctx, { checked: false }, "element")
  })
];
