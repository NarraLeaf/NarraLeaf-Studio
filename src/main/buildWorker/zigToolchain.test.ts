import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheNamespace } from "@shared/types/constants";
import { archiveSuffix, pruneToolchain, zigCacheRoot, zigExecutablePath, zigMirror, ZIG_VERSION } from "./zigToolchain";

/** Build a tree from a list of file paths, so a test can state the shape it means. */
async function makeTree(root: string, files: readonly string[]): Promise<void> {
    for (const file of files) {
        const target = path.join(root, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, "x");
    }
}

/** Every file under `root`, as `/`-separated relative paths, sorted. */
async function listTree(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, relative: string): Promise<void> => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(path.join(dir, entry.name), child);
            } else {
                found.push(child);
            }
        }
    };
    await walk(root, "");
    return found.sort();
}

describe("where a Zig toolchain comes from", () => {
    it("takes what the author set, and adds the separator the layout needs", () => {
        expect(zigMirror("https://typed.test/zig")).toBe("https://typed.test/zig/");
        expect(zigMirror("https://typed.test/zig/")).toBe("https://typed.test/zig/");
    });

    it("falls back to the official source, and reads no environment variable on the way", () => {
        expect(zigMirror("")).toBe("https://ziglang.org/download/");
        expect(zigMirror("   ")).toBe("https://ziglang.org/download/");
        expect(zigMirror()).toBe("https://ziglang.org/download/");

        // The setting is the only override. A host variable that could reach this would be a
        // second place to configure one thing, and the one an author cannot see from the panel
        // they set it in.
        process.env.NARRALEAF_ZIG_MIRROR = "https://host.test/zig";
        try {
            expect(zigMirror()).toBe("https://ziglang.org/download/");
        } finally {
            delete process.env.NARRALEAF_ZIG_MIRROR;
        }
    });

    it("caches where the inventory offers to delete it", () => {
        const root = zigCacheRoot(path.join("C:", "nl-cache"));
        // The one place that knows what Studio leaves on disk has to be looking at this directory,
        // or a few hundred megabytes sit there with nothing on screen accounting for them.
        expect(root).toBe(path.join("C:", "nl-cache", CacheNamespace.Toolchains));
    });

    it("names the executable the way the host does", () => {
        const expected = process.platform === "win32" ? "zig.exe" : "zig";
        expect(path.basename(zigExecutablePath(path.join("root", `zig-${ZIG_VERSION}`)))).toBe(expected);
    });
});

describe("what the downloaded archive is staged as", () => {
    it("keeps the whole suffix of a .tar.xz", () => {
        // 7-Zip names what it unwraps after the archive minus its last extension. Staged as `.xz`,
        // `zig-aarch64-macos-0.16.0.tar.xz` decompresses to a file with no `.tar` on it and the tar
        // step finds nothing - which is every macOS and Linux host, and no Windows one.
        expect(archiveSuffix("zig-aarch64-macos-0.16.0.tar.xz")).toBe(".tar.xz");
        expect(archiveSuffix("zig-x86_64-linux-0.16.0.tar.xz")).toBe(".tar.xz");
    });

    it("leaves a single-container archive with the one extension it has", () => {
        expect(archiveSuffix("zig-x86_64-windows-0.16.0.zip")).toBe(".zip");
    });
});

describe("pruning a Zig toolchain", () => {
    let root = "";

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-zig-prune-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    });

    it("keeps what builds the four desktop targets and drops the rest", async () => {
        await makeTree(root, [
            "zig.exe",
            "zig",
            "LICENSE",
            "README.md",
            "doc/langref.html",
            "lib/zig.h",
            "lib/std/std.zig",
            "lib/compiler_rt/divti3.zig",
            "lib/compiler/aro/Compilation.zig",
            "lib/include/stddef.h",
            "lib/libunwind/src/Unwind.cpp",
            // Omitting this one fails a build with "unable to load 'c/wchar.zig'", which names a
            // file nothing in the target triple suggested - so it is asserted rather than assumed.
            "lib/c/wchar.zig",
            "lib/libcxx/src/string.cpp",
            "lib/docs/index.html",
            "lib/libc/glibc/abi.h",
            "lib/libc/darwin/libSystem.tbd",
            "lib/libc/mingw/crt/crtexe.c",
            "lib/libc/musl/src/stdio.c",
            "lib/libc/wasi/libc-top-half.c",
            "lib/libc/include/any-windows-any/windows.h",
            "lib/libc/include/any-darwin-any/sys/cdefs.h",
            "lib/libc/include/any-linux-any/linux/types.h",
            "lib/libc/include/generic-glibc/stdio.h",
            // Family names, not target triples: `x86_64-linux-gnu` does not exist in this tree, and
            // a keep-list written from the triples keeps none of the headers a Linux build needs.
            "lib/libc/include/x86-linux-gnu/bits/types.h",
            "lib/libc/include/x86-linux-any/asm/types.h",
            "lib/libc/include/aarch64-linux-gnu/bits/types.h",
            "lib/libc/include/aarch64-linux-any/asm/types.h",
            "lib/libc/include/riscv64-linux-gnu/bits/types.h",
            "lib/libc/include/generic-musl/stdio.h",
        ]);

        await pruneToolchain(root);

        expect(await listTree(root)).toEqual([
            "LICENSE",
            "lib/c/wchar.zig",
            "lib/compiler/aro/Compilation.zig",
            "lib/compiler_rt/divti3.zig",
            "lib/include/stddef.h",
            "lib/libc/darwin/libSystem.tbd",
            "lib/libc/glibc/abi.h",
            "lib/libc/include/aarch64-linux-any/asm/types.h",
            "lib/libc/include/aarch64-linux-gnu/bits/types.h",
            "lib/libc/include/any-darwin-any/sys/cdefs.h",
            "lib/libc/include/any-linux-any/linux/types.h",
            "lib/libc/include/any-windows-any/windows.h",
            "lib/libc/include/generic-glibc/stdio.h",
            "lib/libc/include/x86-linux-any/asm/types.h",
            "lib/libc/include/x86-linux-gnu/bits/types.h",
            "lib/libc/mingw/crt/crtexe.c",
            "lib/libunwind/src/Unwind.cpp",
            "lib/std/std.zig",
            "lib/zig.h",
            "zig",
            "zig.exe",
        ]);
    });

    it("keeps a directory it was told to keep whole, however deep it goes", async () => {
        await makeTree(root, [
            "zig",
            "lib/std/os/linux/x86_64.zig",
            "lib/std/crypto/tls/Client.zig",
        ]);

        await pruneToolchain(root);

        // `lib/std` is kept entire: naming levels inside it would be a second copy of the standard
        // library's layout, which changes every release.
        expect(await listTree(root)).toEqual([
            "lib/std/crypto/tls/Client.zig",
            "lib/std/os/linux/x86_64.zig",
            "zig",
        ]);
    });

    it("drops a directory a later release adds rather than keeping it by default", async () => {
        await makeTree(root, ["zig", "lib/std/std.zig", "lib/something-new/big.bin"]);

        await pruneToolchain(root);

        // The point of a keep-list: what nobody has thought about yet is not shipped by accident.
        expect(await listTree(root)).toEqual(["lib/std/std.zig", "zig"]);
    });
});
