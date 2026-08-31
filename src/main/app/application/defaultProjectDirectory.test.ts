import path from "path";
import { describe, expect, it } from "vitest";
import { resolveDefaultProjectDirectory, type ProjectDirectoryEnvironment } from "./defaultProjectDirectory";

/**
 * The one thing this decides is what the wizard's location field is filled in with, and the case
 * worth pinning is Windows with OneDrive's Known Folder Move on: the shell Documents folder is then
 * the sync root, and a new project going there is gigabytes of assets plus a version history handed
 * to a sync client.
 */

const WIN_HOME = "C:\\Users\\author";

function windows(overrides: Partial<ProjectDirectoryEnvironment> = {}): ProjectDirectoryEnvironment {
    return {
        platform: "win32",
        documents: `${WIN_HOME}\\Documents`,
        downloads: `${WIN_HOME}\\Downloads`,
        home: WIN_HOME,
        env: {},
        directoryExists: () => true,
        ...overrides,
    };
}

describe("resolveDefaultProjectDirectory", () => {
    it("offers Documents when nothing has moved it", () => {
        expect(resolveDefaultProjectDirectory(windows()))
            .toBe(path.join(`${WIN_HOME}\\Documents`, "Projects"));
    });

    it("keeps out of the sync root when Documents has been redirected into OneDrive", () => {
        const dir = resolveDefaultProjectDirectory(windows({
            documents: `${WIN_HOME}\\OneDrive\\Documents`,
            env: { OneDrive: `${WIN_HOME}\\OneDrive` },
        }));
        expect(dir).toBe(path.join(`${WIN_HOME}\\Documents`, "Projects"));
    });

    it("recognizes the sync root by its folder name when the environment does not name it", () => {
        // A second account, or a session where the client has not set its variables yet.
        const dir = resolveDefaultProjectDirectory(windows({
            documents: `${WIN_HOME}\\OneDrive - Contoso\\Documents`,
            env: {},
            directoryExists: candidate => candidate === `${WIN_HOME}\\Documents`,
        }));
        expect(dir).toBe(path.join(`${WIN_HOME}\\Documents`, "Projects"));
    });

    it("falls to Downloads when no local Documents survived the move", () => {
        const dir = resolveDefaultProjectDirectory(windows({
            documents: `${WIN_HOME}\\OneDrive\\Documents`,
            env: { OneDrive: `${WIN_HOME}\\OneDrive` },
            directoryExists: candidate => candidate === `${WIN_HOME}\\Downloads`,
        }));
        expect(dir).toBe(path.join(`${WIN_HOME}\\Downloads`, "Projects"));
    });

    it("falls to the home folder when Downloads is inside the sync root too", () => {
        const dir = resolveDefaultProjectDirectory(windows({
            documents: `${WIN_HOME}\\OneDrive\\Documents`,
            downloads: `${WIN_HOME}\\OneDrive\\Downloads`,
            env: { OneDrive: `${WIN_HOME}\\OneDrive` },
            directoryExists: candidate => candidate.startsWith(`${WIN_HOME}\\OneDrive`),
        }));
        expect(dir).toBe(path.join(WIN_HOME, "Projects"));
    });

    it("never offers a folder that is not there", () => {
        const dir = resolveDefaultProjectDirectory(windows({
            documents: `${WIN_HOME}\\OneDrive\\Documents`,
            env: { OneDrive: `${WIN_HOME}\\OneDrive` },
            directoryExists: () => false,
        }));
        expect(dir).toBe(path.join(WIN_HOME, "Projects"));
    });

    it("leaves macOS and Linux on the home folder they have always used", () => {
        for (const platform of ["darwin", "linux"] as const) {
            expect(resolveDefaultProjectDirectory({
                platform,
                documents: "/Users/author/Documents",
                downloads: "/Users/author/Downloads",
                home: "/Users/author",
                env: {},
                directoryExists: () => true,
            })).toBe(path.join("/Users/author", "Projects"));
        }
    });
});
