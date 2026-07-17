import { useEffect, useRef } from "react";
import { useWorkspace } from "../context";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import {
    WORKSPACE_EDITOR_SESSION_SETTINGS_KEY,
    getWorkspaceEditorSessionSettingsKey,
    parseWorkspaceEditorSession,
    restoreWorkspaceEditorSession,
    serializeEditorSession,
} from "../session/workspaceEditorSession";
import { openDashboardTab } from "../modules/dashboard/openDashboardTab";
import {
    DASHBOARD_OPEN_DEFAULT_KEY,
    getDashboardOpenProjectKey,
    resolveDashboardOpen,
} from "@shared/constants/dashboard";

const SAVE_DEBOUNCE_MS = 500;

/** Dedupe restore per project session key when React Strict Mode runs effects twice */
const restorePromisesBySessionKey = new Map<string, Promise<void>>();

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
    const projectService = context?.services.get<ProjectService>(Services.Project) ?? null;
    const projectRef =
        context && projectService
            ? {
                  projectPath: context.project.getConfig().projectPath,
                  projectIdentifier: projectService.getProjectConfig().identifier,
              }
            : null;
    const sessionSettingsKey = projectRef ? getWorkspaceEditorSessionSettingsKey(projectRef) : null;
    const dashboardOpenProjectKey = projectRef ? getDashboardOpenProjectKey(projectRef) : null;

    useEffect(() => {
        if (!context || !uiService || !settingsService || !sessionSettingsKey) {
            return;
        }

        let promise = restorePromisesBySessionKey.get(sessionSettingsKey);
        if (!promise) {
            promise = (async () => {
                restoreInProgressGlobal = true;
                try {
                    const raw = await settingsService.get(sessionSettingsKey);
                    let session = parseWorkspaceEditorSession(raw);
                    let shouldMigrateLegacySession = false;
                    if (!session && !settingsService.has(sessionSettingsKey)) {
                        const legacyRaw = await settingsService.get(WORKSPACE_EDITOR_SESSION_SETTINGS_KEY);
                        session = parseWorkspaceEditorSession(legacyRaw);
                        shouldMigrateLegacySession = Boolean(session);
                    }
                    if (session?.tabs.length) {
                        const restoredCount = restoreWorkspaceEditorSession(context, session, uiService);
                        if (shouldMigrateLegacySession && restoredCount > 0) {
                            const restoredSession = serializeEditorSession(uiService.getStore().getEditorLayout());
                            if (restoredSession) {
                                await settingsService.set(sessionSettingsKey, restoredSession);
                            }
                        }
                    }

                    // Opened after the restore rather than alongside it so the dashboard ends up
                    // focused rather than buried, and outside the `session?.tabs.length` guard
                    // above because a first-run project has no session to restore at all. The tab
                    // id is constant, so re-opening an already-restored dashboard just focuses it.
                    const [projectChoice, globalDefault] = await Promise.all([
                        dashboardOpenProjectKey
                            ? settingsService.get<boolean>(dashboardOpenProjectKey)
                            : Promise.resolve(undefined),
                        settingsService.get<boolean>(DASHBOARD_OPEN_DEFAULT_KEY, true),
                    ]);
                    if (resolveDashboardOpen(projectChoice, globalDefault)) {
                        openDashboardTab(context);
                    }
                } catch (error) {
                    console.error("[WorkspaceEditorSession] Failed to restore:", error);
                } finally {
                    restoreInProgressGlobal = false;
                }
            })();
            restorePromisesBySessionKey.set(sessionSettingsKey, promise);
            void promise.finally(() => {
                restorePromisesBySessionKey.delete(sessionSettingsKey);
            });
        }

        return () => {};
    }, [context, uiService, settingsService, sessionSettingsKey, dashboardOpenProjectKey]);

    useEffect(() => {
        if (!context || !uiService || !settingsService || !sessionSettingsKey) {
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
                await settingsService.set(sessionSettingsKey, session);
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
    }, [context, uiService, settingsService, sessionSettingsKey]);
}
