import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";

vi.mock("electron", () => ({}));

const { ProjectWizardCreatedHandler } = await import("./projectWizardCreatedAction");

type AppWindowLike = Parameters<InstanceType<typeof ProjectWizardCreatedHandler>["handle"]>[0];

let root: string;
/** A folder the wizard was granted and has finished writing a project into. */
let created: string;
/** A folder the wizard was granted but has written nothing into. */
let empty: string;
/** A finished project the wizard was never granted. */
let ungranted: string;

function makeWindow(type: WindowAppType, grants: string[]) {
    const recordArrival = vi.fn(() => true);
    const window = {
        getWindowType: () => type,
        app: {
            logger: { info: vi.fn(), warn: vi.fn() },
            projectTrustManager: { recordArrival },
            storageManager: {
                isPathAllowed: vi.fn(async (_window: unknown, fsPath: string) => grants.some(grant => {
                    const target = path.resolve(fsPath);
                    return target === grant || target.startsWith(`${grant}${path.sep}`);
                })),
            },
        },
    } as unknown as AppWindowLike;
    return { window, recordArrival };
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-wizard-created-"));
    created = path.join(root, "created");
    empty = path.join(root, "empty");
    ungranted = path.join(root, "ungranted");
    for (const dir of [created, empty, ungranted]) {
        await fs.mkdir(dir);
    }
    await fs.writeFile(path.join(created, "game.nlproj"), "");
    await fs.writeFile(path.join(ungranted, "game.nlproj"), "");
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * The one route that trusts a project on a renderer's word, and the three things it checks first.
 */
describe("ProjectWizardCreatedHandler", () => {
    it("records a project the wizard wrote into a folder it was granted", async () => {
        const { window, recordArrival } = makeWindow(WindowAppType.ProjectWizard, [root]);

        const result = await new ProjectWizardCreatedHandler().handle(window, { projectPath: created });

        expect(result).toEqual({ success: true, data: { recorded: true } });
        expect(recordArrival).toHaveBeenCalledWith(created, "created", expect.any(String));
    });

    it.each(Object.values(WindowAppType).filter(type => type !== WindowAppType.ProjectWizard))(
        "refuses a %s window",
        async type => {
            const { window, recordArrival } = makeWindow(type, [root]);

            const result = await new ProjectWizardCreatedHandler().handle(window, { projectPath: created });

            expect(result.success).toBe(false);
            expect(recordArrival).not.toHaveBeenCalled();
        },
    );

    it("refuses a folder the wizard was not granted to write", async () => {
        const { window, recordArrival } = makeWindow(WindowAppType.ProjectWizard, [created, empty]);

        const result = await new ProjectWizardCreatedHandler().handle(window, { projectPath: ungranted });

        expect(result.success).toBe(false);
        expect(recordArrival).not.toHaveBeenCalled();
    });

    it("refuses a folder that holds no project", async () => {
        // A grant covers where the wizard may write, not what it wrote; an empty folder is not a
        // creation, and vouching for it would vouch for whatever lands there next.
        const { window, recordArrival } = makeWindow(WindowAppType.ProjectWizard, [root]);

        const result = await new ProjectWizardCreatedHandler().handle(window, { projectPath: empty });

        expect(result.success).toBe(false);
        expect(recordArrival).not.toHaveBeenCalled();
    });

    it("refuses a payload that is not a path", async () => {
        const { window, recordArrival } = makeWindow(WindowAppType.ProjectWizard, [root]);

        const result = await new ProjectWizardCreatedHandler().handle(window, { projectPath: undefined as never });

        expect(result.success).toBe(false);
        expect(recordArrival).not.toHaveBeenCalled();
    });
});
