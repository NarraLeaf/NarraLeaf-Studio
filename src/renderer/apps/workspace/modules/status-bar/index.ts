import { StatusBarAlignment } from "@/lib/workspace/services/ui/types";
import type { StatusBarEntryModule } from "../types";
import {
    NotificationsEntry,
    RunStatusEntry,
    ShortcutsEntry,
    ThemeEntry,
    SaveStatusEntry,
    VersionEntry,
    WordCountEntry,
    ZoomEntry,
} from "./entries";
import {
    TextEncodingEntry,
    TextFileNameEntry,
    TextLineEndingEntry,
    TextSelectionEntry,
} from "./textDocumentEntries";

export { StatusEntry, StatusBarEntryIdContext, StatusBarRunningContext } from "./StatusEntry";
export { useActiveRunMode } from "./useActiveRunMode";

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
        id: "narraleaf-studio:status-bar/run-status",
        labelKey: "workspace.shell.statusBar.entries.runStatus",
        alignment: StatusBarAlignment.Left,
        component: RunStatusEntry,
    },
    {
        // Id kept from when this cell only watched the story service: it is persisted in the user's
        // status-bar visibility preferences, and renaming it would silently un-hide the cell for
        // anyone who had hidden it.
        id: "narraleaf-studio:status-bar/unsaved-changes",
        labelKey: "workspace.shell.statusBar.entries.unsavedChanges",
        alignment: StatusBarAlignment.Left,
        component: SaveStatusEntry,
    },
    {
        id: "narraleaf-studio:status-bar/word-count",
        labelKey: "workspace.shell.statusBar.entries.wordCount",
        alignment: StatusBarAlignment.Left,
        component: WordCountEntry,
    },
    {
        // After the word count, so the version sits inboard of the writing readout: which version you
        // are in matters less often than what you are writing, and the outer edge belongs to the
        // thing the eye returns to.
        id: "narraleaf-studio:status-bar/version",
        labelKey: "workspace.shell.statusBar.entries.version",
        alignment: StatusBarAlignment.Left,
        component: VersionEntry,
    },
    {
        // Last on the left, so the file being edited sits at the cluster's inboard end - next to the
        // middle of the bar, where the eye is already looking for what is happening right now. It is
        // also silent unless a text tab has focus, so the cells outboard of it never move.
        id: "narraleaf-studio:status-bar/text-file-name",
        labelKey: "workspace.shell.statusBar.entries.textFileName",
        alignment: StatusBarAlignment.Left,
        component: TextFileNameEntry,
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
    // The three text-document cells, last on the right and therefore closest to the centre - the
    // reverse of the array, so they read (from the middle outwards) selection, line ending, encoding.
    // They are together and inboard because they belong to one document and because they are the
    // only cells here an author reaches for while typing; the window-level controls (zoom, theme,
    // notifications, shortcuts) stay pinned to the corner where they have always been.
    {
        id: "narraleaf-studio:status-bar/text-encoding",
        labelKey: "workspace.shell.statusBar.entries.textEncoding",
        alignment: StatusBarAlignment.Right,
        component: TextEncodingEntry,
    },
    {
        id: "narraleaf-studio:status-bar/text-line-ending",
        labelKey: "workspace.shell.statusBar.entries.textLineEnding",
        alignment: StatusBarAlignment.Right,
        component: TextLineEndingEntry,
    },
    {
        id: "narraleaf-studio:status-bar/text-selection",
        labelKey: "workspace.shell.statusBar.entries.textSelection",
        alignment: StatusBarAlignment.Right,
        component: TextSelectionEntry,
    },
];
