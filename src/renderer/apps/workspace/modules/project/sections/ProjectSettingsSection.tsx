import { useCallback, useState } from "react";
import { Switch } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import {
    normalizeNetworkConfiguration,
    normalizeSecurityConfiguration,
    type NetworkConfiguration,
    type SecurityConfiguration,
} from "@/lib/workspace/project/configuration";
import type { ProjectSectionProps } from "./types";

export function ProjectSettingsSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    const [network, setNetwork] = useState<NetworkConfiguration>(() => normalizeNetworkConfiguration(config.app?.network));
    const [security, setSecurity] = useState<SecurityConfiguration>(() => normalizeSecurityConfiguration(config.app?.security));
    const [savingHttp, setSavingHttp] = useState(false);
    const [savingEncrypt, setSavingEncrypt] = useState(false);

    const setAllowHttp = useCallback(async (next: boolean) => {
        if (savingHttp) {
            return;
        }
        const previous = network;
        setSavingHttp(true);
        setNetwork(current => ({ ...current, allowHttp: next }));
        try {
            const updated = await projectService.updateNetworkConfiguration({ allowHttp: next });
            setNetwork(normalizeNetworkConfiguration(updated.app?.network));
            onConfigChange(updated);
        } catch (error) {
            setNetwork(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSavingHttp(false);
        }
    }, [network, onConfigChange, projectService, savingHttp, uiService]);

    const setEncryptAssets = useCallback(async (next: boolean) => {
        if (savingEncrypt) {
            return;
        }
        const previous = security;
        setSavingEncrypt(true);
        setSecurity(current => ({ ...current, encryptAssets: next }));
        try {
            const updated = await projectService.updateSecurityConfiguration({ encryptAssets: next });
            setSecurity(normalizeSecurityConfiguration(updated.app?.security));
            onConfigChange(updated);
        } catch (error) {
            setSecurity(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSavingEncrypt(false);
        }
    }, [security, onConfigChange, projectService, savingEncrypt, uiService]);

    return (
        <div className="grid gap-3">
            <SettingRow
                title={t("project.settings.allowHttpTitle")}
                description={t("project.settings.allowHttpDescription")}
                checked={network.allowHttp}
                loading={savingHttp}
                onChange={value => void setAllowHttp(value)}
            />
            <SettingRow
                title={t("project.settings.encryptAssetsTitle")}
                description={t("project.settings.encryptAssetsDescription")}
                checked={security.encryptAssets}
                loading={savingEncrypt}
                onChange={value => void setEncryptAssets(value)}
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
