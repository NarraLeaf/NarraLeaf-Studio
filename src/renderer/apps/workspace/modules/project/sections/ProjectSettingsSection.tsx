/**
 * Project -> Settings: what the project is allowed to reach, who it says it came from, what it costs
 * to download, and how it sits on a phone.
 *
 * Four parts under four headings rather than one list of switches. The list was in no particular
 * order and mixed the two questions an author actually asks here: "can this game talk to the network
 * and is what it ships readable" and "how big is the download". Signing joined them because it
 * answers the same class of question - it changes what leaves the machine, not what the player meets,
 * which is what keeps all of this off the Game page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select, type SelectOption } from "@/lib/components/elements";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n/catalog";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
  NETWORK_ACCESS_POLICIES,
  NETWORK_POLICY_ALLOWLIST,
  NETWORK_POLICY_OFF,
  normalizeNetworkAccessPolicy,
  type NetworkPluginAllowlistEntry
} from "@shared/types/networkAllowlist";
import { getInterface } from "@/lib/app/bridge";
import { SettingRow, SettingShell, SettingStack } from "./settingRows";
import { NetworkAllowlistField } from "./NetworkAllowlistField";
import { NumberField } from "./NumberField";
import { ProjectSigningSection } from "./ProjectSigningSection";
import { SettingsGroup } from "../components/SettingsGroup";
import {
  MOBILE_CROP_ANCHORS_X,
  MOBILE_CROP_ANCHORS_Y,
  MOBILE_ORIENTATIONS,
  MOBILE_VIEWPORT_FITS,
  normalizeCrashConfiguration,
  normalizeMobileConfiguration,
  normalizeNetworkConfiguration,
  normalizeSecurityConfiguration,
  normalizeWebOptimizationConfiguration,
  WEB_LOSSY_QUALITY_MAX,
  WEB_LOSSY_QUALITY_MIN,
  type MobileConfiguration,
  type MobileCropAnchorX,
  type MobileCropAnchorY,
  type MobileOrientation,
  type MobileViewportFit,
  type CrashConfiguration,
  type NetworkConfiguration,
  type SecurityConfiguration,
  type WebOptimizationConfiguration
} from "@/lib/workspace/project/configuration";
import { GAME_CRASH_POLICIES } from "@shared/types/gameRuntime";
import type { ProjectSectionProps } from "./types";

export function ProjectSettingsSection(props: ProjectSectionProps) {
  const { projectService, uiService, config, onConfigChange } = props;
  const { t } = useTranslation();
  // `SettingRow` reads the freeze itself; the orientation dropdown sits in a bare `SettingShell`, so
  // it needs its own.
  const freeze = useFreezeGuard();
  const [network, setNetwork] = useState<NetworkConfiguration>(() =>
    normalizeNetworkConfiguration(config.app?.network)
  );
  const [security, setSecurity] = useState<SecurityConfiguration>(() =>
    normalizeSecurityConfiguration(config.app?.security)
  );
  const [mobile, setMobile] = useState<MobileConfiguration>(() =>
    normalizeMobileConfiguration(config.app?.mobile)
  );
  const [webOptimization, setWebOptimization] = useState<WebOptimizationConfiguration>(() =>
    normalizeWebOptimizationConfiguration(config.app?.webOptimization)
  );
  const [crash, setCrash] = useState<CrashConfiguration>(() =>
    normalizeCrashConfiguration(config.app?.crash)
  );
  const [savingCrash, setSavingCrash] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [pluginNetwork, setPluginNetwork] = useState<readonly NetworkPluginAllowlistEntry[]>([]);
  const [savingEncrypt, setSavingEncrypt] = useState(false);
  const [savingMobile, setSavingMobile] = useState(false);
  const [savingWeb, setSavingWeb] = useState<keyof WebOptimizationConfiguration | null>(null);

  /**
   * Move the project between the three positions.
   *
   * The allowlist entries are kept whichever position is chosen. An author who widens to any
   * host, or switches the network off while testing something, has not said the list was
   * wrong; losing it on the way past would make the narrow position a thing worth avoiding.
   */
  const setNetworkPolicy = useCallback(
    async (value: string | number) => {
      if (savingPolicy) {
        return;
      }
      const previous = network;
      setSavingPolicy(true);
      const policy = normalizeNetworkAccessPolicy(value);
      setNetwork((current) => ({ ...current, policy, allowHttp: policy !== NETWORK_POLICY_OFF }));
      try {
        const updated = await projectService.updateNetworkConfiguration({ policy });
        setNetwork(normalizeNetworkConfiguration(updated.app?.network));
        onConfigChange(updated);
      } catch (error) {
        setNetwork(previous);
        uiService?.showNotification(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        setSavingPolicy(false);
      }
    },
    [network, onConfigChange, projectService, savingPolicy, uiService]
  );

  const commitAllowlist = useCallback(
    (allowlist: string[]) => {
      setNetwork((current) => ({ ...current, allowlist }));
      void projectService
        .updateNetworkConfiguration({ allowlist })
        .then((updated) => {
          setNetwork(normalizeNetworkConfiguration(updated.app?.network));
          onConfigChange(updated);
        })
        .catch((error) => {
          uiService?.showNotification(
            error instanceof Error ? error.message : String(error),
            "error"
          );
        });
    },
    [onConfigChange, projectService, uiService]
  );

  // What the installed plugins declare, read once: the panel shows them so the list answers
  // "where does my game connect" completely, and nothing here can change them.
  useEffect(() => {
    let cancelled = false;
    void getInterface()
      .plugins.list()
      .then((result) => {
        if (cancelled || !result.success) {
          return;
        }
        setPluginNetwork(
          result.data.plugins
            .filter((plugin) => (plugin.manifest.contributes?.network ?? []).length > 0)
            .map((plugin) => ({
              pluginId: plugin.manifest.id,
              patterns: [...(plugin.manifest.contributes?.network ?? [])]
            }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCrashPolicy = useCallback(
    async (next: string | number) => {
      if (savingCrash) {
        return;
      }
      const previous = crash;
      setSavingCrash(true);
      setCrash(normalizeCrashConfiguration({ policy: next }));
      try {
        const updated = await projectService.updateCrashConfiguration(
          normalizeCrashConfiguration({ policy: next })
        );
        setCrash(normalizeCrashConfiguration(updated.app?.crash));
        onConfigChange(updated);
      } catch (error) {
        setCrash(previous);
        uiService?.showNotification(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        setSavingCrash(false);
      }
    },
    [crash, onConfigChange, projectService, savingCrash, uiService]
  );

  const setEncryptAssets = useCallback(
    async (next: boolean) => {
      if (savingEncrypt) {
        return;
      }
      const previous = security;
      setSavingEncrypt(true);
      setSecurity((current) => ({ ...current, encryptAssets: next }));
      try {
        const updated = await projectService.updateSecurityConfiguration({ encryptAssets: next });
        setSecurity(normalizeSecurityConfiguration(updated.app?.security));
        onConfigChange(updated);
      } catch (error) {
        setSecurity(previous);
        uiService?.showNotification(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        setSavingEncrypt(false);
      }
    },
    [security, onConfigChange, projectService, savingEncrypt, uiService]
  );

  // One writer for the whole Mobile group: every row is the same optimistic-write-then-reconcile,
  // and four copies of it would be four places to forget the rollback.
  const commitMobile = useCallback(
    async (patch: Partial<MobileConfiguration>) => {
      if (savingMobile) {
        return;
      }
      const previous = mobile;
      setSavingMobile(true);
      setMobile((current) => ({ ...current, ...patch }));
      try {
        const updated = await projectService.updateMobileConfiguration(patch);
        setMobile(normalizeMobileConfiguration(updated.app?.mobile));
        onConfigChange(updated);
      } catch (error) {
        setMobile(previous);
        uiService?.showNotification(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        setSavingMobile(false);
      }
    },
    [mobile, onConfigChange, projectService, savingMobile, uiService]
  );

  const commitWebOptimization = useCallback(
    async (
      field: keyof WebOptimizationConfiguration,
      patch: Partial<WebOptimizationConfiguration>
    ) => {
      if (savingWeb) {
        return;
      }
      const previous = webOptimization;
      setSavingWeb(field);
      setWebOptimization((current) => ({ ...current, ...patch }));
      try {
        const updated = await projectService.updateWebOptimizationConfiguration(patch);
        setWebOptimization(normalizeWebOptimizationConfiguration(updated.app?.webOptimization));
        onConfigChange(updated);
      } catch (error) {
        setWebOptimization(previous);
        uiService?.showNotification(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        setSavingWeb(null);
      }
    },
    [onConfigChange, projectService, savingWeb, uiService, webOptimization]
  );

  const orientationOptions: SelectOption[] = useMemo(
    () =>
      MOBILE_ORIENTATIONS.map((orientation) => ({
        value: orientation,
        label: t(`project.settings.orientation.${orientation}`)
      })),
    [t]
  );

  const fitOptions: SelectOption[] = useMemo(
    () =>
      MOBILE_VIEWPORT_FITS.map((value) => ({
        value,
        label: t(`project.settings.stageFit.${value}`)
      })),
    [t]
  );

  const cropAnchorXOptions: SelectOption[] = useMemo(
    () =>
      MOBILE_CROP_ANCHORS_X.map((value) => ({
        value,
        label: t(`project.settings.cropAnchorX.${value}`)
      })),
    [t]
  );

  const crashPolicyOptions: SelectOption[] = useMemo(
    () =>
      GAME_CRASH_POLICIES.map((value) => ({
        value,
        label: t(`project.settings.crashPolicy.${value}`)
      })),
    [t]
  );

  const networkPolicyOptions: SelectOption[] = useMemo(
    () =>
      NETWORK_ACCESS_POLICIES.map((value) => ({
        value,
        label: t(`project.settings.networkPolicy.${value}` as TranslationKey)
      })),
    [t]
  );

  const cropAnchorYOptions: SelectOption[] = useMemo(
    () =>
      MOBILE_CROP_ANCHORS_Y.map((value) => ({
        value,
        label: t(`project.settings.cropAnchorY.${value}`)
      })),
    [t]
  );

  return (
    <div className="grid gap-3 [&>*]:min-w-0">
      <SettingsGroup
        title={t("project.group.security")}
        helpTopic="assetProtection"
        trailing={<HelpTrigger topic="assetProtection" />}
      >
        <SettingStack
          title={t("project.settings.networkPolicyTitle")}
          description={t(
            `project.settings.networkPolicyDetail.${network.policy}` as TranslationKey
          )}
          hint={t("project.settings.networkPolicyWebHint")}
          tooltip={freeze.writes(savingPolicy)["data-tip"]}
        >
          <Select
            size="sm"
            value={network.policy}
            options={networkPolicyOptions}
            disabled={freeze.writes(savingPolicy).disabled}
            ariaLabel={t("project.settings.networkPolicyTitle")}
            onChange={(value) => void setNetworkPolicy(value)}
          />
        </SettingStack>
        {/* The matching rules sit on the hint beside the title, where an author reads them
                    while typing a row; the fuller answer is the `networkAllowlist` topic on F1. */}
        {network.policy === NETWORK_POLICY_ALLOWLIST ? (
          <SettingStack
            title={t("project.settings.networkAllowlist.title")}
            description={t("project.settings.networkAllowlist.description")}
            hint={t("project.settings.networkAllowlist.matchHint")}
            helpTopic="networkAllowlist"
          >
            <NetworkAllowlistField
              entries={network.allowlist}
              pluginEntries={pluginNetwork}
              disabled={false}
              onCommit={commitAllowlist}
            />
          </SettingStack>
        ) : null}
        <SettingRow
          title={t("project.settings.encryptAssetsTitle")}
          description={t("project.settings.encryptAssetsDescription")}
          hint={t("project.settings.encryptAssetsWebHint")}
          checked={security.encryptAssets}
          loading={savingEncrypt}
          onChange={(value) => void setEncryptAssets(value)}
        />
      </SettingsGroup>

      {/* Next to Security rather than after Optimization: both are about whether what ships can
                be trusted, and the two questions read as one block. It renders its own SettingsGroup,
                so it is a direct child of this grid - which is what the hairline between parts keys
                off (see SettingsGroup). */}
      <ProjectSigningSection {...props} />

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
          onChange={(value) =>
            void commitWebOptimization("losslessImages", { losslessImages: value })
          }
        />
        <SettingRow
          title={t("project.settings.webPrecompressTitle")}
          description={t("project.settings.webPrecompressDescription")}
          hint={t("project.settings.webPrecompressHint")}
          checked={webOptimization.precompress}
          loading={savingWeb === "precompress"}
          onChange={(value) => void commitWebOptimization("precompress", { precompress: value })}
        />
        <SettingRow
          title={t("project.settings.webLossyImagesTitle")}
          description={t("project.settings.webLossyImagesDescription")}
          hint={t("project.settings.webSharedWithMobileHint")}
          checked={webOptimization.lossyImages}
          loading={savingWeb === "lossyImages"}
          onChange={(value) => void commitWebOptimization("lossyImages", { lossyImages: value })}
        />
        <SettingShell
          title={t("project.settings.webLossyQualityTitle")}
          description={t("project.settings.webLossyQualityDescription")}
          tooltip={freeze.writes()["data-tip"]}
        >
          <NumberField
            value={webOptimization.lossyQuality}
            min={WEB_LOSSY_QUALITY_MIN}
            max={WEB_LOSSY_QUALITY_MAX}
            disabled={
              freeze.writes(!webOptimization.lossyImages || savingWeb === "lossyQuality").disabled
            }
            ariaLabel={t("project.settings.webLossyQualityTitle")}
            onCommit={(value) =>
              void commitWebOptimization("lossyQuality", { lossyQuality: value })
            }
          />
        </SettingShell>
      </SettingsGroup>

      {/* The one part of this page a player can end up looking at, so it gets a heading of
                its own rather than being filed under Security because a stack trace is sensitive.
                What is being chosen is who the build is for, not how much to hide. */}
      <SettingsGroup title={t("project.group.crash")}>
        <SettingShell
          title={t("project.settings.crashPolicyTitle")}
          description={t("project.settings.crashPolicyDescription")}
          tooltip={freeze.writes(savingCrash)["data-tip"]}
        >
          <Select
            options={crashPolicyOptions}
            value={crash.policy}
            disabled={freeze.writes(savingCrash).disabled}
            onChange={(value) => void setCrashPolicy(value)}
            ariaLabel={t("project.settings.crashPolicyTitle")}
          />
        </SettingShell>
      </SettingsGroup>

      {/* Neither security nor size, and a heading of its own rather than filed under whichever
                of the two it is closer to. The phone-only questions land here. */}
      <SettingsGroup title={t("project.group.mobile")}>
        <SettingShell
          title={t("project.settings.orientationTitle")}
          description={t("project.settings.orientationDescription")}
          tooltip={freeze.writes(savingMobile)["data-tip"]}
        >
          <Select
            options={orientationOptions}
            value={mobile.orientation}
            disabled={freeze.writes(savingMobile).disabled}
            onChange={(value) => void commitMobile({ orientation: value as MobileOrientation })}
            size="sm"
            portalMenu
            className="w-32 shrink-0"
            ariaLabel={t("project.settings.orientationTitle")}
          />
        </SettingShell>
        <SettingShell
          title={t("project.settings.stageFitTitle")}
          description={t("project.settings.stageFitDescription")}
          tooltip={freeze.writes(savingMobile)["data-tip"]}
        >
          <Select
            options={fitOptions}
            value={mobile.fit}
            disabled={freeze.writes(savingMobile).disabled}
            onChange={(value) => void commitMobile({ fit: value as MobileViewportFit })}
            size="sm"
            portalMenu
            className="w-32 shrink-0"
            ariaLabel={t("project.settings.stageFitTitle")}
          />
        </SettingShell>
        {/* Only under `cover`: with letterboxing nothing is cropped, so an anchor here would be
                    a control that cannot do anything — the failure mode this feature already had once.
                    Two rows rather than one because exactly one axis overflows and which one depends
                    on the handset: a phone in landscape crops vertically, a 4:3 tablet horizontally. */}
        {mobile.fit === "cover" ? (
          <>
            <SettingShell
              title={t("project.settings.cropAnchorYTitle")}
              description={t("project.settings.cropAnchorYDescription")}
              tooltip={freeze.writes(savingMobile)["data-tip"]}
            >
              <Select
                options={cropAnchorYOptions}
                value={mobile.cropAnchorY}
                disabled={freeze.writes(savingMobile).disabled}
                onChange={(value) => void commitMobile({ cropAnchorY: value as MobileCropAnchorY })}
                size="sm"
                portalMenu
                className="w-32 shrink-0"
                ariaLabel={t("project.settings.cropAnchorYTitle")}
              />
            </SettingShell>
            <SettingShell
              title={t("project.settings.cropAnchorXTitle")}
              description={t("project.settings.cropAnchorXDescription")}
              tooltip={freeze.writes(savingMobile)["data-tip"]}
            >
              <Select
                options={cropAnchorXOptions}
                value={mobile.cropAnchorX}
                disabled={freeze.writes(savingMobile).disabled}
                onChange={(value) => void commitMobile({ cropAnchorX: value as MobileCropAnchorX })}
                size="sm"
                portalMenu
                className="w-32 shrink-0"
                ariaLabel={t("project.settings.cropAnchorXTitle")}
              />
            </SettingShell>
          </>
        ) : null}
      </SettingsGroup>
    </div>
  );
}
