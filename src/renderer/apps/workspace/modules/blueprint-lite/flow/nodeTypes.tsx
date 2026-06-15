import type { NodeTypes } from "@xyflow/react";
import { BlueprintFlowNode } from "./components/BlueprintFlowNode";

/** Stable reference for React Flow (do not recreate per render). */
export const blueprintFlowNodeTypes = {
    blueprint: BlueprintFlowNode,
} satisfies NodeTypes;
