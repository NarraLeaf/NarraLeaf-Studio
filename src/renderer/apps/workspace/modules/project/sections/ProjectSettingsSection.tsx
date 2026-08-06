/**
 * Project -> Settings: what the project is allowed to reach, what it costs to download, and how it
 * sits on a phone.
 *
 * Three parts under three headings rather than one list of eight switches. The list was in no
 * particular order and mixed the two questions an author actually asks here: "can this game talk to
 * the network and is what it ships readable" and "how big is the download". Nothing here changes
 * what the player sees, which is what keeps it off the Game page.
 */

import { useCallback, useMemo, useState } from "react";
import { Select, type SelectOption } from "@/lib/components/elements";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { SettingRow, SettingShell } from "./settingRows";
import { NumberField } from "./NumberField";
import { SettingsGroup } from "../components/SettingsGroup";
import {
    MOBILE_ORIENTATIONS,
    normalizeMobileConfiguration,
    normalizeNetworkConfiguration,
    normalizeSecurityConfiguration,
    normalizeWebOptimizationConfiguration,
    WEB_LOSSY_QUALITY_MAX,
    WEB_LOSSY_QUALITY_MIN,
    type MobileConfiguration,
    type MobileOrientation,
    type NetworkConfiguration,
    type SecurityConfiguration,
    type WebOptimizationConfiguration,
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
    const [webOptimization, setWebOptimization] = useState<WebOptimizationConfiguration>(
        () => normalizeWebOptimizationConfiguration(config.app?.webOptimization),
    );
    const [savingHttp, setSavingHttp] = useState(false);
    const [savingEncrypt, setSavingEncrypt] = useState(false);
    const [savingOrientation, setSavingOrientation] = useState(false);
    const [savingWeb, setSavingWeb] = useState<keyof WebOptimizationConfiguration | null>(null);

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

    const commitWebOptimization = useCallback(async (
        field: keyof WebOptimizationConfiguration,
        patch: Partial<WebOptimizationConfiguration>,
    ) => {
        if (savingWeb) {
            return;
        }
        const previous = webOptimization;
        setSavingWeb(field);
        setWebOptimization(current => ({ ...current, ...patch }));
        try {
            const updated = await projectService.updateWebOptimizationConfiguration(patch);
            setWebOptimization(normalizeWebOptimizationConfiguration(updated.app?.webOptimization));
            onConfigChange(updated);
        } catch (error) {
            setWebOptimization(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSavingWeb(null);
        }
    }, [onConfigChange, projectService, savingWeb, uiService, webOptimization]);

    const orientationOptions: SelectOption[] = useMemo(
        () => MOBILE_ORIENTATIONS.map(orientation => ({
            value: orientation,
            label: t(`project.settings.orientation.${orientation}`),
        })),
        [t],
    );

    return (
        <div className="grid gap-3 [&>*]:min-w-0">
            <SettingsGroup
                title={t("project.group.security")}
                helpTopic="assetProtection"
                trailing={<HelpTrigger topic="assetProtection" />}
            >
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
            </SettingsGroup>

            <SettingsGroup
                title={t("project.group.optimization")}
                helpTopic="webOptimization"
                trailing={<HelpTrigger topic="webOptimization" />}
            >
                <SettingRow
                    title={t("project.settings.webLosslessImagesTitle")}
                    description={t("project.settings.webLosslessImagesDescription")}
                    hint={t("project.settings.webLosslessImagesHint")}
                    checked={webOptimization.losslessImages}
                    loading={savingWeb === "losslessImages"}
                    onChange={value => void commitWebOptimization("losslessImages", { losslessImages: value })}
                />
                <SettingRow
                    title={t("project.settings.webPrecompressTitle")}
                    description={t("project.settings.webPrecompressDescription")}
                    hint={t("project.settings.webPrecompressHint")}
                    checked={webOptimization.precompress}
                    loading={savingWeb === "precompress"}
                    onChange={value => void commitWebOptimization("precompress", { precompress: value })}
                />
                <SettingRow
                    title={t("project.settings.webLossyImagesTitle")}
                    description={t("project.settings.webLossyImagesDescription")}
                    hint={t("project.settings.webSharedWithMobileHint")}
                    checked={webOptimization.lossyImages}
                    loading={savingWeb === "lossyImages"}
                    onChange={value => void commitWebOptimization("lossyImages", { lossyImages: value })}
                />
                <SettingShell
                    title={t("project.settings.webLossyQualityTitle")}
                    description={t("project.settings.webLossyQualityDescription")}
                    titleAttr={freeze.writes().title}
                >
                    <NumberField
                        value={webOptimization.lossyQuality}
                        min={WEB_LOSSY_QUALITY_MIN}
                        max={WEB_LOSSY_QUALITY_MAX}
                        disabled={freeze.writes(!webOptimization.lossyImages || savingWeb === "lossyQuality").disabled}
                        ariaLabel={t("project.settings.webLossyQualityTitle")}
                        onCommit={value => void commitWebOptimization("lossyQuality", { lossyQuality: value })}
                    />
                </SettingShell>
            </SettingsGroup>

            {/* Neither security nor size, and a heading of its own rather than filed under whichever
                of the two it is closer to. One row today; the phone-only questions land here. */}
            <SettingsGroup title={t("project.group.mobile")}>
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
            </SettingsGroup>
        </div>
    );
}

