import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button, Input, Select, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { join } from "@shared/utils/path";
import { translate, useTranslation } from "@/lib/i18n";
import {
    deriveGameAppId,
    GAME_BUILD_ARCHS_BY_PLATFORM,
    hostCanBuildTarget,
    platformFromSystem,
    predictGameBuildArtifacts,
    type BuildPreflightFinding,
    type BuildPreflightSection,
    type BuildPreflightSeverity,
    type GameBuildArch,
    type GameBuildCompression,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
    type GameBuildPlatform,
    type GameBuildRequest,
} from "@shared/types/gameBuild";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";
import { BUILD_COMPRESSIONS } from "@/lib/workspace/project/configuration";
import type { Workspace } from "@/lib/workspace/workspace";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/ui";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { getInterface } from "@/lib/app/bridge";
import { openProjectPanel } from "../project";
import {
    DESKTOP_PLATFORMS,
    DIALOG_PLATFORMS,
    OFFERED_FORMATS,
    initialDialogState,
    isDesktopPlatform,
    requestToBuildConfiguration,
    stateFromRequest,
    stateToRequest,
    toggleFormat,
    togglePlatform,
    type BuildDialogState,
} from "./buildDialogState";
import { BuildIconRow } from "./BuildIconRow";

const SECTIONS: BuildPreflightSection[] = ["targets", "identity", "content", "output"];

/** Everything the dialog reads about the project but does not itself own. */
export type BuildDialogInfo = {
    hostPlatform: GameBuildDesktopPlatform;
    hostArch: string;
    /** Sanitized base name the artifacts are named from. */
    artifactBaseName: string;
    productName: string;
    appId: string;
    encryptAssets: boolean;
    allowHttp: boolean;
    /** Plugin display names that ship with the game. */
    plugins: string[];
    /** Bundled locales; the source locale is flagged. */
    locales: { name: string; source: boolean }[];
    /** Absolute default output dir (`<project>/dist`), shown when none is chosen. */
    defaultOutputDir: string;
    electronMirror: string;
};

export function BuildDialogContent({
    info,
    initialState,
    initialSection,
    initialVersion,
    initialCopyright,
    onChange,
    onPersistIdentity,
    onEditIcons,
    onCommit,
    onCancel,
    runPreflight,
}: {
    info: BuildDialogInfo;
    initialState: BuildDialogState;
    initialSection: BuildPreflightSection;
    initialVersion: string;
    initialCopyright: string;
    onChange: (request: GameBuildRequest, section: BuildPreflightSection) => void;
    onPersistIdentity: (identity: { version: string; copyright: string }) => Promise<void>;
    onEditIcons: () => void;
    onCommit: (request: GameBuildRequest) => void;
    onCancel: () => void;
    runPreflight: (request: GameBuildRequest) => Promise<BuildPreflightFinding[]>;
}) {
    const { t } = useTranslation();
    const [state, setState] = useState<BuildDialogState>(initialState);
    const [section, setSection] = useState<BuildPreflightSection>(initialSection);
    const [findings, setFindings] = useState<BuildPreflightFinding[]>([]);
    // Owned here, not read from a prop: the dialog element is built once by
    // openBuildDialog, so a prop-driven input could never change.
    const [version, setVersion] = useState(initialVersion);
    const [copyright, setCopyright] = useState(initialCopyright);
    const persisted = useRef({ version: initialVersion, copyright: initialCopyright });

    const request = useMemo(() => stateToRequest(state), [state]);

    const update = useCallback((next: BuildDialogState) => {
        setState(next);
    }, []);

    // Park every change on the service, so closing the dialog (to fix an icon,
    // say) never loses the selection.
    useEffect(() => {
        onChange(request, section);
    }, [onChange, request, section]);

    // Persist identity edits and re-check, debounced together. Preflight reads
    // the project from disk, so the write has to land first or it would judge
    // the previous version. `cancelled` keeps a slow reply from overwriting a
    // newer one.
    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                if (persisted.current.version !== version || persisted.current.copyright !== copyright) {
                    await onPersistIdentity({ version, copyright });
                    persisted.current = { version, copyright };
                }
                if (cancelled) {
                    return;
                }
                const result = await runPreflight(request);
                if (!cancelled) {
                    setFindings(result);
                }
            })();
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [request, runPreflight, onPersistIdentity, version, copyright]);

    const severityBySection = useMemo(() => {
        const map = {} as Partial<Record<BuildPreflightSection, BuildPreflightSeverity>>;
        for (const finding of findings) {
            if (map[finding.section] !== "error") {
                map[finding.section] = finding.severity === "error" ? "error" : (map[finding.section] ?? "warning");
            }
        }
        return map;
    }, [findings]);

    const blocking = useMemo(() => findings.filter(f => f.severity === "error"), [findings]);

    const commit = () => {
        // Never a disabled button: a build that cannot run sends the user to the
        // reason instead of going grey and silent.
        if (blocking.length > 0) {
            setSection(blocking[0].section);
            return;
        }
        onCommit(request);
    };

    const isLastSection = section === SECTIONS[SECTIONS.length - 1];

    return (
        // Negative margins undo DialogContainer's content padding so the rail and
        // footer meet the dialog edges; the footer lives here because
        // dialogs.show snapshots `buttons` and could not follow preflight state.
        <div className="-mx-6 -my-4 flex flex-col text-sm">
            <div className="flex h-96 items-stretch">
                <nav className="w-32 shrink-0 space-y-0.5 border-r border-edge p-2">
                    {SECTIONS.map(id => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setSection(id)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs",
                                "transition-colors duration-150",
                                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                                section === id ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill",
                            )}
                        >
                            <span className="flex-1 truncate">{t(`build.section.${id}`)}</span>
                            <SeverityDot severity={severityBySection[id]} />
                        </button>
                    ))}
                </nav>

                <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
                    {section === "targets" && (
                        <TargetsSection info={info} state={state} findings={findings} onChange={update} />
                    )}
                    {section === "identity" && (
                        <IdentitySection
                            info={info}
                            version={version}
                            copyright={copyright}
                            findings={findings}
                            onVersionChange={setVersion}
                            onCopyrightChange={setCopyright}
                            onEditIcons={onEditIcons}
                        />
                    )}
                    {section === "content" && <ContentSection info={info} findings={findings} />}
                    {section === "output" && (
                        <OutputSection info={info} state={state} version={version} findings={findings} onChange={update} />
                    )}
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-edge bg-surface-overlay px-6 py-3">
                <Button variant="secondary" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                {isLastSection ? (
                    <Button variant="primary" onClick={commit}>
                        {t("build.dialog.start")}
                    </Button>
                ) : (
                    <Button variant="primary" onClick={() => setSection(SECTIONS[SECTIONS.indexOf(section) + 1])}>
                        {t("common.next")}
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Low-key rail marker; absent when a section is clean. */
function SeverityDot({ severity }: { severity?: BuildPreflightSeverity }) {
    if (!severity) {
        return null;
    }
    return (
        <span
            aria-hidden
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", severity === "error" ? "bg-danger" : "bg-warning")}
        />
    );
}

/** Findings for one section, rendered as plain sentences (no chips). */
function Findings({ findings, section }: { findings: BuildPreflightFinding[]; section: BuildPreflightSection }) {
    const { t } = useTranslation();
    const mine = findings.filter(finding => finding.section === section);
    if (mine.length === 0) {
        return null;
    }
    return (
        <div className="grid gap-1">
            {mine.map(finding => (
                <p
                    key={`${finding.code}-${finding.detail?.platform ?? ""}`}
                    className={cn(
                        "whitespace-pre-wrap text-2xs leading-relaxed",
                        finding.severity === "error" ? "text-danger" : "text-fg-subtle",
                    )}
                >
                    {t(`build.preflight.${finding.code}`, {
                        ...finding.detail,
                        ...(finding.detail?.platform
                            ? { platform: t(`build.platform.${finding.detail.platform as GameBuildPlatform}`) }
                            : {}),
                    })}
                </p>
            ))}
        </div>
    );
}

function TargetsSection({
    info,
    state,
    findings,
    onChange,
}: {
    info: BuildDialogInfo;
    state: BuildDialogState;
    findings: BuildPreflightFinding[];
    onChange: (next: BuildDialogState) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="grid gap-2">
            {DIALOG_PLATFORMS.map(platform => {
                const canBuild = hostCanBuildTarget(info.hostPlatform, platform);
                const enabled = state.formats[platform].size > 0;
                return (
                    <div key={platform} className="rounded-md border border-edge-subtle px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                                <Switch
                                    checked={enabled}
                                    disabled={!canBuild}
                                    onCheckedChange={value => onChange(togglePlatform(state, platform, value))}
                                    size="sm"
                                />
                                <span
                                    className={canBuild ? "text-fg" : "text-fg-subtle"}
                                    // The reason lives in a tooltip: it matters only
                                    // for the row you cannot use, and a permanent
                                    // line of it is noise on every other open.
                                    title={canBuild ? undefined : t(`build.unavailable.${platform}`)}
                                >
                                    {t(`build.platform.${platform}`)}
                                </span>
                            </div>
                            {enabled && canBuild && isDesktopPlatform(platform) && (
                                <Select
                                    size="sm"
                                    value={state.archs[platform]}
                                    onChange={value => onChange({
                                        ...state,
                                        archs: { ...state.archs, [platform]: value as GameBuildArch },
                                    })}
                                    options={GAME_BUILD_ARCHS_BY_PLATFORM[platform].map(arch => ({
                                        value: arch,
                                        label: t(`build.arch.${arch}`),
                                    }))}
                                />
                            )}
                        </div>
                        {enabled && canBuild && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {OFFERED_FORMATS[platform].map(format => (
                                    <FormatPill
                                        key={format}
                                        format={format}
                                        active={state.formats[platform].has(format)}
                                        onClick={() => onChange(toggleFormat(state, platform, format))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
            <Findings findings={findings} section="targets" />
            <CrossBuildNote info={info} state={state} />
        </div>
    );
}

function FormatPill({
    format,
    active,
    onClick,
}: {
    format: GameBuildFormat;
    active: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                active ? "bg-primary/15 text-fg" : "bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
            )}
        >
            {active && <Check className="h-3 w-3" />}
            {t(`build.format.${format}`)}
        </button>
    );
}

/** Only shown while a cross target is selected — the mirror matters only then. */
function CrossBuildNote({ info, state }: { info: BuildDialogInfo; state: BuildDialogState }) {
    const { t } = useTranslation();
    const cross = DESKTOP_PLATFORMS.filter(
        platform => platform !== info.hostPlatform
            && state.formats[platform].size > 0
            && hostCanBuildTarget(info.hostPlatform, platform),
    );
    if (cross.length === 0) {
        return null;
    }
    return (
        <p className="text-2xs leading-relaxed text-fg-subtle">
            {`${t("build.arch.label")}: ${info.electronMirror || t("build.mirror.official")}`}
        </p>
    );
}

function IdentitySection({
    info,
    version,
    copyright,
    findings,
    onVersionChange,
    onCopyrightChange,
    onEditIcons,
}: {
    info: BuildDialogInfo;
    version: string;
    copyright: string;
    findings: BuildPreflightFinding[];
    onVersionChange: (value: string) => void;
    onCopyrightChange: (value: string) => void;
    onEditIcons: () => void;
}) {
    const { t } = useTranslation();
    const versionInvalid = findings.some(finding => finding.code === "version-invalid");
    return (
        <div className="grid gap-3">
            <Field label={t("build.identity.version")}>
                <Input
                    size="sm"
                    value={version}
                    variant={versionInvalid ? "error" : "default"}
                    placeholder="1.0.0"
                    onChange={event => onVersionChange(event.target.value)}
                    className="w-36 font-mono"
                />
            </Field>
            <Field label={t("build.identity.productName")}>
                <span className="text-fg">{info.productName}</span>
                <span className="ml-2 text-2xs text-fg-subtle">{t("build.identity.productNameSource")}</span>
            </Field>
            <Field label={t("build.identity.appId")}>
                <span className="font-mono text-2xs text-fg-muted">{info.appId}</span>
            </Field>
            <Field label={t("build.identity.copyright")}>
                <Input
                    size="sm"
                    value={copyright}
                    onChange={event => onCopyrightChange(event.target.value)}
                    className="w-60"
                />
            </Field>
            <Field label={t("build.identity.icons")} align="start">
                <div>
                    <div className="flex gap-2">
                        {DESKTOP_PLATFORMS.map(platform => (
                            <BuildIconRow key={platform} platform={platform} onClick={onEditIcons} />
                        ))}
                    </div>
                    <p className="mt-1.5 text-2xs text-fg-subtle">{t("build.identity.iconsHint")}</p>
                </div>
            </Field>
            <Findings findings={findings} section="identity" />
        </div>
    );
}

function Field({
    label,
    align = "center",
    children,
}: {
    label: string;
    align?: "center" | "start";
    children: React.ReactNode;
}) {
    return (
        <div className={cn("flex gap-3", align === "start" ? "items-start" : "items-center")}>
            {/* Wide enough that the longest label ("Product name") stays on one line. */}
            <span className={cn("w-24 shrink-0 text-xs text-fg-muted", align === "start" && "pt-2.5")}>{label}</span>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

function ContentSection({ info, findings }: { info: BuildDialogInfo; findings: BuildPreflightFinding[] }) {
    const { t } = useTranslation();
    return (
        <div className="grid gap-3">
            <Stated
                label={t("build.content.protection")}
                value={info.encryptAssets ? t("build.content.protectionOn") : t("build.content.protectionOff")}
            />
            <Stated
                label={t("build.content.plugins")}
                value={info.plugins.length > 0 ? info.plugins.join("\n") : t("build.content.pluginsNone")}
            />
            <Stated
                label={t("build.content.locales")}
                value={info.locales.length > 0
                    ? info.locales
                        .map(locale => locale.source ? t("build.content.localeSource", { name: locale.name }) : locale.name)
                        .join(" · ")
                    : t("build.content.localesNone")}
            />
            <Stated
                label={t("build.content.network")}
                value={info.allowHttp ? t("build.content.networkAllowHttp") : t("build.content.networkStrict")}
            />
            <Findings findings={findings} section="content" />
        </div>
    );
}

/** A read-only fact, written out rather than compressed into a chip. */
function Stated({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid gap-0.5">
            <span className="text-xs text-fg">{label}</span>
            <span className="whitespace-pre-wrap text-2xs leading-relaxed text-fg-muted">{value}</span>
        </div>
    );
}

function OutputSection({
    info,
    state,
    version,
    findings,
    onChange,
}: {
    info: BuildDialogInfo;
    state: BuildDialogState;
    version: string;
    findings: BuildPreflightFinding[];
    onChange: (next: BuildDialogState) => void;
}) {
    const { t } = useTranslation();
    const request = useMemo(() => stateToRequest(state), [state]);
    const artifacts = useMemo(() => predictGameBuildArtifacts({
        artifactBaseName: info.artifactBaseName,
        // Mirrors the pipeline's own fallback, so the preview matches a build
        // started with no version set.
        version: version.trim() || "0.0.0",
        targets: request.targets,
    }), [info.artifactBaseName, request.targets, version]);

    const browse = async () => {
        const result = await getInterface().gameBuild.selectOutputDir(state.outputDir || info.defaultOutputDir);
        if (result.success && result.data.path) {
            onChange({ ...state, outputDir: result.data.path });
        }
    };

    return (
        <div className="grid gap-3">
            <div className="grid gap-1">
                <span className="text-xs text-fg-muted">{t("build.outputDir")}</span>
                <div className="flex items-center gap-2">
                    <span
                        className="flex-1 truncate rounded-md bg-fill-subtle px-2 py-1.5 text-2xs text-fg"
                        title={state.outputDir || info.defaultOutputDir}
                    >
                        {state.outputDir || info.defaultOutputDir}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => { void browse(); }}>
                        {t("build.chooseFolder")}
                    </Button>
                </div>
            </div>

            <div className="grid gap-1">
                <span className="text-xs text-fg-muted">{t("build.output.artifacts")}</span>
                {artifacts.length === 0 ? (
                    <span className="text-2xs text-fg-subtle">{t("build.output.artifactsEmpty")}</span>
                ) : (
                    <div className="grid gap-1 rounded-md bg-fill-subtle px-2.5 py-2">
                        {artifacts.map(artifact => (
                            <span key={`${artifact.platform}-${artifact.name}`} className="font-mono text-2xs text-fg-muted">
                                {artifact.name}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg">{t("build.output.openWhenDone")}</span>
                <Switch
                    size="sm"
                    checked={state.openWhenDone}
                    onCheckedChange={value => onChange({ ...state, openWhenDone: value })}
                />
            </div>

            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg">{t("build.output.compression")}</span>
                <Select
                    size="sm"
                    value={state.compression}
                    onChange={value => onChange({ ...state, compression: value as GameBuildCompression })}
                    options={BUILD_COMPRESSIONS.map(level => ({
                        value: level,
                        label: t(`build.output.compression${capitalize(level)}` as "build.output.compressionStore"),
                    }))}
                />
            </div>
            <Findings findings={findings} section="output" />
        </div>
    );
}

function capitalize(value: string): string {
    return `${value[0].toUpperCase()}${value.slice(1)}`;
}

/**
 * Open the build configuration dialog (or, when a build is already running, a
 * small status dialog with cancel). Committing starts the build, remembers the
 * selection, and streams progress to the console.
 */
export async function openBuildDialog(workspace: Workspace): Promise<void> {
    const context = workspace.getContext();
    const services = context.services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    if (buildService.isBuilding()) {
        openBuildInProgressDialog(uiService, buildService);
        return;
    }

    const projectConfig = projectService.getProjectConfig();
    const projectPath = context.project.getConfig().projectPath;
    const hostResult = await getInterface().getPlatform();
    const hostPlatform: GameBuildDesktopPlatform = hostResult.success
        ? platformFromSystem(hostResult.data.system)
        : "linux";
    const hostArch = hostResult.success ? hostResult.data.arch : "x64";
    const localization = projectService.getLocalizationConfiguration();
    const productName = projectConfig.name?.trim() || "NarraLeaf Game";

    const info: BuildDialogInfo = {
        hostPlatform,
        hostArch,
        artifactBaseName: sanitizeProjectFileName(productName),
        productName,
        appId: deriveGameAppId(projectConfig.identifier, productName),
        encryptAssets: projectService.getSecurityConfiguration().encryptAssets,
        allowHttp: projectService.getNetworkConfiguration().allowHttp,
        plugins: (projectService.getDependencyTable()?.plugins ?? []).map(
            plugin => `${plugin.name ?? plugin.id} ${plugin.authoredVersion}`,
        ),
        locales: localization.sourceLocale
            ? localization.locales.map(locale => ({
                name: locale.displayName || locale.code,
                source: locale.code === localization.sourceLocale,
            }))
            : [],
        defaultOutputDir: join(projectPath, "dist"),
        electronMirror: "",
    };

    // A parked draft wins over the persisted selection: it is what the user was
    // in the middle of, and the only reason they left was to fix something.
    const draft = buildService.getDraft();
    const storedConfig = projectService.getBuildConfiguration();
    const initialState = draft
        ? stateFromRequest(draft.request, hostPlatform, hostArch)
        : initialDialogState(storedConfig, hostPlatform, hostArch);

    let request: GameBuildRequest = stateToRequest(initialState);
    let section: BuildPreflightSection = draft?.section ?? "targets";

    const dialogId = uiService.dialogs.show({
        title: translate("build.dialog.title"),
        width: 720,
        closable: true,
        // Footer is drawn inside the content: dialogs.show snapshots `buttons`
        // at open time, so it cannot react to preflight state.
        content: (
            <BuildDialogContent
                info={info}
                initialState={initialState}
                initialSection={section}
                initialVersion={typeof projectConfig.metadata?.version === "string" ? projectConfig.metadata.version : ""}
                initialCopyright={typeof projectConfig.metadata?.copyright === "string" ? projectConfig.metadata.copyright : ""}
                onChange={(nextRequest, nextSection) => {
                    request = nextRequest;
                    section = nextSection;
                    buildService.setDraft({ request: nextRequest, section: nextSection });
                }}
                onPersistIdentity={async ({ version, copyright }) => {
                    // Best-effort: a failed write must not wedge the dialog, and
                    // preflight re-reads from disk either way.
                    await projectService.updateProjectMetadata({ version, copyright }).catch(() => undefined);
                }}
                onEditIcons={() => {
                    // The draft is already parked, so closing here is safe: the
                    // next open restores exactly this selection.
                    uiService.dialogs.close(dialogId);
                    openProjectPanel(context, { section: "assets" });
                }}
                onCancel={() => {
                    buildService.clearDraft();
                    uiService.dialogs.close(dialogId);
                }}
                onCommit={async committed => {
                    uiService.dialogs.close(dialogId);
                    await startBuild(workspace, committed);
                }}
                runPreflight={nextRequest => buildService.preflight(nextRequest)}
            />
        ),
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

async function startBuild(workspace: Workspace, request: GameBuildRequest): Promise<void> {
    const services = workspace.getContext().services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    // Remember the selection for next time (best-effort; never blocks the build).
    void projectService.updateBuildConfiguration(requestToBuildConfiguration(request)).catch(() => undefined);

    uiService.panels.show("narraleaf-studio:console");
    // The toolbar's build-status subscriber owns the success/error toast, so a
    // failure here is not double-reported.
    await buildService.start(request);
}
