import type { PanelComponentProps } from "../../types";
import { ActionInspector } from "./StorySceneActionInspector";
import { useStoryInspectorState, type StoryInspectorPanelPayload } from "./storyInspectorBridge";

/**
 * The right-sidebar inspector (WI-1). The property editor that used to expand inline under the action
 * row now lives here — the same `ActionInspector`, keyed off the tab's published selection. When
 * nothing inspectable is open it shows a bare empty surface (no copy), matching the other panels.
 */
export function StoryInspectorPanel({ payload }: PanelComponentProps<StoryInspectorPanelPayload>) {
    const state = useStoryInspectorState(payload?.tabId);

    if (!state) {
        return <div className="h-full min-h-0 bg-surface" />;
    }

    // Carries its own fill while it holds fields, for the same reason the editor body does: a custom
    // workspace background clears base `bg-surface`, and values you have to read must not compete
    // with a photograph. Shares the editor's `editor.surfaceOpacity` — one knob, three surfaces. The
    // empty state above keeps the base surface: there is nothing to read there.
    return (
        <div className="nl-editor-surface nl-no-scrollbar h-full min-h-0 overflow-y-auto p-3">
            <ActionInspector
                block={state.block}
                document={state.document}
                sceneId={state.sceneId}
                characters={state.characters}
                onUpdatePayload={state.onUpdatePayload}
                onClose={state.onClose}
                onSetDialogueCharacter={state.onSetDialogueCharacter}
                generateTextId={state.generateTextId}
                onCreateLayer={state.onCreateLayer}
            />
        </div>
    );
}
