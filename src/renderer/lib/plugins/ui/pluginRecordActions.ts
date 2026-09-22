/**
 * Which of a plugin's own switches a surface offers, read off the installed record.
 *
 * Two surfaces show these controls - the Launcher's plugins tab and the workspace's plugins panel,
 * each as a row and as a details view - and all four have to agree about what a record allows.
 * They used to decide it inline from the status word, which is how a plugin that failed to load
 * ended up with no switch anywhere: `error` hides `enabled` and `disabled` behind it, and every
 * surface read that as "there is nothing to offer". A failed plugin is still switched on or off,
 * and switching it off is the only way to stop a built-in one trying and failing on every open.
 *
 * The one control that is new here is {@link PluginRecordActions.retry}. Clearing a recorded
 * failure is what enabling a plugin does - the record forgets the failure so the loader will serve
 * the plugin again - so the way back for a plugin that is already switched on is to switch it off
 * and then on. That reads as two presses of which the first does nothing the author can see, and
 * it records a choice they did not make: if they stop after the first press, the plugin is now off
 * because they said so. One press that says what it is for leaves the switch meaning what it says.
 */

import type { PluginListItem } from "@shared/types/plugins";

/**
 * Whether this version's permissions have not been granted.
 *
 * The status word answers this too, but only while nothing else is wrong with the record: it
 * reports a failed load ahead of the grant, so a plugin that failed and was then replaced on disk
 * by a version asking for more permissions reads as `error` while the grant is what actually
 * stands in its way. The main process refuses to switch such a plugin on, so what is offered is
 * decided by the same comparison the main process makes rather than by the word.
 */
export function needsPluginAuthorization(plugin: PluginListItem): boolean {
    return plugin.grantedManifestVersion !== plugin.manifest.version;
}

export interface PluginRecordActions {
    /** Ask for the permissions this version has not been granted. */
    authorize: boolean;
    /** The switch, and which way it points. Null while the grant is what stands in the way. */
    toggle: "enable" | "disable" | null;
    /**
     * Forget the recorded failure and start the plugin again in this window.
     *
     * Only ever offered for a plugin that is switched on: one that is switched off already has
     * Enable, which clears the failure on its way past. A load failure can only have come from a
     * studio entry - it is the only one that reports one - so this never appears on a plugin that
     * extends nothing but the running game.
     */
    retry: boolean;
}

/**
 * What one plugin's record lets the author do.
 *
 * `canStart` is false on a surface that runs no plugins of its own - the Launcher, a recovery
 * window, a frozen project - where a retry could only clear the record and would report a start
 * that never happened. The switch stays there: writing the record is the whole change on those
 * surfaces, and it is what the next open reads.
 */
export function pluginRecordActions(plugin: PluginListItem, canStart: boolean): PluginRecordActions {
    if (needsPluginAuthorization(plugin)) {
        return { authorize: true, toggle: null, retry: false };
    }
    return {
        authorize: false,
        toggle: plugin.enabled ? "disable" : "enable",
        retry: canStart && plugin.status === "error" && plugin.enabled,
    };
}
