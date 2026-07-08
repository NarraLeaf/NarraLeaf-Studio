import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    HardDrive,
    Image as ImageIcon,
    Laptop,
    Loader2,
    Monitor,
    RefreshCw,
    Upload,
} from "lucide-react";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { getProjectIconConfig } from "@/lib/workspace/services/core/ProjectService";
import type { ProjectIconConfig, ProjectIconPlatform } from "@/lib/workspace/project/project";
import { createProjectIconPreview, type ProjectIconPreview } from "../iconPreview";
import type { ProjectSectionProps } from "./types";

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

export function ProjectAssetsSection({ projectService, uiService, onConfigChange }: ProjectSectionProps) {
    const [iconStates, setIconStates] = useState<Record<ProjectIconPlatform, IconState>>(() => cloneIconStates(EMPTY_ICON_STATE));
    const previewUrlsRef = useRef<Record<ProjectIconPlatform, string | null>>({
        macos: null,
        windows: null,
        linux: null,
    });

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

    useEffect(() => {
        let disposed = false;
        const config = projectService.getProjectConfig();

        setIconStates(previous => {
            const next = { ...previous };
            for (const option of PLATFORM_OPTIONS) {
                next[option.id] = {
                    ...next[option.id],
                    icon: getProjectIconConfig(config, option.id),
                    error: null,
                };
            }
            return next;
        });

        for (const option of PLATFORM_OPTIONS) {
            const icon = getProjectIconConfig(config, option.id);
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
    }, [applyPreview, projectService]);

    useEffect(() => {
        return () => {
            for (const url of Object.values(previewUrlsRef.current)) {
                if (url) {
                    URL.revokeObjectURL(url);
                }
            }
        };
    }, []);

    const handleUpload = useCallback(async (platform: ProjectIconPlatform) => {
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
            onConfigChange(projectService.getProjectConfig());
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
    }, [applyPreview, onConfigChange, projectService, uiService]);

    return (
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
        <section className="rounded-md border border-edge bg-white/[0.025] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <PlatformIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{option.label}</div>
                        <div className="truncate text-2xs text-fg-subtle">{option.detail}</div>
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
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-edge bg-[#17181c]">
                    {state.preview ? (
                        <img src={state.preview.url} alt={`${option.label} icon`} className="max-h-full max-w-full object-contain" />
                    ) : busy ? (
                        <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />
                    ) : (
                        <ImageIcon className="h-5 w-5 text-fg-subtle" />
                    )}
                </div>
                <div className="min-w-0 flex-1 self-center">
                    <div className="flex min-w-0 items-center gap-1.5">
                        {state.status === "error" ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                        ) : state.icon ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                        )}
                        <span className="min-w-0 truncate text-xs text-fg-muted">
                            {state.status === "error"
                                ? state.error
                                : state.icon?.sourceName ?? "No icon selected"}
                        </span>
                    </div>
                    {state.icon ? (
                        <div className="mt-1 min-w-0 truncate text-2xs text-fg-subtle">
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
