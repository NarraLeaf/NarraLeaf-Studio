/**
 * Built-in blueprint node definitions, grouped by domain.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { appTagBlueprintNodes } from "./appTagNodes";
import { backlogBlueprintNodes } from "./backlogNodes";
import { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
import { broadcastBlueprintNodes } from "./broadcastNodes";
import { collectionBlueprintNodes } from "./collectionNodes";
import { componentBlueprintNodes } from "./componentNodes";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { dataBlueprintNodes } from "./dataNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { elementBlueprintNodes } from "./elementNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { fnBlueprintNodes } from "./fnNodes";
import { frameBlueprintNodes } from "./frameNodes";
import { pointerBlueprintNodes } from "./pointerNodes";
import { gameBlueprintNodes } from "./gameNodes";
import { layerBlueprintNodes } from "./layerNodes";
import { listBlueprintNodes } from "./listNodes";
import { localizationBlueprintNodes } from "./localizationNodes";
import { voiceBlueprintNodes } from "./voiceNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { mathBlueprintNodes } from "./mathNodes";
import { networkBlueprintNodes } from "./networkNodes";
import { persistentVariableBlueprintNodes } from "./persistentVariableNodes";
import { progressBlueprintNodes } from "./progressNodes";
import { sliderBlueprintNodes } from "./sliderNodes";
import { soundBlueprintNodes } from "./soundNodes";
import { structuralBlueprintNodes } from "./structuralNodes";
import { switchBlueprintNodes } from "./switchNodes";
import { textInputBlueprintNodes } from "./textInputNodes";
import { storyVariableBlueprintNodes } from "./storyVariableNodes";
import { visitedBlueprintNodes } from "./visitedNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";
import { timeBlueprintNodes } from "./timeNodes";
import { widgetPropertyBlueprintNodes } from "./widgetPropertyNodes";

export { appTagBlueprintNodes } from "./appTagNodes";
export { backlogBlueprintNodes } from "./backlogNodes";
export { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
export { broadcastBlueprintNodes } from "./broadcastNodes";
export { collectionBlueprintNodes } from "./collectionNodes";
export { componentBlueprintNodes, BLUEPRINT_COMPONENT_PARAM_OPTIONS_SOURCE } from "./componentNodes";
export { controlFlowBlueprintNodes } from "./controlFlowNodes";
export { dataBlueprintNodes } from "./dataNodes";
export { devtoolsBlueprintNodes } from "./devtoolsNodes";
export { elementBlueprintNodes } from "./elementNodes";
export { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
export { fnBlueprintNodes } from "./fnNodes";
export { frameBlueprintNodes } from "./frameNodes";
export { pointerBlueprintNodes } from "./pointerNodes";
export { gameBlueprintNodes } from "./gameNodes";
export { layerBlueprintNodes } from "./layerNodes";
export { listBlueprintNodes } from "./listNodes";
export { localizationBlueprintNodes } from "./localizationNodes";
export { voiceBlueprintNodes } from "./voiceNodes";
export { localVariableBlueprintNodes } from "./localVariableNodes";
export { mathBlueprintNodes } from "./mathNodes";
export { networkBlueprintNodes } from "./networkNodes";
export { persistentVariableBlueprintNodes } from "./persistentVariableNodes";
export { progressBlueprintNodes } from "./progressNodes";
export { storyVariableBlueprintNodes } from "./storyVariableNodes";
export { visitedBlueprintNodes } from "./visitedNodes";
export { sliderBlueprintNodes } from "./sliderNodes";
export { soundBlueprintNodes } from "./soundNodes";
export { switchBlueprintNodes } from "./switchNodes";
export { textInputBlueprintNodes } from "./textInputNodes";
export { stringBlueprintNodes } from "./stringNodes";
export { textBlueprintNodes } from "./textNodes";
export { timeBlueprintNodes } from "./timeNodes";
export { structuralBlueprintNodes } from "./structuralNodes";
export { imageAssetBlueprintNodes, widgetPropertyBlueprintNodes } from "./widgetPropertyNodes";

/** All core built-in nodes in registration order (must stay stable if you rely on duplicate checks elsewhere). */
export const allBuiltinBlueprintNodes: BlueprintNodeDef[] = [
    ...structuralBlueprintNodes,
    ...eventHeadBlueprintNodes,
    ...broadcastBlueprintNodes,
    ...fnBlueprintNodes,
    ...frameBlueprintNodes,
    ...pointerBlueprintNodes,
    ...layerBlueprintNodes,
    ...componentBlueprintNodes,
    ...gameBlueprintNodes,
    ...visitedBlueprintNodes,
    ...appTagBlueprintNodes,
    ...progressBlueprintNodes,
    ...backlogBlueprintNodes,
    ...controlFlowBlueprintNodes,
    ...dataBlueprintNodes,
    ...collectionBlueprintNodes,
    ...listBlueprintNodes,
    ...elementBlueprintNodes,
    ...localVariableBlueprintNodes,
    ...localizationBlueprintNodes,
    ...voiceBlueprintNodes,
    ...soundBlueprintNodes,
    ...networkBlueprintNodes,
    ...persistentVariableBlueprintNodes,
    ...storyVariableBlueprintNodes,
    ...mathBlueprintNodes,
    ...booleanCompareBlueprintNodes,
    ...stringBlueprintNodes,
    ...timeBlueprintNodes,
    ...textBlueprintNodes,
    ...sliderBlueprintNodes,
    ...switchBlueprintNodes,
    ...textInputBlueprintNodes,
    ...widgetPropertyBlueprintNodes,
    ...devtoolsBlueprintNodes,
];
