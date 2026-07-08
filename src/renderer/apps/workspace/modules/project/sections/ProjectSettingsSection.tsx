import { useCallback, useState } from "react";
import { Switch } from "@/lib/components/elements";
import { normalizeNetworkConfiguration, type NetworkConfiguration } from "@/lib/workspace/project/configuration";
import type { ProjectSectionProps } from "./types";

export function ProjectSettingsSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const [network, setNetwork] = useState<NetworkConfiguration>(() => normalizeNetworkConfiguration(config.app?.network));
    const [saving, setSaving] = useState(false);

    const setAllowHttp = useCallback(async (next: boolean) => {
        if (saving) {
            return;
        }
        const previous = network;
        setSaving(true);
        setNetwork(current => ({ ...current, allowHttp: next }));
        try {
            const updated = await projectService.updateNetworkConfiguration({ allowHttp: next });
            setNetwork(normalizeNetworkConfiguration(updated.app?.network));
            onConfigChange(updated);
        } catch (error) {
            setNetwork(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(false);
        }
    }, [network, onConfigChange, projectService, saving, uiService]);

    return (
        <div className="grid gap-3">
            <SettingRow
                title="Allow HTTP"
                description="When off, the game is confined to the app protocol and all HTTP/HTTPS requests are blocked."
                checked={network.allowHttp}
                loading={saving}
                onChange={value => void setAllowHttp(value)}
            />
        </div>
    );
}

function SettingRow({
    title,
    description,
    checked,
    loading,
    onChange,
}: {
    title: string;
    description: string;
    checked: boolean;
    loading: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <section className="flex items-start justify-between gap-3 rounded-md border border-edge bg-white/[0.025] p-3">
            <div className="min-w-0">
                <div className="text-sm font-medium text-fg">{title}</div>
                <div className="mt-1 text-2xs leading-relaxed text-fg-subtle">{description}</div>
            </div>
            <Switch
                size="sm"
                checked={checked}
                loading={loading}
                onCheckedChange={onChange}
                aria-label={title}
            />
        </section>
    );
}
