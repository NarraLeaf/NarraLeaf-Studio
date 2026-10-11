import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel, IconButton, Switch } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import {
    AGENT_CLIENTS,
    AGENT_MASKED_TOKEN,
    findAgentClient,
    type AgentClientDescriptor,
    type AgentClientId,
    type AgentClientSetupInfo,
} from "@shared/agent/clients";
import { buildAgentClientConfig } from "@shared/agent/settings";
import type { AgentQuickState } from "@shared/agent/workspaceAccess";
import { OptionList } from "./OptionList";

/** How long a copy button says it copied. The same as the Settings panel's. */
const COPIED_FLASH_MS = 1500;

export interface AgentStepProps {
    /** Held by the flow, so walking past this screen and back keeps the answer. */
    client: AgentClientId;
    onClientChange: (client: AgentClientId) => void;
}

/**
 * Connecting the author's own AI agent, which like a Team server is a screen finished by doing
 * nothing.
 *
 * **The same two switches as Settings, through the same narrow door as the workspace menu.** The
 * launcher is let through `agentQuickToggle` and `agentCopyConfig` only while setup is open, so this
 * screen never holds the token: the configuration is shown with the token masked, and the copy button
 * has main write the real one straight onto the clipboard. Turning writes on is confirmed in Studio's
 * agent access window, as it is from the menu.
 *
 * **One application at a time.** Each client takes its configuration in its own shape and its skill
 * in its own way (`@shared/agent/clients`), and a screen that listed all of them would be the README.
 * The author picks theirs and sees only what applies to it.
 */
export function AgentStep({ client: clientId, onClientChange }: AgentStepProps) {
    const { t } = useTranslation();
    const [quick, setQuick] = useState<AgentQuickState | null>(null);
    const [info, setInfo] = useState<AgentClientSetupInfo | null>(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [installedPath, setInstalledPath] = useState<Partial<Record<AgentClientId, string>>>({});
    const [error, setError] = useState<string | null>(null);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const client = findAgentClient(clientId) ?? AGENT_CLIENTS[0];

    const readInfo = useCallback(async () => {
        const result = await getInterface().agent.clientSetup().catch(() => null);
        if (result?.success) {
            setInfo(result.data);
        }
    }, []);

    useEffect(() => {
        void getInterface().agent.getQuickState().then(result => {
            if (result.success) {
                setQuick(result.data);
            }
        }).catch(() => undefined);
        void readInfo();
        return () => {
            if (copiedTimer.current) {
                clearTimeout(copiedTimer.current);
            }
        };
    }, [readInfo]);

    const toggle = useCallback(async (patch: { enabled?: boolean; allowWrites?: boolean }) => {
        setBusy(true);
        setError(null);
        try {
            const result = await getInterface().agent.quickToggle(patch);
            if (result.success) {
                setQuick(result.data);
                // The address follows the port actually served on, which is only known once it runs.
                void readInfo();
            } else {
                setError(result.error ?? null);
            }
        } finally {
            setBusy(false);
        }
    }, [readInfo]);

    const copy = useCallback(async () => {
        const result = await getInterface().agent.copyConfig(client.configKind).catch(() => null);
        if (!result?.success) {
            setError(result?.error ?? null);
            return;
        }
        setCopied(true);
        if (copiedTimer.current) {
            clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    }, [client.configKind]);

    const install = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const result = await getInterface().agent.installSkill(client.id);
            if (!result.success) {
                setError(result.error ?? null);
            } else if (!result.data.canceled) {
                const written = result.data.path;
                setInstalledPath(current => ({ ...current, [client.id]: written }));
                void readInfo();
            }
        } finally {
            setBusy(false);
        }
    }, [client.id, readInfo]);

    const enabled = quick?.enabled === true;
    const options = AGENT_CLIENTS.map(entry => ({ value: entry.id, label: entry.name ?? t("onboarding.agent.other") }));

    return (
        <div className="space-y-5">
            <div className="space-y-2.5">
                <SwitchRow
                    label={t("settings.agent.enable")}
                    checked={enabled}
                    disabled={busy || !quick}
                    onChange={next => void toggle({ enabled: next })}
                />
                {/* Full access turns writes on by itself; while it is on the switch shows that and
                    holds still, as it does in Settings. Full access itself is left to Settings. */}
                <SwitchRow
                    label={t("settings.agent.allowWrites")}
                    checked={quick?.allowWrites === true || quick?.fullAccess === true}
                    disabled={busy || !quick || quick.fullAccess}
                    onChange={next => void toggle({ allowWrites: next })}
                />
            </div>

            <div>
                <FieldLabel as="div">{t("onboarding.agent.app")}</FieldLabel>
                <OptionList
                    label={t("onboarding.agent.app")}
                    value={client.id}
                    options={options}
                    onChange={value => {
                        setCopied(false);
                        onClientChange(value as AgentClientId);
                    }}
                    columns={2}
                />
            </div>

            <div className={cn("transition-opacity duration-150", !enabled && "opacity-50")}>
                <FieldLabel as="div">{t("onboarding.agent.connection")}</FieldLabel>
                <p className="mb-1.5 text-xs text-fg-subtle">
                    {enabled ? connectionHint(t, client) : t("onboarding.agent.offHint")}
                </p>
                <div className="relative rounded-md border border-edge bg-fill-subtle">
                    <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all py-2 pl-2.5 pr-10 font-mono text-2xs leading-relaxed text-fg-muted">
                        {info ? <WrapAtSpaces text={buildAgentClientConfig(client.configKind, info.url, AGENT_MASKED_TOKEN, info.stdio)} /> : " "}
                    </pre>
                    <IconButton
                        size="sm"
                        variant="ghost"
                        className="absolute right-1 top-1"
                        disabled={!enabled || !info}
                        aria-label={copied ? t("settings.agent.copied") : t("common.copy")}
                        data-tip={copied ? t("settings.agent.copied") : t("common.copy")}
                        onClick={() => void copy()}
                    >
                        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    </IconButton>
                </div>
            </div>

            <div>
                <FieldLabel as="div">{t("onboarding.agent.skill")}</FieldLabel>
                <SkillSection
                    client={client}
                    info={info}
                    written={installedPath[client.id] ?? null}
                    busy={busy}
                    onInstall={() => void install()}
                />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
        </div>
    );
}

/**
 * A configuration broken only where it has spaces. Left to itself the browser also breaks after a
 * hyphen, which split `--header` across two lines and read as two words. Each run between spaces
 * holds together; one longer than the box (a path to Studio's executable) still breaks, through the
 * `break-all` on the box, rather than running out of it.
 */
function WrapAtSpaces({ text }: { text: string }) {
    return (
        <>
            {text.split(/(\s+)/).map((part, index) => (
                /\s/.test(part) || part === "" ? part : <span key={index} className="inline-block max-w-full whitespace-pre-wrap">{part}</span>
            ))}
        </>
    );
}

function connectionHint(t: ReturnType<typeof useTranslation>["t"], client: AgentClientDescriptor): string {
    if (client.id === "claudeDesktop") {
        return t("onboarding.agent.claudeDesktop");
    }
    if (client.id === "other") {
        return t("onboarding.agent.otherClient");
    }
    if (client.configIsCommand) {
        return t("onboarding.agent.runCommand");
    }
    return t("onboarding.agent.mergeInto", { file: client.configFile ?? "" });
}

function SkillSection({
    client,
    info,
    written,
    busy,
    onInstall,
}: {
    client: AgentClientDescriptor;
    info: AgentClientSetupInfo | null;
    /** What an install from this screen wrote, which says more than the folder it went into. */
    written: string | null;
    busy: boolean;
    onInstall: () => void;
}) {
    const { t } = useTranslation();

    if (client.skill === "served") {
        return <p className="text-xs text-fg-subtle">{t("onboarding.agent.skillServed")}</p>;
    }

    if (client.skill === "upload") {
        return (
            <div className="space-y-2">
                <p className="text-xs text-fg-subtle">
                    {written ? t("onboarding.agent.skillSaved", { path: written }) : t("onboarding.agent.skillUpload")}
                </p>
                <Button size="sm" variant="secondary" disabled={busy} onClick={onInstall}>
                    {t("onboarding.agent.skillSave")}
                </Button>
            </div>
        );
    }

    const target = info?.skillTargets[client.id] ?? null;
    const installed = target?.installed === true;
    return (
        <div className="space-y-2">
            <p className="truncate text-xs text-fg-subtle" data-tip={target?.displayPath}>
                {target
                    ? installed
                        ? t("onboarding.agent.skillInstalled", { path: target.displayPath })
                        : t("onboarding.agent.skillFolder", { path: target.displayPath })
                    : " "}
            </p>
            <Button size="sm" variant="secondary" disabled={busy || !target} onClick={onInstall}>
                {installed || written ? t("onboarding.agent.skillReinstall") : t("onboarding.agent.skillInstall")}
            </Button>
        </div>
    );
}

function SwitchRow({
    label,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm text-fg-muted">{label}</span>
            <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} size="sm" aria-label={label} />
        </div>
    );
}
