// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { PluginDetailsPage } from "./PluginDetailsPage";
import type { PluginActivity } from "./useWorkspacePluginActivity";

/**
 * Which actions one plugin's page offers, in each state a plugin can be in.
 *
 * The rule being pinned is one rule: a control on this page does something when it is pressed.
 * Reload is the one that broke it - the loader refuses a plugin this project holds back, so the
 * action ran, reported success and changed nothing - and the states around it are asserted with it,
 * because "offered here, not offered there" is the whole of the decision and it is easy to widen by
 * accident.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    // The keys, so the assertions read as "this action is offered" rather than as a snapshot of one
    // language's wording.
    useTranslation: () => ({ t: (key: string) => key, has: () => false, tn: (key: string) => key, locale: "en" }),
}));

// The body says what the plugin IS; this page's own question is what it offers. Stubbed to the one
// thing the page puts inside it - the note about what the plugin is doing in this window.
vi.mock("@/lib/plugins/ui/PluginDetailsBody", () => ({
    PluginDetailsBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/renderApp", () => ({ getAppInfo: () => ({ version: "1.0.0" }) }));

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
    return {
        pluginId: "narraleaf.gallery",
        manifest: { name: "Gallery", version: "3.1.0", entries: { studio: "studio.js" }, permissions: [] },
        installPath: "/plugins/gallery",
        enabled: true,
        builtIn: false,
        status: "enabled",
        installedAt: 0,
        updatedAt: 0,
        grantedManifestVersion: "3.1.0",
        ...overrides,
    } as PluginListItem;
}

const PUBLISHED: PluginRegistryEntry = {
    id: "narraleaf.gallery",
    name: "Gallery",
    version: "3.1.0",
    description: "",
    publisher: "narraleaf",
    targets: ["studio"],
    categories: [],
    keywords: [],
    license: "MIT",
    permissions: [],
    release: { tag: "narraleaf.gallery@3.1.0", page: "", download: "" },
};

function open(options: {
    installed?: PluginListItem | null;
    registryEntry?: PluginRegistryEntry | null;
    activity: PluginActivity | null;
    canReload?: boolean;
}) {
    render(
        <PluginDetailsPage
            installed={options.installed === undefined ? plugin() : options.installed}
            registryEntry={options.registryEntry ?? null}
            activity={options.activity}
            loadError={null}
            busy={false}
            task={{ status: "idle" }}
            restartHint={false}
            onRestartWorkspace={() => {}}
            canReload={options.canReload ?? true}
            canUninstall
            onBack={() => {}}
            onAuthorize={() => {}}
            onSetEnabled={() => {}}
            onUninstall={() => {}}
            onInstall={() => {}}
            onReload={() => {}}
            onRetry={() => {}}
        />,
    );
}

const RELOAD = "plugins.workspace.reload";
const RETRY = "common.retry";

afterEach(cleanup);

describe("PluginDetailsPage - which actions it offers", () => {
    it("offers a reload for a plugin that is up, or was and is not", () => {
        for (const activity of ["running", "stopped", "failed"] as const) {
            open({ activity });
            expect(screen.getByText(RELOAD)).toBeTruthy();
            cleanup();
        }
    });

    /**
     * The defect: the hold is applied inside the loader, so a reload of a held plugin unloaded
     * nothing, started nothing and reported that it had reloaded. What releases the hold is Rescan
     * in Project ▸ App, and the page already says so.
     */
    it("offers no reload for a plugin this project holds back, and says what does release it", () => {
        open({ activity: "suppressed" });
        expect(screen.queryByText(RELOAD)).toBeNull();
        expect(screen.getByText("plugins.workspace.activity.suppressedHint")).toBeTruthy();
    });

    it("offers no reload for a plugin that only extends the running game", () => {
        open({ activity: "runtimeOnly" });
        expect(screen.queryByText(RELOAD)).toBeNull();
    });

    it("offers no reload in a window that loads no plugins at all", () => {
        // Recovery: the record is still writable, so the switch stays; nothing here can be started.
        open({ activity: "running", canReload: false });
        expect(screen.queryByText(RELOAD)).toBeNull();
        expect(screen.getByText("common.disable")).toBeTruthy();
    });

    it("offers the grant, and no reload, for a plugin waiting for its permissions", () => {
        open({
            installed: plugin({ status: "needsAuthorization", enabled: false, grantedManifestVersion: null }),
            activity: "off",
        });
        expect(screen.getByText("plugins.authorize")).toBeTruthy();
        expect(screen.queryByText(RELOAD)).toBeNull();
        expect(screen.queryByText("common.enable")).toBeNull();
    });

    /**
     * The second defect of the same shape, and the worse one: the switch used to be read off the
     * status word, which reports a failure ahead of the record's own on/off, so a plugin that threw
     * while starting was offered no control at all. A third-party one could at least be uninstalled
     * and installed again; a built-in one had no way out of the state whatsoever.
     */
    it("offers a plugin whose last load failed a way to try again, and the switch beside it", () => {
        open({ installed: plugin({ status: "error", enabled: true }), activity: "off" });
        expect(screen.getByText(RETRY)).toBeTruthy();
        expect(screen.getByText("common.disable")).toBeTruthy();
        // Nothing is loaded for it in this window, and the loader serves no descriptor for a record
        // that carries a failure, so a reload would have nothing to fetch.
        expect(screen.queryByText(RELOAD)).toBeNull();
    });

    it("offers a failed plugin that is switched off the switch alone", () => {
        // Enable clears the recorded failure on its way past, so it is the way back already; a retry
        // beside it would be the same press under another name. The record reads `disabled` once the
        // author has switched it off, the failure staying on it as the reason the last load ended.
        open({ installed: plugin({ status: "disabled", enabled: false, lastError: "setup threw" }), activity: "off" });
        expect(screen.getByText("common.enable")).toBeTruthy();
        expect(screen.queryByText(RETRY)).toBeNull();
    });

    it("offers no reload for a failed record this window has not caught up with", () => {
        // The moment after a retry throws again: the session says the load failed, and the record
        // says so too, but the list was read before the attempt. Reload would be refused.
        open({ installed: plugin({ status: "error", enabled: true }), activity: "failed" });
        expect(screen.queryByText(RELOAD)).toBeNull();
        expect(screen.getByText(RETRY)).toBeTruthy();
    });

    it("offers no retry in a window that loads no plugins at all", () => {
        // Recovery: the record stays writable, so the switch stays; nothing here can be started, and
        // a retry that only cleared the record would report a start that never happened.
        open({ installed: plugin({ status: "error", enabled: true }), activity: "off", canReload: false });
        expect(screen.queryByText(RETRY)).toBeNull();
        expect(screen.getByText("common.disable")).toBeTruthy();
    });

    it("offers only the install for a plugin this machine has not got", () => {
        open({ installed: null, registryEntry: PUBLISHED, activity: null });
        expect(screen.getByText("plugins.store.install")).toBeTruthy();
        for (const absent of [RELOAD, "plugins.authorize", "common.enable", "plugins.uninstall"]) {
            expect(screen.queryByText(absent)).toBeNull();
        }
    });
});
