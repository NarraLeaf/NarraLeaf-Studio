import { StatusBarAlignment } from "@/lib/workspace/services/ui/types";
import type { StatusBarEntryModule } from "../types";
import {
    BuildEntry,
    DevModeEntry,
    NotificationsEntry,
    PreviewEntry,
    ShortcutsEntry,
    ThemeEntry,
    UnsavedChangesEntry,
    WordCountEntry,
    ZoomEntry,
} from "./entries";

export { StatusEntry } from "./StatusEntry";

/**
 * The built-in status bar entries, in **registration order**.
 *
 * Registration order is what places an entry: the first entry registered for a side sits against
 * that side's outer edge, and each later one is packed further *inward*, toward the middle of the
 * bar. Items registered at runtime through `StatusBarService` join the end of the list, so plugin
 * entries land closest to the centre. Users can hide entries but cannot reorder them - the
 * positions are a property of the registry, not a preference.
 *
 * Concretely: left entries render in this order left-to-right, and right entries render in the
 * reverse of this order (`ShortcutsEntry` is declared first, so it pins to the far right corner).
 * See {@link orderStatusBarEntries}.
 */
export const builtInStatusBarEntries: StatusBarEntryModule[] = [
    {
        id: "narraleaf-studio:status-bar/dev-mode",
        labelKey: "workspace.shell.statusBar.entries.devMode",
        alignment: StatusBarAlignment.Left,
        component: DevModeEntry,
    },
    {
        id: "narraleaf-studio:status-bar/preview",
        labelKey: "workspace.shell.statusBar.entries.preview",
        alignment: StatusBarAlignment.Left,
        component: PreviewEntry,
    },
    {
        id: "narraleaf-studio:status-bar/build",
        labelKey: "workspace.shell.statusBar.entries.build",
        alignment: StatusBarAlignment.Left,
        component: BuildEntry,
    },
    {
        id: "narraleaf-studio:status-bar/unsaved-changes",
        labelKey: "workspace.shell.statusBar.entries.unsavedChanges",
        alignment: StatusBarAlignment.Left,
        component: UnsavedChangesEntry,
    },
    {
        id: "narraleaf-studio:status-bar/word-count",
        labelKey: "workspace.shell.statusBar.entries.wordCount",
        alignment: StatusBarAlignment.Left,
        component: WordCountEntry,
    },
    {
        id: "narraleaf-studio:status-bar/shortcuts",
        labelKey: "workspace.shell.statusBar.entries.shortcuts",
        alignment: StatusBarAlignment.Right,
        component: ShortcutsEntry,
    },
    {
        id: "narraleaf-studio:status-bar/notifications",
        labelKey: "workspace.shell.statusBar.entries.notifications",
        alignment: StatusBarAlignment.Right,
        component: NotificationsEntry,
    },
    {
        id: "narraleaf-studio:status-bar/theme",
        labelKey: "workspace.shell.statusBar.entries.theme",
        alignment: StatusBarAlignment.Right,
        component: ThemeEntry,
    },
    {
        id: "narraleaf-studio:status-bar/zoom",
        labelKey: "workspace.shell.statusBar.entries.zoom",
        alignment: StatusBarAlignment.Right,
        component: ZoomEntry,
    },
];
