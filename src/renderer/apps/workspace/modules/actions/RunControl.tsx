import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileDiff, FlaskConical, GitBranch, Loader2, MonitorPlay, Package, PackagePlus, Play, RotateCcw, Square } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "../../context";
import { useKeybinding, useKeybindings } from "../../hooks";
import { useWorkspaceOperationsFrozen } from "../../hooks/useWorkspaceFrozen";
import { useFreezeUnavailableReason } from "../../components/ui/freezeGuard";
import { translate, useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { BUILD_CONSOLE_CHANNEL, BuildService } from "@/lib/workspace/services/core/BuildService";
import { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import type { DlcService } from "@/lib/workspace/services/dlc/DlcService";
import type { ProjectDlc } from "@shared/types/dlc";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { readProjectMobileOrientation, readProjectViewportConfig } from "@/apps/workspace/modules/ui-editor/editors/projectMobileOrientation";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { flushUIDocAndGraphIfDirty } from "./flushDevModeAssets";
import { openBuildDialog } from "./BuildDialog";
import { openPatchDialog } from "./PatchDialog";
import { openBuildReportTab } from "../build-report";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "./runtimeActionStatus";
import {
    getTestRunService,
    isTerminalTestStatus,
    openTestDialog,
    openTestReportTab,
    resolveTestText,
    TEST_RUN_COMMAND_ID,
    TEST_TOAST_KEYS,
    TEST_TOAST_TONE,
} from "../testing";
import type { TestRunRecord } from "@/lib/testing/types";
import type { DevModeStatus } from "@shared/types/devMode";
import type { GameBuildStatus } from "@shared/types/gameBuild";
import type { PreviewStatus } from "@shared/types/gameRuntime";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { useTitleBarMenu } from "../../components/ui/titleBarMenus";
import { useShortcutLabels } from "../../hooks/useShortcutLabels";
import { MenuShortcut } from "../../components/ui/MenuShortcut";
import { WorkspaceMenuAction, WorkspaceRunCommand } from "@shared/types/menu";
import type { TranslationKey } from "@shared/i18n";

/**
 * The two modes the Run button can launch; Build/Production is a separate control, and so is Test.
 *
 * A test is deliberately NOT a run mode: a mode is a persisted habit the split button remembers and
 * launches with one click, and "which test" is a question with as many answers as the registry has
 * entries. It holds the run slot while it runs (ruling R7) without being something the button can be
 * left pointing at.
 */
type RunMode = "devMode" | "preview";
const RUN_MODE_SETTINGS_KEY = "ui.runMode";
/**
 * Which build variant this machine runs this project as, bucketed by project.
 *
 * A machine habit rather than a project field, and the reasoning is in `runVariant.ts` on the main
 * process side, which reads this very key when it assembles. Kept in sync by name only, because the
 * two sides mean the same setting: a value written here decides what the next Dev Mode run *is*.
 */
const RUN_VARIANT_SETTINGS_KEY = "ui.runVariantByProject";
/**
 * Which of this project's DLC this machine runs it WITH, bucketed by project.
 *
 * None of them until an author ticks one: a run is the game a player bought, which is the state
 * being shipped and the only one where a forgotten `Is DLC Installed` guard shows itself. The
 * reasoning is on `runDlc.ts`, which reads this very key on the main process side.
 */
const RUN_DLC_ON_SETTINGS_KEY = "ui.runDlcOnByProject";
const RUN_MODES: readonly RunMode[] = ["devMode", "preview"];
/**
 * The catalog id the stop chord lives under, shared by the three commands that can be the thing it
 * stops. Spelled out rather than derived so `keybindingCatalog.test.ts` - which reads source text,
 * not a running app - can check that an entry for it exists.
 */
const RUN_STOP_CATALOG_ID = "run:stop";
/** Where a failed run's output is; the panel the failure notification sends the author to. */
const CONSOLE_PANEL_ID = "narraleaf-studio:console";

const RUN_MODE_META: Record<RunMode, {
    icon: React.ReactNode;
    labelKey: TranslationKey;
    runKey: TranslationKey;
    stopKey: TranslationKey;
    /** The catalog entry whose chord launches this mode, printed beside the row. */
    catalogId: string;
}> = {
    devMode: {
        icon: <Play className="h-4 w-4" />,
        labelKey: "actions.run.devMode",
        runKey: "actions.run.runDevMode",
        stopKey: "workspace.shell.stopDevMode",
        catalogId: "run:dev-mode",
    },
    preview: {
        icon: <MonitorPlay className="h-4 w-4" />,
        labelKey: "actions.run.preview",
        runKey: "actions.run.runPreview",
        stopKey: "workspace.shell.stopPreview",
        catalogId: "run:preview",
    },
};

function normalizeRunMode(value: unknown): RunMode {
    return value === "preview" ? "preview" : "devMode";
}

/**
 * The Run split-button. One label+icon button that launches the *selected* mode (Dev Mode or
 * Preview) with a dropdown to switch which one that is. While a mode runs the button becomes a Stop
 * control and the mode rows go inert — you cannot switch modes mid-run, only stop the running one.
 * Which mode is selected persists globally (see `ui.runMode`).
 *
 * **Production Build lives in that dropdown**, not in its own title-bar icon: the version control
 * widget needs the room, and run and build belong to one another anyway.
 * The action itself stays registered (see `buildAction`) because the macOS Dev ▸ Build menu, the
 * command palette and the freeze policy all resolve through the registry; `ActionBar` skips drawing
 * it. This control also carries the build's STATUS and its done/failed notifications, which used to
 * live inside the icon component - an effect in an icon runs once per place the icon is rendered.
 *
 * A frozen workspace disables Preview and Production Build but not Dev Mode. This control is a fixed
 * part of the top bar rather than a registered action, so the exemption table in
 * `components/ui/freezeActionPolicy` does not reach it and the rules are spelled out below instead.
 * Which freezes count is not spelled out here, though: `useWorkspaceOperationsFrozen` asks the same
 * predicate the managers that start these things ask, so the button and the process agree.
 */
export function RunControl() {
    const { t } = useTranslation();
    const { workspace, context } = useWorkspace();
    // Everything this control launches is started by the main process, which refuses on its own
    // account - so the question here is that same refusal, not "is project data frozen". They part
    // company for the one freeze whose working tree IS what the author is looking at; greying these
    // rows there would leave a button that does nothing while the process behind it would have said
    // yes.
    const frozen = useWorkspaceOperationsFrozen();
    const [mode, setMode] = useState<RunMode>("devMode");
    const [devStatus, setDevStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
    const [buildStatus, setBuildStatus] = useState<GameBuildStatus>("idle");
    const [activeRun, setActiveRun] = useState<TestRunRecord | null>(null);
    // Held in the title bar's bar of menus, so opening this one puts away whatever was open. It is
    // NOT part of the chain the pointer walks (`hotTrack`): this is a button that runs the project
    // and happens to carry a menu, and crossing it on the way elsewhere is not a request to see the
    // run modes. See `../../components/ui/titleBarMenus`.
    const {
        ref: menuRef,
        open: menuOpen,
        setOpen: setMenuOpen,
        toggle: toggleMenu,
    } = useTitleBarMenu("narraleaf-studio:run");
    const shortcuts = useShortcutLabels();
    const [variantOpen, setVariantOpen] = useState(false);
    const [variants, setVariants] = useState<ProjectAppTag[]>([]);
    const [variantId, setVariantId] = useState<string | null>(null);
    const [dlcOpen, setDlcOpen] = useState(false);
    const [dlcs, setDlcs] = useState<ProjectDlc[]>([]);
    // Reset player data is a flyout submenu, not an inline section like the variant and DLC pickers:
    // those show a persistent current choice, while this is a one-shot action, so it opens to the
    // side on hover and takes no permanent room in the menu.
    const [resetOpen, setResetOpen] = useState(false);
    const [resetToLeft, setResetToLeft] = useState(false);
    const resetRowRef = useRef<HTMLDivElement | null>(null);
    const resetCloseTimerRef = useRef<number | null>(null);
    /** The ids ticked on, as the setting stores them. An id the project lost is left alone here. */
    const [dlcOn, setDlcOn] = useState<readonly string[]>([]);

    // The variant list folds away with the menu that holds it. It has to be tied to the menu closing
    // rather than to the gestures that close it: the bar puts this menu away too - when a sibling
    // opens, or when a pointer lands elsewhere - and reopening onto a list left expanded would show
    // a submenu nobody asked for.
    useEffect(() => {
        if (!menuOpen) {
            setVariantOpen(false);
            setDlcOpen(false);
            setResetOpen(false);
        }
    }, [menuOpen]);

    // The selected mode is a global UI habit; follow live changes so a second window stays in sync.
    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setMode(normalizeRunMode(settings.getSync(RUN_MODE_SETTINGS_KEY)));
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === RUN_MODE_SETTINGS_KEY) {
                setMode(normalizeRunMode(change.value));
            }
        });
        return () => token?.cancel();
    }, [context]);

    // The project's variants, followed live: an author who builds one in the Project panel and comes
    // straight back here must find it in the list. `AppTagService` emits on every mutation, so this
    // is the whole subscription.
    useEffect(() => {
        if (!context) {
            return;
        }
        const tags = context.services.get<AppTagService>(Services.AppTags);
        const read = () => setVariants(tags.listAuthoredTags());
        read();
        return tags.onTagsChanged(read);
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const dlc = context.services.get<DlcService>(Services.Dlc);
        setDlcs(dlc.list());
        return dlc.onDlcChanged(setDlcs);
    }, [context]);

    // Which ones are ticked on, from the same store the main process reads.
    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const projectKey = normalizeProjectPath(context.project.getConfig()?.projectPath ?? "");
        const read = (value: unknown) => {
            const record = value && typeof value === "object" && !Array.isArray(value)
                ? value as Record<string, unknown>
                : {};
            const stored = record[projectKey];
            setDlcOn(
                (Array.isArray(stored) ? stored : [])
                    .filter((id): id is string => typeof id === "string" && Boolean(id.trim())),
            );
        };
        read(settings.getSync(RUN_DLC_ON_SETTINGS_KEY));
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === RUN_DLC_ON_SETTINGS_KEY) {
                read(change.value);
            }
        });
        return () => token?.cancel();
    }, [context]);

    // Which one is selected, from the same store the main process reads.
    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const projectKey = normalizeProjectPath(context.project.getConfig()?.projectPath ?? "");
        const read = (value: unknown) => {
            const record = value && typeof value === "object" && !Array.isArray(value)
                ? value as Record<string, unknown>
                : {};
            const stored = record[projectKey];
            setVariantId(typeof stored === "string" && stored ? stored : null);
        };
        read(settings.getSync(RUN_VARIANT_SETTINGS_KEY));
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === RUN_VARIANT_SETTINGS_KEY) {
                read(change.value);
            }
        });
        return () => token?.cancel();
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const dev = context.services.get<DevModeService>(Services.DevMode);
        setDevStatus(dev.getStatus());
        return dev.onStatusChanged(setDevStatus);
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const preview = context.services.get<PreviewService>(Services.Preview);
        setPreviewStatus(preview.getStatus());
        return preview.onStatusChanged(setPreviewStatus);
    }, [context]);

    /**
     * The build's status, and the notification that reports its end.
     *
     * Moved here from the Build icon because this control is mounted for the whole session while an
     * icon is mounted once per surface that draws it - and the icon was drawn in the command palette
     * too, so a build finishing with the palette open announced itself twice.
     *
     * Three things the announcement has to get right:
     *
     *  - **A patch export announces itself too.** It runs in the same session and reports the same
     *    states, it takes as long as a build, and it is watched no more closely; only the wording
     *    differs, because a patch produces no installer.
     *  - **A run the author stopped announces nothing.** The pipeline reports it as a failure, and
     *    `cancelled` on the finished run is what tells the two apart.
     *  - **The notification stays up.** A build runs for minutes with nobody watching, so an outcome
     *    that cleared itself after five seconds was an outcome the author never saw - and the button
     *    on it has to still be there when they come back.
     */
    useEffect(() => {
        if (!context) {
            return;
        }
        const build = context.services.get<BuildService>(Services.Build);
        const uiService = context.services.get<UIService>(Services.UI);
        // Seeded with whatever had already ended before this subscription existed, so remounting the
        // top bar does not re-announce a run the author read about ten minutes ago.
        let announced = build.getLastFinishedRun()?.id ?? 0;
        setBuildStatus(build.getStatus());
        return build.onStateChanged(state => {
            setBuildStatus(state.status);
            const run = build.getLastFinishedRun();
            if (!run || run.id === announced) {
                return;
            }
            announced = run.id;
            if (run.cancelled) {
                return;
            }
            const patch = run.kind === "patch";
            if (run.state.status === "done") {
                uiService.showNotification(
                    translate(patch ? "build.toast.patchDone" : "build.toast.done"),
                    "success",
                    {
                        sticky: true,
                        actions: [{
                            label: translate("build.toast.openReport"),
                            primary: true,
                            onClick: () => openBuildReportTab(context),
                        }],
                    },
                );
            } else {
                uiService.showNotification(
                    run.state.error ?? translate(patch ? "build.toast.patchFailed" : "build.toast.failed"),
                    "error",
                    {
                        sticky: true,
                        actions: [{
                            label: translate("build.dialog.viewConsole"),
                            primary: true,
                            onClick: () => {
                                uiService.panels.show(CONSOLE_PANEL_ID);
                                // Showing the panel restores whichever channel was last active, so
                                // without this the author can land on a tab the build never wrote to.
                                context.services
                                    .get<ConsoleService>(Services.Console)
                                    .requestFocus(BUILD_CONSOLE_CHANNEL);
                            },
                        }],
                    },
                );
            }
        });
    }, [context]);

    /**
     * The test run: what the button is holding, and the one announcement a finished run makes.
     *
     * Raised here for the same reason the build's toasts moved here - this control is mounted for
     * the whole session, while anything that could plausibly own the announcement instead (the
     * picker, the report tab) is transient, and a dialog that closed at Start cannot report an
     * outcome it is not around for. Opening the report tab rides along for the same reason.
     *
     * `announced` is seeded with every run that had already settled before this subscription
     * existed, so remounting the top bar does not re-toast a run the author read about ten minutes
     * ago. It is keyed by run id rather than by "the newest one changed", because a run's record
     * keeps being written to (findings, log lines) after it settles.
     */
    useEffect(() => {
        if (!context) {
            return;
        }
        const testRun = getTestRunService(context);
        const uiService = context.services.get<UIService>(Services.UI);
        const announced = new Set(
            testRun.listRuns().filter(run => isTerminalTestStatus(run.status)).map(run => run.runId),
        );
        const sync = () => {
            setActiveRun(testRun.getActiveRun());
            for (const run of testRun.listRuns()) {
                if (!isTerminalTestStatus(run.status) || announced.has(run.runId)) {
                    continue;
                }
                announced.add(run.runId);
                const title = resolveTestText(run.title, translate);
                uiService.showNotification(
                    translate(TEST_TOAST_KEYS[run.status], { title }),
                    TEST_TOAST_TONE[run.status],
                );
                openTestReportTab(context, run.runId);
            }
        };
        sync();
        return testRun.onChanged(sync);
    }, [context]);

    const devActive = isDevModeRuntimeActive(devStatus);
    const previewActive = isPreviewRuntimeActive(previewStatus);
    const testActive = activeRun !== null;
    const activeMode: RunMode | null = devActive ? "devMode" : previewActive ? "preview" : null;
    // A test holds the run slot exactly as a mode does (ruling R7): the mode rows go inert, and this
    // button becomes the Stop control for it.
    const running = activeMode !== null || testActive;
    // The face reflects whatever is actually running; when nothing is, the selected mode.
    const shownMode = activeMode ?? mode;
    const meta = RUN_MODE_META[shownMode];
    const errored = !running && (shownMode === "devMode" ? devStatus === "error" : previewStatus === "error");

    /**
     * Preview is off while frozen; Dev Mode stays on.
     *
     * Preview builds and runs the project the way a player would receive it, and that is the thing a
     * frozen workspace is specifically not claiming to be. Dev Mode runs what is on disk, which while
     * a freeze is manual IS the working tree - correct as it stands. Pointing Dev Mode at the focused
     * revision instead is future work; nothing here anticipates it.
     *
     * Never applied while something is running: whatever the freeze says, a launched process must
     * always be stoppable, and this same button is the stop control.
     */
    const previewBlocked = frozen && !running && shownMode === "preview";
    const frozenTitle = useFreezeUnavailableReason();
    const building = buildStatus === "preparing" || buildStatus === "compiling" || buildStatus === "packaging";
    /**
     * Production Build is off while frozen, exactly as it was when it had its own button - the same
     * answer `resolveFrozenActionDisabled` gives for `buildAction`, which is still what the palette
     * and the macOS menu consult. A frozen workspace is not claiming to be shippable, and main refuses
     * the build a second time anyway (greying a renderer control is affordance, not enforcement).
     */
    const buildBlocked = frozen;

    /** Start one mode. Shared with the palette's run commands so the flush-then-launch order is not copied. */
    /**
     * Refresh the plugin dependency table before a run.
     *
     * Which plugin runtime entries go into the pack is decided from that table (see
     * `selectRuntimePluginsForPack`), and until now only a build, an export, or a visit to the
     * Project panel ever refreshed it. So the first run after an author added the row that USES a
     * plugin - a plugin blueprint node, a plugin story action - ran a game the plugin was not in,
     * and the feature simply did not happen with nothing on screen to say why.
     *
     * Best-effort and awaited: a scan failure must not stop the author running their game, but a
     * run that starts before the scan lands would pack the stale answer, which is the bug.
     * Skipped on a frozen workspace, for the reason the export path documents - nobody asked for
     * this write, and it is bookkeeping rather than the thing being run.
     */
    const refreshDependenciesForRun = async () => {
        if (!context || getProjectWriteFreeze() !== null) {
            return;
        }
        try {
            await context.services
                .get<ProjectDependencyService>(Services.ProjectDependency)
                .rescanAndPersist();
        } catch (error) {
            console.warn("[run] plugin dependency rescan failed", error);
        }
    };

    const launchMode = (target: RunMode) => {
        if (!workspace || !context) {
            return;
        }
        if (target === "preview") {
            void (async () => {
                await refreshDependenciesForRun();
                await context.services.get<PreviewService>(Services.Preview)
                    .launch({ kind: "surface", surfaceId: MAIN_APP_SURFACE_ID });
            })();
            return;
        }
        const dev = context.services.get<DevModeService>(Services.DevMode);
        void (async () => {
            try {
                await flushUIDocAndGraphIfDirty(workspace);
            } catch (e) {
                console.error("[DevMode] flush before launch failed", e);
            }
            await refreshDependenciesForRun();
                // No safeAreaId on purpose: the top bar runs the game the way a player gets it. The
            // orientation is project context rather than a design aid, and the Dev Mode window's
            // own safe-area picker needs it to resolve a device onto the right edge.
            await dev.launch({
                kind: "surface",
                surfaceId: MAIN_APP_SURFACE_ID,
                mobileOrientation: readProjectMobileOrientation(context),
                viewport: readProjectViewportConfig(context),
            });
        })();
    };

    const runOrStop = () => {
        if (!workspace || !context) {
            return;
        }
        if (activeRun) {
            getTestRunService(context).cancel(activeRun.runId);
            return;
        }
        if (devActive) {
            void context.services.get<DevModeService>(Services.DevMode).stop();
            return;
        }
        if (previewActive) {
            void context.services.get<PreviewService>(Services.Preview).stop();
            return;
        }
        launchMode(mode);
    };

    const selectMode = (next: RunMode) => {
        setMenuOpen(false);
        if (next === mode) {
            return;
        }
        setMode(next);
        void getInterface().app.state.setGlobalState(RUN_MODE_SETTINGS_KEY, next);
    };

    /**
     * The same launches, by name.
     *
     * This control is a fixed part of the top bar rather than a registered action, so nothing about
     * it reached the command palette - running the project was mouse-only. Registered here rather
     * than in a commands module because the launch sequence (flush dirty UI docs, then launch the
     * main surface) lives here, and a second copy of it would drift.
     *
     * One entry per state, like the freeze commands: an author searching "run" should read off the
     * list what is running, and a single Run/Stop toggle whose meaning depends on invisible state is
     * the opposite of that. `when` reads live status through the ref, since the palette re-evaluates
     * it on every keystroke.
     */
    const openTest = () => {
        if (workspace) {
            openTestDialog(workspace);
        }
    };

    const openBuild = () => {
        if (workspace) {
            void openBuildDialog(workspace);
        }
    };

    const runStateRef = useRef({ devActive, previewActive, testActive, frozen, runOrStop, launchMode, openTest, openBuild });
    runStateRef.current = { devActive, previewActive, testActive, frozen, runOrStop, launchMode, openTest, openBuild };

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const idle = () => !runStateRef.current.devActive && !runStateRef.current.previewActive;
        const launch = (target: RunMode) => runStateRef.current.launchMode(target);
        return commandService.registerMany([
            {
                id: WorkspaceRunCommand.RunDevMode,
                titleKey: "actions.run.runDevMode",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                // The run modes already own a glyph each (RUN_MODE_META) - reused here rather than
                // chosen again, so the palette row and the button that does the same thing match.
                icon: RUN_MODE_META.devMode.icon,
                when: idle,
                run: () => launch("devMode"),
            },
            {
                id: WorkspaceRunCommand.RunPreview,
                titleKey: "actions.run.runPreview",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                icon: RUN_MODE_META.preview.icon,
                // Preview is what a frozen workspace is specifically not claiming to be; see above.
                when: () => idle() && !runStateRef.current.frozen,
                run: () => launch("preview"),
            },
            {
                id: WorkspaceRunCommand.StopDevMode,
                // All three stop rows show the one chord that stops whatever holds the run slot,
                // and none of them owns it - the catalog has a single `run:stop` entry to rebind,
                // rather than three that would read as conflicting with one another.
                keybindingId: RUN_STOP_CATALOG_ID,
                titleKey: "workspace.shell.stopDevMode",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                // Stopping is one act with one glyph, whatever is running - the same square the
                // button turns into.
                icon: <Square className="w-4 h-4" />,
                when: () => runStateRef.current.devActive,
                run: () => runStateRef.current.runOrStop(),
            },
            {
                id: WorkspaceRunCommand.StopPreview,
                keybindingId: RUN_STOP_CATALOG_ID,
                titleKey: "workspace.shell.stopPreview",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                icon: <Square className="w-4 h-4" />,
                when: () => runStateRef.current.previewActive,
                run: () => runStateRef.current.runOrStop(),
            },
            {
                // Not gated on `idle()`, unlike the two launches above: this opens the picker rather
                // than starting anything, and the picker is where an author reads WHY every test is
                // greyed out while something else runs. Not gated on the freeze either - a headless
                // test is a read-only observer and runs while frozen (ruling R9), and which tests
                // those are is `getAvailability`'s answer to give, not this predicate's.
                id: TEST_RUN_COMMAND_ID,
                titleKey: "test.action.run",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                icon: <FlaskConical className="w-4 h-4" />,
                when: () => !runStateRef.current.testActive,
                run: () => runStateRef.current.openTest(),
            },
            {
                id: WorkspaceRunCommand.StopTest,
                keybindingId: RUN_STOP_CATALOG_ID,
                titleKey: "test.action.stop",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                icon: <Square className="w-4 h-4" />,
                when: () => runStateRef.current.testActive,
                run: () => runStateRef.current.runOrStop(),
            },
            // Production Build is deliberately absent: `buildAction` is a registered action, so the
            // palette already derives it (and drops it while frozen). A second entry would be a
            // duplicate row that the freeze policy does not reach.
        ]);
    }, [context]);

    /**
     * The same launches, by key.
     *
     * Registered here rather than beside the shell's other shortcuts for the reason the commands
     * above are: the launch sequence lives in this component, and a second copy of it would drift.
     * Each id below composes with `catalogPrefix` into the id of the command it runs (`run:dev-mode`
     * and friends), which is what keeps the palette to one row per command - the row shows the
     * chord instead of the shortcut appearing under a second name.
     *
     * The `when` predicates mirror the commands' exactly, so a chord is dead in precisely the
     * states its palette entry is missing: nothing starts while something else holds the run slot,
     * Preview stays off while the workspace is frozen, and Stop is live only while there is
     * something to stop.
     *
     * `allowInEditable` throughout: these are function keys, so there is no keystroke an author
     * could lose to them, and the caret is in a story line for most of the working day - a run
     * shortcut that only worked when it was not would be a run shortcut that never worked.
     */
    useKeybindings({
        keybindings: [
            {
                id: "dev-mode",
                key: "f5",
                description: "Run the project in Dev Mode",
                allowInEditable: true,
                when: () => !runStateRef.current.devActive && !runStateRef.current.previewActive,
                handler: () => runStateRef.current.launchMode("devMode"),
            },
            {
                id: "preview",
                key: "f6",
                description: "Run the project in Preview",
                allowInEditable: true,
                when: () => !runStateRef.current.devActive
                    && !runStateRef.current.previewActive
                    && !runStateRef.current.frozen,
                handler: () => runStateRef.current.launchMode("preview"),
            },
            {
                id: "test",
                key: "f7",
                description: "Open the test picker",
                allowInEditable: true,
                when: () => !runStateRef.current.testActive,
                handler: () => runStateRef.current.openTest(),
            },
            {
                id: "stop",
                key: "shift+f5",
                description: "Stop whatever is running",
                allowInEditable: true,
                when: () => runStateRef.current.devActive
                    || runStateRef.current.previewActive
                    || runStateRef.current.testActive,
                handler: () => runStateRef.current.runOrStop(),
            },
        ],
        idPrefix: "workspace-run",
        catalogPrefix: "run:",
    });

    /**
     * Production Build's chord.
     *
     * Registered apart from the four above because Build is a toolbar ACTION, not a palette command,
     * and an action's shortcut is read - by the palette and by the override map alike - under
     * `action:<id>`. Binding it there rather than declaring `shortcut` on the action itself is
     * deliberate: `shortcut` auto-registers a binding that no catalog entry governs, which would
     * leave this chord unrebindable and absent from the shortcut settings.
     *
     * The freeze check is this binding's own, because the freeze policy that greys the button and
     * drops the palette row never sees a keystroke.
     */
    useKeybinding({
        id: "workspace-run-build",
        catalogId: "action:narraleaf-studio:build",
        key: "f10",
        description: "Open the production build dialog",
        allowInEditable: true,
        when: () => !runStateRef.current.frozen,
        handler: () => runStateRef.current.openBuild(),
    });

    /**
     * The variant a run assembles as, or null for the whole game.
     *
     * A stored id whose variant has since been deleted reads as null rather than as an error, which
     * is the same answer the main process gives: deleting a variant must not leave every run of the
     * project refusing to start.
     */
    const selectedVariant = useMemo(
        () => variants.find(variant => variant.id === variantId) ?? null,
        [variants, variantId],
    );

    const selectVariant = useCallback((id: string | null): void => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const projectKey = normalizeProjectPath(context.project.getConfig()?.projectPath ?? "");
        const current = settings.getSync(RUN_VARIANT_SETTINGS_KEY);
        const record: Record<string, unknown> = current && typeof current === "object" && !Array.isArray(current)
            ? { ...current as Record<string, unknown> }
            : {};
        if (id) {
            record[projectKey] = id;
        } else {
            // Deleted rather than stored as the release id, so "runs the whole game" and "never
            // chose" are one state - the same rule the variant overrides themselves follow.
            delete record[projectKey];
        }
        void settings.set(RUN_VARIANT_SETTINGS_KEY, record);
        setVariantId(id);
        setVariantOpen(false);
    }, [context]);

    /**
     * How many of this project's DLC a run has, and how many it could.
     *
     * Counted against the project's own list rather than against the stored set, so an id left over
     * from a deleted DLC cannot make the row claim something is on that is not there.
     */
    const activeDlcCount = useMemo(
        () => dlcs.filter(dlc => dlcOn.includes(dlc.id)).length,
        [dlcOn, dlcs],
    );

    const toggleDlc = useCallback((id: string): void => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const projectKey = normalizeProjectPath(context.project.getConfig()?.projectPath ?? "");
        const current = settings.getSync(RUN_DLC_ON_SETTINGS_KEY);
        const record: Record<string, unknown> = current && typeof current === "object" && !Array.isArray(current)
            ? { ...current as Record<string, unknown> }
            : {};
        const next = dlcOn.includes(id) ? dlcOn.filter(entry => entry !== id) : [...dlcOn, id];
        if (next.length > 0) {
            record[projectKey] = next;
        } else {
            // Deleted rather than stored as an empty list, so "runs with none of them" and "never
            // chose" are one state - the same rule the variant choice follows.
            delete record[projectKey];
        }
        void settings.set(RUN_DLC_ON_SETTINGS_KEY, record);
        setDlcOn(next);
        // The menu stays open, unlike the variant rows: ticking several on is one decision made in
        // several clicks, and closing after each would make the author reopen it every time.
    }, [context, dlcOn]);

    /**
     * Clear the save slots and persistent data a mode leaves behind.
     *
     * The recovery path for a game that poisons its own persisted state and crashes on launch: the
     * data is cleared through the main process without booting the game, so it works when the game
     * will not. Confirmed first because it is destructive, and reported either way.
     */
    const resetPlayerData = useCallback(async (target: RunMode): Promise<void> => {
        if (!context) {
            return;
        }
        setMenuOpen(false);
        const uiService = context.services.get<UIService>(Services.UI);
        const confirmed = await uiService.showConfirm(
            translate(target === "devMode" ? "actions.run.resetDevModeConfirm" : "actions.run.resetPreviewConfirm"),
            translate("actions.run.resetDetail"),
        );
        if (!confirmed) {
            return;
        }
        try {
            if (target === "devMode") {
                await context.services.get<DevModeService>(Services.DevMode).resetData();
            } else {
                await context.services.get<PreviewService>(Services.Preview).resetData();
            }
            uiService.showNotification(translate("actions.run.resetDone"), "success");
        } catch (error) {
            console.error("[run] reset player data failed", error);
            uiService.showNotification(translate("actions.run.resetFailed"), "error");
        }
    }, [context, setMenuOpen]);

    // The flyout opens on hover and closes on a short delay, so crossing the gap from the row to the
    // panel does not shut it. Which side it opens on is measured, because the Run button sits well to
    // the right of the bar and a panel pinned to the right would run off screen there.
    const openResetFlyout = useCallback(() => {
        if (resetCloseTimerRef.current !== null) {
            window.clearTimeout(resetCloseTimerRef.current);
            resetCloseTimerRef.current = null;
        }
        const rect = resetRowRef.current?.getBoundingClientRect();
        if (rect) {
            const PANEL_WIDTH = 176; // min-w-44
            setResetToLeft(rect.right + PANEL_WIDTH + 8 > window.innerWidth);
        }
        setResetOpen(true);
    }, []);
    const scheduleCloseResetFlyout = useCallback(() => {
        if (resetCloseTimerRef.current !== null) {
            window.clearTimeout(resetCloseTimerRef.current);
        }
        resetCloseTimerRef.current = window.setTimeout(() => {
            resetCloseTimerRef.current = null;
            setResetOpen(false);
        }, 200);
    }, []);
    useEffect(() => () => {
        if (resetCloseTimerRef.current !== null) {
            window.clearTimeout(resetCloseTimerRef.current);
        }
    }, []);

    // A test owns the face while it runs: showing "Dev Mode" over a Stop square would name the wrong
    // thing to stop.
    const runTitle = testActive ? t("test.action.stop") : running ? t(meta.stopKey) : t(meta.runKey);
    // The variant rides on the face whenever it is not the whole game. "Dev Mode is the preview you
    // can trust at any moment" only holds while it cannot quietly have become something else, and a
    // setting one click deep in a menu is quiet.
    //
    // The DLC selection deliberately does NOT ride here. It is a set rather than a name, so the
    // only thing it could add is a count - and a count is not what the face is for: the face says
    // what this run IS, and every run is the game with whatever the author asked for beside it.
    // The menu row states the count where it can be read against the list it counts.
    const runLabel = testActive
        ? t("test.statusBar.label")
        : selectedVariant
            ? `${t(meta.labelKey)} · ${selectedVariant.name}`
            : t(meta.labelKey);

    return (
        <div className="relative flex items-center" ref={menuRef}>
            <div className={cn("flex h-8 items-stretch overflow-hidden rounded-md", running && "bg-danger text-white")}>
                <button
                    type="button"
                    onClick={runOrStop}
                    disabled={previewBlocked}
                    data-tip={previewBlocked ? frozenTitle : runTitle}
                    aria-label={runTitle}
                    aria-pressed={running || undefined}
                    className={cn(
                        "flex cursor-default items-center gap-1.5 px-2 text-sm transition-colors",
                        previewBlocked
                            ? "cursor-not-allowed text-fg-subtle"
                            : running ? "hover:bg-danger/80" : "text-fg-muted hover:bg-fill hover:text-fg",
                    )}
                >
                    <span className={cn("flex h-4 w-4 items-center justify-center", errored && "text-danger")}>
                        {running ? <Square className="h-3.5 w-3.5 fill-current" /> : meta.icon}
                    </span>
                    <span>{runLabel}</span>
                </button>

                {/* Stays live while a mode runs, unlike before: the menu is no longer only "switch
                    mode", it is also the only way to reach Production Build, and folding that in must
                    not take away an entry point that used to be a click away. The mode rows below go
                    inert instead, which is where the "no switching mid-run" rule actually belongs. */}
                <button
                    type="button"
                    onClick={toggleMenu}
                    data-tip={t("actions.run.menu")}
                    aria-label={t("actions.run.menu")}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className={cn(
                        "flex cursor-default items-center justify-center px-1 transition-colors",
                        running ? "text-white hover:bg-danger/80" : "text-fg-muted hover:bg-fill hover:text-fg",
                    )}
                >
                    <ChevronDown className={cn("h-3 w-3 transition-transform", menuOpen && "rotate-180")} />
                </button>
            </div>

            {menuOpen && (
                <>
                    {/* Backdrop. The bar is what notices a pointer landing outside this menu; what
                        this adds is that a click meant to put the menu away does not also press
                        whatever it landed on. It reaches only the content below the title bar. */}
                    <div
                        className="nl-window-content-layer z-10"
                        onClick={() => setMenuOpen(false)}
                    />
                    <div
                        role="menu"
                        aria-label={t("actions.run.menu")}
                        className="absolute left-0 top-full z-20 mt-1 min-w-52 rounded-md border border-edge-strong bg-surface-overlay py-1 shadow-lg"
                    >
                        {RUN_MODES.map(option => {
                            const optionMeta = RUN_MODE_META[option];
                            const selected = option === mode;
                            // Selecting a mode whose run button is dead would be a dead end, so the
                            // frozen mode is disabled here too - and stays listed, so the author can
                            // see that Preview exists and why it is off. Everything is inert while
                            // something runs: the mode cannot change under a running process.
                            const optionBlocked = running || (frozen && option === "preview");
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={selected}
                                    aria-disabled={optionBlocked || undefined}
                                    disabled={optionBlocked}
                                    data-tip={frozen && option === "preview" ? frozenTitle : undefined}
                                    onClick={() => selectMode(option)}
                                    className={cn(
                                        "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                        optionBlocked
                                            ? "cursor-not-allowed text-fg-subtle"
                                            : selected ? "text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                    )}
                                >
                                    <span className="flex h-4 w-4 items-center justify-center">{optionMeta.icon}</span>
                                    <span className="flex-1 whitespace-nowrap text-left">{t(optionMeta.labelKey)}</span>
                                    <MenuShortcut of={shortcuts.forBinding(optionMeta.catalogId)} />
                                    <span className="w-3">{selected && <Check className="h-3 w-3" />}</span>
                                </button>
                            );
                        })}

                        {/* Which edition the three run entries above assemble as. Only where there is
                            something to pick: a project with no variant of its own has one answer, and
                            a row offering it would be a control that cannot do anything. */}
                        {variants.length > 0 && (
                            <>
                                <div className="my-1 mx-2 h-px bg-fill-strong" />
                                <button
                                    type="button"
                                    role="menuitem"
                                    aria-expanded={variantOpen}
                                    aria-label={t("actions.run.runAs")}
                                    onClick={() => setVariantOpen(open => !open)}
                                    className={cn(
                                        "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                        "text-fg-muted hover:bg-fill hover:text-fg",
                                    )}
                                >
                                    <span className="flex h-4 w-4 items-center justify-center">
                                        <GitBranch className="h-4 w-4" />
                                    </span>
                                    <span className="flex-1 whitespace-nowrap text-left">{t("actions.run.runAs")}</span>
                                    <span className="text-fg-subtle">
                                        {selectedVariant?.name ?? RELEASE_APP_TAG.name}
                                    </span>
                                    <span className="w-3">
                                        <ChevronRight className={cn("h-3 w-3 transition-transform", variantOpen && "rotate-90")} />
                                    </span>
                                </button>
                                {variantOpen && [null, ...variants].map(variant => {
                                    const id = variant?.id ?? null;
                                    const selected = id === (selectedVariant?.id ?? null);
                                    return (
                                        <button
                                            key={id ?? RELEASE_APP_TAG.id}
                                            type="button"
                                            role="menuitemradio"
                                            aria-checked={selected}
                                            onClick={() => selectVariant(id)}
                                            className={cn(
                                                "flex w-full cursor-default items-center gap-2 py-1.5 pl-9 pr-3 text-sm transition-colors",
                                                selected ? "text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                            )}
                                        >
                                            <span className="flex-1 text-left">{variant?.name ?? RELEASE_APP_TAG.name}</span>
                                            <span className="w-3">{selected && <Check className="h-3 w-3" />}</span>
                                        </button>
                                    );
                                })}
                            </>
                        )}

                        {/* Which DLC the run has installed. It sits with the edition above, without a
                            rule between them, because the two rows answer one question together -
                            what this run IS. Only where the project ships some.

                            The rule appears only when there is no edition row above, where it is what
                            keeps DLC off the run modes.

                            Multi-select, so the row states a count rather than a name: "1 of 3" is
                            the only summary of a set that does not grow with it. None are on until an
                            author ticks one - a run is the game a player bought. */}
                        {dlcs.length > 0 && (
                            <>
                                {variants.length === 0 && <div className="my-1 mx-2 h-px bg-fill-strong" />}
                                <button
                                    type="button"
                                    role="menuitem"
                                    aria-expanded={dlcOpen}
                                    aria-label={t("actions.run.runWithDlc")}
                                    onClick={() => setDlcOpen(open => !open)}
                                    className={cn(
                                        "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                        "text-fg-muted hover:bg-fill hover:text-fg",
                                    )}
                                >
                                    <span className="flex h-4 w-4 items-center justify-center">
                                        <PackagePlus className="h-4 w-4" />
                                    </span>
                                    <span className="flex-1 whitespace-nowrap text-left">{t("actions.run.runWithDlc")}</span>
                                    <span className="text-fg-subtle">
                                        {t("actions.run.dlcCount", { active: activeDlcCount, total: dlcs.length })}
                                    </span>
                                    <span className="w-3">
                                        <ChevronRight className={cn("h-3 w-3 transition-transform", dlcOpen && "rotate-90")} />
                                    </span>
                                </button>
                                {dlcOpen && dlcs.map(dlc => {
                                    const active = dlcOn.includes(dlc.id);
                                    return (
                                        <button
                                            key={dlc.id}
                                            type="button"
                                            role="menuitemcheckbox"
                                            aria-checked={active}
                                            data-run-dlc={dlc.id}
                                            onClick={() => toggleDlc(dlc.id)}
                                            className={cn(
                                                "flex w-full cursor-default items-center gap-2 py-1.5 pl-9 pr-3 text-sm transition-colors",
                                                active ? "text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                            )}
                                        >
                                            <span className="flex-1 truncate text-left">{dlc.name}</span>
                                            <span className="w-3">{active && <Check className="h-3 w-3" />}</span>
                                        </button>
                                    );
                                })}
                            </>
                        )}

                        <div className="my-1 mx-2 h-px bg-fill-strong" />

                        {/* Production Build. Not a run mode - it produces a package rather than
                            launching anything - so it is a plain row below the radio group rather than
                            a third option, and it stays reachable while a mode runs. */}
                        <button
                            type="button"
                            role="menuitem"
                            aria-disabled={buildBlocked || undefined}
                            disabled={buildBlocked}
                            data-tip={buildBlocked ? frozenTitle : undefined}
                            onClick={() => {
                                setMenuOpen(false);
                                if (workspace) {
                                    void openBuildDialog(workspace);
                                }
                            }}
                            className={cn(
                                "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                buildBlocked
                                    ? "cursor-not-allowed text-fg-subtle"
                                    : "text-fg-muted hover:bg-fill hover:text-fg",
                            )}
                        >
                            <span className={cn("flex h-4 w-4 items-center justify-center", buildStatus === "error" && "text-danger")}>
                                {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-4 w-4" />}
                            </span>
                            <span className="flex-1 whitespace-nowrap text-left">{t("actions.run.productionBuild")}</span>
                            <MenuShortcut of={shortcuts.forAction(WorkspaceMenuAction.Build)} />
                            <span className="w-3" />
                        </button>

                        {/* Export patch. Directly under Production Build because it is the same
                            kind of thing - it produces a file rather than launching anything - and
                            because it is only ever reached after a build: a patch is made for one.
                            Gated by the same freeze, and for the same reason: it compiles the
                            project. */}
                        <button
                            type="button"
                            role="menuitem"
                            aria-disabled={buildBlocked || undefined}
                            disabled={buildBlocked}
                            data-tip={buildBlocked ? frozenTitle : undefined}
                            onClick={() => {
                                setMenuOpen(false);
                                if (workspace) {
                                    void openPatchDialog(workspace);
                                }
                            }}
                            className={cn(
                                "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                buildBlocked
                                    ? "cursor-not-allowed text-fg-subtle"
                                    : "text-fg-muted hover:bg-fill hover:text-fg",
                            )}
                        >
                            <span className="flex h-4 w-4 items-center justify-center">
                                <FileDiff className="h-4 w-4" />
                            </span>
                            <span className="flex-1 whitespace-nowrap text-left">{t("actions.run.exportPatch")}</span>
                            <span className="w-3" />
                        </button>

                        {/* Test. Beside Production Build rather than among the mode rows above,
                            because it is not a mode either - it checks the project instead of
                            launching it, and the picker is what decides what runs. Never gated
                            here: a headless test runs on a frozen workspace (ruling R9) and every
                            other refusal - the freeze, a run already in flight - is `getAvailability`'s
                            to state, per row, with its reason. Greying this row would replace all of
                            that with silence. */}
                        <button
                            type="button"
                            role="menuitem"
                            aria-label={t("test.action.open")}
                            onClick={() => {
                                setMenuOpen(false);
                                if (workspace) {
                                    openTestDialog(workspace);
                                }
                            }}
                            className="flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                        >
                            <span className="flex h-4 w-4 items-center justify-center">
                                {testActive
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <FlaskConical className="h-4 w-4" />}
                            </span>
                            <span className="flex-1 whitespace-nowrap text-left">{t("test.action.open")}</span>
                            <MenuShortcut of={shortcuts.forBinding(TEST_RUN_COMMAND_ID)} />
                            <span className="w-3" />
                        </button>

                        <div className="my-1 mx-2 h-px bg-fill-strong" />

                        {/* Reset player data. Clears the saves and persistent data a run leaves
                            behind - the recovery path when the author's own game poisons that state
                            and crashes on launch, reached without launching anything. A flyout rather
                            than an inline section: it is a one-shot action, not a persistent choice
                            like the variant and DLC pickers, so it opens to the side on hover and
                            leaves the menu the height it was. Dev Mode and Preview keep their data
                            apart, so each row resets one without touching the other. Always here, not
                            behind a setting: the author it helps most is the one who cannot get the
                            game to start, and that is exactly who would never find it hidden. */}
                        <div
                            ref={resetRowRef}
                            className="relative"
                            onMouseEnter={openResetFlyout}
                            onMouseLeave={scheduleCloseResetFlyout}
                        >
                            <button
                                type="button"
                                role="menuitem"
                                aria-haspopup="menu"
                                aria-expanded={resetOpen}
                                aria-label={t("actions.run.resetData")}
                                onClick={openResetFlyout}
                                className={cn(
                                    "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                    resetOpen ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                )}
                            >
                                <span className="flex h-4 w-4 items-center justify-center">
                                    <RotateCcw className="h-4 w-4" />
                                </span>
                                <span className="flex-1 whitespace-nowrap text-left">{t("actions.run.resetData")}</span>
                                <span className="w-3">
                                    <ChevronRight className="h-3 w-3" />
                                </span>
                            </button>

                            {/* The panel is a DOM child of the row, so moving the pointer onto it is
                                not "leaving" the row - that, plus the close delay, is what lets the
                                pointer travel across to it without the flyout shutting. */}
                            {resetOpen && (
                                <div
                                    role="menu"
                                    aria-label={t("actions.run.resetData")}
                                    className={cn(
                                        "absolute top-0 z-30 min-w-44 rounded-md border border-edge-strong bg-surface-overlay py-1 shadow-lg",
                                        resetToLeft ? "right-full mr-1" : "left-full ml-1",
                                    )}
                                >
                                    {RUN_MODES.map(option => {
                                        // Disabled while its own mode runs: clearing the store under a
                                        // live process would race its next write. Never blocks the
                                        // lockout case, where the mode is crashed rather than running.
                                        const optionRunning = option === "devMode" ? devActive : previewActive;
                                        const optionMeta = RUN_MODE_META[option];
                                        return (
                                            <button
                                                key={option}
                                                type="button"
                                                role="menuitem"
                                                aria-disabled={optionRunning || undefined}
                                                disabled={optionRunning}
                                                data-tip={optionRunning ? t("actions.run.resetWhileRunning") : undefined}
                                                onClick={() => void resetPlayerData(option)}
                                                className={cn(
                                                    "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                                    optionRunning
                                                        ? "cursor-not-allowed text-fg-subtle"
                                                        : "text-fg-muted hover:bg-fill hover:text-fg",
                                                )}
                                            >
                                                <span className="flex h-4 w-4 items-center justify-center">{optionMeta.icon}</span>
                                                <span className="flex-1 whitespace-nowrap text-left">{t(optionMeta.labelKey)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
