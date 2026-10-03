import fs from "fs/promises";
import { createRequire } from "module";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheNamespace } from "@shared/types/constants";
import {
    APPIMAGE_TOOLSET_ARCHIVE,
    APPIMAGE_TOOLSET_VERSION,
    appImageToolsetArchivePath,
    appImageToolsetUrl,
    ensureAppImageToolset,
    readAppImageToolset,
    readTar,
} from "./appImageToolset";

const requireFromHere = createRequire(__filename);

/** One tar header block, checksummed. `gnu` writes GNU's magic, which has no name prefix. */
function tarHeader(fields: {
    name: string;
    size?: number;
    type?: string;
    mode?: number;
    linkName?: string;
    prefix?: string;
    gnu?: boolean;
}): Buffer {
    const header = Buffer.alloc(512);
    header.write(fields.name, 0, 100, "utf8");
    header.write((fields.mode ?? 0o644).toString(8).padStart(7, "0"), 100, "latin1");
    header.write("0000000", 108, "latin1");
    header.write("0000000", 116, "latin1");
    header.write((fields.size ?? 0).toString(8).padStart(11, "0"), 124, "latin1");
    header.write("00000000000", 136, "latin1");
    header.write(fields.type ?? "0", 156, "latin1");
    header.write(fields.linkName ?? "", 157, 100, "utf8");
    if (fields.gnu) {
        header.write("ustar  \0", 257, "latin1");
    } else {
        header.write("ustar\0" + "00", 257, "latin1");
        header.write(fields.prefix ?? "", 345, 155, "utf8");
    }
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) {
        sum += byte;
    }
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    return header;
}

function tarEntry(fields: Parameters<typeof tarHeader>[0], data: Buffer = Buffer.alloc(0)): Buffer {
    const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
    data.copy(padded);
    return Buffer.concat([tarHeader({ ...fields, size: data.length }), padded]);
}

function paxRecord(key: string, value: string): string {
    const body = ` ${key}=${value}\n`;
    let length = body.length + 1;
    while (`${length}${body}`.length !== length) {
        length++;
    }
    return `${length}${body}`;
}

const END = Buffer.alloc(1024);

describe("the AppImage toolset Studio fetches", () => {
    it("is the one the installed electron-builder pins for the same toolset version", () => {
        const linux = requireFromHere("app-builder-lib/out/toolsets/linux.js") as {
            appimageChecksums: Record<string, Record<string, string>>;
        };
        expect(linux.appimageChecksums[APPIMAGE_TOOLSET_VERSION]).toEqual({
            [APPIMAGE_TOOLSET_ARCHIVE.file]: APPIMAGE_TOOLSET_ARCHIVE.sha256,
        });
        expect(APPIMAGE_TOOLSET_ARCHIVE.release).toBe(`appimage@${APPIMAGE_TOOLSET_VERSION}`);
    });

    it("comes from the binaries mirror the author set, laid out the way electron-builder lays it out", () => {
        expect(appImageToolsetUrl("https://mirror.test/builder-binaries")).toBe(
            "https://mirror.test/builder-binaries/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz",
        );
        const saved = { ...process.env };
        try {
            delete process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR;
            delete process.env.ELECTRON_BUILDER_BINARIES_MIRROR;
            expect(appImageToolsetUrl()).toBe(
                "https://github.com/electron-userland/electron-builder-binaries/releases/download/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz",
            );
            // A host-wide mirror still applies when the setting is empty, as for winCodeSign.
            process.env.ELECTRON_BUILDER_BINARIES_MIRROR = "https://host.test/b/";
            expect(appImageToolsetUrl("  ")).toBe("https://host.test/b/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz");
            expect(appImageToolsetUrl("https://typed.test/")).toBe("https://typed.test/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz");
        } finally {
            process.env = saved;
        }
    });

    it("is cached in electron-builder's download cache, where electron-builder keeps the same archive", () => {
        const saved = process.env.ELECTRON_BUILDER_CACHE;
        try {
            delete process.env.ELECTRON_BUILDER_CACHE;
            expect(appImageToolsetArchivePath(path.join("C:", "nl-cache"))).toBe(
                path.join("C:", "nl-cache", CacheNamespace.ElectronBuilder, "appimage@1.0.3", "appimage-tools-runtime-20251108.tar.gz"),
            );
            // The build worker is started with this set, to the same place unless the author chose another.
            process.env.ELECTRON_BUILDER_CACHE = path.join("D:", "shared-builder-cache");
            expect(appImageToolsetArchivePath(path.join("C:", "nl-cache"))).toBe(
                path.join("D:", "shared-builder-cache", "appimage@1.0.3", "appimage-tools-runtime-20251108.tar.gz"),
            );
        } finally {
            if (saved === undefined) {
                delete process.env.ELECTRON_BUILDER_CACHE;
            } else {
                process.env.ELECTRON_BUILDER_CACHE = saved;
            }
        }
    });
});

describe("fetching the AppImage toolset", () => {
    let cacheRoot: string;
    let savedCache: string | undefined;

    beforeEach(async () => {
        cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nl-appimage-toolset-"));
        savedCache = process.env.ELECTRON_BUILDER_CACHE;
        delete process.env.ELECTRON_BUILDER_CACHE;
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        if (savedCache !== undefined) {
            process.env.ELECTRON_BUILDER_CACHE = savedCache;
        }
        await fs.rm(cacheRoot, { recursive: true, force: true });
    });

    it("refuses an archive that is not the pinned one, and caches nothing", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from("not the toolset"))));
        await expect(ensureAppImageToolset({ cacheRoot, mirror: "https://mirror.test/" })).rejects.toThrow(/not the pinned/);
        await expect(fs.access(appImageToolsetArchivePath(cacheRoot))).rejects.toThrow();
    });

    it("fetches again over a damaged cached copy, rather than using it", async () => {
        const archivePath = appImageToolsetArchivePath(cacheRoot);
        await fs.mkdir(path.dirname(archivePath), { recursive: true });
        await fs.writeFile(archivePath, "damaged");
        const fetchStub = vi.fn(async () => new Response(null, { status: 404 }));
        vi.stubGlobal("fetch", fetchStub);
        const warnings: string[] = [];
        await expect(ensureAppImageToolset({
            cacheRoot,
            mirror: "https://mirror.test/",
            log: (level, message) => level === "warning" && warnings.push(message),
        })).rejects.toThrow(/HTTP 404/);
        expect(fetchStub).toHaveBeenCalledWith("https://mirror.test/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz");
        expect(warnings.join("\n")).toMatch(/does not match its checksum/);
    });

    it("applies the author's download rewrites", async () => {
        const fetchStub = vi.fn(async () => new Response(null, { status: 500 }));
        vi.stubGlobal("fetch", fetchStub);
        await expect(ensureAppImageToolset({
            cacheRoot,
            mirror: "https://mirror.test/",
            rewrites: [{ from: "https://mirror.test/", to: "https://inside.test/", enabled: true }],
        })).rejects.toThrow(/https:\/\/mirror\.test\/appimage@1\.0\.3/);
        expect(fetchStub).toHaveBeenCalledWith("https://inside.test/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz");
    });
});

describe("reading a tar archive", () => {
    it("reads ustar, GNU long names, pax paths, links and modes", () => {
        const longName = `lib/${"n".repeat(150)}.so`;
        const paxName = `pax/${"p".repeat(120)}/file`;
        const archive = Buffer.concat([
            tarEntry({ name: "./", type: "5", mode: 0o755 }),
            tarEntry({ name: "./runtimes/runtime-x64", mode: 0o644 }, Buffer.from("RUNTIME")),
            tarEntry({ name: "file-in-prefix", prefix: "deep/prefix", mode: 0o600 }, Buffer.from("p")),
            tarEntry({ name: "././@LongLink", type: "L", gnu: true }, Buffer.from(`${longName}\0`)),
            tarEntry({ name: longName.slice(0, 99), mode: 0o755, gnu: true }, Buffer.from("long")),
            tarEntry({ name: "./lib/x64/libXss.so.1", type: "2", linkName: "libXss.so.1.0.0", mode: 0o777 }),
            tarEntry({ name: "PaxHeader", type: "x" }, Buffer.from(paxRecord("path", paxName))),
            tarEntry({ name: "truncated-name", mode: 0o640 }, Buffer.alloc(1000, 7)),
            END,
        ]);
        const entries = [...readTar(archive)];
        expect(entries.map(({ path: entryPath, type, mode, linkName }) => ({ path: entryPath, type, mode, linkName }))).toEqual([
            { path: "", type: "directory", mode: 0o755, linkName: "" },
            { path: "runtimes/runtime-x64", type: "file", mode: 0o644, linkName: "" },
            { path: "deep/prefix/file-in-prefix", type: "file", mode: 0o600, linkName: "" },
            { path: longName, type: "file", mode: 0o755, linkName: "" },
            { path: "lib/x64/libXss.so.1", type: "symlink", mode: 0o777, linkName: "libXss.so.1.0.0" },
            { path: paxName, type: "file", mode: 0o640, linkName: "" },
        ]);
        expect(entries[1].data.toString()).toBe("RUNTIME");
        expect(entries[5].data).toEqual(Buffer.alloc(1000, 7));
    });

    it("refuses a header whose checksum is wrong", () => {
        const entry = tarEntry({ name: "a" }, Buffer.from("a"));
        entry[0] = "b".charCodeAt(0);
        expect(() => [...readTar(Buffer.concat([entry, END]))]).toThrow(/checksum/);
    });
});

describe("the toolset for one architecture", () => {
    it("is its runtime, and its libraries as entries under usr/lib", async () => {
        const archive = zlib.gzipSync(Buffer.concat([
            tarEntry({ name: "./runtimes/", type: "5", mode: 0o755 }),
            tarEntry({ name: "./runtimes/runtime-x64" }, Buffer.from("x64 runtime")),
            tarEntry({ name: "./runtimes/runtime-arm64" }, Buffer.from("arm64 runtime")),
            tarEntry({ name: "./lib/x64/", type: "5", mode: 0o755 }),
            tarEntry({ name: "./lib/x64/libXss.so.1.0.0", mode: 0o644 }, Buffer.from("xss")),
            tarEntry({ name: "./lib/x64/libXss.so.1", type: "2", linkName: "libXss.so.1.0.0", mode: 0o777 }),
            tarEntry({ name: "./lib/arm64/libXss.so.1.0.0", mode: 0o644 }, Buffer.from("arm xss")),
            tarEntry({ name: "./linux/x64/mksquashfs", mode: 0o755 }, Buffer.from("tool")),
            END,
        ]));
        const toolset = await readAppImageToolset(archive, "x64");
        expect(toolset.runtime.toString()).toBe("x64 runtime");
        expect(toolset.libraries).toEqual([
            { kind: "file", path: "usr/lib/libXss.so.1.0.0", mode: 0o644, content: Buffer.from("xss") },
            { kind: "symlink", path: "usr/lib/libXss.so.1", target: "libXss.so.1.0.0" },
        ]);
        expect((await readAppImageToolset(archive, "arm64")).runtime.toString()).toBe("arm64 runtime");
    });

    it("refuses an archive without the runtime", async () => {
        const archive = zlib.gzipSync(Buffer.concat([tarEntry({ name: "./lib/x64/a.so" }, Buffer.from("a")), END]));
        await expect(readAppImageToolset(archive, "x64")).rejects.toThrow(/runtime-x64/);
    });
});
