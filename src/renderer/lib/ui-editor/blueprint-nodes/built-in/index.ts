/**
 * Built-in blueprint node definitions, grouped by domain.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { mathBlueprintNodes } from "./mathNodes";
import { persistenceBlueprintNodes } from "./persistenceNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { structuralBlueprintNodes } from "./structuralNodes";
import { widgetHostBlueprintNodes } from "./widget/widgetHostNodes";

export { controlFlowBlueprintNodes } from "./controlFlowNodes";
export { devtoolsBlueprintNodes } from "./devtoolsNodes";
export { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
export { localVariableBlueprintNodes } from "./localVariableNodes";
export { mathBlueprintNodes } from "./mathNodes";
export { stringBlueprintNodes } from "./stringNodes";
export { persistenceBlueprintNodes } from "./persistenceNodes";
export { structuralBlueprintNodes } from "./structuralNodes";
export { widgetHostBlueprintNodes } from "./widget/widgetHostNodes";

/** All core built-in nodes in registration order (must stay stable if you rely on duplicate checks elsewhere). */
export const allBuiltinBlueprintNodes: BlueprintNodeDef[] = [
    ...structuralBlueprintNodes,
    ...eventHeadBlueprintNodes,
    ...controlFlowBlueprintNodes,
    ...localVariableBlueprintNodes,
    ...mathBlueprintNodes,
    ...stringBlueprintNodes,
    ...widgetHostBlueprintNodes,
    ...persistenceBlueprintNodes,
    ...devtoolsBlueprintNodes,
];
