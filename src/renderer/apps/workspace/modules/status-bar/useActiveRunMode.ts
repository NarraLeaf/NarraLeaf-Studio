import { useEffect, useState } from "react";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "../actions/runtimeActionStatus";
import type { TranslationKey } from "@shared/i18n";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";
import type { GameBuildStatus } from "@shared/types/gameBuild";

export type RunModeKind = "devMode" | "preview" | "production";

/** The one mode currently surfaced by the status bar, or null when nothing is running. */
export interface ActiveRunMode {
    kind: RunModeKind;
    /** Mode name shown before the divider. */
    labelKey: TranslationKey;
    /** Current phase shown after the divider. */
    phaseKey: TranslationKey;
    /** Transient work (show a spinner) rather than the steady "running" state. */
    busy: boolean;
}

const PHASE = (name: string) => `workspace.shell.statusBar.phase.${name}` as TranslationKey;

const DEV_MODE_PHASE: Partial<Record<DevModeStatus, TranslationKey>> = {
    starting: PHASE("starting"),
    compiling: PHASE("compiling"),
    running: PHASE("running"),
    reloading: PHASE("reloading"),
    stopping: PHASE("stopping"),
};

const PREVIEW_PHASE: Partial<Record<PreviewStatus, TranslationKey>> = {
    preparing: PHASE("preparing"),
    compiling: PHASE("compiling"),
    launching: PHASE("launching"),
    running: PHASE("running"),
    stopping: PHASE("stopping"),
};

const BUILD_PHASE: Partial<Record<GameBuildStatus, TranslationKey>> = {
    preparing: PHASE("preparing"),
    compiling: PHASE("compiling"),
    packaging: PHASE("packaging"),
};

function isBuildActive(status: GameBuildStatus): boolean {
    return status === "preparing" || status === "compiling" || status === "packaging";
}

/**
 * Which run mode the status bar reports, resolved from the Dev Mode, Preview and Build services.
 *
 * The run session (Dev Mode / Preview) wins over a Build: the split-button that launches it is the
 * primary control, and a build already surfaces its own progress in the console and its own toolbar
 * button. Dev Mode and Preview are mutually exclusive (the Run button only starts the selected one),
 * so the order between them never actually decides anything.
 */
export function useActiveRunMode(): ActiveRunMode | null {
    const { context } = useWorkspace();
    const [devStatus, setDevStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
    const [buildStatus, setBuildStatus] = useState<GameBuildStatus>("idle");

    useEffect(() => {
        if (!context) {
            return;
        }
        const devMode = context.services.get<DevModeService>(Services.DevMode);
        setDevStatus(devMode.getStatus());
        return devMode.onStatusChanged(setDevStatus);
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const preview = context.services.get<PreviewService>(Services.Preview);
        setPreviewStatus(preview.getStatus());
        return preview.onStatusChanged(setPreviewStatus);
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const build = context.services.get<BuildService>(Services.Build);
        setBuildStatus(build.getStatus());
        return build.onStateChanged(state => setBuildStatus(state.status));
    }, [context]);

    if (isDevModeRuntimeActive(devStatus)) {
        return {
            kind: "devMode",
            labelKey: "workspace.shell.statusBar.devMode",
            phaseKey: DEV_MODE_PHASE[devStatus] ?? PHASE("running"),
            busy: devStatus !== "running",
        };
    }
    if (isPreviewRuntimeActive(previewStatus)) {
        return {
            kind: "preview",
            labelKey: "workspace.shell.statusBar.preview",
            phaseKey: PREVIEW_PHASE[previewStatus] ?? PHASE("running"),
            busy: previewStatus !== "running",
        };
    }
    if (isBuildActive(buildStatus)) {
        return {
            kind: "production",
            labelKey: "workspace.shell.statusBar.production",
            phaseKey: BUILD_PHASE[buildStatus] ?? PHASE("packaging"),
            busy: true,
        };
    }
    return null;
}
