/**
 * Built-in blueprint node definitions, grouped by domain.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { backlogBlueprintNodes } from "./backlogNodes";
import { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
import { broadcastBlueprintNodes } from "./broadcastNodes";
import { collectionBlueprintNodes } from "./collectionNodes";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { dataBlueprintNodes } from "./dataNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { elementBlueprintNodes } from "./elementNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { fnBlueprintNodes } from "./fnNodes";
import { frameBlueprintNodes } from "./frameNodes";
import { gameBlueprintNodes } from "./gameNodes";
import { listBlueprintNodes } from "./listNodes";
import { localizationBlueprintNodes } from "./localizationNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { mathBlueprintNodes } from "./mathNodes";
import { persistentVariableBlueprintNodes } from "./persistentVariableNodes";
import { sliderBlueprintNodes } from "./sliderNodes";
import { storyVariableBlueprintNodes } from "./storyVariableNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";
import { widgetPropertyBlueprintNodes } from "./widgetPropertyNodes";

export { backlogBlueprintNodes } from "./backlogNodes";
export { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
export { broadcastBlueprintNodes } from "./broadcastNodes";
export { collectionBlueprintNodes } from "./collectionNodes";
export { controlFlowBlueprintNodes } from "./controlFlowNodes";
export { dataBlueprintNodes } from "./dataNodes";
export { devtoolsBlueprintNodes } from "./devtoolsNodes";
export { elementBlueprintNodes } from "./elementNodes";
export { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
export { fnBlueprintNodes } from "./fnNodes";
export { frameBlueprintNodes } from "./frameNodes";
export { gameBlueprintNodes } from "./gameNodes";
export { listBlueprintNodes } from "./listNodes";
export { localizationBlueprintNodes } from "./localizationNodes";
export { localVariableBlueprintNodes } from "./localVariableNodes";
export { mathBlueprintNodes } from "./mathNodes";
export { persistentVariableBlueprintNodes } from "./persistentVariableNodes";
export { storyVariableBlueprintNodes } from "./storyVariableNodes";
export { sliderBlueprintNodes } from "./sliderNodes";
export { navigationBlueprintNodes } from "./navigationNodes";
export { stringBlueprintNodes } from "./stringNodes";
export { textBlueprintNodes } from "./textNodes";
export { structuralBlueprintNodes } from "./structuralNodes";
export { widgetHostBlueprintNodes } from "./widget/widgetHostNodes";
export { imageAssetBlueprintNodes, widgetPropertyBlueprintNodes } from "./widgetPropertyNodes";

/** All core built-in nodes in registration order (must stay stable if you rely on duplicate checks elsewhere). */
export const allBuiltinBlueprintNodes: BlueprintNodeDef[] = [
    ...eventHeadBlueprintNodes,
    ...broadcastBlueprintNodes,
    ...fnBlueprintNodes,
    ...frameBlueprintNodes,
    ...gameBlueprintNodes,
    ...backlogBlueprintNodes,
    ...controlFlowBlueprintNodes,
    ...dataBlueprintNodes,
    ...collectionBlueprintNodes,
    ...listBlueprintNodes,
    ...elementBlueprintNodes,
    ...localVariableBlueprintNodes,
    ...localizationBlueprintNodes,
    ...persistentVariableBlueprintNodes,
    ...storyVariableBlueprintNodes,
    ...mathBlueprintNodes,
    ...booleanCompareBlueprintNodes,
    ...stringBlueprintNodes,
    ...textBlueprintNodes,
    ...sliderBlueprintNodes,
    ...widgetPropertyBlueprintNodes,
    ...devtoolsBlueprintNodes,
];
