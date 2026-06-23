/**
 * Built-in blueprint node definitions, grouped by domain.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
import { broadcastBlueprintNodes } from "./broadcastNodes";
import { collectionBlueprintNodes } from "./collectionNodes";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { dataBlueprintNodes } from "./dataNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { elementBlueprintNodes } from "./elementNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { frameBlueprintNodes } from "./frameNodes";
import { listBlueprintNodes } from "./listNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { mathBlueprintNodes } from "./mathNodes";
import { sliderBlueprintNodes } from "./sliderNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";

export { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
export { broadcastBlueprintNodes } from "./broadcastNodes";
export { collectionBlueprintNodes } from "./collectionNodes";
export { controlFlowBlueprintNodes } from "./controlFlowNodes";
export { dataBlueprintNodes } from "./dataNodes";
export { devtoolsBlueprintNodes } from "./devtoolsNodes";
export { elementBlueprintNodes } from "./elementNodes";
export { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
export { frameBlueprintNodes } from "./frameNodes";
export { listBlueprintNodes } from "./listNodes";
export { localVariableBlueprintNodes } from "./localVariableNodes";
export { mathBlueprintNodes } from "./mathNodes";
export { sliderBlueprintNodes } from "./sliderNodes";
export { navigationBlueprintNodes } from "./navigationNodes";
export { stringBlueprintNodes } from "./stringNodes";
export { textBlueprintNodes } from "./textNodes";
export { persistenceBlueprintNodes } from "./persistenceNodes";
export { structuralBlueprintNodes } from "./structuralNodes";
export { widgetHostBlueprintNodes } from "./widget/widgetHostNodes";

/** All core built-in nodes in registration order (must stay stable if you rely on duplicate checks elsewhere). */
export const allBuiltinBlueprintNodes: BlueprintNodeDef[] = [
    ...eventHeadBlueprintNodes,
    ...broadcastBlueprintNodes,
    ...frameBlueprintNodes,
    ...controlFlowBlueprintNodes,
    ...dataBlueprintNodes,
    ...collectionBlueprintNodes,
    ...listBlueprintNodes,
    ...elementBlueprintNodes,
    ...localVariableBlueprintNodes,
    ...mathBlueprintNodes,
    ...booleanCompareBlueprintNodes,
    ...stringBlueprintNodes,
    ...textBlueprintNodes,
    ...sliderBlueprintNodes,
    ...devtoolsBlueprintNodes,
];
