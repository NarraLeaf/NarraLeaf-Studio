import React, { useEffect, useState } from "react";
import { Check, ChevronDown, MonitorPlay, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { flushUIDocAndGraphIfDirty } from "./flushDevModeAssets";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "./runtimeActionStatus";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";
import type { TranslationKey } from "@shared/i18n";

/** The two modes the Run button can launch; Build/Production is a separate control. */
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
 * control and the dropdown is disabled — you cannot switch modes mid-run, only stop the running one.
 * Which mode is selected persists globally (see `ui.runMode`); Build/Production stays its own icon.
 */
export function RunControl() {
    const { t } = useTranslation();
    const { workspace, context } = useWorkspace();
    const [mode, setMode] = useState<RunMode>("devMode");
    const [devStatus, setDevStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
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

    const devActive = isDevModeRuntimeActive(devStatus);
    const previewActive = isPreviewRuntimeActive(previewStatus);
    const activeMode: RunMode | null = devActive ? "devMode" : previewActive ? "preview" : null;
    const running = activeMode !== null;
    // The face reflects whatever is actually running; when nothing is, the selected mode.
    const shownMode = activeMode ?? mode;
    const meta = RUN_MODE_META[shownMode];
    const errored = !running && (shownMode === "devMode" ? devStatus === "error" : previewStatus === "error");

    const runOrStop = () => {
        if (!workspace || !context) {
            return;
        }
        const dev = context.services.get<DevModeService>(Services.DevMode);
        const preview = context.services.get<PreviewService>(Services.Preview);
        if (devActive) {
            void dev.stop();
            return;
        }
        if (previewActive) {
            void preview.stop();
            return;
        }
        if (mode === "devMode") {
            void (async () => {
                try {
                    await flushUIDocAndGraphIfDirty(workspace);
                } catch (e) {
                    console.error("[DevMode] flush before launch failed", e);
                }
                await dev.launch({ kind: "surface", surfaceId: MAIN_APP_SURFACE_ID });
            })();
        } else {
            void preview.launch({ kind: "surface", surfaceId: MAIN_APP_SURFACE_ID });
        }
    };

    const selectMode = (next: RunMode) => {
        setMenuOpen(false);
        if (next === mode) {
            return;
        }
        setMode(next);
        void getInterface().app.state.setGlobalState(RUN_MODE_SETTINGS_KEY, next);
    };

    const runTitle = running ? t(meta.stopKey) : t(meta.runKey);

    return (
        <div className="relative flex items-center">
            <div className={cn("flex h-8 items-stretch overflow-hidden rounded-md", running && "bg-danger text-white")}>
                <button
                    type="button"
                    onClick={runOrStop}
                    title={runTitle}
                    aria-label={runTitle}
                    aria-pressed={running || undefined}
                    className={cn(
                        "flex cursor-default items-center gap-1.5 px-2 text-sm transition-colors",
                        running ? "hover:bg-danger/80" : "text-fg-muted hover:bg-fill hover:text-fg",
                    )}
                >
                    <span className={cn("flex h-4 w-4 items-center justify-center", errored && "text-danger")}>
                        {running ? <Square className="h-3.5 w-3.5 fill-current" /> : meta.icon}
                    </span>
                    <span>{t(meta.labelKey)}</span>
                </button>

                <button
                    type="button"
                    onClick={() => setMenuOpen(open => !open)}
                    disabled={running}
                    title={t("actions.run.switchMode")}
                    aria-label={t("actions.run.switchMode")}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className={cn(
                        "flex cursor-default items-center justify-center px-1 transition-colors",
                        running ? "cursor-not-allowed text-white/40" : "text-fg-muted hover:bg-fill hover:text-fg",
                    )}
                >
                    <ChevronDown className={cn("h-3 w-3 transition-transform", menuOpen && "rotate-180")} />
                </button>
            </div>

            {menuOpen && !running && (
                <>
                    <div className="nl-window-content-layer z-10" onClick={() => setMenuOpen(false)} />
                    <div
                        role="menu"
                        aria-label={t("actions.run.switchMode")}
                        className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-md border border-edge-strong bg-surface-overlay py-1 shadow-lg"
                    >
                        {RUN_MODES.map(option => {
                            const optionMeta = RUN_MODE_META[option];
                            const selected = option === mode;
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={selected}
                                    onClick={() => selectMode(option)}
                                    className={cn(
                                        "flex w-full cursor-default items-center gap-2 px-3 py-2 text-sm transition-colors",
                                        selected ? "text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                    )}
                                >
                                    <span className="flex h-4 w-4 items-center justify-center">{optionMeta.icon}</span>
                                    <span className="flex-1 text-left">{t(optionMeta.labelKey)}</span>
                                    <span className="w-3">{selected && <Check className="h-3 w-3" />}</span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
