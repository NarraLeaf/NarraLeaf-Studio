import { describe, expect, it } from "vitest";
import type { PluginListItem, PluginStatus } from "@shared/types/plugins";
import { needsPluginAuthorization, pluginRecordActions } from "./pluginRecordActions";

/**
 * Which switches one plugin's record offers, in every state a record can be in.
 *
 * The rule being pinned is that each state offers a way onwards. `error` is the one that broke it:
 * it hides `enabled` and `disabled` behind it, so reading the switch off the status word left a
 * plugin that failed to load with nothing to press - and a built-in one, which cannot be
 * uninstalled, with no way out of the state at all.
 */

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
    return {
        pluginId: "acme.notes",
        manifest: { name: "Notes", version: "1.0.0", entries: { studio: "studio.js" }, permissions: [] },
        installPath: "/plugins/notes",
        enabled: true,
        builtIn: false,
        status: "enabled",
        installedAt: 0,
        updatedAt: 0,
        grantedManifestVersion: "1.0.0",
        ...overrides,
    } as PluginListItem;
}

describe("pluginRecordActions", () => {
    it("offers the switch the other way round, whatever the record is doing", () => {
        const states: Array<[PluginStatus, boolean]> = [
            ["enabled", true],
            ["disabled", false],
            ["error", true],
            ["error", false],
        ];
        for (const [status, enabled] of states) {
            const actions = pluginRecordActions(plugin({ status, enabled }), true);
            expect(actions.toggle).toBe(enabled ? "disable" : "enable");
            expect(actions.authorize).toBe(false);
        }
    });

    it("offers a way to try a failed plugin again, and only while it is switched on", () => {
        expect(pluginRecordActions(plugin({ status: "error", enabled: true }), true).retry).toBe(true);
        // Switched off, Enable is the way back: it clears the recorded failure on its way past, so a
        // second control beside it would be the same press under another name. That is the record as
        // the main process writes it - a failure is reported only while the plugin is switched on -
        // and the status word is checked as well, for a list read a moment before the switch.
        expect(pluginRecordActions(plugin({ status: "disabled", enabled: false, lastError: "setup threw" }), true).retry)
            .toBe(false);
        expect(pluginRecordActions(plugin({ status: "error", enabled: false }), true).retry).toBe(false);
    });

    it("offers no retry for a plugin that has not failed", () => {
        for (const status of ["enabled", "disabled"] as const) {
            expect(pluginRecordActions(plugin({ status, enabled: status === "enabled" }), true).retry).toBe(false);
        }
    });

    it("offers no retry where nothing can be started, and keeps the switch there", () => {
        // The Launcher, a recovery window, a frozen project: the record is writable and is the whole
        // change, but a retry could only report a start that never happened.
        const actions = pluginRecordActions(plugin({ status: "error", enabled: true }), false);
        expect(actions.retry).toBe(false);
        expect(actions.toggle).toBe("disable");
    });

    it("asks for the grant first, and offers nothing else until it has one", () => {
        const waiting = plugin({ status: "needsAuthorization", enabled: false, grantedManifestVersion: null });
        expect(pluginRecordActions(waiting, true)).toEqual({ authorize: true, toggle: null, retry: false });
    });

    /**
     * The status word reports a failed load ahead of the grant, so a plugin that failed and was then
     * replaced on disk by a version asking for more permissions reads as `error` while the grant is
     * what stands in its way. The main process refuses to switch that plugin on, so neither control
     * may be offered for it.
     */
    it("asks for the grant even when the record is reporting a failure instead", () => {
        const stale = plugin({ status: "error", enabled: true, grantedManifestVersion: "0.9.0" });
        expect(needsPluginAuthorization(stale)).toBe(true);
        expect(pluginRecordActions(stale, true)).toEqual({ authorize: true, toggle: null, retry: false });
    });

    it("treats a record written before grants were tracked as ungranted", () => {
        expect(needsPluginAuthorization(plugin({ grantedManifestVersion: undefined }))).toBe(true);
    });
});
