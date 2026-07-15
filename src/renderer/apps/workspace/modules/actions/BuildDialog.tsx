import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button, Switch } from "@/lib/components/elements";
import { join } from "@shared/utils/path";
import { translate, useTranslation } from "@/lib/i18n";
import {
    hostCanBuildTarget,
    platformFromSystem,
    type GameBuildFormat,
    type GameBuildPlatform,
    type GameBuildTarget,
} from "@shared/types/gameBuild";
import type { BuildConfiguration } from "@/lib/workspace/project/configuration";
import type { Workspace } from "@/lib/workspace/workspace";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/ui";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { getInterface } from "@/lib/app/bridge";

/** Platforms shown, in display order. */
const PLATFORMS: GameBuildPlatform[] = ["windows", "macos", "linux", "web"];

/**
 * Formats offered per platform in the dialog. Desktop platforms get a portable
 * ZIP plus the native installer; "dir" (the unpacked folder) is a
 * build-internal detail there and is not offered. The web target has no
 * installer — it offers the archive and the deployable site folder itself.
 */
const OFFERED_FORMATS: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis"],
    macos: ["zip", "dmg"],
    linux: ["zip", "appimage"],
    web: ["zip", "dir"],
};

export type BuildDialogSelection = {
    targets: GameBuildTarget[];
    /** Absolute output directory, or "" to use the default (`<project>/dist`). */
    outputDir: string;
};

export type BuildDialogInfo = {
    hostPlatform: GameBuildPlatform;
    version: string;
    encryptAssets: boolean;
    /** Whether the build ships unsigned (v1 always true) — drives the notice. */
    unsigned: boolean;
    /** Absolute default output dir (`<project>/dist`), shown when none is chosen. */
    defaultOutputDir: string;
};

type PlatformFormatState = Record<GameBuildPlatform, Set<GameBuildFormat>>;

function initialFormatState(config: BuildConfiguration | null, hostPlatform: GameBuildPlatform): PlatformFormatState {
    const state = {} as PlatformFormatState;
    for (const platform of PLATFORMS) {
        // A platform this host cannot build never starts selected, so the
        // committed selection can never contain an impossible target.
        if (!hostCanBuildTarget(hostPlatform, platform)) {
            state[platform] = new Set();
            continue;
        }
        const stored = config?.formats?.[platform];
        const enabled = config
            ? (config.platforms.includes(platform) && Boolean(stored?.length))
            : platform === hostPlatform;
        const formats = stored?.length ? stored : OFFERED_FORMATS[platform];
        state[platform] = new Set(enabled ? formats.filter(f => OFFERED_FORMATS[platform].includes(f)) : []);
    }
    return state;
}

/** Collect the current selection into a request-ready shape. */
export function collectSelection(state: PlatformFormatState, outputDir: string): BuildDialogSelection {
    const targets: GameBuildTarget[] = [];
    for (const platform of PLATFORMS) {
        const formats = [...state[platform]];
        if (formats.length > 0) {
            targets.push({ platform, formats });
        }
    }
    return { targets, outputDir: outputDir.trim() };
}

/**
 * The selection the dialog opens with — derived from the SAME state the
 * checkboxes render, so what the user sees is exactly what commits even if they
 * click Start without touching anything.
 */
export function initialSelection(config: BuildConfiguration | null, hostPlatform: GameBuildPlatform): BuildDialogSelection {
    return collectSelection(initialFormatState(config, hostPlatform), config?.outputDir ?? "");
}

/**
 * Build dialog body. Self-contained selection state; reports the live
 * selection to the parent through `onChange` so the dialog's action button can
 * read it when the user commits.
 */
export function BuildDialogContent({
    info,
    config,
    onChange,
}: {
    info: BuildDialogInfo;
    config: BuildConfiguration | null;
    onChange: (selection: BuildDialogSelection) => void;
}) {
    const { t } = useTranslation();
    const [formatState, setFormatState] = useState<PlatformFormatState>(() => initialFormatState(config, info.hostPlatform));
    const [outputDir, setOutputDir] = useState<string>(config?.outputDir ?? "");

    const emit = (nextState: PlatformFormatState, nextOutput: string) => {
        onChange(collectSelection(nextState, nextOutput));
    };

    const toggleFormat = (platform: GameBuildPlatform, format: GameBuildFormat) => {
        setFormatState(prev => {
            const next = { ...prev, [platform]: new Set(prev[platform]) };
            if (next[platform].has(format)) {
                next[platform].delete(format);
            } else {
                next[platform].add(format);
            }
            emit(next, outputDir);
            return next;
        });
    };

    const togglePlatform = (platform: GameBuildPlatform, enabled: boolean) => {
        setFormatState(prev => {
            const next = { ...prev, [platform]: new Set<GameBuildFormat>() };
            if (enabled) {
                // Default to both offered formats when a platform is switched on.
                OFFERED_FORMATS[platform].forEach(f => next[platform].add(f));
            }
            emit(next, outputDir);
            return next;
        });
    };

    const changeOutput = (value: string) => {
        setOutputDir(value);
        emit(formatState, value);
    };

    const anySelected = useMemo(
        () => PLATFORMS.some(p => formatState[p].size > 0),
        [formatState],
    );

    const browseOutputDir = async () => {
        const result = await getInterface().gameBuild.selectOutputDir(outputDir || info.defaultOutputDir);
        if (result.success && result.data.path) {
            changeOutput(result.data.path);
        }
    };

    return (
        <div className="grid gap-4 text-sm">
            <div className="grid gap-2">
                {PLATFORMS.map(platform => {
                    const canBuild = hostCanBuildTarget(info.hostPlatform, platform);
                    const enabled = formatState[platform].size > 0;
                    return (
                        <div
                            key={platform}
                            className="rounded-md border border-edge-subtle px-3 py-2.5"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex flex-col">
                                    <span className={canBuild ? "text-fg" : "text-fg-subtle"}>
                                        {t(`build.platform.${platform}`)}
                                    </span>
                                    {!canBuild && (
                                        <span className="text-xs text-fg-subtle">
                                            {t(`build.unavailable.${platform}`)}
                                        </span>
                                    )}
                                </div>
                                <Switch
                                    checked={enabled}
                                    disabled={!canBuild}
                                    onCheckedChange={value => togglePlatform(platform, value)}
                                    size="sm"
                                />
                            </div>
                            {enabled && canBuild && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {OFFERED_FORMATS[platform].map(format => {
                                        const active = formatState[platform].has(format);
                                        return (
                                            <button
                                                key={format}
                                                type="button"
                                                onClick={() => toggleFormat(platform, format)}
                                                className={[
                                                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                                                    active
                                                        ? "bg-fill-strong text-fg"
                                                        : "bg-fill-subtle text-fg-muted hover:text-fg",
                                                ].join(" ")}
                                            >
                                                {active && <Check className="h-3 w-3" />}
                                                {t(`build.format.${format}`)}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="grid gap-1">
                <span className="text-xs text-fg-muted">{t("build.outputDir")}</span>
                <div className="flex items-center gap-2">
                    <span className="flex-1 truncate rounded-md bg-fill-subtle px-2 py-1.5 text-xs text-fg" title={outputDir || info.defaultOutputDir}>
                        {outputDir || info.defaultOutputDir}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => { void browseOutputDir(); }}>
                        {t("build.chooseFolder")}
                    </Button>
                </div>
            </div>

            <div className="grid gap-1 rounded-md bg-fill-subtle px-3 py-2 text-xs text-fg-muted">
                <div className="flex justify-between">
                    <span>{t("build.info.version")}</span>
                    <span className="text-fg">{info.version || "0.0.0"}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t("build.info.protection")}</span>
                    <span className="text-fg">
                        {info.encryptAssets ? t("build.info.protectionOn") : t("build.info.protectionOff")}
                    </span>
                </div>
            </div>

            {formatState.web.size > 0 && (
                <p className="text-xs text-fg-subtle leading-relaxed">
                    {t("build.webStaticNotice")}
                </p>
            )}

            {info.unsigned && (
                <p className="text-xs text-fg-subtle leading-relaxed">
                    {t("build.unsignedNotice")}
                </p>
            )}

            {!anySelected && (
                <p className="text-xs text-warning">{t("build.selectAtLeastOne")}</p>
            )}
        </div>
    );
}

/**
 * Open the build configuration dialog (or, when a build is already running, a
 * small status dialog with cancel). Committing starts the build, remembers the
 * selection, and streams progress to the console.
 */
export async function openBuildDialog(workspace: Workspace): Promise<void> {
    const services = workspace.getContext().services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    if (buildService.isBuilding()) {
        openBuildInProgressDialog(uiService, buildService);
        return;
    }

    const projectConfig = projectService.getProjectConfig();
    const projectPath = workspace.getContext().project.getConfig().projectPath;
    const hostResult = await getInterface().getPlatform();
    const hostPlatform: GameBuildPlatform = hostResult.success
        ? platformFromSystem(hostResult.data.system)
        : "linux";
    const info: BuildDialogInfo = {
        hostPlatform,
        version: typeof projectConfig.metadata?.version === "string" ? projectConfig.metadata.version : "",
        encryptAssets: projectService.getSecurityConfiguration().encryptAssets,
        unsigned: true,
        defaultOutputDir: join(projectPath, "dist"),
    };
    const storedConfig = projectService.getBuildConfiguration();

    // Seed from the same derivation the dialog renders, so committing without
    // any interaction sends exactly what is displayed.
    let selection: BuildDialogSelection = initialSelection(storedConfig, hostPlatform);

    const dialogId = uiService.dialogs.show({
        title: translate("build.dialog.title"),
        width: 460,
        closable: true,
        content: (
            <BuildDialogContent
                info={info}
                config={storedConfig}
                onChange={value => {
                    selection = value;
                }}
            />
        ),
        buttons: [
            { label: translate("common.cancel"), onClick: () => uiService.dialogs.close(dialogId) },
            {
                label: translate("build.dialog.start"),
                primary: true,
                onClick: async () => {
                    if (selection.targets.length === 0) {
                        uiService.showNotification(translate("build.selectAtLeastOne"), "warning");
                        return;
                    }
                    uiService.dialogs.close(dialogId);
                    await startBuild(workspace, selection);
                },
            },
        ],
    });
}

function openBuildInProgressDialog(uiService: UIService, buildService: BuildService): void {
    const dialogId = uiService.dialogs.show({
        title: translate("build.dialog.runningTitle"),
        width: 400,
        closable: true,
        content: (
            <p className="text-sm text-fg-muted leading-relaxed">
                {translate("build.dialog.runningBody")}
            </p>
        ),
        buttons: [
            {
                label: translate("build.dialog.viewConsole"),
                onClick: () => {
                    uiService.panels.show("narraleaf-studio:console");
                    uiService.dialogs.close(dialogId);
                },
            },
            {
                label: translate("build.dialog.cancelBuild"),
                onClick: async () => {
                    uiService.dialogs.close(dialogId);
                    await buildService.cancel();
                },
            },
        ],
    });
}

async function startBuild(workspace: Workspace, selection: BuildDialogSelection): Promise<void> {
    const services = workspace.getContext().services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    // Remember the selection for next time (best-effort; never blocks the build).
    void projectService.updateBuildConfiguration(buildConfigFromSelection(selection)).catch(() => undefined);

    uiService.panels.show("narraleaf-studio:console");
    // The toolbar's build-status subscriber owns the success/error toast, so a
    // failure here is not double-reported.
    await buildService.start({
        targets: selection.targets,
        outputDir: selection.outputDir,
    });
}

function buildConfigFromSelection(selection: BuildDialogSelection): BuildConfiguration {
    const formats: BuildConfiguration["formats"] = {};
    for (const target of selection.targets) {
        formats[target.platform] = target.formats;
    }
    return {
        platforms: selection.targets.map(t => t.platform),
        formats,
        outputDir: selection.outputDir,
    };
}
