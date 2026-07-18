import { useEffect, useRef } from "react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import type { FocusContext } from "@/lib/workspace/services/ui/types";
import {
    closableOtherTabIds,
    closableTabIds,
    closableTabIdsToRight,
    findActiveEditorTarget,
    type ActiveEditorTarget,
} from "./editorCommandsModel";

/**
 * Registers the editor-tab commands (close / close others / close to the right / close all) on the
 * {@link CommandService} so they surface in the command palette. Unlike the tab context menu they
 * have no click target, so they act on the *active* editor tab — the focused tab of the group that
 * holds editor focus.
 *
 * Lives in the workspace shell (renders nothing), mirroring {@link EditorClosedTabsKeybinding}:
 * a single registration here beats per-group ones, which would stack duplicate ids and vanish when
 * the last group closes. Close routes through the registry's `closeEditorTab(s)` — not the store
 * directly — so palette-closed tabs are still recorded for "reopen closed tab".
 */
export function EditorCommands() {
    const { context } = useWorkspace();
    const { editorLayout, closeEditorTab, closeEditorTabs } = useRegistry();

    // The commands are registered once; their `when`/`run` read the latest layout and close
    // functions through this ref instead of re-registering on every editor change.
    const stateRef = useRef({ editorLayout, closeEditorTab, closeEditorTabs });
    stateRef.current = { editorLayout, closeEditorTab, closeEditorTabs };

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const uiService = context.services.get<UIService>(Services.UI);

        // `focus` is supplied by the palette's `when` check; `run` reads live focus at click time.
        const activeTarget = (focus?: FocusContext | null): ActiveEditorTarget | null =>
            findActiveEditorTarget(stateRef.current.editorLayout, focus ?? uiService.focus.getFocus());

        const closeTabs = (ids: string[], groupId: string) => {
            if (ids.length > 0) {
                stateRef.current.closeEditorTabs(ids, groupId);
            }
        };

        return commandService.registerMany([
            {
                id: "editor:close-tab",
                titleKey: "workspace.shell.commandPalette.editor.closeTab",
                categoryKey: "workspace.shell.commandPalette.categoryEditor",
                when: focus => {
                    const target = activeTarget(focus);
                    return !!target && target.tab.closable !== false;
                },
                run: () => {
                    const target = activeTarget();
                    if (target && target.tab.closable !== false) {
                        stateRef.current.closeEditorTab(target.tab.id, target.group.id);
                    }
                },
            },
            {
                id: "editor:close-others",
                titleKey: "workspace.shell.commandPalette.editor.closeOthers",
                categoryKey: "workspace.shell.commandPalette.categoryEditor",
                when: focus => {
                    const target = activeTarget(focus);
                    return !!target && closableOtherTabIds(target.group, target.index).length > 0;
                },
                run: () => {
                    const target = activeTarget();
                    if (target) {
                        closeTabs(closableOtherTabIds(target.group, target.index), target.group.id);
                    }
                },
            },
            {
                id: "editor:close-to-right",
                titleKey: "workspace.shell.commandPalette.editor.closeToRight",
                categoryKey: "workspace.shell.commandPalette.categoryEditor",
                when: focus => {
                    const target = activeTarget(focus);
                    return !!target && closableTabIdsToRight(target.group, target.index).length > 0;
                },
                run: () => {
                    const target = activeTarget();
                    if (target) {
                        closeTabs(closableTabIdsToRight(target.group, target.index), target.group.id);
                    }
                },
            },
            {
                id: "editor:close-all",
                titleKey: "workspace.shell.commandPalette.editor.closeAll",
                categoryKey: "workspace.shell.commandPalette.categoryEditor",
                when: focus => {
                    const target = activeTarget(focus);
                    return !!target && closableTabIds(target.group.tabs).length > 0;
                },
                run: () => {
                    const target = activeTarget();
                    if (target) {
                        closeTabs(closableTabIds(target.group.tabs), target.group.id);
                    }
                },
            },
        ]);
    }, [context]);

    return null;
}
