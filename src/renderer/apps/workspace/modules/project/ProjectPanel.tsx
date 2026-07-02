import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    FileImage,
    HardDrive,
    Image as ImageIcon,
    Laptop,
    Loader2,
    Monitor,
    RefreshCw,
    Upload,
} from "lucide-react";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { ProjectService, getProjectIconConfig } from "@/lib/workspace/services/core/ProjectService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import type { ProjectConfig, ProjectIconConfig, ProjectIconPlatform } from "@/lib/workspace/project/project";
import type { PanelComponentProps } from "../types";
import { createProjectIconPreview, type ProjectIconPreview } from "./iconPreview";

type IconState = {
    icon: ProjectIconConfig | null;
    preview: ProjectIconPreview | null;
    status: "idle" | "loading" | "uploading" | "error";
    error: string | null;
};

type PlatformOption = {
    id: ProjectIconPlatform;
    label: string;
    detail: string;
    icon: typeof Laptop;
};

const PLATFORM_OPTIONS: PlatformOption[] = [
    { id: "macos", label: "macOS", detail: ".icns, .png", icon: Laptop },
    { id: "windows", label: "Windows", detail: ".ico, .png", icon: Monitor },
    { id: "linux", label: "Linux", detail: ".png, .svg", icon: HardDrive },
];

const EMPTY_ICON_STATE: Record<ProjectIconPlatform, IconState> = {
    macos: { icon: null, preview: null, status: "idle", error: null },
    windows: { icon: null, preview: null, status: "idle", error: null },
    linux: { icon: null, preview: null, status: "idle", error: null },
};

const ICON_BUTTON_CLASS = controlButtonClass();

export function ProjectPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const [config, setConfig] = useState<ProjectConfig | null>(null);
    const [nameDraft, setNameDraft] = useState("");
    const [savingName, setSavingName] = useState(false);
    const [iconStates, setIconStates] = useState<Record<ProjectIconPlatform, IconState>>(() => cloneIconStates(EMPTY_ICON_STATE));
    const previewUrlsRef = useRef<Record<ProjectIconPlatform, string | null>>({
        macos: null,
        windows: null,
        linux: null,
    });

    const projectService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<ProjectService>(Services.Project);
    }, [context, isInitialized]);

    const uiService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context, isInitialized]);

    const applyPreview = useCallback((platform: ProjectIconPlatform, preview: ProjectIconPreview | null) => {
        const previousUrl = previewUrlsRef.current[platform];
        if (previousUrl && previousUrl !== preview?.url) {
            URL.revokeObjectURL(previousUrl);
        }
        previewUrlsRef.current[platform] = preview?.url ?? null;
        setIconStates(previous => ({
            ...previous,
            [platform]: {
                ...previous[platform],
                preview,
            },
        }));
    }, []);

    const refreshConfig = useCallback(() => {
        if (!projectService) {
            setConfig(null);
            setNameDraft("");
            return null;
        }
        const nextConfig = cloneProjectConfig(projectService.getProjectConfig());
        setConfig(nextConfig);
        setNameDraft(nextConfig.name);
        setIconStates(previous => {
            const next = { ...previous };
            for (const option of PLATFORM_OPTIONS) {
                next[option.id] = {
                    ...next[option.id],
                    icon: getProjectIconConfig(nextConfig, option.id),
                    error: null,
                };
            }
            return next;
        });
        return nextConfig;
    }, [projectService]);

    useEffect(() => {
        if (!projectService) {
            return;
        }

        let disposed = false;
        const nextConfig = refreshConfig();
        if (!nextConfig) {
            return;
        }

        for (const option of PLATFORM_OPTIONS) {
            const icon = getProjectIconConfig(nextConfig, option.id);
            if (!icon) {
                applyPreview(option.id, null);
                continue;
            }

            setIconStates(previous => ({
                ...previous,
                [option.id]: { ...previous[option.id], status: "loading", error: null },
            }));

            void projectService.readProjectIcon(option.id)
                .then(async bytes => {
                    if (disposed) {
                        return;
                    }
                    if (!bytes) {
                        setIconStates(previous => ({
                            ...previous,
                            [option.id]: {
                                ...previous[option.id],
                                status: "error",
                                error: "Icon file missing",
                            },
                        }));
                        applyPreview(option.id, null);
                        return;
                    }
                    const preview = await createProjectIconPreview(bytes, icon.mediaType, icon.path);
                    if (disposed) {
                        URL.revokeObjectURL(preview.url);
                        return;
                    }
                    setIconStates(previous => ({
                        ...previous,
                        [option.id]: { ...previous[option.id], status: "idle", error: null },
                    }));
                    applyPreview(option.id, preview);
                })
                .catch(error => {
                    if (disposed) {
                        return;
                    }
                    setIconStates(previous => ({
                        ...previous,
                        [option.id]: {
                            ...previous[option.id],
                            status: "error",
                            error: error instanceof Error ? error.message : String(error),
                        },
                    }));
                    applyPreview(option.id, null);
                });
        }

        return () => {
            disposed = true;
        };
    }, [applyPreview, projectService, refreshConfig]);

    useEffect(() => {
        return () => {
            for (const url of Object.values(previewUrlsRef.current)) {
                if (url) {
                    URL.revokeObjectURL(url);
                }
            }
        };
    }, []);

    const nameDirty = nameDraft.trim() !== (config?.name ?? "");
    const commitName = useCallback(async () => {
        if (!projectService || !nameDirty || savingName) {
            return;
        }
        const nextName = nameDraft.trim();
        if (!nextName) {
            uiService?.showNotification("Application name is required.", "warning");
            setNameDraft(config?.name ?? "");
            return;
        }

        setSavingName(true);
        try {
            const nextConfig = await projectService.updateProjectName(nextName);
            setConfig(cloneProjectConfig(nextConfig));
            setNameDraft(nextConfig.name);
            uiService?.showNotification("Application name saved.", "success");
        } catch (error) {
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
            setNameDraft(config?.name ?? "");
        } finally {
            setSavingName(false);
        }
    }, [config?.name, nameDirty, nameDraft, projectService, savingName, uiService]);

    const handleUpload = useCallback(async (platform: ProjectIconPlatform) => {
        if (!projectService) {
            return;
        }

        setIconStates(previous => ({
            ...previous,
            [platform]: { ...previous[platform], status: "uploading", error: null },
        }));

        try {
            const result = await projectService.importProjectIcon(platform);
            if (!result) {
                setIconStates(previous => ({
                    ...previous,
                    [platform]: { ...previous[platform], status: "idle", error: null },
                }));
                return;
            }

            const preview = await createProjectIconPreview(result.bytes, result.icon.mediaType, result.relativePath);
            applyPreview(platform, preview);
            setConfig(cloneProjectConfig(projectService.getProjectConfig()));
            setIconStates(previous => ({
                ...previous,
                [platform]: {
                    ...previous[platform],
                    icon: result.icon,
                    status: "idle",
                    error: null,
                },
            }));
            uiService?.showNotification(`${platformLabel(platform)} icon saved.`, "success");
        } catch (error) {
            setIconStates(previous => ({
                ...previous,
                [platform]: {
                    ...previous[platform],
                    status: "error",
                    error: error instanceof Error ? error.message : String(error),
                },
            }));
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        }
    }, [applyPreview, projectService, uiService]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#101114] text-slate-200" data-panel-id={panelId}>
            <div className="border-b border-white/10 p-3">
                <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Application Name</span>
                    <div className="flex min-w-0 items-center gap-2">
                        <EnhancedInput
                            className="flex-1"
                            value={nameDraft}
                            onChange={setNameDraft}
                            onBlur={() => void commitName()}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                    setNameDraft(config?.name ?? "");
                                    event.currentTarget.blur();
                                }
                            }}
                            leftIcon={<FileImage className="h-3.5 w-3.5 text-slate-500" />}
                            placeholder="Application name"
                            disabled={!projectService || savingName}
                        />
                        <button
                            type="button"
                            className={ICON_BUTTON_CLASS}
                            onClick={() => void commitName()}
                            disabled={!nameDirty || savingName}
                            title="Save application name"
                            aria-label="Save application name"
                        >
                            {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                    </div>
                </label>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="grid gap-3">
                    {PLATFORM_OPTIONS.map(option => (
                        <ProjectIconCard
                            key={option.id}
                            option={option}
                            state={iconStates[option.id]}
                            onUpload={() => void handleUpload(option.id)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ProjectIconCard({
    option,
    state,
    onUpload,
}: {
    option: PlatformOption;
    state: IconState;
    onUpload: () => void;
}) {
    const PlatformIcon = option.icon;
    const busy = state.status === "loading" || state.status === "uploading";
    const dimensions = state.preview?.width && state.preview.height
        ? `${state.preview.width} x ${state.preview.height}`
        : null;

    return (
        <section className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <PlatformIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-100">{option.label}</div>
                        <div className="truncate text-[11px] text-slate-500">{option.detail}</div>
                    </div>
                </div>
                <button
                    type="button"
                    className={ICON_BUTTON_CLASS}
                    onClick={onUpload}
                    disabled={busy}
                    title={`Upload ${option.label} icon`}
                    aria-label={`Upload ${option.label} icon`}
                >
                    {state.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </button>
            </div>

            <div className="mt-3 flex min-w-0 gap-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-[#17181c]">
                    {state.preview ? (
                        <img src={state.preview.url} alt={`${option.label} icon`} className="max-h-full max-w-full object-contain" />
                    ) : busy ? (
                        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                    ) : (
                        <ImageIcon className="h-5 w-5 text-slate-600" />
                    )}
                </div>
                <div className="min-w-0 flex-1 self-center">
                    <div className="flex min-w-0 items-center gap-1.5">
                        {state.status === "error" ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                        ) : state.icon ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                        )}
                        <span className="min-w-0 truncate text-xs text-slate-300">
                            {state.status === "error"
                                ? state.error
                                : state.icon?.sourceName ?? "No icon selected"}
                        </span>
                    </div>
                    {state.icon ? (
                        <div className="mt-1 min-w-0 truncate text-[11px] text-slate-500">
                            {[
                                dimensions,
                                state.preview?.extractedFromIcns ? "ICNS preview" : null,
                            ].filter(Boolean).join(" · ")}
                        </div>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function cloneProjectConfig(config: ProjectConfig): ProjectConfig {
    return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}

function cloneIconStates(states: Record<ProjectIconPlatform, IconState>): Record<ProjectIconPlatform, IconState> {
    return {
        macos: { ...states.macos },
        windows: { ...states.windows },
        linux: { ...states.linux },
    };
}

function platformLabel(platform: ProjectIconPlatform): string {
    return PLATFORM_OPTIONS.find(option => option.id === platform)?.label ?? platform;
}
