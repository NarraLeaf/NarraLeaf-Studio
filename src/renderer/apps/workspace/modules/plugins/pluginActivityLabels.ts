import type { TranslationKey } from "@shared/i18n";
import type { PluginActivity } from "./useWorkspacePluginActivity";

/**
 * How each activity reads in a list, and in what colour.
 *
 * `null` means "say nothing": a plugin that is running, and one that is simply switched off, are
 * both already described by the row's badge or by its absence. Only the states that explain a plugin
 * doing nothing when the author expects it to work get words - and the colour goes on the word, not
 * on a dot beside it, for the same reason the dependencies list dropped its dots.
 */
export const ACTIVITY_LABEL_KEYS: Readonly<Record<PluginActivity, TranslationKey | null>> = {
  running: null,
  off: null,
  runtimeOnly: "plugins.workspace.activity.runtimeOnly",
  suppressed: "plugins.workspace.activity.suppressed",
  failed: "plugins.workspace.activity.failed",
  stopped: "plugins.workspace.activity.stopped"
};

export const ACTIVITY_TONES: Readonly<Record<PluginActivity, string>> = {
  running: "text-fg-subtle",
  off: "text-fg-subtle",
  runtimeOnly: "text-fg-subtle",
  suppressed: "text-warning",
  failed: "text-danger",
  stopped: "text-warning"
};
