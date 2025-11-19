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
    /** Callback to rename selected asset/group */
    onRename: () => void;
}

export function useKeyboardShortcuts({
    context,
    isInitialized,
    panelId,
    onCopy,
    onCut,
    onPaste,
    onRename,
}: UseKeyboardShortcutsParams) {
    // Use refs to store the latest function references
    const onCopyRef = useRef(onCopy);
    const onCutRef = useRef(onCut);
    const onPasteRef = useRef(onPaste);
    const onRenameRef = useRef(onRename);

    // Update refs when functions change
    onCopyRef.current = onCopy;
    onCutRef.current = onCut;
    onPasteRef.current = onPaste;
    onRenameRef.current = onRename;

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

        const unregisterRename = uiService.keybindings.register({
            id: `assets-${panelId}-rename`,
            key: 'f2',
            description: 'Rename selected asset or group',
            handler: () => {
                onRenameRef.current();
            },
            when,
        });

        return () => {
            unregisterCopy();
            unregisterCut();
            unregisterPaste();
            unregisterRename();
        };
    }, [context, isInitialized, panelId]); // Removed function dependencies
}
