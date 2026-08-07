import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FlaskConical, Loader2, MonitorPlay, Package, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "../../context";
import { useWorkspaceFrozen } from "../../hooks/useWorkspaceFrozen";
import { translate, useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { flushUIDocAndGraphIfDirty } from "./flushDevModeAssets";
import { openBuildDialog } from "./BuildDialog";
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
import { WorkspaceRunCommand } from "@shared/types/menu";
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
const RUN_MODES: readonly RunMode[] = ["devMode", "preview"];

const RUN_MODE_META: Record<RunMode, {
    icon: React.ReactNode;
    labelKey: TranslationKey;
    runKey: TranslationKey;
    stopKey: TranslationKey;
}> = {
    devMode: {
        icon: <Play className="h-4 w-4" />,
        labelKey: "actions.run.devMode",
        runKey: "actions.run.runDevMode",
        stopKey: "workspace.shell.stopDevMode",
    },
    preview: {
        icon: <MonitorPlay className="h-4 w-4" />,
        labelKey: "actions.run.preview",
        runKey: "actions.run.runPreview",
        stopKey: "workspace.shell.stopPreview",
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
 * widget needs the room (plan 2026-07-28-002 §3), and run and build belong to one another anyway.
 * The action itself stays registered (see `buildAction`) because the macOS Dev ▸ Build menu, the
 * command palette and the freeze policy all resolve through the registry; `ActionBar` skips drawing
 * it. This control also carries the build's STATUS and its done/failed notifications, which used to
 * live inside the icon component - an effect in an icon runs once per place the icon is rendered.
 *
 * A frozen workspace disables Preview and Production Build but not Dev Mode. This control is a fixed
 * part of the top bar rather than a registered action, so the exemption table in
 * `components/ui/freezeActionPolicy` does not reach it and the rules are spelled out below instead.
 */
export function RunControl() {
    const { t } = useTranslation();
    const { workspace, context } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const [mode, setMode] = useState<RunMode>("devMode");
    const [devStatus, setDevStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
    const [buildStatus, setBuildStatus] = useState<GameBuildStatus>("idle");
    const [activeRun, setActiveRun] = useState<TestRunRecord | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);

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

    // The build's status, and the toasts that report its end. Moved here from the Build icon because
    // this control is mounted for the whole session while an icon is mounted once per surface that
    // draws it - and the icon was drawn in the command palette too, so a build finishing with the
    // palette open announced itself twice.
    useEffect(() => {
        if (!context) {
            return;
        }
        const build = context.services.get<BuildService>(Services.Build);
        const uiService = context.services.get<UIService>(Services.UI);
        let previous = build.getStatus();
        setBuildStatus(previous);
        return build.onStateChanged(state => {
            setBuildStatus(state.status);
            if (state.status !== previous) {
                if (state.status === "done") {
                    uiService.showNotification(translate("build.toast.done"), "success");
                } else if (state.status === "error") {
                    uiService.showNotification(state.error ?? translate("build.toast.failed"), "error");
                }
            }
            previous = state.status;
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
     * revision instead is U4 (plan 2026-07-28-002 §4); nothing here anticipates it.
     *
     * Never applied while something is running: whatever the freeze says, a launched process must
     * always be stoppable, and this same button is the stop control.
     */
    const previewBlocked = frozen && !running && shownMode === "preview";
    const frozenTitle = t("workspace.shell.freeze.unavailable");
    const building = buildStatus === "preparing" || buildStatus === "compiling" || buildStatus === "packaging";
    /**
     * Production Build is off while frozen, exactly as it was when it had its own button - the same
     * answer `resolveFrozenActionDisabled` gives for `buildAction`, which is still what the palette
     * and the macOS menu consult. A frozen workspace is not claiming to be shippable, and main refuses
     * the build a second time anyway (greying a renderer control is affordance, not enforcement).
     */
    const buildBlocked = frozen;

    /** Start one mode. Shared with the palette's run commands so the flush-then-launch order is not copied. */
    const launchMode = (target: RunMode) => {
        if (!workspace || !context) {
            return;
        }
        if (target === "preview") {
            void context.services.get<PreviewService>(Services.Preview)
                .launch({ kind: "surface", surfaceId: MAIN_APP_SURFACE_ID });
            return;
        }
        const dev = context.services.get<DevModeService>(Services.DevMode);
        void (async () => {
            try {
                await flushUIDocAndGraphIfDirty(workspace);
            } catch (e) {
                console.error("[DevMode] flush before launch failed", e);
            }
            await dev.launch({ kind: "surface", surfaceId: MAIN_APP_SURFACE_ID });
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

    const runStateRef = useRef({ devActive, previewActive, testActive, frozen, runOrStop, launchMode, openTest });
    runStateRef.current = { devActive, previewActive, testActive, frozen, runOrStop, launchMode, openTest };

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
                when: idle,
                run: () => launch("devMode"),
            },
            {
                id: WorkspaceRunCommand.RunPreview,
                titleKey: "actions.run.runPreview",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                // Preview is what a frozen workspace is specifically not claiming to be; see above.
                when: () => idle() && !runStateRef.current.frozen,
                run: () => launch("preview"),
            },
            {
                id: WorkspaceRunCommand.StopDevMode,
                titleKey: "workspace.shell.stopDevMode",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                when: () => runStateRef.current.devActive,
                run: () => runStateRef.current.runOrStop(),
            },
            {
                id: WorkspaceRunCommand.StopPreview,
                titleKey: "workspace.shell.stopPreview",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
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
                when: () => !runStateRef.current.testActive,
                run: () => runStateRef.current.openTest(),
            },
            {
                id: WorkspaceRunCommand.StopTest,
                titleKey: "test.action.stop",
                categoryKey: "workspace.shell.commandPalette.categoryRun",
                when: () => runStateRef.current.testActive,
                run: () => runStateRef.current.runOrStop(),
            },
            // Production Build is deliberately absent: `buildAction` is a registered action, so the
            // palette already derives it (and drops it while frozen). A second entry would be a
            // duplicate row that the freeze policy does not reach.
        ]);
    }, [context]);

    // A test owns the face while it runs: showing "Dev Mode" over a Stop square would name the wrong
    // thing to stop.
    const runTitle = testActive ? t("test.action.stop") : running ? t(meta.stopKey) : t(meta.runKey);
    const runLabel = testActive ? t("test.statusBar.label") : t(meta.labelKey);

    return (
        <div className="relative flex items-center">
            <div className={cn("flex h-8 items-stretch overflow-hidden rounded-md", running && "bg-danger text-white")}>
                <button
                    type="button"
                    onClick={runOrStop}
                    disabled={previewBlocked}
                    title={previewBlocked ? frozenTitle : runTitle}
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
                    onClick={() => setMenuOpen(open => !open)}
                    title={t("actions.run.menu")}
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
                    <div className="nl-window-content-layer z-10" onClick={() => setMenuOpen(false)} />
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
                                    title={frozen && option === "preview" ? frozenTitle : undefined}
                                    onClick={() => selectMode(option)}
                                    className={cn(
                                        "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                        optionBlocked
                                            ? "cursor-not-allowed text-fg-subtle"
                                            : selected ? "text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                    )}
                                >
                                    <span className="flex h-4 w-4 items-center justify-center">{optionMeta.icon}</span>
                                    <span className="flex-1 text-left">{t(optionMeta.labelKey)}</span>
                                    <span className="w-3">{selected && <Check className="h-3 w-3" />}</span>
                                </button>
                            );
                        })}

                        <div className="my-1 mx-2 h-px bg-fill-strong" />

                        {/* Production Build. Not a run mode - it produces a package rather than
                            launching anything - so it is a plain row below the radio group rather than
                            a third option, and it stays reachable while a mode runs. */}
                        <button
                            type="button"
                            role="menuitem"
                            aria-disabled={buildBlocked || undefined}
                            disabled={buildBlocked}
                            title={buildBlocked ? frozenTitle : undefined}
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
                            <span className="flex-1 text-left">{t("actions.run.productionBuild")}</span>
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
                            <span className="flex-1 text-left">{t("test.action.open")}</span>
                            <span className="w-3" />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
