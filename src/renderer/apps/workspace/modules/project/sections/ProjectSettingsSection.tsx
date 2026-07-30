import { useCallback, useMemo, useState } from "react";
import { Select, type SelectOption } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { SettingRow, SettingShell } from "./settingRows";
import {
    MOBILE_ORIENTATIONS,
    normalizeMobileConfiguration,
    normalizeNetworkConfiguration,
    normalizeSecurityConfiguration,
    type MobileConfiguration,
    type MobileOrientation,
    type NetworkConfiguration,
    type SecurityConfiguration,
} from "@/lib/workspace/project/configuration";
import type { ProjectSectionProps } from "./types";

export function ProjectSettingsSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    // `SettingRow` reads the freeze itself; the orientation dropdown sits in a bare `SettingShell`, so
    // it needs its own.
    const freeze = useFreezeGuard();
    const [network, setNetwork] = useState<NetworkConfiguration>(() => normalizeNetworkConfiguration(config.app?.network));
    const [security, setSecurity] = useState<SecurityConfiguration>(() => normalizeSecurityConfiguration(config.app?.security));
    const [mobile, setMobile] = useState<MobileConfiguration>(() => normalizeMobileConfiguration(config.app?.mobile));
    const [savingHttp, setSavingHttp] = useState(false);
    const [savingEncrypt, setSavingEncrypt] = useState(false);
    const [savingOrientation, setSavingOrientation] = useState(false);

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

    const setOrientation = useCallback(async (next: MobileOrientation) => {
        if (savingOrientation) {
            return;
        }
        const previous = mobile;
        setSavingOrientation(true);
        setMobile(current => ({ ...current, orientation: next }));
        try {
            const updated = await projectService.updateMobileConfiguration({ orientation: next });
            setMobile(normalizeMobileConfiguration(updated.app?.mobile));
            onConfigChange(updated);
        } catch (error) {
            setMobile(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSavingOrientation(false);
        }
    }, [mobile, onConfigChange, projectService, savingOrientation, uiService]);

    const orientationOptions: SelectOption[] = useMemo(
        () => MOBILE_ORIENTATIONS.map(orientation => ({
            value: orientation,
            label: t(`project.settings.orientation.${orientation}`),
        })),
        [t],
    );

    return (
        <div className="grid gap-3">
            <SettingRow
                title={t("project.settings.allowHttpTitle")}
                description={t("project.settings.allowHttpDescription")}
                hint={t("project.settings.allowHttpWebHint")}
                checked={network.allowHttp}
                loading={savingHttp}
                onChange={value => void setAllowHttp(value)}
            />
            <SettingRow
                title={t("project.settings.encryptAssetsTitle")}
                description={t("project.settings.encryptAssetsDescription")}
                hint={t("project.settings.encryptAssetsWebHint")}
                checked={security.encryptAssets}
                loading={savingEncrypt}
                onChange={value => void setEncryptAssets(value)}
            />
            <SettingShell
                title={t("project.settings.orientationTitle")}
                description={t("project.settings.orientationDescription")}
                titleAttr={freeze.writes(savingOrientation).title}
            >
                <Select
                    options={orientationOptions}
                    value={mobile.orientation}
                    disabled={freeze.writes(savingOrientation).disabled}
                    onChange={value => void setOrientation(value as MobileOrientation)}
                    size="sm"
                    portalMenu
                    className="w-32 shrink-0"
                    aria-label={t("project.settings.orientationTitle")}
                />
            </SettingShell>
        </div>
    );
}

