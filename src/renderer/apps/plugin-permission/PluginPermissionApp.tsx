import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { getInterface } from "@/lib/app/bridge";
import {
    PluginPermissionGrantResult,
    PluginPermissionPersistence,
    PluginPermissionPromptProps,
    PluginPermissionRequest,
} from "@shared/types/pluginPermissions";
import { WindowAppType } from "@shared/types/window";

function describeRequest(request: PluginPermissionRequest): string {
    switch (request.kind) {
        case "trust":
            return "Trust this plugin";
        case "filesystem":
            return `${request.mode} access to ${request.path}`;
        case "install":
            return `Install from ${request.source}`;
        case "api":
            return `Use ${request.capability}`;
        default:
            return "Plugin permission";
    }
}

function isPrivilegedRequest(request: PluginPermissionRequest): boolean {
    return request.kind === "trust" || request.kind === "filesystem" || request.kind === "api";
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
    const requestTitle = useMemo(() => request ? describeRequest(request) : "Plugin permission", [request]);
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
        <AppLayout title="Plugin Permission" iconSrc="/favicon.ico">
            <div className="flex h-full flex-col bg-[#111318] px-5 pb-5 pt-4 text-gray-100">
                <div className="min-h-0 flex-1">
                    <div className="text-[13px] font-semibold uppercase tracking-normal text-cyan-300">
                        {request?.plugin.name ?? request?.plugin.id ?? "Plugin"}
                    </div>
                    <div className="mt-2 text-lg font-semibold leading-6 text-white">
                        {requestTitle}
                    </div>
                    {request?.reason ? (
                        <div className="mt-3 max-h-20 overflow-auto rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-5 text-gray-300">
                            {request.reason}
                        </div>
                    ) : null}
                    {request?.kind === "filesystem" ? (
                        <div className="mt-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-5 text-gray-300">
                            {request.recursive ? "Recursive" : "Single path"} {request.mode} permission
                        </div>
                    ) : null}
                    {request?.kind === "api" ? (
                        <div className="mt-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-5 text-gray-300">
                            {request.capability}
                        </div>
                    ) : null}
                    {error ? (
                        <div className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className={`mt-4 grid gap-3 ${showPersistentChoices ? "grid-cols-3" : "grid-cols-2"}`}>
                    <button
                        type="button"
                        onClick={handleDeny}
                        autoFocus
                        className="no-drag flex h-10 items-center justify-center gap-2 rounded border border-white/10 bg-white/[0.04] text-sm font-medium text-gray-200 hover:bg-white/[0.08]"
                    >
                        <X size={16} />
                        {request?.kind === "install" ? "Don't Allow" : "Deny"}
                    </button>
                    {showPersistentChoices ? (
                        <button
                            type="button"
                            onClick={() => handleApprove("temporary")}
                            disabled={!request || busy}
                            className="no-drag flex h-10 items-center justify-center gap-2 rounded border border-cyan-400/30 bg-cyan-400/10 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Check size={16} />
                            Allow Once
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => handleApprove(showPersistentChoices ? "permanent" : undefined)}
                        disabled={!request || busy}
                        className="no-drag flex h-10 items-center justify-center gap-2 rounded bg-cyan-500 text-sm font-semibold text-[#071216] hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Check size={16} />
                        {busy ? "Granting" : showPersistentChoices ? "Always Allow" : "Allow"}
                    </button>
                </div>
            </div>
        </AppLayout>
    );
}

export default PluginPermissionApp;
