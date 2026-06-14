import { useEffect, useRef } from "react";
import { useWorkspace } from "../context";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import {
    WORKSPACE_EDITOR_SESSION_SETTINGS_KEY,
    parseWorkspaceEditorSession,
    restoreWorkspaceEditorSession,
    serializeEditorSession,
} from "../session/workspaceEditorSession";

const SAVE_DEBOUNCE_MS = 500;

/** Dedupe restore per project path when React Strict Mode runs effects twice */
const restorePromisesByProjectPath = new Map<string, Promise<void>>();

let restoreInProgressGlobal = false;

/**
 * Persist and restore main editor tab strip via global Studio settings.
 * Tabs without a registered serialization strategy are omitted on save; restore skips entries that fail to resolve.
 */
export function useWorkspaceEditorSession() {
    const { context } = useWorkspace();
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const uiService = context?.services.get<UIService>(Services.UI) ?? null;
    const settingsService = context?.services.get<GlobalSettingsService>(Services.GlobalSettings) ?? null;

    useEffect(() => {
        if (!context || !uiService || !settingsService) {
            return;
        }

        const path = context.project.getConfig().projectPath;
        let promise = restorePromisesByProjectPath.get(path);
        if (!promise) {
            promise = (async () => {
                restoreInProgressGlobal = true;
                try {
                    const raw = await settingsService.get(WORKSPACE_EDITOR_SESSION_SETTINGS_KEY);
                    const session = parseWorkspaceEditorSession(raw);
                    if (session?.tabs.length) {
                        restoreWorkspaceEditorSession(context, session, uiService);
                    }
                } catch (error) {
                    console.error("[WorkspaceEditorSession] Failed to restore:", error);
                } finally {
                    restoreInProgressGlobal = false;
                }
            })();
            restorePromisesByProjectPath.set(path, promise);
            void promise.finally(() => {
                restorePromisesByProjectPath.delete(path);
            });
        }

        return () => {};
    }, [context, uiService, settingsService]);

    useEffect(() => {
        if (!context || !uiService || !settingsService) {
            return;
        }

        const flushSave = async () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            if (restoreInProgressGlobal) {
                return;
            }
            try {
                const layout = uiService.getStore().getEditorLayout();
                const session = serializeEditorSession(layout);
                if (session === null) {
                    return;
                }
                await settingsService.set(WORKSPACE_EDITOR_SESSION_SETTINGS_KEY, session);
            } catch (error) {
                console.error("[WorkspaceEditorSession] Failed to save:", error);
            }
        };

        const scheduleSave = () => {
            if (restoreInProgressGlobal) {
                return;
            }
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            saveTimerRef.current = setTimeout(() => {
                saveTimerRef.current = null;
                void flushSave();
            }, SAVE_DEBOUNCE_MS);
        };

        const unsubscribe = uiService.getEvents().on("stateChanged", changes => {
            if (changes.editorLayout) {
                scheduleSave();
            }
        });

        return () => {
            unsubscribe();
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [context, uiService, settingsService]);
}
