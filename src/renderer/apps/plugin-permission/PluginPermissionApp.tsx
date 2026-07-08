import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { getInterface } from "@/lib/app/bridge";
import {
    PluginPermissionGrantResult,
    PluginPermissionPersistence,
    PluginPermissionPromptProps,
    PluginPermissionRequest,
} from "@shared/types/pluginPermissions";
import { describePluginInstallPermissions } from "@shared/utils/pluginInstallPermissions";
import { WindowAppType, WindowControlPolicy, type WindowControlAbility } from "@shared/types/window";

type PermissionCopy = {
    type: string;
    title: string;
    body: string[];
    permissions: string[];
    detail?: string;
};

const WINDOW_LABELS: Record<string, string> = {
    launcher: "Launcher",
    settings: "Settings",
    workspace: "Workspace",
    "project-wizard": "Project Wizard",
    "dev-mode": "Dev Mode",
    "plugin-permission": "Plugin Permission",
    raw: "Studio",
};

const PLUGIN_PERMISSION_WINDOW_CONTROL_ABILITY: WindowControlAbility = {
    minimizable: false,
    maximizable: false,
    closable: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
};

function isPrivilegedRequest(request: PluginPermissionRequest): boolean {
    return request.kind === "trust" || request.kind === "filesystem" || request.kind === "api";
}

function pluginLabel(request: PluginPermissionRequest): string {
    const name = request.plugin.name?.trim();
    return name ? `${name} (${request.plugin.id})` : request.plugin.id;
}

function requesterLabel(props: PluginPermissionPromptProps | null): string {
    const windowType = props?.requester?.windowType;
    if (!windowType) {
        return "Studio";
    }
    return WINDOW_LABELS[windowType] ?? windowType;
}

function buildPermissionCopy(props: PluginPermissionPromptProps): PermissionCopy {
    const request = props.request;
    const plugin = pluginLabel(request);
    const requester = requesterLabel(props);

    switch (request.kind) {
        case "install": {
            return {
                type: "Plugin Install Request",
                title: `${requester} requests to install ${plugin}`,
                body: [
                    "Studio identified these privileged controls for this installation:",
                    "Approving this install grants the listed controls to this plugin version. Only install plugins you trust.",
                ],
                permissions: describePluginInstallPermissions(request.permissions),
                detail: `Source: ${request.source}`,
            };
        }
        case "filesystem":
            return {
                type: "File System Permission Request",
                title: `${plugin} requests file access`,
                body: [
                    "This plugin will be able to use the requested file system control after you approve it.",
                    request.persistence === "permanent"
                        ? "Choosing Allow Once grants this only for the current Studio session."
                        : "This request is for the current Studio session.",
                ],
                permissions: [
                    `${formatMode(request.mode)} ${request.recursive ? "inside" : "for"} ${request.path}`,
                ],
            };
        case "api":
            return {
                type: "Plugin API Permission Request",
                title: `${plugin} requests ${request.capability}`,
                body: [
                    "This plugin will be able to call the requested Studio API after approval.",
                    "Only approve this if the plugin needs the capability for the action you started.",
                ],
                permissions: [request.capability],
            };
        case "trust":
            return {
                type: "Plugin Trust Request",
                title: `${requester} requests to trust ${plugin}`,
                body: [
                    "Trusted plugins can be enabled by Studio without repeating the initial trust prompt.",
                    "Only trust plugins from sources you recognize.",
                ],
                permissions: ["Trust this plugin identity"],
            };
        default:
            return {
                type: "Plugin Permission Request",
                title: `${plugin} requests a Studio permission`,
                body: ["Review the request before allowing it."],
                permissions: [],
            };
    }
}

function formatMode(mode: string): string {
    switch (mode) {
        case "read":
            return "Read access";
        case "write":
            return "Write access";
        case "readwrite":
            return "Read and write access";
        default:
            return mode;
    }
}

export function PluginPermissionApp() {
    const [props, setProps] = useState<PluginPermissionPromptProps | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let mounted = true;
        getInterface()
            .getWindowProps<WindowAppType.PluginPermissionPrompt>()
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setError(result.error ?? "Failed to load permission request");
                    return;
                }
                setProps(result.data);
                getInterface().window.ready();
            })
            .catch(err => {
                if (mounted) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    const request = props?.request ?? null;
    const copy = useMemo(() => props ? buildPermissionCopy(props) : null, [props]);
    const showPersistentChoices = Boolean(request && isPrivilegedRequest(request) && request.persistence === "permanent");

    const closeWithResult = (result: PluginPermissionGrantResult | null) => {
        getInterface().window.closeWith<WindowAppType.PluginPermissionPrompt>(result);
    };

    const handleDeny = () => {
        if (!request) {
            closeWithResult(null);
            return;
        }
        closeWithResult({
            requestId: request.requestId,
            pluginId: request.plugin.id,
            kind: request.kind,
            approved: false,
            persistence: request.persistence ?? "temporary",
        });
    };

    const handleApprove = async (persistence?: PluginPermissionPersistence) => {
        if (!request || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        const result = await getInterface().pluginPermissions.grant(request, {
            requestId: request.requestId,
            approved: true,
            persistence: persistence ?? request.persistence ?? "temporary",
        });
        setBusy(false);

        if (!result.success) {
            setError(result.error ?? "Failed to grant permission");
            return;
        }

        closeWithResult(result.data);
    };

    return (
        <AppLayout
            title="Plugin Permission"
            iconSrc="/favicon.ico"
            initialControlAbility={PLUGIN_PERMISSION_WINDOW_CONTROL_ABILITY}
            windowControlPolicy={WindowControlPolicy.None}
        >
            <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
                {!request && !error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-label="Loading" />
                    </div>
                ) : null}

                {copy ? (
                    <>
                        <div className="border-b border-edge bg-surface-sunken px-4 py-2">
                            <div className="text-2xs font-medium tracking-normal text-fg-muted">
                                {copy.type}
                            </div>
                            <div className="mt-1 text-sm font-medium text-white">
                                {copy.title}
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            <div className="space-y-2 text-sm leading-5 text-fg-muted">
                                {copy.body.map((line, index) => (
                                    <p key={index}>{line}</p>
                                ))}
                            </div>

                            {copy.permissions.length > 0 ? (
                                <div className="mt-3 border border-edge bg-fill-subtle">
                                    {copy.permissions.map((permission, index) => (
                                        <div
                                            key={`${permission}-${index}`}
                                            className="border-b border-edge px-3 py-2 text-sm text-fg last:border-b-0"
                                        >
                                            {permission}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {copy.detail ? (
                                <div className="mt-3 truncate font-mono text-2xs text-fg-subtle">
                                    {copy.detail}
                                </div>
                            ) : null}

                            {request?.reason ? (
                                <div className="mt-3 border border-edge bg-[#111318] px-3 py-2 text-xs leading-5 text-fg-muted">
                                    {request.reason}
                                </div>
                            ) : null}

                            {error ? (
                                <div className="mt-3 border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                                    {error}
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                        <div className="border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                            {error}
                        </div>
                    </div>
                ) : null}

                {request ? (
                    <div className={`grid gap-2 border-t border-edge bg-surface-sunken p-3 ${showPersistentChoices ? "grid-cols-[1fr_1fr_1.15fr]" : "grid-cols-2"}`}>
                        <button
                            type="button"
                            onClick={handleDeny}
                            autoFocus
                            className="no-drag flex h-9 min-w-0 items-center justify-center gap-2 rounded border border-edge bg-fill-subtle px-3 text-sm font-medium text-fg hover:bg-fill focus:outline-none focus:ring-2 focus:ring-primary/60"
                        >
                            <X size={15} className="shrink-0" />
                            <span className="whitespace-nowrap">{request.kind === "install" ? "Don't Allow" : "Deny"}</span>
                        </button>
                        {showPersistentChoices ? (
                            <button
                                type="button"
                                onClick={() => handleApprove("temporary")}
                                disabled={!request || busy}
                                className="no-drag flex h-9 min-w-0 items-center justify-center gap-2 rounded border border-edge bg-fill px-3 text-sm font-medium text-fg hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Check size={15} className="shrink-0" />
                                <span className="whitespace-nowrap">Allow Once</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => handleApprove(showPersistentChoices ? "permanent" : undefined)}
                            disabled={!request || busy}
                            className="no-drag flex h-9 min-w-0 items-center justify-center gap-2 rounded bg-primary px-3 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Check size={15} className="shrink-0" />
                            <span className="whitespace-nowrap">{busy ? "Granting" : showPersistentChoices ? "Always Allow" : "Allow"}</span>
                        </button>
                    </div>
                ) : null}
            </div>
        </AppLayout>
    );
}

export default PluginPermissionApp;
