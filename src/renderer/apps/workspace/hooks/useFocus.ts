import { useCallback, useEffect, useState, useMemo } from "react";
import { useWorkspace } from "../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea, FocusContext } from "@/lib/workspace/services/ui/types";

/**
 * Focus state with helper methods
 */
export interface UseFocusResult {
    /** Current focus context */
    focus: FocusContext;
    /** Whether the specified area is focused */
    isFocused: (area: FocusArea, targetId?: string) => boolean;
    /** Whether any editor is focused */
    isEditorFocused: boolean;
    /** Whether any panel is focused */
    isPanelFocused: boolean;
    /** Set focus to a specific area */
    setFocus: (area: FocusArea, targetId?: string) => void;
    /** Set focus to editor area */
    focusEditor: (tabId: string) => void;
    /** Set focus to left panel */
    focusLeftPanel: (panelId: string) => void;
    /** Set focus to right panel */
    focusRightPanel: (panelId: string) => void;
    /** Set focus to bottom panel */
    focusBottomPanel: (panelId: string) => void;
    /** Clear focus */
    clearFocus: () => void;
}

/**
 * Hook for unified focus management
 * Provides simplified access to focus state and operations
 *
 * @example
 * const { focus, isFocused, setFocus, focusEditor } = useFocus();
 *
 * // Check if editor is focused
 * if (isFocused(FocusArea.Editor, tabId)) {
 *   // do something
 * }
 *
 * // Focus an editor tab
 * focusEditor("my-tab-id");
 */
export function useFocus(): UseFocusResult {
    const { context } = useWorkspace();
    const [focus, setFocusState] = useState<FocusContext>({
        area: FocusArea.None,
        targetId: undefined,
    });

    // Get UI service
    const uiService = useMemo(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);

    // Subscribe to focus changes
    useEffect(() => {
        if (!uiService) return;

        // Get initial focus
        setFocusState(uiService.focus.getFocus());

        // Subscribe to changes
        const unsubscribe = uiService.focus.onFocusChange((newFocus) => {
            setFocusState(newFocus);
        });

        return unsubscribe;
    }, [uiService]);

    // Check if specific area/target is focused
    const isFocused = useCallback(
        (area: FocusArea, targetId?: string): boolean => {
            if (targetId !== undefined) {
                return focus.area === area && focus.targetId === targetId;
            }
            return focus.area === area;
        },
        [focus]
    );

    // Computed properties
    const isEditorFocused = focus.area === FocusArea.Editor;
    const isPanelFocused =
        focus.area === FocusArea.LeftPanel ||
        focus.area === FocusArea.RightPanel ||
        focus.area === FocusArea.BottomPanel;

    // Set focus to specific area
    const setFocus = useCallback(
        (area: FocusArea, targetId?: string) => {
            uiService?.focus.setFocus(area, targetId);
        },
        [uiService]
    );

    // Focus editor
    const focusEditor = useCallback(
        (tabId: string) => {
            uiService?.focus.setFocus(FocusArea.Editor, tabId);
        },
        [uiService]
    );

    // Focus left panel
    const focusLeftPanel = useCallback(
        (panelId: string) => {
            uiService?.focus.setFocus(FocusArea.LeftPanel, panelId);
        },
        [uiService]
    );

    // Focus right panel
    const focusRightPanel = useCallback(
        (panelId: string) => {
            uiService?.focus.setFocus(FocusArea.RightPanel, panelId);
        },
        [uiService]
    );

    // Focus bottom panel
    const focusBottomPanel = useCallback(
        (panelId: string) => {
            uiService?.focus.setFocus(FocusArea.BottomPanel, panelId);
        },
        [uiService]
    );

    // Clear focus
    const clearFocus = useCallback(() => {
        uiService?.focus.clearFocus();
    }, [uiService]);

    return {
        focus,
        isFocused,
        isEditorFocused,
        isPanelFocused,
        setFocus,
        focusEditor,
        focusLeftPanel,
        focusRightPanel,
        focusBottomPanel,
        clearFocus,
    };
}

/**
 * Hook that tracks if a specific target is focused
 * Optimized for components that only need to know their own focus state
 *
 * @param area - The focus area to check
 * @param targetId - The target ID to check (optional)
 * @returns Whether the target is focused
 *
 * @example
 * const isFocused = useIsFocused(FocusArea.Editor, tabId);
 */
export function useIsFocused(area: FocusArea, targetId?: string): boolean {
    const { focus } = useFocus();

    if (targetId !== undefined) {
        return focus.area === area && focus.targetId === targetId;
    }
    return focus.area === area;
}

