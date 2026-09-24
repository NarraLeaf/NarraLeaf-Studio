import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The copy itself is recorded rather than run: what is under test is which folder it is aimed at.
const { scaffoldProjectFromTemplate } = vi.hoisted(() => ({
    scaffoldProjectFromTemplate: vi.fn(
        async (..._args: unknown[]): Promise<{ locales: string[]; dependencies: string[] }> =>
            ({ locales: [], dependencies: [] }),
    ),
}));
vi.mock("electron", () => ({}));
vi.mock("../../projectTemplates", () => ({ scaffoldProjectFromTemplate, listProjectTemplates: vi.fn() }));

const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { ProjectTemplateScaffoldHandler } = await import("./projectTemplateAction");

type AppWindowLike = Parameters<InstanceType<typeof ProjectTemplateScaffoldHandler>["handle"]>[0];

const created = path.resolve("/projects/new-game");
const somebodyElses = path.resolve("/projects/theirs");

type InstalledPluginLike = { pluginId: string; builtIn: boolean; enabled: boolean };

/** A window with the given project (or none), holding a write grant over exactly `writable`. */
function makeWindow(options: {
    projectPath?: string;
    writable: string[];
    installed?: InstalledPluginLike[];
}): AppWindowLike {
    const app = {
        resolveResource: (relative: string) => relative,
        storageManager: {
            isPathAllowed: async (_window: unknown, fsPath: string, mode: string) =>
                mode === "write" && options.writable.includes(fsPath),
        },
        pluginManager: {
            listPlugins: async () => options.installed ?? [],
            setPluginEnabled,
        },
        refreshPluginLocales: () => undefined,
    };
    return {
        app,
        getApp: () => app,
        getProps: () => (options.projectPath === undefined ? {} : { projectPath: options.projectPath }),
    } as unknown as AppWindowLike;
}

const setPluginEnabled = vi.fn(async (_pluginId: string, _enabled: boolean) => undefined);

beforeEach(() => {
    scaffoldProjectFromTemplate.mockClear();
    setPluginEnabled.mockClear();
    scaffoldProjectFromTemplate.mockImplementation(async () => ({ locales: [], dependencies: [] }));
});

/**
 * Laying a bundled template's documents into a folder.
 *
 * Only the project wizard asks, about the folder it is creating - and it has no project of its own,
 * so the window's project cannot be the rule. The folder has to be one the window was granted to
 * write, which the wizard's new folder is; without that, any window could lay a template's
 * documents over another project's own.
 */
describe("ProjectTemplateScaffoldHandler", () => {
    it("scaffolds the folder the wizard is creating", async () => {
        const result = await new ProjectTemplateScaffoldHandler().handle(
            makeWindow({ writable: [created] }),
            { templateId: "skeleton", projectPath: created, locale: "en" },
        );

        expect(result.success).toBe(true);
        expect(scaffoldProjectFromTemplate.mock.calls[0][2]).toBe(created);
    });

    it("refuses a folder the window was not granted to write", async () => {
        const result = await new ProjectTemplateScaffoldHandler().handle(
            makeWindow({ writable: [created] }),
            { templateId: "skeleton", projectPath: somebodyElses, locale: "en" },
        );

        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(scaffoldProjectFromTemplate).not.toHaveBeenCalled();
    });

    /**
     * Asking for a template is asking for what it is made of. Two of the bundled plugins ship
     * switched off, so a project made from a template built on one used to open on a warning about
     * a plugin nobody had touched.
     */
    it("switches on a built-in plugin the template's content depends on", async () => {
        scaffoldProjectFromTemplate.mockImplementation(async () => ({
            locales: [],
            dependencies: ["narraleaf.gallery"],
        }));

        await new ProjectTemplateScaffoldHandler().handle(
            makeWindow({
                writable: [created],
                installed: [{ pluginId: "narraleaf.gallery", builtIn: true, enabled: false }],
            }),
            { templateId: "skeleton", projectPath: created, locale: "en" },
        );

        expect(setPluginEnabled).toHaveBeenCalledWith("narraleaf.gallery", true);
    });

    /** Somebody else's code stays where the author left it, and an installed switch is not thrown twice. */
    it("leaves a third-party plugin, an absent one and one already on alone", async () => {
        scaffoldProjectFromTemplate.mockImplementation(async () => ({
            locales: [],
            dependencies: ["third.party", "narraleaf.gallery", "not.installed"],
        }));

        await new ProjectTemplateScaffoldHandler().handle(
            makeWindow({
                writable: [created],
                installed: [
                    { pluginId: "third.party", builtIn: false, enabled: false },
                    { pluginId: "narraleaf.gallery", builtIn: true, enabled: true },
                ],
            }),
            { templateId: "skeleton", projectPath: created, locale: "en" },
        );

        expect(setPluginEnabled).not.toHaveBeenCalled();
    });

    it("refuses a window with a project any folder but that project", async () => {
        const result = await new ProjectTemplateScaffoldHandler().handle(
            makeWindow({ projectPath: created, writable: [created, somebodyElses] }),
            { templateId: "skeleton", projectPath: somebodyElses, locale: "en" },
        );

        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(scaffoldProjectFromTemplate).not.toHaveBeenCalled();
    });
});
