import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, IconButton, Input, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { pluginDisplayName } from "@shared/utils/pluginDisplayText";
import {
    AGENT_PORT_MAX,
    AGENT_PORT_MIN,
    buildAgentClientConfig,
    isUsableAgentPort,
    type AgentClientConfigKind,
    type AgentSettingsPatch,
    type AgentSettingsSnapshot,
} from "@shared/agent/settings";
import { SETTING_CONTROL_WIDTH } from "../components/settingControlWidth";

const CONFIG_KINDS: {
    kind: AgentClientConfigKind;
    labelKey: "settings.agent.copyClaudeCode" | "settings.agent.copyJson" | "settings.agent.copyOpencode" | "settings.agent.copyStdio";
    tipKey?: "settings.agent.copyStdioHint";
}[] = [
    { kind: "claudeCode", labelKey: "settings.agent.copyClaudeCode" },
    { kind: "json", labelKey: "settings.agent.copyJson" },
    { kind: "opencode", labelKey: "settings.agent.copyOpencode" },
    // For clients that only launch local programs: Studio's own executable as a stdio bridge.
    { kind: "stdio", labelKey: "settings.agent.copyStdio", tipKey: "settings.agent.copyStdioHint" },
];

/**
 * Agent access: the MCP endpoint an author's own AI agent connects to, and the switches that decide
 * what it may do.
 *
 * Everything here lives in the main process (`AgentManager`), not in the settings store - the token
 * is a secret and the switches decide whether an outside program may change a project - so the
 * panel reads and writes over its own Settings-only channel and shows what main answers, never what
 * it hoped to write. The endpoint starts and stops the moment the switch moves.
 *
 * Rows follow the generic settings row (label and description on the left, the control at the
 * shared control width on the right), so this section reads like the ones around it.
 */
export function AgentAccessPanel() {
    const { t, locale } = useTranslation();
    const [settings, setSettings] = useState<AgentSettingsSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [portDraft, setPortDraft] = useState("");
    const [tokenVisible, setTokenVisible] = useState(false);
    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const [copied, setCopied] = useState<AgentClientConfigKind | null>(null);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const adopt = useCallback((result: Awaited<ReturnType<ReturnType<typeof getInterface>["agent"]["getSettings"]>>) => {
        if (result.success) {
            setSettings(result.data);
            setPortDraft(String(result.data.port));
            setError(null);
        } else {
            setError(result.error ?? "");
        }
    }, []);

    useEffect(() => {
        void getInterface().agent.getSettings().then(adopt).catch(() => undefined);
        // A workspace's Agent menu can switch access or writes while this panel is open; main says
        // so, and the full snapshot is read again rather than patched from the menu's three booleans.
        const token = getInterface().agent.onQuickStateChanged(() => {
            void getInterface().agent.getSettings().then(adopt).catch(() => undefined);
        });
        return () => {
            token.cancel();
            if (copiedTimer.current) {
                clearTimeout(copiedTimer.current);
            }
        };
    }, [adopt]);

    const run = useCallback(async (action: () => ReturnType<ReturnType<typeof getInterface>["agent"]["getSettings"]>) => {
        setBusy(true);
        try {
            adopt(await action());
        } finally {
            setBusy(false);
        }
    }, [adopt]);

    const update = useCallback((patch: AgentSettingsPatch) => run(() => getInterface().agent.updateSettings(patch)), [run]);

    const portValue = Number(portDraft);
    const portValid = portDraft.trim() !== "" && isUsableAgentPort(portValue);

    const commitPort = useCallback(() => {
        if (!settings || !portValid || portValue === settings.port) {
            if (settings && !portValid) {
                setPortDraft(String(settings.port));
            }
            return;
        }
        void update({ port: portValue });
    }, [settings, portValid, portValue, update]);

    const copy = useCallback(async (kind: AgentClientConfigKind) => {
        if (!settings) {
            return;
        }
        await copyTextToClipboard(buildAgentClientConfig(kind, settings.url, settings.token, settings.stdio));
        setCopied(kind);
        if (copiedTimer.current) {
            clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(null), 1500);
    }, [settings]);

    if (!settings) {
        return error
            ? <p className="px-2 text-xs text-danger">{error}</p>
            : <p className="px-2 text-xs text-fg-subtle">{t("settings.agent.loading")}</p>;
    }

    const status = settings.running
        ? t("settings.agent.running")
        : settings.error
            ? t("settings.agent.failed", { message: settings.error })
            : t("settings.agent.stopped");

    return (
        <div className="flex flex-col gap-1">
            <Row label={t("settings.agent.enable")} description={t("settings.agent.enableHint")}>
                <Switch
                    checked={settings.enabled}
                    disabled={busy}
                    onCheckedChange={checked => void update({ enabled: checked })}
                    size="md"
                    aria-label={t("settings.agent.enable")}
                />
            </Row>
            {/* Full access lets writes through on its own; while it is on, the write switch shows that and holds still. */}
            <Row label={t("settings.agent.allowWrites")} description={t("settings.agent.allowWritesHint")}>
                <Switch
                    checked={settings.allowWrites || settings.fullAccess}
                    disabled={busy || settings.fullAccess}
                    onCheckedChange={checked => void update({ allowWrites: checked })}
                    size="md"
                    aria-label={t("settings.agent.allowWrites")}
                />
            </Row>
            {/* Turning it on is confirmed in the agent access window by main; a declined prompt answers the switch off again. */}
            <Row label={t("settings.agent.fullAccess")} description={t("settings.agent.fullAccessHint")}>
                <Switch
                    checked={settings.fullAccess}
                    disabled={busy}
                    onCheckedChange={checked => void update({ fullAccess: checked })}
                    size="md"
                    aria-label={t("settings.agent.fullAccess")}
                />
            </Row>
            <Row
                label={t("settings.agent.port")}
                description={portValid ? t("settings.agent.portHint") : t("settings.agent.portInvalid", { min: AGENT_PORT_MIN, max: AGENT_PORT_MAX })}
                descriptionTone={portValid ? "muted" : "danger"}
            >
                <Input
                    size="sm"
                    inputMode="numeric"
                    value={portDraft}
                    variant={portValid ? "default" : "error"}
                    disabled={busy}
                    onChange={event => setPortDraft(event.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={commitPort}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            commitPort();
                        }
                    }}
                    aria-label={t("settings.agent.port")}
                />
            </Row>
            <Row label={t("settings.agent.endpoint")} description={status} descriptionTone={settings.error && !settings.running ? "danger" : "muted"}>
                <p className="w-full truncate text-right font-mono text-xs text-fg-muted" data-tip={settings.url}>
                    {settings.url}
                </p>
            </Row>
            <Row label={t("settings.agent.token")} description={t("settings.agent.tokenHint")}>
                <div className="flex w-full items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
                        {tokenVisible ? settings.token : "•".repeat(24)}
                    </p>
                    <Button size="sm" variant="ghost" onClick={() => setTokenVisible(visible => !visible)}>
                        {tokenVisible ? t("settings.agent.hide") : t("settings.agent.show")}
                    </Button>
                </div>
            </Row>
            <Row label={t("settings.agent.regenerate")} description={t("settings.agent.regenerateHint")}>
                {confirmRegenerate ? (
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRegenerate(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => {
                                setConfirmRegenerate(false);
                                void run(() => getInterface().agent.regenerateToken());
                            }}
                        >
                            {t("settings.agent.regenerateConfirm")}
                        </Button>
                    </div>
                ) : (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRegenerate(true)}>
                        {t("settings.agent.regenerateAction")}
                    </Button>
                )}
            </Row>
            <Row label={t("settings.agent.copyConfig")} description={t("settings.agent.copyConfigHint")} wide>
                <div className="flex flex-wrap justify-end gap-2">
                    {CONFIG_KINDS.map(({ kind, labelKey, tipKey }) => (
                        <Button
                            key={kind}
                            size="sm"
                            variant="secondary"
                            data-tip={tipKey ? t(tipKey) : undefined}
                            onClick={() => void copy(kind)}
                        >
                            {copied === kind ? t("settings.agent.copied") : t(labelKey)}
                        </Button>
                    ))}
                </div>
            </Row>
            <div className="rounded-md px-2 py-2">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 grow basis-64 flex-col gap-1">
                        <span className="text-sm font-medium text-fg">{t("settings.agent.importRoots")}</span>
                        <span className="text-xs text-fg-subtle">{t("settings.agent.importRootsHint")}</span>
                    </div>
                    <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto"
                        disabled={busy}
                        onClick={() => void run(() => getInterface().agent.addImportRoot())}
                    >
                        {t("settings.agent.addFolder")}
                    </Button>
                </div>
                {settings.allowedImportRoots.length === 0 ? (
                    <p className="mt-2 text-xs text-fg-subtle">{t("settings.agent.importRootsEmpty")}</p>
                ) : (
                    <div className="mt-2 flex flex-col">
                        {settings.allowedImportRoots.map(root => (
                            <div key={root} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-fill">
                                <p className="min-w-0 flex-1 truncate text-sm text-fg-muted" data-tip={root}>{root}</p>
                                <IconButton
                                    size="sm"
                                    variant="ghost"
                                    aria-label={t("settings.agent.removeFolder")}
                                    data-tip={t("settings.agent.removeFolder")}
                                    disabled={busy}
                                    onClick={() => void update({ removeImportRoot: root })}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </IconButton>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {/*
              * Plugins that offer agent tools, each with its own switch. On unless the author turns
              * one off: the install prompt already said the plugin offers them, and nothing they do
              * writes unless "Allow agents to make changes" is on as well.
              */}
            <div className="rounded-md px-2 py-2">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-fg">{t("settings.agent.pluginTools")}</span>
                    <span className="text-xs text-fg-subtle">{t("settings.agent.pluginToolsHint")}</span>
                </div>
                {settings.pluginTools.length === 0 ? (
                    <p className="mt-2 text-xs text-fg-subtle">{t("settings.agent.pluginToolsEmpty")}</p>
                ) : (
                    <div className="mt-2 flex flex-col">
                        {settings.pluginTools.map(plugin => {
                            const name = pluginDisplayName(plugin, locale);
                            return (
                                <div key={plugin.pluginId} className="flex h-11 items-center gap-3 rounded-md px-2 hover:bg-fill">
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm text-fg" data-tip={plugin.pluginId}>{name}</span>
                                        <span className="truncate text-xs text-fg-subtle">
                                            {t("settings.agent.pluginToolsCount", { tools: plugin.tools, writes: plugin.writeTools })}
                                        </span>
                                    </div>
                                    <Switch
                                        checked={plugin.allowed}
                                        disabled={busy}
                                        onCheckedChange={checked => void update({ pluginTools: { pluginId: plugin.pluginId, allowed: checked } })}
                                        size="md"
                                        aria-label={t("settings.agent.pluginToolsAllow", { plugin: name })}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            {error && <p className="px-2 text-xs text-danger">{error}</p>}
            {busy && <Loader2 className="mx-2 h-3 w-3 animate-spin text-primary" />}
        </div>
    );
}

function Row({
    label,
    description,
    descriptionTone = "muted",
    wide = false,
    children,
}: {
    label: string;
    description: string;
    descriptionTone?: "muted" | "danger";
    /** Let the control column grow past the shared width, for a group of buttons. */
    wide?: boolean;
    children: ReactNode;
}) {
    return (
        <div className="rounded-md px-2 py-2 transition duration-200 hover:bg-fill-subtle">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 grow basis-64 flex-col gap-1">
                    <span className="text-sm font-medium text-fg">{label}</span>
                    <span className={cn("text-xs", descriptionTone === "danger" ? "text-danger" : "text-fg-subtle")}>{description}</span>
                </div>
                <div className={cn("ml-auto flex max-w-full flex-col items-end gap-1", !wide && SETTING_CONTROL_WIDTH)}>
                    {children}
                </div>
            </div>
        </div>
    );
}
