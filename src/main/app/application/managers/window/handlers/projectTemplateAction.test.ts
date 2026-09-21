import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The copy itself is recorded rather than run: what is under test is which folder it is aimed at.
const { scaffoldProjectFromTemplate } = vi.hoisted(() => ({
    scaffoldProjectFromTemplate: vi.fn(async (..._args: unknown[]) => ({ locales: [], dependencies: [] })),
}));
vi.mock("electron", () => ({}));
vi.mock("../../projectTemplates", () => ({ scaffoldProjectFromTemplate, listProjectTemplates: vi.fn() }));

const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { ProjectTemplateScaffoldHandler } = await import("./projectTemplateAction");

type AppWindowLike = Parameters<InstanceType<typeof ProjectTemplateScaffoldHandler>["handle"]>[0];

const created = path.resolve("/projects/new-game");
const somebodyElses = path.resolve("/projects/theirs");

/** A window with the given project (or none), holding a write grant over exactly `writable`. */
function makeWindow(options: { projectPath?: string; writable: string[] }): AppWindowLike {
    const app = {
        resolveResource: (relative: string) => relative,
        storageManager: {
            isPathAllowed: async (_window: unknown, fsPath: string, mode: string) =>
                mode === "write" && options.writable.includes(fsPath),
        },
    };
    return {
        app,
        getApp: () => app,
        getProps: () => (options.projectPath === undefined ? {} : { projectPath: options.projectPath }),
    } as unknown as AppWindowLike;
}

beforeEach(() => {
    scaffoldProjectFromTemplate.mockClear();
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

    it("refuses a window with a project any folder but that project", async () => {
        const result = await new ProjectTemplateScaffoldHandler().handle(
            makeWindow({ projectPath: created, writable: [created, somebodyElses] }),
            { templateId: "skeleton", projectPath: somebodyElses, locale: "en" },
        );

        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(scaffoldProjectFromTemplate).not.toHaveBeenCalled();
    });
});
