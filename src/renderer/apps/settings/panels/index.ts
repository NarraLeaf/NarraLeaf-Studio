import type { ComponentType } from "react";
import type { SettingPanelId } from "@/lib/settings/models";
import { KeybindingsPanel } from "./KeybindingsPanel";

/**
 * Resolves the `panel` id on a `SettingValueType.Custom` entry to the component that renders it.
 * The registry lives here, not in `lib/settings`, so the definitions stay plain data.
 */
export const SETTING_PANELS: Record<SettingPanelId, ComponentType> = {
    keybindings: KeybindingsPanel,
};

export { KeybindingsPanel } from "./KeybindingsPanel";
