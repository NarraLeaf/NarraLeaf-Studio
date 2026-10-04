import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { flattenCatalog } from "@shared/i18n/flatten";
import { en } from "@shared/i18n/catalog/en";
import { getKeybindingCatalogEntry } from "./keybindingCatalog";
import { FIXED_INPUT_CATALOG, formatFixedInput, resolveFixedInputDisplay, type FixedInput } from "./fixedInputCatalog";

/**
 * The fixed-input catalog describes behaviour that lives in event handlers all over the renderer,
 * so on its own it would drift the day someone changes a gesture. Each entry is therefore pinned to
 * the code that implements it: a fragment that has to be present in that file. Changing the gesture
 * changes the fragment, the fragment stops matching, and this suite names the entry to revisit.
 *
 * A fragment that matches while the gesture changed is still possible - this is a tripwire, not a
 * proof - so the fragments are the lines that decide the behaviour (the modifier test, the button
 * check, the handler wiring), not lines near them.
 */

const R = "src/renderer";
const WORKSPACE = `${R}/apps/workspace`;
const STORY_ROWS = `${WORKSPACE}/modules/story/scene-editor`;
const UI_INTERACTION = `${R}/lib/ui-editor/interaction`;
const BLUEPRINT_FLOW = `${WORKSPACE}/modules/blueprint-lite/flow`;
const MOTION = `${WORKSPACE}/modules/story-motion/StoryMotionEditorTab.tsx`;
const EASING = `${WORKSPACE}/components/ui/EasingCurveEditor.tsx`;
const ASSETS = `${WORKSPACE}/modules/assets`;

interface Anchor {
    file: string;
    /** Every fragment must be in the file. */
    present: string[];
    /** None of these may be: for behaviour that is a library default, the prop that would change it. */
    absent?: string[];
}

const ANCHORS: Record<string, Anchor[]> = {
    "workspace.tab.middle-click-close": [
        { file: `${WORKSPACE}/components/layout/EditorGroup.tsx`, present: ["if (e.button === 1 && closable)"] },
    ],
    "workspace.tab.keep-open": [
        { file: `${WORKSPACE}/components/layout/EditorGroup.tsx`, present: ["onDoubleClick={(e) => {", "keepTabOpen(tab.id);"] },
    ],
    "workspace.tab.multi-select": [
        {
            file: `${WORKSPACE}/components/layout/EditorGroup.tsx`,
            present: ["if (e.shiftKey && rangeAnchorTabIdRef.current != null)", "if (e.ctrlKey || e.metaKey) {"],
        },
    ],
    "workspace.split.reset": [
        {
            file: `${WORKSPACE}/components/layout/SplitSash.tsx`,
            present: ["onDoubleClick={() => onCommit(EDITOR_DEFAULT_SPLIT_RATIO)}"],
        },
    ],

    "story.row.double-click-edit": [
        { file: `${STORY_ROWS}/StorySceneEditorRows.tsx`, present: ["onDoubleClick={event => {"] },
    ],
    "story.row.toggle-select": [
        { file: `${STORY_ROWS}/storyRowSelectionGesture.ts`, present: ["if (event?.ctrlKey || event?.metaKey) {"] },
    ],
    "story.row.range-select": [
        { file: `${STORY_ROWS}/storyRowSelectionGesture.ts`, present: ["if (event?.shiftKey && anchorBlockId) {"] },
        { file: `${STORY_ROWS}/storyRowSelectionGesture.ts`, present: ["export function rowDragEngaged("] },
    ],
    "story.row.drag-move": [
        { file: `${STORY_ROWS}/StorySceneEditorRows.tsx`, present: ["const dragListeners = useMemo(() => freeze.gesture(listeners)"] },
    ],
    "story.row.follow-reference": [
        {
            file: `${STORY_ROWS}/useJumpModifier.ts`,
            present: ["export function isJumpModifierEvent(event: { ctrlKey: boolean; metaKey: boolean }): boolean {\n    return event.ctrlKey || event.metaKey;"],
        },
    ],
    "story.edit.enter": [
        { file: `${STORY_ROWS}/RichTextInput.tsx`, present: ["event.shiftKey ? props.onShiftEnter() : props.onEnter();"] },
    ],
    "story.edit.shift-enter": [
        { file: `${STORY_ROWS}/RichTextInput.tsx`, present: ["event.shiftKey ? props.onShiftEnter() : props.onEnter();"] },
    ],
    "story.edit.escape": [
        { file: `${STORY_ROWS}/RichTextInput.tsx`, present: ["if (event.key === \"Escape\") {\n            event.preventDefault();\n            props.onExit();"] },
    ],
    "story.paste-plain": [
        {
            file: `${STORY_ROWS}/useStorySceneEditorController.ts`,
            present: ["(event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === \"v\""],
        },
    ],
    "story.easing.snap": [{ file: EASING, present: ["moveHandle(handle, snap(x, moveEvent.shiftKey), snap(y, moveEvent.shiftKey));"] }],
    "story.easing.nudge": [{ file: EASING, present: ["const delta = ARROW_DELTAS[event.key];"] }],

    "ui-editor.pan": [
        {
            file: `${UI_INTERACTION}/useSurfaceInteractionEvents.ts`,
            present: ["const isMiddleMouse = event.button === 1;", "const panY = event.shiftKey ? 0 : -panDeltaY;"],
        },
    ],
    "ui-editor.zoom": [
        { file: `${UI_INTERACTION}/useSurfaceInteractionEvents.ts`, present: ["const isZoomInteraction = event.ctrlKey ||"] },
    ],
    "ui-editor.toggle-select": [
        {
            file: `${UI_INTERACTION}/useSurfaceInteractionEvents.ts`,
            present: ["if ((event.metaKey || event.ctrlKey) && selectionData && selectionData.surfaceId === surfaceId) {"],
        },
        { file: `${UI_INTERACTION}/outline/LayerOutlinePanel.tsx`, present: ["} else if (event.metaKey || event.ctrlKey) {"] },
    ],
    "ui-editor.add-select": [
        {
            file: `${UI_INTERACTION}/useSurfaceInteractionEvents.ts`,
            present: ["} else if (event.shiftKey && selectionData && selectionData.surfaceId === surfaceId) {"],
        },
        { file: `${UI_INTERACTION}/outline/LayerOutlinePanel.tsx`, present: ["if (event.shiftKey && selectionData?.surfaceId === surfaceId) {"] },
    ],
    "ui-editor.select-inside": [
        { file: `${UI_INTERACTION}/useSurfaceInteractionEvents.ts`, present: ["const allowDrillIntoChild = detail >= 2 || rapidSameTarget;"] },
    ],
    "ui-editor.edit-text": [
        { file: `${UI_INTERACTION}/UIEditorInteractionLayer.tsx`, present: ["beginOrExplainInlineTextEdit({ stateService, documentService }, surfaceId, liveSelectedSingleElementId);"] },
        { file: `${UI_INTERACTION}/inlineTextEdit.ts`, present: ["return uiTextSiteOf(element?.type)?.typedOnCanvas === true;"] },
    ],
    "ui-editor.discard-text": [
        {
            file: `${R}/lib/ui-editor/widget-modules/builtin/text/renderer.tsx`,
            present: ["if (e.key === \"Escape\") {\n                e.preventDefault();\n                skipBlurCommitRef.current = true;"],
        },
    ],
    "ui-editor.crop": [
        { file: `${UI_INTERACTION}/UIEditorInteractionLayer.tsx`, present: ["source: \"moveableDoubleClick\","] },
    ],
    "ui-editor.suspend-snap": [
        { file: `${UI_INTERACTION}/UIEditorInteractionLayer.tsx`, present: ["const transformSnapSuspended = useCallback(() => altKeyRef.current, []);"] },
        { file: `${UI_INTERACTION}/useSurfaceInteractionEvents.ts`, present: ["const suspendSnap = (insertSnapSuspended?.() ?? false) || event.altKey;"] },
    ],
    "ui-editor.drop-image": [
        { file: `${WORKSPACE}/modules/ui-editor/editors/useSurfaceImageDrop.ts`, present: ["onDrop: handleImageAssetsDropped,"] },
    ],
    "ui-editor.outline.rename": [
        { file: `${UI_INTERACTION}/outline/LayerOutlineRows.tsx`, present: ["onStartRename(element);"] },
    ],
    "ui-editor.outline.reorder": [
        { file: `${UI_INTERACTION}/outline/LayerOutlinePanel.tsx`, present: ["onDragStart={handleDragStart}"] },
    ],

    "blueprint.pan": [
        {
            file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`,
            present: [
                "const PAN_BUTTONS_SELECT_TOOL = [1];",
                "if (e.button !== 0 || !e.ctrlKey || pendingPlacementEntryRef.current) {",
                "panOnScroll\n",
            ],
        },
    ],
    "blueprint.zoom": [
        // React Flow's own: with `panOnScroll`, holding its zoom activation key (Control, or ⌘ on
        // macOS) turns the wheel into zoom. Only overriding that key would change it.
        { file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`, present: ["panOnScroll\n"], absent: ["zoomActivationKeyCode"] },
    ],
    "blueprint.add-select": [
        { file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`, present: ["multiSelectionKeyCode=\"Shift\""] },
    ],
    "blueprint.add-node": [
        { file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`, present: ["onPaneContextMenu={freeze.gesture(onPaneContextMenu)}"] },
    ],
    "blueprint.add-connected-node": [
        { file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`, present: ["if (connectionState.isValid || connectionState.toHandle) {"] },
    ],
    "blueprint.delete-wire": [
        { file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`, present: ["onEdgeDoubleClick={freeze.gesture(onEdgeDoubleClick)}"] },
    ],
    "blueprint.delete": [
        { file: `${BLUEPRINT_FLOW}/BlueprintFlowCanvas.tsx`, present: ["deleteKeyCode = [\"Backspace\", \"Delete\"],"] },
    ],
    "blueprint.rename-group": [
        {
            file: `${BLUEPRINT_FLOW}/components/BlueprintFlowNode.tsx`,
            present: ["onDoubleClick={isFrame && onPatchNodeParam ? () => setRenaming(true) : undefined}"],
        },
    ],
    "blueprint.detach": [
        { file: `${WORKSPACE}/modules/blueprint-lite/editors/BlueprintEntryTab.tsx`, present: ["if (event.button !== 1 || isDetachedHost) {"] },
    ],

    "story-motion.no-snap": [
        { file: MOTION, present: ["scrubToClientX(moveEvent.clientX, rect, !moveEvent.altKey)", "lastTime = moveEvent.altKey ? raw"] },
    ],
    "story-motion.add-keyframe": [
        { file: MOTION, present: ["handleLaneDoubleClick(event, track)"] },
    ],
    "story-motion.pan-preview": [{ file: MOTION, present: ["if (event.button !== 1 || !previewViewportRef.current) {"] }],
    "story-motion.zoom": [
        {
            file: MOTION,
            present: [
                "const handlePreviewWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {\n        if (!event.ctrlKey) {",
                "const handleTimelineWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {\n        if (event.ctrlKey) {",
            ],
        },
    ],
    "story-motion.scroll-timeline": [{ file: MOTION, present: ["const horizontalIntent = event.shiftKey ||"] }],
    "story-motion.easing.snap": [{ file: EASING, present: ["moveHandle(handle, snap(x, moveEvent.shiftKey), snap(y, moveEvent.shiftKey));"] }],
    "story-motion.easing.nudge": [{ file: EASING, present: ["const delta = ARROW_DELTAS[event.key];"] }],

    "assets.toggle-select": [{ file: `${ASSETS}/state/useMultiSelection.ts`, present: ["if (event.ctrlKey || event.metaKey) {"] }],
    "assets.range-select": [{ file: `${ASSETS}/state/useMultiSelection.ts`, present: ["} else if (event.shiftKey && lastSelectedItem) {"] }],
    "assets.open": [
        { file: `${ASSETS}/browser/AssetBrowserView.tsx`, present: ["} else if (event.key === \"Enter\") {"] },
        { file: `${ASSETS}/browser/BrowserDetails.tsx`, present: ["onDoubleClick={() => gestures.onOpen(item)}"] },
        { file: `${WORKSPACE}/components/layout/useEditorGroupDrop.ts`, present: ["openAssetPreviewTabsInEditor(context, assetDrop.resolved, {"] },
    ],
    "assets.up": [
        {
            file: `${ASSETS}/browser/AssetBrowserView.tsx`,
            present: ["if (event.key === \"Backspace\" || (event.altKey && event.key === \"ArrowUp\")) {"],
        },
    ],
    "assets.move-to-group": [
        { file: `${ASSETS}/browser/useBrowserItemGestures.ts`, present: ["return draggedItem.category === category ? \"move\" : null;"] },
    ],
    "assets.tile-size": [
        { file: `${ASSETS}/browser/AssetBrowserView.tsx`, present: ["if (!event.ctrlKey || view !== \"grid\") {"] },
        { file: `${ASSETS}/views/AssetsIconView.tsx`, present: ["if (!event.ctrlKey) return;"] },
    ],
    "assets.audio.scroll": [
        { file: `${ASSETS}/editors/AudioPreviewEditor.tsx`, present: ["setView(current => scrollByFraction(current, clipLength(clip), delta / 400));"] },
    ],
    "assets.audio.zoom-time": [
        {
            file: `${ASSETS}/editors/AudioPreviewEditor.tsx`,
            present: ["if (event.ctrlKey || event.metaKey) {\n                event.preventDefault();\n                const rect = element.getBoundingClientRect();"],
        },
    ],
    "assets.audio.zoom-amplitude": [
        {
            file: `${ASSETS}/editors/AudioPreviewEditor.tsx`,
            present: ["if (event.altKey) {\n                event.preventDefault();\n                setWaveAmplitude("],
        },
    ],
    "assets.audio.select-range": [
        { file: `${ASSETS}/editors/audio/WaveformView.tsx`, present: ["gestureRef.current = { kind: \"select\", originX: event.clientX"] },
    ],
    "assets.audio.select-all": [
        { file: `${ASSETS}/editors/audio/WaveformView.tsx`, present: ["onDoubleClick={handleDoubleClick}", "        onSelectAll();\n    };"] },
    ],
    "assets.audio.clear-point": [{ file: `${ASSETS}/editors/audio/WaveformView.tsx`, present: ["onClearLoopPoint(end);"] }],
    "assets.video.zoom": [
        { file: `${ASSETS}/editors/video/VideoFrameView.tsx`, present: ["if (event.ctrlKey || event.metaKey) {", "onViewChange(zoomAt(view, viewport, frameSize, factor,"] },
    ],
    "assets.video.actual-size": [
        { file: `${ASSETS}/editors/video/VideoFrameView.tsx`, present: ["onViewChange(FIT_VIEW);", "onDoubleClick={handleDoubleClick}"] },
    ],
    "assets.video.select-all": [
        {
            file: `${ASSETS}/editors/video/VideoTimelineView.tsx`,
            present: ["if (localPoint(event.clientX, event.clientY).y >= RULER_HEIGHT) {\n            onSelectAll();"],
        },
    ],
};

/** Source text with Windows line endings folded, so a fragment written with `\n` matches either. */
function readSource(file: string): string {
    return readFileSync(join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
}

const enKeys = new Set(flattenCatalog(en).keys());

describe("fixedInputCatalog", () => {
    it("has unique ids", () => {
        const ids = FIXED_INPUT_CATALOG.map(entry => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("pins every entry to the code that implements it", () => {
        const unanchored = FIXED_INPUT_CATALOG.map(entry => entry.id).filter(id => !ANCHORS[id]);
        expect(unanchored, "entries with no code anchor in fixedInputCatalog.test.ts").toEqual([]);
        const stale = Object.keys(ANCHORS).filter(id => !FIXED_INPUT_CATALOG.some(entry => entry.id === id));
        expect(stale, "anchors for entries that no longer exist").toEqual([]);
    });

    for (const [id, anchors] of Object.entries(ANCHORS)) {
        it(`still finds the code behind ${id}`, () => {
            for (const anchor of anchors) {
                const source = readSource(anchor.file);
                for (const fragment of anchor.present) {
                    expect(
                        source.includes(fragment),
                        `${id}: ${anchor.file} no longer contains ${JSON.stringify(fragment)} - the gesture changed; update its entry in fixedInputCatalog.ts and this anchor`,
                    ).toBe(true);
                }
                for (const fragment of anchor.absent ?? []) {
                    expect(source.includes(fragment), `${id}: ${anchor.file} now sets ${fragment}`).toBe(false);
                }
            }
        });
    }

    it("shows every entry under a label and a group that exist", () => {
        for (const entry of FIXED_INPUT_CATALOG) {
            const display = resolveFixedInputDisplay(entry);
            expect(display, `${entry.id} has no label or group`).not.toBeNull();
            expect(enKeys, `${entry.id}: label ${display!.labelKey}`).toContain(display!.labelKey);
            expect(enKeys, `${entry.id}: group ${display!.categoryKey}`).toContain(display!.categoryKey);
            if (entry.extends) {
                expect(getKeybindingCatalogEntry(entry.extends), `${entry.id} extends ${entry.extends}`).toBeDefined();
            }
        }
    });

    it("names every gesture phrase it uses", () => {
        for (const entry of FIXED_INPUT_CATALOG) {
            expect(entry.inputs.length, `${entry.id} has no inputs`).toBeGreaterThan(0);
            for (const input of entry.inputs) {
                if ("gesture" in input) {
                    expect(enKeys, `${entry.id}: ${input.gesture}`).toContain(input.gesture);
                }
            }
        }
    });

    it("puts the held modifiers in front of a gesture, the way a chord is written", () => {
        const t = (key: string, params?: Record<string, string>) =>
            key.endsWith(".withModifiers") ? `${params?.keys}+${params?.gesture}` : key.split(".").pop()!;
        const altDrag: FixedInput = { gesture: "workspace.shell.keybindings.gestures.drag" as never, modifiers: "alt" };
        expect(formatFixedInput(altDrag, false, t as never)).toBe("Alt+drag");
        expect(formatFixedInput(altDrag, true, t as never)).toBe("⌥+drag");
        expect(formatFixedInput({ key: "mod+shift+v" }, false, t as never)).toBe("Ctrl+Shift+V");
    });
});
