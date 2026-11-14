import { useEffect, useRef } from "react";
import { useWorkspace } from "../context";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import {
    WORKSPACE_EDITOR_SESSION_SETTINGS_KEY,
    countSessionTabs,
    getWorkspaceEditorSessionSettingsKey,
    parseWorkspaceEditorSession,
    restoreWorkspaceEditorSession,
    serializeEditorSession,
} from "../session/workspaceEditorSession";
import { collectEditorGroups } from "../components/layout/editorCommandsModel";
import { FocusArea, type FocusContext } from "@/lib/workspace/services/ui/types";
import { openDashboardTab } from "../modules/dashboard/openDashboardTab";
import { WELCOME_SHOWN_KEY, openWelcomeTab } from "../modules/welcome/openWelcomeTab";
import {
    DASHBOARD_OPEN_DEFAULT_KEY,
    getDashboardOpenProjectKey,
    resolveDashboardOpen,
} from "@shared/constants/dashboard";

const SAVE_DEBOUNCE_MS = 500;

/** Dedupe restore per project session key when React Strict Mode runs effects twice */
const restorePromisesBySessionKey = new Map<string, Promise<boolean>>();

let restoreInProgressGlobal = false;

/**
 * Persist and restore main editor tab strip via global Studio settings.
 * Tabs without a registered serialization strategy are omitted on save; restore skips entries that fail to resolve.
 *
 * `enabled: false` opts a window out of both halves at once, which is the only useful shape: a
 * window that restored but did not save would drop the session the moment a tab was closed, and one
 * that saved but did not restore would overwrite the author's real session with an empty one. The
 * caller is the recovery window - see the note there.
 */
export function useWorkspaceEditorSession({ enabled = true }: { enabled?: boolean } = {}) {
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
        if (!enabled || !context || !uiService || !settingsService || !sessionSettingsKey) {
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
                    let restoredCount = 0;
                    if (session && countSessionTabs(session.layout) > 0) {
                        restoredCount = restoreWorkspaceEditorSession(context, session, uiService);
                        if (shouldMigrateLegacySession && restoredCount > 0) {
                            await settingsService.set(
                                sessionSettingsKey,
                                serializeEditorSession(uiService.getStore().getEditorLayout()),
                            );
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

                    // Last, so it lands focused in front of the dashboard on the one run it
                    // appears. Gated on `restoredCount` rather than on the live layout because the
                    // dashboard above has already put a tab there - "nothing to restore" is what
                    // actually distinguishes a first run from a returning one.
                    if (restoredCount === 0 && !(await settingsService.get<boolean>(WELCOME_SHOWN_KEY, false))) {
                        openWelcomeTab(context);
                        await settingsService.set(WELCOME_SHOWN_KEY, true);
                    }
                    return true;
                } catch (error) {
                    console.error("[WorkspaceEditorSession] Failed to restore:", error);
                    return false;
                } finally {
                    restoreInProgressGlobal = false;
                }
            })();
            restorePromisesBySessionKey.set(sessionSettingsKey, promise);
            void promise.finally(() => {
                restorePromisesBySessionKey.delete(sessionSettingsKey);
            });
        }

    }, [enabled, context, uiService, settingsService, sessionSettingsKey, dashboardOpenProjectKey]);

    useEffect(() => {
        if (!enabled || !context || !uiService || !settingsService || !sessionSettingsKey) {
            return;
        }

        const focusedGroupId = (focus: FocusContext): string | null => {
            const groups = collectEditorGroups(uiService.getStore().getEditorLayout());
            if (focus.area === FocusArea.EditorTabs) {
                return groups.find(group => group.id === focus.targetId)?.id ?? null;
            }
            if (focus.area === FocusArea.Editor && focus.targetId) {
                return groups.find(group => group.tabs.some(tab => tab.id === focus.targetId))?.id ?? null;
            }
            return null;
        };
        let lastFocusedGroupId = focusedGroupId(uiService.focus.getFocus());
        let dirtyDuringRestore = false;

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
                const activeGroup = collectEditorGroups(layout).find(group => group.id === lastFocusedGroupId);
                await settingsService.set(sessionSettingsKey, serializeEditorSession(layout, activeGroup?.id ?? null));
            } catch (error) {
                console.error("[WorkspaceEditorSession] Failed to save:", error);
            }
        };

        const scheduleSave = () => {
            if (restoreInProgressGlobal) {
                dirtyDuringRestore = true;
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
        const unsubscribeFocus = uiService.focus.onFocusChange(focus => {
            const groupId = focusedGroupId(focus);
            if (groupId && groupId !== lastFocusedGroupId) {
                lastFocusedGroupId = groupId;
                scheduleSave();
            }
        });
        // Changes during restore cannot be saved until its startup tabs are settled.
        let mounted = true;
        void restorePromisesBySessionKey.get(sessionSettingsKey)?.then(restored => {
            if (mounted && restored && dirtyDuringRestore) scheduleSave();
        });

        return () => {
            mounted = false;
            unsubscribe();
            unsubscribeFocus();
            if (saveTimerRef.current) {
                void flushSave();
            }
        };
    }, [enabled, context, uiService, settingsService, sessionSettingsKey]);
}
