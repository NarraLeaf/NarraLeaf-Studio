import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey, Translator } from "@shared/i18n";
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

const WINDOW_LABEL_KEYS: Record<string, TranslationKey> = {
    launcher: "pluginPermission.window.launcher",
    settings: "pluginPermission.window.settings",
    workspace: "pluginPermission.window.workspace",
    "project-wizard": "pluginPermission.window.projectWizard",
    "dev-mode": "pluginPermission.window.devMode",
    "plugin-permission": "pluginPermission.window.pluginPermission",
    raw: "pluginPermission.window.studio",
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

function requesterLabel(props: PluginPermissionPromptProps | null, t: Translator["t"]): string {
    const windowType = props?.requester?.windowType;
    if (!windowType) {
        return t("pluginPermission.window.studio");
    }
    const key = WINDOW_LABEL_KEYS[windowType];
    return key ? t(key) : windowType;
}

function buildPermissionCopy(props: PluginPermissionPromptProps, t: Translator["t"]): PermissionCopy {
    const request = props.request;
    const plugin = pluginLabel(request);
    const requester = requesterLabel(props, t);

    switch (request.kind) {
        case "install": {
            return {
                type: t("pluginPermission.install.type"),
                title: t("pluginPermission.install.title", { requester, plugin }),
                body: [
                    t("pluginPermission.install.body1"),
                    t("pluginPermission.install.body2"),
                ],
                permissions: describePluginInstallPermissions(request.permissions),
                detail: t("pluginPermission.install.source", { source: request.source }),
            };
        }
        case "filesystem":
            return {
                type: t("pluginPermission.filesystem.type"),
                title: t("pluginPermission.filesystem.title", { plugin }),
                body: [
                    t("pluginPermission.filesystem.body1"),
                    request.persistence === "permanent"
                        ? t("pluginPermission.filesystem.bodyPermanent")
                        : t("pluginPermission.filesystem.bodySession"),
                ],
                permissions: [
                    request.recursive
                        ? t("pluginPermission.filesystem.permissionRecursive", {
                              mode: formatMode(request.mode, t),
                              path: request.path,
                          })
                        : t("pluginPermission.filesystem.permissionSingle", {
                              mode: formatMode(request.mode, t),
                              path: request.path,
                          }),
                ],
            };
        case "api":
            return {
                type: t("pluginPermission.api.type"),
                title: t("pluginPermission.api.title", { plugin, capability: request.capability }),
                body: [
                    t("pluginPermission.api.body1"),
                    t("pluginPermission.api.body2"),
                ],
                permissions: [request.capability],
            };
        case "trust":
            return {
                type: t("pluginPermission.trust.type"),
                title: t("pluginPermission.trust.title", { requester, plugin }),
                body: [
                    t("pluginPermission.trust.body1"),
                    t("pluginPermission.trust.body2"),
                ],
                permissions: [t("pluginPermission.trust.permission")],
            };
        default:
            return {
                type: t("pluginPermission.generic.type"),
                title: t("pluginPermission.generic.title", { plugin }),
                body: [t("pluginPermission.generic.body")],
                permissions: [],
            };
    }
}

function formatMode(mode: string, t: Translator["t"]): string {
    switch (mode) {
        case "read":
            return t("pluginPermission.mode.read");
        case "write":
            return t("pluginPermission.mode.write");
        case "readwrite":
            return t("pluginPermission.mode.readwrite");
        default:
            return mode;
    }
}

export function PluginPermissionApp() {
    const { t } = useTranslation();
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
                    setError(result.error ?? t("pluginPermission.error.load"));
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
    const copy = useMemo(() => props ? buildPermissionCopy(props, t) : null, [props, t]);
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
            setError(result.error ?? t("pluginPermission.error.grant"));
            return;
        }

        closeWithResult(result.data);
    };

    return (
        <AppLayout
            title={t("pluginPermission.title")}
            iconSrc="/favicon.ico"
            initialControlAbility={PLUGIN_PERMISSION_WINDOW_CONTROL_ABILITY}
            windowControlPolicy={WindowControlPolicy.None}
        >
            <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
                {!request && !error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-label={t("common.loading")} />
                    </div>
                ) : null}

                {copy ? (
                    <>
                        <div className="border-b border-edge bg-surface-sunken px-4 py-2">
                            <div className="text-2xs font-medium tracking-normal text-fg-muted">
                                {copy.type}
                            </div>
                            <div className="mt-1 text-sm font-medium text-fg">
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
                                <div className="mt-3 border border-edge bg-surface px-3 py-2 text-xs leading-5 text-fg-muted">
                                    {request.reason}
                                </div>
                            ) : null}

                            {error ? (
                                <div className="mt-3 border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                                    {error}
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                        <div className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
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
                            <span className="whitespace-nowrap">{request.kind === "install" ? t("pluginPermission.button.dontAllow") : t("pluginPermission.button.deny")}</span>
                        </button>
                        {showPersistentChoices ? (
                            <button
                                type="button"
                                onClick={() => handleApprove("temporary")}
                                disabled={!request || busy}
                                className="no-drag flex h-9 min-w-0 items-center justify-center gap-2 rounded border border-edge bg-fill px-3 text-sm font-medium text-fg hover:bg-fill-strong disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Check size={15} className="shrink-0" />
                                <span className="whitespace-nowrap">{t("pluginPermission.button.allowOnce")}</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => handleApprove(showPersistentChoices ? "permanent" : undefined)}
                            disabled={!request || busy}
                            className="no-drag flex h-9 min-w-0 items-center justify-center gap-2 rounded bg-primary px-3 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Check size={15} className="shrink-0" />
                            <span className="whitespace-nowrap">{busy ? t("pluginPermission.button.granting") : showPersistentChoices ? t("pluginPermission.button.alwaysAllow") : t("pluginPermission.button.allow")}</span>
                        </button>
                    </div>
                ) : null}
            </div>
        </AppLayout>
    );
}

export default PluginPermissionApp;
