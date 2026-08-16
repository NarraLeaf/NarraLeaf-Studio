/**
 * Which pins of a blueprint node carry execution, answerable without the node registry.
 *
 * An edge in a graph IR carries no kind. `{ from: { nodeId, port }, to: { nodeId, port } }` is all
 * there is, and whether that edge is a flow arrow or a value wire is a property of the *node type* at
 * its source - which lives in `@/lib/ui-editor/blueprint-nodes`, under the renderer. The main process
 * cannot import it, and the main process is where a graph is cut down to the variant being packaged
 * (see `appTagGraphFold`). This table is the part of the registry that folding needs, restated in a
 * place both processes can reach.
 *
 * # Why a table and not a rule
 *
 * There is no default entry, and a node type this file has not heard of is not "probably a data
 * node" - it is a node the fold refuses to work around. The alternative is worse than it looks: a
 * sweep that guessed wrong about one node's exec output would leave one branch of a decided `If`
 * behind, and the result is indistinguishable from a correct fold until someone finds the content
 * inside a shipped package. So the answer is either known or the build stops.
 *
 * # Keeping it true
 *
 * The registry is the authority; this is a copy of it, and a copy rots. `blueprintPinSemantics.test`
 * in the renderer walks the live registry, resolves each node's effective pins, and fails when the
 * two disagree in either direction - a node added without an entry here, and an entry here for a node
 * that no longer exists. Adding a node therefore turns that test red until it is listed, which is the
 * same discipline the lint rule registry and the blueprint node i18n map are held to.
 *
 * Entries are grouped by shape rather than listed one per line, because the shapes are what carry
 * the meaning: 285 nodes have no execution pins at all, 210 are one step of flow, 50 start one. Only
 * a dozen are irregular, and every one of them is irregular for a reason worth reading.
 */

import {
    BLUEPRINT_NODE_TYPE_APP_OPEN_EXTERNAL,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS,
    BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
} from "@shared/types/blueprint/graph";
import type { BlueprintGraphNode } from "@shared/types/blueprint/document";

/**
 * Variadic execution outputs a node keeps in its own params.
 *
 * `If Else` and `Switch String` let an author add branches, and the added pins are not in the node
 * definition at all - they are ids in `node.params[storageKey]`, expanded by
 * `resolveEffectiveBlueprintNodePins`. A pin id ending in `_${idSuffix}` among those ids is an
 * execution output; the rest of the list is the data pins that pair with them.
 */
export type BlueprintVariadicExecOutputs = {
    /** Key on `node.params` holding the ordered pin ids. */
    storageKey: string;
    /** Suffix that marks one of those ids as an execution output rather than its data twin. */
    idSuffix: string;
};

/** One node type's execution pins. Both lists are empty for a pure data node. */
export type BlueprintNodeExecPins = {
    in: readonly string[];
    out: readonly string[];
    variadicOut?: BlueprintVariadicExecOutputs;
};

/** `If Else`: one `if_N_condition` data input per added branch, paired with an `if_N_then` output. */
export const BLUEPRINT_IF_ELSE_BRANCH_PINS: BlueprintVariadicExecOutputs = {
    storageKey: "__ifElseBranchPins",
    idSuffix: "then",
};

/** `Switch String`: one `case_N_value` data input per added case, paired with a `case_N_output`. */
export const BLUEPRINT_SWITCH_STRING_CASE_PINS: BlueprintVariadicExecOutputs = {
    storageKey: "__switchStringCasePins",
    idSuffix: "output",
};

/** `Show Confirm`: one `button_N_label` data input per added button, paired with a `button_N_pressed`. */
export const BLUEPRINT_LAYER_CONFIRM_BUTTON_PINS: BlueprintVariadicExecOutputs = {
    storageKey: "__confirmButtonPins",
    idSuffix: "pressed",
};

/**
 * No execution pins at all: the value nodes, the literals, the readers, and the comment card.
 *
 * These are pulled on demand through a data pin rather than stepped through, which is what makes
 * them safe for the fold to delete once nothing consumes them any more.
 */
const PURE_DATA_NODE_TYPES: readonly string[] = [
    "blueprint.boolean.and", "blueprint.boolean.not", "blueprint.boolean.or", "blueprint.boolean.xor",
    "blueprint.broadcast.getListenerCount", "blueprint.button.getEnabled", "blueprint.button.getLabel",
    "blueprint.button.getVariant", "blueprint.button.getVisible", "blueprint.collection.arrayContains",
    "blueprint.collection.arrayGet", "blueprint.collection.arrayInsert", "blueprint.collection.arrayJoin",
    "blueprint.collection.arrayLength", "blueprint.collection.arrayPush",
    "blueprint.collection.arrayRemove", "blueprint.collection.arrayRemoveAt",
    "blueprint.collection.arraySet", "blueprint.collection.arraySlice", "blueprint.collection.objectKeys",
    "blueprint.collection.objectMerge", "blueprint.collection.objectRemoveField",
    "blueprint.collection.objectSetField", "blueprint.collection.objectValues", "blueprint.compare.equal",
    "blueprint.compare.greaterThan", "blueprint.compare.greaterThanOrEqual", "blueprint.compare.lessThan",
    "blueprint.compare.lessThanOrEqual", "blueprint.compare.notEqual", "blueprint.component.getParam",
    "blueprint.container.getClipContent", "blueprint.container.getEnabled",
    "blueprint.container.getVariant", "blueprint.container.getVisible", "blueprint.data.booleanLiteral",
    "blueprint.data.breakRect", "blueprint.data.breakVector2d",
    "blueprint.data.colorLiteral", "blueprint.data.floatLiteral", "blueprint.data.integerLiteral",
    "blueprint.data.isArray", "blueprint.data.isBoolean", "blueprint.data.isEmptyValue",
    "blueprint.data.isNull", "blueprint.data.isNumber", "blueprint.data.isObject",
    "blueprint.data.isString", "blueprint.data.jsonArrayLength", "blueprint.data.jsonClone",
    "blueprint.data.jsonGet", "blueprint.data.jsonHas", "blueprint.data.jsonLiteral",
    "blueprint.data.jsonMakeArray", "blueprint.data.jsonMakeObject", "blueprint.data.jsonMergeObject",
    "blueprint.data.jsonRemove", "blueprint.data.jsonSet", "blueprint.data.literal",
    "blueprint.data.makeRect", "blueprint.data.makeVector2d",
    "blueprint.data.notNull", "blueprint.data.nullLiteral", "blueprint.data.numberLiteral",
    "blueprint.data.parseFloat", "blueprint.data.parseInt", "blueprint.data.parseJson",
    "blueprint.data.rectCenter", "blueprint.data.rectLiteral", "blueprint.data.stringifyJson",
    "blueprint.data.stringLiteral",
    "blueprint.data.toBoolean", "blueprint.data.toFloat", "blueprint.data.toInteger",
    "blueprint.data.toJson", "blueprint.data.vector2dLiteral", "blueprint.displayable.getBounds",
    "blueprint.displayable.getDisplay", "blueprint.displayable.getOpacity",
    "blueprint.displayable.getPosition", "blueprint.displayable.getProperty",
    "blueprint.displayable.getRotation", "blueprint.displayable.getSize",
    "blueprint.displayable.getCenter", "blueprint.displayable.getMeasuredRect",
    "blueprint.displayable.getVariant", "blueprint.displayable.getVisible",
    "blueprint.element.button.getEnabled", "blueprint.element.button.getLabel",
    "blueprint.element.button.getVariant", "blueprint.element.button.getVisible",
    "blueprint.element.container.getClipContent", "blueprint.element.container.getEnabled",
    "blueprint.element.container.getVariant", "blueprint.element.container.getVisible",
    "blueprint.element.displayable.getBounds", "blueprint.element.displayable.getCenter",
    "blueprint.element.displayable.getDisplay", "blueprint.element.displayable.getMeasuredRect",
    "blueprint.element.displayable.getOpacity", "blueprint.element.displayable.getPosition",
    "blueprint.element.displayable.getProperty", "blueprint.element.displayable.getRotation",
    "blueprint.element.displayable.getSize", "blueprint.element.displayable.getVariant",
    "blueprint.element.displayable.getVisible", "blueprint.element.frame.getEnabled",
    "blueprint.element.frame.getParams", "blueprint.element.frame.getTargetPage",
    "blueprint.element.frame.getVisible", "blueprint.element.image.getCropRect",
    "blueprint.element.image.getEnabled", "blueprint.element.image.getFitMode",
    "blueprint.element.image.getFlipX", "blueprint.element.image.getFlipY",
    "blueprint.element.image.getImageAsset", "blueprint.element.image.getVisible",
    "blueprint.element.list.getEnabled", "blueprint.element.list.getItems",
    "blueprint.element.list.getSelectedIndex", "blueprint.element.list.getSelectedItem",
    "blueprint.element.list.getVisible", "blueprint.element.ref", "blueprint.element.slider.getEnabled",
    "blueprint.element.slider.getNormalizedValue", "blueprint.element.slider.getRange",
    "blueprint.element.slider.getValue", "blueprint.element.slider.getVisible",
    "blueprint.element.switch.getChecked", "blueprint.element.switch.getEnabled",
    "blueprint.element.switch.getVisible", "blueprint.element.text.getAllProperties",
    "blueprint.element.text.getEffects", "blueprint.element.text.getEnabled",
    "blueprint.element.text.getFont", "blueprint.element.text.getFontSize",
    "blueprint.element.text.getFontWeight", "blueprint.element.text.getLineHeight",
    "blueprint.element.text.getText", "blueprint.element.text.getTextAlign",
    "blueprint.element.text.getTextColor", "blueprint.element.text.getTextVerticalAlign",
    "blueprint.element.text.getVisible", "blueprint.element.text.getWrapMode",
    "blueprint.element.textInput.getValue", "blueprint.flow.comment", "blueprint.frame.getEnabled",
    "blueprint.frame.getParam", "blueprint.frame.getVisible", "blueprint.frameWidget.getParams",
    "blueprint.frameWidget.getTargetPage", "blueprint.game.getAppTag", "blueprint.game.getAutoForward",
    "blueprint.game.getBgmVolume", "blueprint.game.getCharacter", "blueprint.game.getChoiceCount",
    "blueprint.game.getCps", "blueprint.game.getGameSpeed", "blueprint.game.getGlobalVolume",
    "blueprint.game.getNametag", "blueprint.game.getNotifications", "blueprint.game.getSkip",
    "blueprint.game.getSkipDelay", "blueprint.game.getSkipInterval", "blueprint.game.getSkipReadText",
    "blueprint.game.getSoundVolume", "blueprint.game.getSpeakerAvatar", "blueprint.game.getSpeakerColor",
    "blueprint.game.getTrackVolume", "blueprint.game.getVoiceEndMode",
    "blueprint.game.getVoiceFadeDuration", "blueprint.game.getVoiceVolume",
    "blueprint.game.history.canRedo", "blueprint.game.history.canUndo", "blueprint.game.isGameOverlay",
    "blueprint.game.isInGame", "blueprint.game.isNvlMode", "blueprint.game.isOptionPicked",
    "blueprint.game.isSceneVisited", "blueprint.game.isTextRead", "blueprint.game.isTextReadById",
    "blueprint.image.assetLiteral", "blueprint.image.getCropRect", "blueprint.image.getEnabled",
    "blueprint.image.getFitMode", "blueprint.image.getFlipX", "blueprint.image.getFlipY",
    "blueprint.image.getImageAsset", "blueprint.image.getVisible", "blueprint.layer.isMounted",
    "blueprint.list.getEnabled", "blueprint.list.getItemCount", "blueprint.list.getItemIndex",
    "blueprint.list.getItemKey", "blueprint.list.getItemProps", "blueprint.list.getItems",
    "blueprint.list.getSelectedIndex", "blueprint.list.getSelectedItem", "blueprint.list.getVisible",
    "blueprint.local.declareVar", "blueprint.local.get",
    "blueprint.math.abs", "blueprint.math.add", "blueprint.math.ceil",
    "blueprint.math.decrement", "blueprint.math.divide", "blueprint.math.equal", "blueprint.math.floor",
    "blueprint.math.greater", "blueprint.math.greaterOrEqual", "blueprint.math.increment",
    "blueprint.math.less", "blueprint.math.lessOrEqual", "blueprint.math.max", "blueprint.math.min",
    "blueprint.math.modulo", "blueprint.math.multiply", "blueprint.math.notEqual",
    "blueprint.math.randomFloat", "blueprint.math.randomInteger", "blueprint.math.round",
    "blueprint.math.subtract", "blueprint.page.getProps", "blueprint.page.isSurfaceEntering",
    "blueprint.page.isSurfaceExiting", "blueprint.page.isSurfaceTransitioning",
    "blueprint.slider.getEnabled", "blueprint.slider.getNormalizedValue", "blueprint.slider.getRange",
    "blueprint.slider.getValue", "blueprint.slider.getVisible", "blueprint.string.capitalize",
    "blueprint.string.charAt", "blueprint.string.concat", "blueprint.string.contains",
    "blueprint.string.count", "blueprint.string.endsWith", "blueprint.string.equals",
    "blueprint.string.equalsIgnoreCase", "blueprint.string.extractRegex", "blueprint.string.format",
    "blueprint.string.indexOf", "blueprint.string.insert", "blueprint.string.isBlank",
    "blueprint.string.isEmpty", "blueprint.string.join", "blueprint.string.lastIndexOf",
    "blueprint.string.length", "blueprint.string.matchesRegex", "blueprint.string.normalizeLineBreaks",
    "blueprint.string.padEnd", "blueprint.string.padStart", "blueprint.string.repeat",
    "blueprint.string.replace", "blueprint.string.replaceAll", "blueprint.string.split",
    "blueprint.string.startsWith", "blueprint.string.substring", "blueprint.string.toLowerCase",
    "blueprint.string.toString", "blueprint.string.toUpperCase", "blueprint.string.trim",
    "blueprint.string.trimEnd", "blueprint.string.trimStart", "blueprint.switch.getChecked",
    "blueprint.switch.getEnabled", "blueprint.switch.getVisible", "blueprint.text.getAllProperties",
    "blueprint.text.getEffects", "blueprint.text.getEnabled", "blueprint.text.getFont",
    "blueprint.text.getFontSize", "blueprint.text.getFontWeight", "blueprint.text.getLineHeight",
    "blueprint.text.getText", "blueprint.text.getTextAlign", "blueprint.text.getTextColor",
    "blueprint.text.getTextVerticalAlign", "blueprint.text.getVisible", "blueprint.text.getWrapMode",
    "blueprint.textInput.getValue", "blueprint.time.add", "blueprint.time.difference",
    "blueprint.time.durationParts", "blueprint.time.format", "blueprint.time.formatDuration",
    "blueprint.time.formatLocalized", "blueprint.time.formatRelative", "blueprint.time.isSameDay",
    "blueprint.time.make", "blueprint.time.now", "blueprint.time.parse", "blueprint.time.parts",
    "blueprint.time.startOfDay", "blueprint.time.toIsoString", "blueprint.time.zoneOffset",
];

/**
 * One step of flow: `in` arrives, `next` leaves. The overwhelming majority of effectful nodes,
 * and the shape the fold walks straight through.
 */
const STEP_NODE_TYPES: readonly string[] = [
    "blueprint.app.getFullscreen", "blueprint.app.setFullscreen", "blueprint.broadcast.send",
    "blueprint.button.setEnabled", "blueprint.button.setLabel", "blueprint.button.setPointer",
    "blueprint.button.setVariant", "blueprint.button.setVisible", "blueprint.container.setClipContent",
    "blueprint.container.setEnabled", "blueprint.container.setVariant", "blueprint.container.setVisible",
    "blueprint.data.memo", "blueprint.displayable.animateProperty", "blueprint.displayable.setDisplay",
    "blueprint.displayable.setProperty", "blueprint.displayable.setVariant",
    "blueprint.displayable.stopAnimation", "blueprint.element.button.setEnabled",
    "blueprint.element.button.setLabel", "blueprint.element.button.setPointer",
    "blueprint.element.button.setVariant", "blueprint.element.button.setVisible",
    "blueprint.element.container.setClipContent", "blueprint.element.container.setEnabled",
    "blueprint.element.container.setVariant", "blueprint.element.container.setVisible",
    "blueprint.element.continueEventBubble", "blueprint.element.displayable.animateProperty",
    "blueprint.element.displayable.setDisplay", "blueprint.element.displayable.setProperty",
    "blueprint.element.displayable.setVariant", "blueprint.element.displayable.stopAnimation",
    "blueprint.element.frame.setEnabled", "blueprint.element.frame.setParams",
    "blueprint.element.frame.setTargetPage", "blueprint.element.frame.setVisible",
    "blueprint.element.image.clearImageAsset", "blueprint.element.image.setCropRect",
    "blueprint.element.image.setEnabled", "blueprint.element.image.setFitMode",
    "blueprint.element.image.setFlipX", "blueprint.element.image.setFlipY",
    "blueprint.element.image.setImageAsset", "blueprint.element.image.setVisible",
    "blueprint.element.list.appendItem", "blueprint.element.list.clear",
    "blueprint.element.list.insertItem", "blueprint.element.list.refreshItems",
    "blueprint.element.list.removeItem", "blueprint.element.list.removeItemAt",
    "blueprint.element.list.scrollToBottom", "blueprint.element.list.scrollToIndex",
    "blueprint.element.list.scrollToTop", "blueprint.element.list.setEnabled",
    "blueprint.element.list.setItems", "blueprint.element.list.setSelectedIndex",
    "blueprint.element.list.setSelectedItem", "blueprint.element.list.setVisible",
    "blueprint.element.slider.setEnabled", "blueprint.element.slider.setRange",
    "blueprint.element.slider.setValue", "blueprint.element.slider.setVisible",
    "blueprint.element.stopEventBubble", "blueprint.element.switch.setChecked",
    "blueprint.element.switch.setEnabled", "blueprint.element.switch.setVisible",
    "blueprint.element.switch.toggle", "blueprint.element.switch.turnOff",
    "blueprint.element.switch.turnOn", "blueprint.element.text.appendText",
    "blueprint.element.text.clearText", "blueprint.element.text.setAllProperties",
    "blueprint.element.text.setEffects", "blueprint.element.text.setEnabled",
    "blueprint.element.text.setFont", "blueprint.element.text.setFontSize",
    "blueprint.element.text.setFontWeight", "blueprint.element.text.setLineHeight",
    "blueprint.element.text.setText", "blueprint.element.text.setTextAlign",
    "blueprint.element.text.setTextColor", "blueprint.element.text.setTextVerticalAlign",
    "blueprint.element.text.setVisible", "blueprint.element.text.setWrapMode",
    "blueprint.element.textInput.clear", "blueprint.element.textInput.setValue", "blueprint.flow.noop",
    "blueprint.flow.skipDelay", "blueprint.fn.call", "blueprint.frame.emit", "blueprint.frame.setEnabled",
    "blueprint.frame.setVisible", "blueprint.frameWidget.setParams", "blueprint.frameWidget.setTargetPage",
    "blueprint.game.autoSave.latest", "blueprint.game.autoSave.list", "blueprint.game.autoSave.write",
    "blueprint.game.choose", "blueprint.game.clearTextRead", "blueprint.game.clearVisited",
    "blueprint.game.hideDialog", "blueprint.game.history.get", "blueprint.game.history.getFuture",
    "blueprint.game.history.redoNext", "blueprint.game.history.restore",
    "blueprint.game.history.undoLast", "blueprint.game.next", "blueprint.game.save.delete",
    "blueprint.game.save.getMetadata", "blueprint.game.save.getPreview",
    "blueprint.game.save.getLine", "blueprint.game.save.getTime", "blueprint.game.save.listIds",
    "blueprint.game.save.write", "blueprint.game.setAutoForward", "blueprint.game.setBgmVolume",
    "blueprint.game.setGameSpeed", "blueprint.game.setGlobalVolume", "blueprint.game.setSentenceSpeed",
    "blueprint.game.setSkip", "blueprint.game.setSkipDelay", "blueprint.game.setSkipInterval",
    "blueprint.game.setSkipReadText", "blueprint.game.setSoundVolume", "blueprint.game.setTrackVolume",
    "blueprint.game.setVoiceEndMode", "blueprint.game.setVoiceFadeDuration",
    "blueprint.game.setVoiceVolume", "blueprint.game.showDialog", "blueprint.game.skip",
    "blueprint.game.toggleDialogDisplay", "blueprint.image.clearImageAsset", "blueprint.image.setCropRect",
    "blueprint.image.setEnabled", "blueprint.image.setFitMode", "blueprint.image.setFlipX",
    "blueprint.image.setFlipY", "blueprint.image.setImageAsset", "blueprint.image.setVisible",
    "blueprint.layer.closeSelf", "blueprint.layer.hide", "blueprint.layer.show", "blueprint.layer.wait",
    "blueprint.list.appendItem", "blueprint.list.clear", "blueprint.list.insertItem",
    "blueprint.list.refreshItems", "blueprint.list.removeItem", "blueprint.list.removeItemAt",
    "blueprint.list.scrollToBottom", "blueprint.list.scrollToIndex", "blueprint.list.scrollToTop",
    "blueprint.list.setEnabled", "blueprint.list.setItems", "blueprint.list.setSelectedIndex",
    "blueprint.list.setSelectedItem", "blueprint.list.setVisible", "blueprint.local.set",
    "blueprint.localization.formatText", "blueprint.localization.getAvailableLanguages",
    "blueprint.localization.getCurrentLanguage", "blueprint.localization.getText",
    "blueprint.localization.hasText", "blueprint.localization.setLanguage", "blueprint.log",
    "blueprint.network.readResponseText", "blueprint.page.back", "blueprint.page.clear",
    "blueprint.persistent.get", "blueprint.persistent.set", "blueprint.saved.get", "blueprint.saved.set",
    "blueprint.scene.get", "blueprint.scene.set", "blueprint.slider.setEnabled",
    "blueprint.slider.setRange", "blueprint.slider.setValue", "blueprint.slider.setVisible",
    "blueprint.sound.isPlaying", "blueprint.sound.pause", "blueprint.sound.play", "blueprint.sound.resume",
    "blueprint.sound.seek", "blueprint.sound.setVolume", "blueprint.sound.stop",
    "blueprint.switch.setChecked", "blueprint.switch.setEnabled", "blueprint.switch.setVisible",
    "blueprint.switch.toggle", "blueprint.switch.turnOff", "blueprint.switch.turnOn",
    "blueprint.text.appendText", "blueprint.text.clearText", "blueprint.text.setAllProperties",
    "blueprint.text.setEffects", "blueprint.text.setEnabled", "blueprint.text.setFont",
    "blueprint.text.setFontSize", "blueprint.text.setFontWeight", "blueprint.text.setLineHeight",
    "blueprint.text.setText", "blueprint.text.setTextAlign", "blueprint.text.setTextColor",
    "blueprint.text.setTextVerticalAlign", "blueprint.text.setVisible", "blueprint.text.setWrapMode",
    "blueprint.textInput.clear", "blueprint.textInput.setValue", "blueprint.voice.getAvailableLanguages",
    "blueprint.voice.getLanguage", "blueprint.voice.play", "blueprint.voice.setLanguage",
];

/**
 * Flow starts here: no execution input, one `then`. Every event head, plus the `Fn` head, whose
 * body is the exec-reachable subgraph below it inside its host event graph.
 */
const EVENT_HEAD_NODE_TYPES: readonly string[] = [
    "blueprint.event.head.afterSurfaceEnter", "blueprint.event.head.anyKeyDown",
    "blueprint.event.head.anyKeyUp", "blueprint.event.head.anyPreferenceChanged",
    "blueprint.event.head.appBoot", "blueprint.event.head.beforeSurfaceExit", "blueprint.event.head.blur",
    "blueprint.event.head.elementClick", "blueprint.event.head.elementFlush", "blueprint.event.head.flush",
    "blueprint.event.head.focus", "blueprint.event.head.fullscreenChanged",
    "blueprint.event.head.gameReady", "blueprint.event.head.init", "blueprint.event.head.itemClick",
    "blueprint.event.head.itemHover", "blueprint.event.head.itemRender", "blueprint.event.head.keyDown",
    "blueprint.event.head.keyUp", "blueprint.event.head.listItemRefresh", "blueprint.event.head.mouseClick",
    "blueprint.event.head.mouseDoubleClick", "blueprint.event.head.mouseDown",
    "blueprint.event.head.mouseEnter", "blueprint.event.head.mouseLeave", "blueprint.event.head.mouseMove",
    "blueprint.event.head.mouseUp", "blueprint.event.head.mouseWheel",
    "blueprint.event.head.onAnyBroadcast", "blueprint.event.head.onBroadcast",
    "blueprint.event.head.onCall", "blueprint.event.head.pageEvent",
    "blueprint.event.head.preferenceChanged", "blueprint.event.head.rightClick",
    "blueprint.event.head.scroll", "blueprint.event.head.scrollEnd",
    "blueprint.event.head.selectionChanged", "blueprint.event.head.sliderDragEnd",
    "blueprint.event.head.sliderDragStart", "blueprint.event.head.sliderValueChanged",
    "blueprint.event.head.surfaceInit", "blueprint.event.head.surfaceUnmount",
    "blueprint.event.head.switchChanged", "blueprint.event.head.switchTurnedOff",
    "blueprint.event.head.switchTurnedOn", "blueprint.event.head.textInputSubmit",
    "blueprint.event.head.textInputValueChanged", "blueprint.event.head.unmount",
    "blueprint.event.head.windowCloseRequested", "blueprint.fn.head",
];

/** Flow ends here: `in` arrives and nothing leaves. Returns, and the four ways to leave a game. */
const TAIL_NODE_TYPES: readonly string[] = [
    "blueprint.data.returnValue", "blueprint.flow.return", "blueprint.fn.return", "blueprint.game.quit",
    "blueprint.game.save.load", "blueprint.game.startStory", "blueprint.page.go", "blueprint.page.quit",
];

/** The three loops. `loop` runs the body, `completed` carries on once it stops. */
const LOOP_NODE_TYPES: readonly string[] = [
    "blueprint.flow.forEach", "blueprint.flow.forLoop", "blueprint.flow.while",
];


/**
 * The ten nodes whose flow shape is their own.
 *
 * Eight of them branch - the two `If` spellings, the string switch, the parallel `Sequence`, the two
 * network nodes and `Open Link`, which route by outcome rather than by a condition, and `Show
 * Confirm`, which routes by the answer a player gave. `Function entry` has an execution input nothing
 * can wire, a leftover from before function graphs had a head of their own. `Delay` names its single
 * output `completed` rather than `next`, which is the difference between "carry on" and "the wait is
 * over".
 */
const IRREGULAR_EXEC_PINS: Readonly<Record<string, BlueprintNodeExecPins>> = {
    // The bare `"if"`, not a namespaced id: the oldest node in the catalogue, and renaming it would
    // orphan every graph that holds one.
    [BLUEPRINT_NODE_TYPE_FLOW_IF]: { in: ["in"], out: ["true", "false"] },
    [BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE]: {
        in: ["in"],
        out: ["then", "else"],
        variadicOut: BLUEPRINT_IF_ELSE_BRANCH_PINS,
    },
    [BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING]: {
        in: ["in"],
        out: ["case0", "case1", "default"],
        variadicOut: BLUEPRINT_SWITCH_STRING_CASE_PINS,
    },
    [BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE]: { in: ["in"], out: ["then0", "then1", "then2", "then3"] },
    [BLUEPRINT_NODE_TYPE_FLOW_DELAY]: { in: ["in"], out: ["completed"] },
    [BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY]: { in: ["in"], out: ["then"] },
    [BLUEPRINT_NODE_TYPE_NETWORK_FETCH]: {
        in: ["in"],
        out: ["success", "httpError", "networkError", "timeout"],
    },
    [BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON]: { in: ["in"], out: ["next", "failed"] },
    // `Open Link` leaves by `failed` when the address is not one this build declared, or when the
    // player's machine has nothing to open it with - the two the node lets an author branch on.
    [BLUEPRINT_NODE_TYPE_APP_OPEN_EXTERNAL]: { in: ["in"], out: ["next", "failed"] },
    // The Move Mouse pair is `Open Link`'s shape for the same reason: the cursor went there or it
    // did not, and whether the host has no cursor support or the system refused the move is on a
    // data pin rather than in a third branch nobody could act on differently.
    [BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO]: { in: ["in"], out: ["next", "failed"] },
    [BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT]: { in: ["in"], out: ["next", "failed"] },
    // `Export Progress` is `Open Link`'s shape for the same reason: the write happened or it did
    // not, and the reason is on a data pin rather than in a third branch.
    [BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS]: { in: ["in"], out: ["next", "failed"] },
    // `Import Progress` has three because the author answers each of them differently. `missing` is
    // the ordinary state of a player who never exported - a demo they never finished, a fresh
    // machine - and it leads to "start a new game", not to an apology. Folding it into `failed`
    // would put an error message in front of every first-time player.
    [BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS]: { in: ["in"], out: ["found", "missing", "failed"] },
    // `Show Confirm` has no `next` at all: every way out of the question is a branch. `dismissed`
    // is the static one - the player closed it without answering - and each button an author added
    // publishes its own `button_N_pressed` beside it.
    [BLUEPRINT_NODE_TYPE_LAYER_CONFIRM]: {
        in: ["in"],
        out: ["dismissed"],
        variadicOut: BLUEPRINT_LAYER_CONFIRM_BUTTON_PINS,
    },
};

const NO_EXEC_PINS: BlueprintNodeExecPins = { in: [], out: [] };
const STEP_EXEC_PINS: BlueprintNodeExecPins = { in: ["in"], out: ["next"] };
const HEAD_EXEC_PINS: BlueprintNodeExecPins = { in: [], out: ["then"] };
const TAIL_EXEC_PINS: BlueprintNodeExecPins = { in: ["in"], out: [] };
const LOOP_EXEC_PINS: BlueprintNodeExecPins = { in: ["in"], out: ["loop", "completed"] };

function buildTable(): Map<string, BlueprintNodeExecPins> {
    const table = new Map<string, BlueprintNodeExecPins>();
    const add = (types: readonly string[], pins: BlueprintNodeExecPins): void => {
        for (const type of types) {
            table.set(type, pins);
        }
    };
    add(PURE_DATA_NODE_TYPES, NO_EXEC_PINS);
    add(STEP_NODE_TYPES, STEP_EXEC_PINS);
    add(EVENT_HEAD_NODE_TYPES, HEAD_EXEC_PINS);
    add(TAIL_NODE_TYPES, TAIL_EXEC_PINS);
    add(LOOP_NODE_TYPES, LOOP_EXEC_PINS);
    for (const [type, pins] of Object.entries(IRREGULAR_EXEC_PINS)) {
        table.set(type, pins);
    }
    return table;
}

const EXEC_PINS_BY_TYPE = buildTable();

/** Every node type this file answers for. The drift test compares it with the live registry. */
export function listKnownBlueprintNodeTypes(): string[] {
    return [...EXEC_PINS_BY_TYPE.keys()];
}

/** This type's execution pins, or `null` when the type is not in the table. */
export function blueprintNodeExecPins(type: string): BlueprintNodeExecPins | null {
    return EXEC_PINS_BY_TYPE.get(type) ?? null;
}

/**
 * Every execution output pin id a node instance actually has, its added branches included.
 *
 * Takes the node rather than the type because the added pins live on the instance. An unknown type
 * answers `null` and not an empty list: "this node routes nowhere" and "nobody here knows where this
 * node routes" have to stay different answers, and only one of them is safe to fold against.
 */
export function blueprintNodeExecOutputPinIds(node: BlueprintGraphNode): string[] | null {
    const pins = blueprintNodeExecPins(node.type);
    if (!pins) {
        return null;
    }
    const variadic = pins.variadicOut;
    if (!variadic) {
        return [...pins.out];
    }
    const added = readVariadicPinIds(node.params, variadic.storageKey)
        .filter(pinId => pinId.endsWith(`_${variadic.idSuffix}`));
    // Added pins come before the last static one on the card (`else` / `default`), but nothing here
    // depends on the order - a fold names the pin it took, it does not count positions.
    return [...pins.out, ...added];
}

/** Whether the node has no execution pins at all, which is what makes it pullable as pure data. */
export function isPureDataBlueprintNode(node: BlueprintGraphNode): boolean {
    const pins = blueprintNodeExecPins(node.type);
    return pins !== null && pins.in.length === 0 && pins.out.length === 0 && !pins.variadicOut;
}

/**
 * The ordered pin ids a variadic node keeps in its params.
 *
 * Mirrors `readDynamicInputPinIds` in the editor: a non-array, and any entry that is not a non-blank
 * string, is not a pin. Restated here rather than imported for the reason the whole file exists -
 * that function is under the renderer.
 */
export function readVariadicPinIds(params: Record<string, unknown> | undefined, storageKey: string): string[] {
    const raw = params?.[storageKey];
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}
