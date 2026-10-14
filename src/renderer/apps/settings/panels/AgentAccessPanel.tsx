import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, IconButton, Input, Select, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { pluginDisplayName } from "@shared/utils/pluginDisplayText";
import {
    AGENT_PORT_MAX,
    AGENT_PORT_MIN,
    isUsableAgentPort,
    type AgentPortRefusal,
    type AgentSettingsPatch,
    type AgentSettingsSnapshot,
} from "@shared/agent/settings";
import type { AgentClientId } from "@shared/agent/clients";
import { SETTING_CONTROL_WIDTH } from "../components/settingControlWidth";
import { AgentClientGuide, useAgentClientOptions } from "../components/AgentClientGuide";

/**
 * Agent access: the MCP endpoint an author's own AI agent connects to, and the switches that decide
 * what it may do.
 *
 * Everything here lives in the main process (`AgentManager`), not in the settings store - the token
 * is a secret and the switches decide whether an outside program may change a project - so the
 * panel reads and writes over its own Settings-only channel and shows what main answers, never what
 * it hoped to write. The endpoint starts and stops the moment the switch moves.
 *
 * The port row moves the endpoint at once, or says why it could not and shows the port it is still
 * on. A start that finds the profile's port taken moves on its own instead; the address row says so -
 * which is when configurations copied before stop working - until a configuration or the address is
 * copied again.
 *
 * Rows follow the generic settings row (label and description on the left, the control at the
 * shared control width on the right), so this section reads like the ones around it.
 *
 * Under the token rows, the guide first-run setup walks an author through: pick the agent
 * application, then its configuration (token masked), where it goes, and its Agent Skill - the same
 * component as the setup screen (`AgentClientGuide`), so what setup offered stays here. It is the
 * one place a configuration is copied from in this panel: a row of copy buttons beside it would be a
 * second way to do the same thing, without the guide's "where it goes".
 */
export function AgentAccessPanel() {
    const { t, locale } = useTranslation();
    const [settings, setSettings] = useState<AgentSettingsSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [portDraft, setPortDraft] = useState("");
    const [portRefused, setPortRefused] = useState<AgentPortRefusal | null>(null);
    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const [copied, setCopied] = useState<"address" | "token" | null>(null);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Each step of regenerating replaces the focused button, so focus is handed on explicitly: the
    // confirm step's Cancel takes it, and once the step closes the Regenerate button gets it back
    // (after a regeneration, once it is enabled again).
    const regenerateButton = useRef<HTMLButtonElement | null>(null);
    const refocusRegenerate = useRef(false);
    const [guideClient, setGuideClient] = useState<AgentClientId>("claudeCode");
    const clientOptions = useAgentClientOptions();

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

    const update = useCallback((patch: AgentSettingsPatch) => run(async () => {
        const result = await getInterface().agent.updateSettings(patch);
        // A refusal answers this request only. Main tells this window about every change, and the
        // snapshot read again for that does not carry it, so it is held here until the field is edited.
        if (patch.port !== undefined) {
            setPortRefused(result.success ? result.data.portRefused ?? null : null);
        }
        return result;
    }), [run]);

    const closeRegenerateConfirm = useCallback(() => {
        refocusRegenerate.current = true;
        setConfirmRegenerate(false);
    }, []);

    useEffect(() => {
        if (!confirmRegenerate && !busy && refocusRegenerate.current) {
            refocusRegenerate.current = false;
            regenerateButton.current?.focus();
        }
    }, [confirmRegenerate, busy]);

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

    const copy = useCallback(async (what: "address" | "token") => {
        if (!settings) {
            return;
        }
        await copyTextToClipboard(what === "address" ? settings.url : settings.token);
        setCopied(what);
        if (copiedTimer.current) {
            clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(null), 1500);
        // What was copied names the current port: the notice that it moved has been acted on.
        if (what === "address" && settings.movedToPort !== null) {
            void update({ acknowledgeMovedPort: true });
        }
    }, [settings, update]);

    if (!settings) {
        return error
            ? <p className="px-2 text-xs text-danger">{error}</p>
            : <p className="px-2 text-xs text-fg-subtle">{t("settings.agent.loading")}</p>;
    }

    const status = settings.running
        ? settings.movedToPort !== null
            ? t("settings.agent.portMoved", { port: settings.movedToPort })
            : t("settings.agent.running")
        : settings.error
            ? t("settings.agent.failed", { message: settings.error })
            : t("settings.agent.stopped");
    const statusTone = settings.running
        ? settings.movedToPort !== null ? "warning" : "muted"
        : settings.error ? "danger" : "muted";
    const portDescription = !portValid
        ? t("settings.agent.portInvalid", { min: AGENT_PORT_MIN, max: AGENT_PORT_MAX })
        : portRefused
            ? t(portRefused.reason === "inUse" ? "settings.agent.portInUse" : "settings.agent.portReserved", { port: portRefused.port })
            : t("settings.agent.portHint");

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
            <Row label={t("settings.agent.port")} description={portDescription} descriptionTone={portValid && !portRefused ? "muted" : "danger"}>
                <Input
                    size="sm"
                    inputMode="numeric"
                    value={portDraft}
                    variant={portValid ? "default" : "error"}
                    disabled={busy}
                    onChange={event => {
                        setPortDraft(event.target.value.replace(/[^0-9]/g, ""));
                        setPortRefused(null);
                    }}
                    onBlur={commitPort}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            commitPort();
                        }
                    }}
                    aria-label={t("settings.agent.port")}
                />
            </Row>
            <Row label={t("settings.agent.endpoint")} description={status} descriptionTone={statusTone}>
                <div className="flex w-full items-center justify-end gap-1">
                    <p className="min-w-0 truncate font-mono text-xs text-fg-muted" data-tip={settings.url}>
                        {settings.url}
                    </p>
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={t("settings.agent.copyAddress")}
                        data-tip={copied === "address" ? t("settings.agent.copied") : t("settings.agent.copyAddress")}
                        onClick={() => void copy("address")}
                    >
                        {copied === "address" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </IconButton>
                </div>
            </Row>
            {/* Never shown in full: it is only ever pasted, and a 43-character secret does not fit the control
                column anyway. The last characters tell which token a client was set up with. */}
            <Row label={t("settings.agent.token")} description={t("settings.agent.tokenHint")}>
                <div className="flex w-full items-center justify-end gap-1">
                    <p className="min-w-0 truncate font-mono text-xs text-fg-muted">{maskAgentToken(settings.token)}</p>
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={t("settings.agent.copyToken")}
                        data-tip={copied === "token" ? t("settings.agent.copied") : t("settings.agent.copyToken")}
                        onClick={() => void copy("token")}
                    >
                        {copied === "token" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </IconButton>
                </div>
            </Row>
            <Row label={t("settings.agent.regenerate")} description={t("settings.agent.regenerateHint")}>
                {confirmRegenerate ? (
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" autoFocus onClick={closeRegenerateConfirm}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => {
                                closeRegenerateConfirm();
                                void run(() => getInterface().agent.regenerateToken());
                            }}
                        >
                            {t("settings.agent.regenerateAction")}
                        </Button>
                    </div>
                ) : (
                    <Button ref={regenerateButton} size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRegenerate(true)}>
                        {t("settings.agent.regenerateAction")}
                    </Button>
                )}
            </Row>
            <Row label={t("settings.agent.guide.app")} description={t("settings.agent.guide.appHint")}>
                <Select
                    size="sm"
                    fullWidth
                    options={clientOptions}
                    value={guideClient}
                    onChange={value => setGuideClient(value as AgentClientId)}
                    ariaLabel={t("settings.agent.guide.app")}
                />
            </Row>
            <div className="px-2 pb-3 pt-1" data-agent-client-guide>
                <AgentClientGuide client={guideClient} enabled={settings.enabled} endpointKey={settings.url} />
            </div>
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
              * one off: the install prompt already said the plugin offers them. A tool the plugin
              * declares as changing the project is refused unless "Allow agents to change projects" is
              * on as well; one it declares as reading is held only to not writing the plugin's own
              * storage - see `blockedPluginTools` in `@shared/agent/settings`.
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
                                        <span className="truncate text-sm text-fg" data-tip={name}>{name}</span>
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

/** How many of the token's last characters the Settings row shows. */
const TOKEN_VISIBLE_TAIL = 4;

function maskAgentToken(token: string): string {
    return `${"•".repeat(8)}${token.slice(-TOKEN_VISIBLE_TAIL)}`;
}

const TONE_CLASS = { muted: "text-fg-subtle", warning: "text-warning", danger: "text-danger" } as const;

function Row({
    label,
    description,
    descriptionTone = "muted",
    wide = false,
    children,
}: {
    label: string;
    description: string;
    descriptionTone?: "muted" | "warning" | "danger";
    /** Let the control column grow past the shared width, for a group of buttons. */
    wide?: boolean;
    children: ReactNode;
}) {
    return (
        <div className="rounded-md px-2 py-2 transition duration-200 hover:bg-fill-subtle">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 grow basis-64 flex-col gap-1">
                    <span className="text-sm font-medium text-fg">{label}</span>
                    <span className={cn("text-xs", TONE_CLASS[descriptionTone])}>{description}</span>
                </div>
                <div className={cn("ml-auto flex max-w-full flex-col items-end gap-1", !wide && SETTING_CONTROL_WIDTH)}>
                    {children}
                </div>
            </div>
        </div>
    );
}
