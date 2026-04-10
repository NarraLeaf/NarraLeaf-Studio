/**
 * Built-in blueprint node definitions, grouped by domain.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { navigationBlueprintNodes } from "./navigationNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { mathBlueprintNodes } from "./mathNodes";
import { persistenceBlueprintNodes } from "./persistenceNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { structuralBlueprintNodes } from "./structuralNodes";
import { widgetButtonBlueprintNodes } from "./widgetButtonNodes";
import { widgetElementBlueprintNodes } from "./widgetElementNodes";

export { controlFlowBlueprintNodes } from "./controlFlowNodes";
export { devtoolsBlueprintNodes } from "./devtoolsNodes";
export { localVariableBlueprintNodes } from "./localVariableNodes";
export { mathBlueprintNodes } from "./mathNodes";
export { stringBlueprintNodes } from "./stringNodes";
export { navigationBlueprintNodes } from "./navigationNodes";
export { persistenceBlueprintNodes } from "./persistenceNodes";
export { structuralBlueprintNodes } from "./structuralNodes";
export { widgetButtonBlueprintNodes } from "./widgetButtonNodes";
export { widgetElementBlueprintNodes } from "./widgetElementNodes";

/** All core built-in nodes in registration order (must stay stable if you rely on duplicate checks elsewhere). */
export const allBuiltinBlueprintNodes: BlueprintNodeDef[] = [
    ...structuralBlueprintNodes,
    ...controlFlowBlueprintNodes,
    ...localVariableBlueprintNodes,
    ...mathBlueprintNodes,
    ...stringBlueprintNodes,
    ...navigationBlueprintNodes,
    ...widgetElementBlueprintNodes,
    ...widgetButtonBlueprintNodes,
    ...persistenceBlueprintNodes,
    ...devtoolsBlueprintNodes,
];
