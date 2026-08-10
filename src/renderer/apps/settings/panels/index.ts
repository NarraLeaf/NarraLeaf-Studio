import type { ComponentType } from "react";
import type { SettingPanelId } from "@/lib/settings/models";
import { KeybindingsPanel } from "./KeybindingsPanel";
import { DownloadSourcesPanel } from "./DownloadSourcesPanel";
import { CacheInventoryPanel } from "./CacheInventoryPanel";
import { SettingsTransferPanel } from "./SettingsTransferPanel";
import { SoftwareUpdatePanel } from "./SoftwareUpdatePanel";

/**
 * Resolves the `panel` id on a `SettingValueType.Custom` entry to the component that renders it.
 * The registry lives here, not in `lib/settings`, so the definitions stay plain data.
 */
export const SETTING_PANELS: Record<SettingPanelId, ComponentType> = {
    keybindings: KeybindingsPanel,
    downloadSources: DownloadSourcesPanel,
    cacheInventory: CacheInventoryPanel,
    settingsTransfer: SettingsTransferPanel,
    softwareUpdate: SoftwareUpdatePanel,
};

export { KeybindingsPanel } from "./KeybindingsPanel";
export { DownloadSourcesPanel } from "./DownloadSourcesPanel";
export { CacheInventoryPanel } from "./CacheInventoryPanel";
export { SettingsTransferPanel } from "./SettingsTransferPanel";
export { SoftwareUpdatePanel } from "./SoftwareUpdatePanel";
