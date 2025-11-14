import { useEffect, useRef } from 'react';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { UIService } from '@/lib/workspace/services/core/UIService';
import { Services } from '@/lib/workspace/services/services';
import { FocusArea, FocusContext } from '@/lib/workspace/services/ui/types';

export interface UseKeyboardShortcutsParams {
    context: WorkspaceContext | null;
    isInitialized: boolean;
    panelId: string;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
}

export function useKeyboardShortcuts({
    context,
    isInitialized,
    panelId,
    onCopy,
    onCut,
    onPaste,
}: UseKeyboardShortcutsParams) {
    // Use refs to store the latest function references
    const onCopyRef = useRef(onCopy);
    const onCutRef = useRef(onCut);
    const onPasteRef = useRef(onPaste);

    // Update refs when functions change
    onCopyRef.current = onCopy;
    onCutRef.current = onCut;
    onPasteRef.current = onPaste;

    useEffect(() => {
        console.log('useKeyboardShortcuts initialized for panel:', panelId);
        if (!context || !isInitialized) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const when = (focusContext: FocusContext) => focusContext.area === FocusArea.LeftPanel && focusContext.targetId === panelId;

        // Register keybindings through the global keybinding service
        const unregisterCopy = uiService.keybindings.register({
            id: `assets-${panelId}-copy`,
            key: 'ctrl+c',
            description: 'Copy selected assets',
            handler: () => {
                onCopyRef.current();
            },
            when,
        });


        const unregisterCut = uiService.keybindings.register({
            id: `assets-${panelId}-cut`,
            key: 'ctrl+x',
            description: 'Cut selected assets',
            handler: () => {
                onCutRef.current();
            },
            when,
        });

        const unregisterPaste = uiService.keybindings.register({
            id: `assets-${panelId}-paste`,
            key: 'ctrl+v',
            description: 'Paste assets',
            handler: () => {
                onPasteRef.current();
            },
            when,
        });

        return () => {
            unregisterCopy();
            unregisterCut();
            unregisterPaste();
        };
    }, [context, isInitialized, panelId]); // Removed function dependencies
}
