import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel, IconButton } from "@/lib/components/elements";
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

/** How long a copy button says it copied. The same as the Settings panel's other copy buttons. */
const COPIED_FLASH_MS = 1500;

/** The agent applications to pick from, in `AGENT_CLIENTS` order, with the catch-all row named. */
export function useAgentClientOptions(): { value: AgentClientId; label: string }[] {
    const { t } = useTranslation();
    return AGENT_CLIENTS.map(entry => ({ value: entry.id, label: entry.name ?? t("settings.agent.guide.other") }));
}

export interface AgentClientGuideProps {
    /** The application picked; the picker is the caller's, since setup and Settings draw it differently. */
    client: AgentClientId;
    /** Whether agent access is on: until it is, the configuration names an endpoint that is not there. */
    enabled: boolean;
    /**
     * Anything that changes when the endpoint's address may have (Settings passes the address), so
     * the guide reads it again. The address follows the port actually served on, which is only known
     * once the endpoint runs; turning access on is covered by `enabled`.
     */
    endpointKey?: string | null;
}

/**
 * Connecting one agent application: its configuration, where it goes, and how it gets the Agent
 * Skill. Shown in first-run setup's agent access screen and in Settings ▸ Agent access, which is
 * what the welcome screen's promise that everything in setup stays available in Settings rests on.
 *
 * **It never holds the token.** The configuration is shown with the token masked, and the copy button
 * has main write the real one straight onto the clipboard (`agentCopyConfig`); the endpoint and the
 * skill folders come from `agentClientSetup`. Both answer only the Settings window and the launcher
 * main opened in setup.
 *
 * **One application at a time.** Each client takes its configuration in its own shape and its skill
 * in its own way (`@shared/agent/clients`), and a guide that listed all of them would be the README.
 */
export function AgentClientGuide({ client: clientId, enabled, endpointKey }: AgentClientGuideProps) {
    const { t } = useTranslation();
    const [info, setInfo] = useState<AgentClientSetupInfo | null>(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [installedPath, setInstalledPath] = useState<Partial<Record<AgentClientId, string>>>({});
    const [exportedPath, setExportedPath] = useState<string | null>(null);
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
        void readInfo();
    }, [readInfo, enabled, endpointKey]);

    useEffect(() => () => {
        if (copiedTimer.current) {
            clearTimeout(copiedTimer.current);
        }
    }, []);

    // A copy that said "copied" for the application before is not about this one.
    useEffect(() => {
        setCopied(false);
    }, [clientId]);

    // Main's reasons are English and technical, so each failure is said in the author's language
    // with main's reason after it.
    const copy = useCallback(async () => {
        const result = await getInterface().agent.copyConfig(client.configKind).catch(() => null);
        if (!result?.success) {
            setError(t("settings.agent.guide.copyFailed", { error: result?.error ?? "" }));
            return;
        }
        setError(null);
        setCopied(true);
        if (copiedTimer.current) {
            clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    }, [client.configKind, t]);

    const install = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const result = await getInterface().agent.installSkill(client.id);
            if (!result.success) {
                const failed = client.skill === "upload" ? "settings.agent.guide.saveFailed" : "settings.agent.guide.installFailed";
                setError(t(failed, { error: result.error ?? "" }));
            } else if (!result.data.canceled) {
                const written = result.data.path;
                setInstalledPath(current => ({ ...current, [client.id]: written }));
                void readInfo();
            }
        } finally {
            setBusy(false);
        }
    }, [client.id, client.skill, readInfo, t]);

    // The Agent menu's export, for an application Studio does not know the skill folder of.
    const exportSkill = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const result = await getInterface().agent.exportSkill();
            if (!result.success) {
                setError(t("settings.agent.guide.exportFailed", { error: result.error ?? "" }));
            } else if (!result.data.canceled) {
                setExportedPath(result.data.path);
            }
        } finally {
            setBusy(false);
        }
    }, [t]);

    return (
        <div className="space-y-5">
            <div className={cn("transition-opacity duration-150", !enabled && "opacity-50")}>
                <FieldLabel as="div">{t("settings.agent.guide.connection")}</FieldLabel>
                <p className="mb-1.5 text-xs text-fg-subtle">
                    {enabled ? connectionHint(t, client) : t("settings.agent.guide.offHint")}
                </p>
                <CodeBox
                    text={info ? buildAgentClientConfig(client.configKind, info.url, AGENT_MASKED_TOKEN, info.stdio) : " "}
                    copied={copied}
                    disabled={!enabled || !info}
                    onCopy={() => void copy()}
                />
            </div>

            <div>
                <FieldLabel as="div">{t("settings.agent.guide.skill")}</FieldLabel>
                <SkillSection
                    client={client}
                    info={info}
                    written={installedPath[client.id] ?? null}
                    exported={exportedPath}
                    busy={busy}
                    onInstall={() => void install()}
                    onExport={() => void exportSkill()}
                />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
        </div>
    );
}

/** A command or configuration to paste somewhere else, with the button that copies it. */
function CodeBox({ text, copied, disabled, onCopy }: { text: string; copied: boolean; disabled: boolean; onCopy: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="relative rounded-md border border-edge bg-fill-subtle">
            <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all py-2 pl-2.5 pr-10 font-mono text-2xs leading-relaxed text-fg-muted">
                <WrapAtSpaces text={text} />
            </pre>
            <IconButton
                size="sm"
                variant="ghost"
                className="absolute right-1 top-1"
                disabled={disabled}
                aria-label={copied ? t("settings.agent.copied") : t("common.copy")}
                data-tip={copied ? t("settings.agent.copied") : t("common.copy")}
                onClick={onCopy}
            >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
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
        return t("settings.agent.guide.claudeDesktop");
    }
    if (client.id === "other") {
        return t("settings.agent.guide.otherClient");
    }
    if (client.configIsCommand) {
        return t("settings.agent.guide.runCommand");
    }
    return t("settings.agent.guide.mergeInto", { file: client.configFile ?? "" });
}

function SkillSection({
    client,
    info,
    written,
    exported,
    busy,
    onInstall,
    onExport,
}: {
    client: AgentClientDescriptor;
    info: AgentClientSetupInfo | null;
    /** What an install from this guide wrote, which says more than the folder it went into. */
    written: string | null;
    /** The folder an export from this guide wrote. */
    exported: string | null;
    busy: boolean;
    onInstall: () => void;
    onExport: () => void;
}) {
    const { t } = useTranslation();

    // Studio does not know where this application keeps skills. It reads the same guide from the
    // MCP server, and the Agent Skill this Studio ships can be exported for the author to put where
    // the application reads skills - the same export as the Agent menu's.
    if (client.skill === "served") {
        return (
            <div className="space-y-2">
                <p className="text-xs text-fg-subtle">
                    {exported ? t("settings.agent.guide.skillExported", { path: exported }) : t("settings.agent.guide.skillServed")}
                </p>
                <Button size="sm" variant="secondary" disabled={busy} onClick={onExport}>
                    {t("settings.agent.guide.skillExport")}
                </Button>
            </div>
        );
    }

    if (client.skill === "upload") {
        return (
            <div className="space-y-2">
                <p className="text-xs text-fg-subtle">
                    {written ? t("settings.agent.guide.skillSaved", { path: written }) : t("settings.agent.guide.skillUpload")}
                </p>
                <Button size="sm" variant="secondary" disabled={busy} onClick={onInstall}>
                    {t("settings.agent.guide.skillSave")}
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
                        ? t("settings.agent.guide.skillInstalled", { path: target.displayPath })
                        : t("settings.agent.guide.skillFolder", { path: target.displayPath })
                    : " "}
            </p>
            <Button size="sm" variant="secondary" disabled={busy || !target} onClick={onInstall}>
                {installed || written ? t("settings.agent.guide.skillReinstall") : t("settings.agent.guide.skillInstall")}
            </Button>
        </div>
    );
}
