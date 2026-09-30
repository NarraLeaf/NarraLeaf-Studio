import type { ComponentType } from "react";
import type { SettingPanelId } from "@/lib/settings/models";
import { KeybindingsPanel } from "./KeybindingsPanel";
import { DownloadSourcesPanel } from "./DownloadSourcesPanel";
import { CacheInventoryPanel } from "./CacheInventoryPanel";
import { SettingsTransferPanel } from "./SettingsTransferPanel";
import { SoftwareUpdatePanel } from "./SoftwareUpdatePanel";
import { ServersPanel } from "./ServersPanel";
import { DictionariesPanel } from "./DictionariesPanel";
import { ProjectTrustPanel } from "./ProjectTrustPanel";

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
    servers: ServersPanel,
    dictionaries: DictionariesPanel,
    projectTrust: ProjectTrustPanel,
};

export { KeybindingsPanel } from "./KeybindingsPanel";
export { DownloadSourcesPanel } from "./DownloadSourcesPanel";
export { CacheInventoryPanel } from "./CacheInventoryPanel";
export { SettingsTransferPanel } from "./SettingsTransferPanel";
export { SoftwareUpdatePanel } from "./SoftwareUpdatePanel";
export { ServersPanel } from "./ServersPanel";
// Adding a server is a dialog rather than part of the panel, so any surface that wants to
// offer it - the launcher's Servers tab, a project pointed at a server nobody has signed
// in to - mounts this one instead of writing a second sequence.
export { AddServerModal, passwordSignInUnavailable } from "./AddServerModal";
export type {
    AddServerModalProps,
    PasswordSignIn,
    PasswordSignInOutcome,
    PasswordSignInProblem,
    PasswordSignInRequest,
} from "./AddServerModal";
export { DictionariesPanel } from "./DictionariesPanel";
export { ProjectTrustPanel } from "./ProjectTrustPanel";
