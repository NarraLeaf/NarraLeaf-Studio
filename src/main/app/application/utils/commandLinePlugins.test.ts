import { describe, expect, it, vi } from "vitest";
import {
    enableCommandLinePlugins,
    resolveCommandLinePlugins,
    type CommandLinePluginCandidate,
} from "./commandLinePlugins";

/**
 * Which installed plugin a `--lint-plugin` (or `--test-plugin`, `--build-plugin`) value means, and
 * which values end the run instead.
 *
 * The profile a CI job runs in is usually a fresh one, where the built-in Gallery and Menu Bar are
 * installed and switched off - so those are the cases that matter most. Every refusal names what the
 * line asked for in words a person can act on, and never a generated id.
 */
function plugin(overrides: Partial<CommandLinePluginCandidate> & { name?: string; version?: string } = {}): CommandLinePluginCandidate {
    const { name = "Gallery", version = "3.1.0", ...rest } = overrides;
    return {
        pluginId: "narraleaf.gallery",
        status: "disabled",
        grantedManifestVersion: version,
        manifest: { name, version },
        ...rest,
    } as CommandLinePluginCandidate;
}

/** What a fresh profile has: every built-in, granted, with the two authoring surfaces switched off. */
const FRESH_PROFILE: CommandLinePluginCandidate[] = [
    plugin(),
    plugin({ pluginId: "narraleaf.menu-bar", name: "Menu Bar", version: "1.0.0" }),
    plugin({ pluginId: "narraleaf.quick-save", name: "Quick Save", version: "1.0.0", status: "enabled" }),
];

const resolve = (...requested: string[]) => resolveCommandLinePlugins({
    requested,
    installed: FRESH_PROFILE,
    flag: "--lint-plugin",
});

describe("resolveCommandLinePlugins", () => {
    it("finds a plugin by the name Studio shows for it, without regard to case", () => {
        expect(resolve("gallery")).toEqual({
            ok: true,
            plugins: [{ id: "narraleaf.gallery", name: "Gallery", version: "3.1.0", enabledForRun: true }],
        });
        expect(resolve("  MENU BAR ")).toMatchObject({ ok: true, plugins: [{ id: "narraleaf.menu-bar", name: "Menu Bar" }] });
    });

    it("finds a plugin by its manifest id", () => {
        expect(resolve("narraleaf.gallery")).toMatchObject({ ok: true, plugins: [{ id: "narraleaf.gallery", name: "Gallery" }] });
    });

    it("keeps the order the line named them in, and each plugin once", () => {
        const resolved = resolve("Menu Bar", "Gallery", "narraleaf.gallery", "menu bar");

        expect(resolved).toMatchObject({ ok: true });
        expect(resolved.ok && resolved.plugins.map(entry => entry.id)).toEqual(["narraleaf.menu-bar", "narraleaf.gallery"]);
    });

    it("says which plugins the line switched on and which the profile already ran", () => {
        const resolved = resolve("Gallery", "Quick Save");

        expect(resolved.ok && resolved.plugins.map(entry => [entry.name, entry.enabledForRun])).toEqual([
            ["Gallery", true],
            ["Quick Save", false],
        ]);
    });

    it("switches on a plugin held back since it last failed to start, which the line gives a fresh start", () => {
        const resolved = resolveCommandLinePlugins({
            requested: ["Gallery"],
            installed: [plugin({ status: "error" })],
            flag: "--lint-plugin",
        });

        expect(resolved).toMatchObject({ ok: true, plugins: [{ enabledForRun: true }] });
    });

    it("refuses a name no installed plugin has, and lists the names it does have", () => {
        expect(resolve("Nope")).toEqual({
            ok: false,
            reason: 'This profile has no plugin "Nope" (--lint-plugin). It has: "Gallery", "Menu Bar", "Quick Save".',
        });
        expect(resolveCommandLinePlugins({ requested: ["Gallery"], installed: [], flag: "--build-plugin" })).toEqual({
            ok: false,
            reason: 'This profile has no plugin "Gallery" (--build-plugin). It has none installed.',
        });
    });

    it("refuses a name two installed plugins share, and asks for the id", () => {
        const resolved = resolveCommandLinePlugins({
            requested: ["stats"],
            installed: [
                plugin({ pluginId: "acme.stats", name: "Stats", version: "1.2.0" }),
                plugin({ pluginId: "beta.stats", name: "Stats", version: "2.0.0" }),
            ],
            flag: "--test-plugin",
        });

        expect(resolved).toEqual({
            ok: false,
            reason: 'Two plugins in this profile are called "stats" (--test-plugin): "Stats" 1.2.0 (acme.stats)'
                + ' and "Stats" 2.0.0 (beta.stats). Name the one this run needs by its id, as --test-plugin=acme.stats.',
        });
        // Which the id then does.
        expect(resolveCommandLinePlugins({
            requested: ["beta.stats"],
            installed: [
                plugin({ pluginId: "acme.stats", name: "Stats", version: "1.2.0" }),
                plugin({ pluginId: "beta.stats", name: "Stats", version: "2.0.0" }),
            ],
            flag: "--test-plugin",
        })).toMatchObject({ ok: true, plugins: [{ id: "beta.stats", version: "2.0.0" }] });
    });

    it("prefers the id when one plugin's id is another's name", () => {
        const resolved = resolveCommandLinePlugins({
            requested: ["acme.stats"],
            installed: [
                plugin({ pluginId: "other.plugin", name: "acme.stats" }),
                plugin({ pluginId: "acme.stats", name: "Stats" }),
            ],
            flag: "--lint-plugin",
        });

        expect(resolved).toMatchObject({ ok: true, plugins: [{ id: "acme.stats" }] });
    });

    it("refuses a third-party plugin whose permissions this profile never granted, rather than granting them", () => {
        const resolved = resolveCommandLinePlugins({
            requested: ["Stats"],
            installed: [plugin({ pluginId: "acme.stats", name: "Stats", version: "1.2.0", status: "needsAuthorization", grantedManifestVersion: null })],
            flag: "--lint-plugin",
        });

        expect(resolved).toEqual({
            ok: false,
            reason: '"Stats" 1.2.0 (--lint-plugin) needs permissions this profile has not granted, and naming it on'
                + " the command line does not grant them. Grant them once in Studio's plugin list with this"
                + " profile, then run again.",
        });
    });

    it("refuses one granted for an earlier version that asked for less, and one that failed before it was ever granted", () => {
        for (const candidate of [
            plugin({ pluginId: "acme.stats", name: "Stats", version: "2.0.0", status: "needsAuthorization", grantedManifestVersion: "1.2.0" }),
            plugin({ pluginId: "acme.stats", name: "Stats", version: "2.0.0", status: "error", grantedManifestVersion: null }),
        ]) {
            const resolved = resolveCommandLinePlugins({ requested: ["Stats"], installed: [candidate], flag: "--lint-plugin" });

            expect(resolved.ok).toBe(false);
            expect(!resolved.ok && resolved.reason).toContain("needs permissions this profile has not granted");
        }
    });

    it("switches on a third-party plugin the profile granted and then switched off", () => {
        const resolved = resolveCommandLinePlugins({
            requested: ["Stats"],
            installed: [plugin({ pluginId: "acme.stats", name: "Stats", version: "1.2.0", status: "disabled", grantedManifestVersion: "1.2.0" })],
            flag: "--lint-plugin",
        });

        expect(resolved).toMatchObject({ ok: true, plugins: [{ id: "acme.stats", enabledForRun: true }] });
    });
});

describe("enableCommandLinePlugins", () => {
    it("reads nothing and switches nothing on when the line named no plugin", async () => {
        const manager = { listPlugins: vi.fn(), enableForCommandLineRun: vi.fn() };

        await expect(enableCommandLinePlugins(manager, [], "--lint-plugin")).resolves.toEqual({ ok: true, plugins: [] });
        expect(manager.listPlugins).not.toHaveBeenCalled();
        expect(manager.enableForCommandLineRun).not.toHaveBeenCalled();
    });

    it("switches on exactly the plugins the names came to", async () => {
        const manager = {
            listPlugins: vi.fn(async () => FRESH_PROFILE),
            enableForCommandLineRun: vi.fn(async () => undefined),
        };

        const resolved = await enableCommandLinePlugins(manager, ["Gallery", "narraleaf.gallery"], "--lint-plugin");

        expect(resolved.ok).toBe(true);
        expect(manager.enableForCommandLineRun).toHaveBeenCalledWith(["narraleaf.gallery"]);
    });

    it("switches nothing on when any name is refused", async () => {
        const manager = {
            listPlugins: vi.fn(async () => FRESH_PROFILE),
            enableForCommandLineRun: vi.fn(async () => undefined),
        };

        const resolved = await enableCommandLinePlugins(manager, ["Gallery", "Nope"], "--lint-plugin");

        expect(resolved.ok).toBe(false);
        expect(manager.enableForCommandLineRun).not.toHaveBeenCalled();
    });
});
