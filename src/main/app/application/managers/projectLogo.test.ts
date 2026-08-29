import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { createProjectIconSet, type ProjectIconSet } from "@shared/types/projectIcons";

/**
 * nativeImage is a main-process API with no standalone implementation, and what this module needs
 * from it is narrow: decode, report a size, downscale. Bytes beginning "PNG" stand in for a
 * decodable image at the size named after them; anything else decodes empty, which is the branch
 * that decides whether a format goes through the resize or is passed to the renderer as it is.
 */
vi.mock("electron", () => ({
    nativeImage: {
        createFromBuffer: (bytes: Buffer) => {
            const match = /^PNG:(\d+)x(\d+)/.exec(bytes.toString("utf8"));
            const size = match
                ? { width: Number(match[1]), height: Number(match[2]) }
                : { width: 0, height: 0 };
            return image(size, !match);
        },
    },
}));

function image(size: { width: number; height: number }, empty: boolean) {
    return {
        isEmpty: () => empty,
        getSize: () => size,
        resize: (options: { width: number; height: number }) =>
            image({ width: options.width, height: options.height }, false),
        toPNG: () => Buffer.from(`decoded:${size.width}x${size.height}`),
    };
}

const { readProjectLogo } = await import("./projectLogo");

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** A project folder holding a `.nlproj` whose `metadata.icons` is `icons`. */
async function makeProject(icons: ProjectIconSet | undefined): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-logo-"));
    tempDirs.push(dir);
    await fs.writeFile(
        path.join(dir, "Game.nlproj"),
        encodeProjectConfig({
            name: "Game",
            identifier: "com.example.game",
            metadata: icons ? { icons } : {},
        }),
    );
    return dir;
}

/** Write a file into the project, creating whatever directories it needs. */
async function writeInto(projectPath: string, relativePath: string, contents: string): Promise<void> {
    const target = path.join(projectPath, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
}

function setWithMaster(overrides: Partial<ProjectIconSet["master"]> & { path: string; mediaType: string }): ProjectIconSet {
    return {
        ...createProjectIconSet(),
        master: { sourceName: "logo", updatedAt: "", ...overrides },
    };
}

describe("readProjectLogo", () => {
    it("downscales the master and answers a PNG data URL", async () => {
        const set = setWithMaster({ path: "resources/icons/source/master.png", mediaType: "image/png" });
        const project = await makeProject(set);
        await writeInto(project, "resources/icons/source/master.png", "PNG:1024x1024");

        // 1024 is past the thumbnail edge, so it comes back resized rather than whole.
        expect(await readProjectLogo(project)).toBe(
            `data:image/png;base64,${Buffer.from("decoded:128x128").toString("base64")}`,
        );
    });

    it("keeps a non-square logo's proportions", async () => {
        const set = setWithMaster({ path: "resources/icons/source/master.png", mediaType: "image/png" });
        const project = await makeProject(set);
        await writeInto(project, "resources/icons/source/master.png", "PNG:1000x500");

        expect(await readProjectLogo(project)).toBe(
            `data:image/png;base64,${Buffer.from("decoded:128x64").toString("base64")}`,
        );
    });

    it("passes through a format nativeImage cannot decode but a renderer can draw", async () => {
        const set = setWithMaster({ path: "resources/icons/source/master.svg", mediaType: "image/svg+xml" });
        const project = await makeProject(set);
        await writeInto(project, "resources/icons/source/master.svg", "<svg/>");

        expect(await readProjectLogo(project)).toBe(
            `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
        );
    });

    it("falls back to the baked desktop PNG when the master is a format nothing draws", async () => {
        const set: ProjectIconSet = {
            ...setWithMaster({ path: "resources/icons/source/master.icns", mediaType: "image/icns" }),
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        };
        const project = await makeProject(set);
        await writeInto(project, "resources/icons/source/master.icns", "icns-bytes");
        await writeInto(project, "resources/icons/derived/windows.png", "PNG:64x64");

        // Under the thumbnail edge, so it is handed over at its own size.
        expect(await readProjectLogo(project)).toBe(
            `data:image/png;base64,${Buffer.from("decoded:64x64").toString("base64")}`,
        );
    });

    it("refuses a path that points outside the project", async () => {
        const set = setWithMaster({ path: "../outside.png", mediaType: "image/png" });
        const project = await makeProject(set);
        await fs.writeFile(path.join(path.dirname(project), "outside.png"), "PNG:64x64");
        tempDirs.push(path.join(path.dirname(project), "outside.png"));

        expect(await readProjectLogo(project)).toBeNull();
    });

    it("answers null for a project with no icon, a missing file, and a folder that is not a project", async () => {
        expect(await readProjectLogo(await makeProject(undefined))).toBeNull();

        const missing = await makeProject(
            setWithMaster({ path: "resources/icons/source/master.png", mediaType: "image/png" }),
        );
        expect(await readProjectLogo(missing)).toBeNull();

        const notAProject = await fs.mkdtemp(path.join(os.tmpdir(), "nl-logo-"));
        tempDirs.push(notAProject);
        expect(await readProjectLogo(notAProject)).toBeNull();
    });
});
