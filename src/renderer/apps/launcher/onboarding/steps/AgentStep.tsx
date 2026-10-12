import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { FieldLabel, Switch } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { AgentClientGuide, useAgentClientOptions } from "@/apps/settings/components/AgentClientGuide";
import type { AgentClientId } from "@shared/agent/clients";
import type { AgentQuickState } from "@shared/agent/workspaceAccess";
import { OptionList } from "./OptionList";

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
 * screen never holds the token. The switches are Studio's own, as in Settings, so main turns access
 * and writes on without asking again. Full access is left to Settings.
 *
 * **One application at a time**, picked from rows, then the same guide Settings ▸ Agent access shows
 * for it (`AgentClientGuide`): its configuration, where it goes, and its Agent Skill.
 */
export function AgentStep({ client, onClientChange }: AgentStepProps) {
    const { t } = useTranslation();
    const [quick, setQuick] = useState<AgentQuickState | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const options = useAgentClientOptions();

    useEffect(() => {
        void getInterface().agent.getQuickState().then(result => {
            if (result.success) {
                setQuick(result.data);
            }
        }).catch(() => undefined);
    }, []);

    const toggle = useCallback(async (patch: { enabled?: boolean; allowWrites?: boolean }) => {
        setBusy(true);
        setError(null);
        try {
            const result = await getInterface().agent.quickToggle(patch);
            if (result.success) {
                setQuick(result.data);
            } else {
                // Main's reason is English; the sentence around it is the author's language.
                setError(t("onboarding.agent.toggleFailed", { error: result.error ?? "" }));
            }
        } finally {
            setBusy(false);
        }
    }, [t]);

    return (
        <div className="space-y-5">
            <div className="space-y-2.5">
                <SwitchRow
                    label={t("settings.agent.enable")}
                    checked={quick?.enabled === true}
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
                {error && <p className="text-xs text-danger">{error}</p>}
            </div>

            <div>
                <FieldLabel as="div">{t("settings.agent.guide.app")}</FieldLabel>
                <OptionList
                    label={t("settings.agent.guide.app")}
                    value={client}
                    options={options}
                    onChange={value => onClientChange(value as AgentClientId)}
                    columns={2}
                />
            </div>

            <AgentClientGuide client={client} enabled={quick?.enabled === true} />
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
