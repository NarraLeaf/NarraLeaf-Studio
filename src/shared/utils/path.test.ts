import { describe, expect, it } from "vitest";
import { basename, dirname, extname, join, normalize, parse, posix, win32 } from "./path";

describe("path polyfill", () => {
    it("preserves POSIX roots when joining project files", () => {
        expect(join("/Users/nomen/Documents/dev/test/hello", "hello.nlproj")).toBe(
            "/Users/nomen/Documents/dev/test/hello/hello.nlproj",
        );
    });

    it("treats absolute-looking later join segments like Node path.join", () => {
        expect(join("/project", "editor", "story", "stories", "story-1", "/")).toBe(
            "/project/editor/story/stories/story-1/",
        );
        expect(join("/project", "/editor")).toBe("/project/editor");
        expect(join("project", "/editor")).toBe("project/editor");
    });

    it("keeps absolute POSIX paths absolute while normalizing parent segments", () => {
        expect(normalize("/Users/nomen/../nomen/Documents")).toBe("/Users/nomen/Documents");
        expect(posix.normalize("/..")).toBe("/");
    });

    /**
     * The whole reason this file exists. Windows reads `/` and `\` as the same character, and the
     * paths this polyfill is handed are routinely mixed: a project resolves to
     * `D:/proj\runtimes/puppet`, a model bundle names its files `Hiyori.2048/texture_00.png`. Parsing
     * against one stored separator answered the *entire string* for `basename` and `"."` for
     * `dirname`, without failing.
     */
    describe("win32 reads both separators", () => {
        it.each([
            ["D:\\Temp\\demo\\Mao", "Mao", "D:\\Temp\\demo"],
            ["D:/Temp/demo/Mao", "Mao", "D:/Temp/demo"],
            ["/home/u/Mao", "Mao", "/home/u"],
            ["a/b.png", "b.png", "a"],
            // Mixed, as `project.resolve("runtimes/puppet")` actually produces it.
            ["D:/Temp/nls-demo\\runtimes/puppet", "puppet", "D:/Temp/nls-demo\\runtimes"],
            // A bundle's own reference to one of its files.
            ["Hiyori.2048/texture_00.png", "texture_00.png", "Hiyori.2048"],
        ])("splits %s", (input, base, dir) => {
            expect(win32.basename(input)).toBe(base);
            expect(win32.dirname(input)).toBe(dir);
        });

        it("keeps a child of the root inside its root", () => {
            expect(win32.dirname("/Mao")).toBe("/");
            expect(win32.dirname("D:\\Mao")).toBe("D:\\");
            expect(win32.dirname("D:/Mao")).toBe("D:/");
        });

        it("reads roots written either way", () => {
            expect(win32.isAbsolute("/home/u")).toBe(true);
            expect(win32.isAbsolute("\\home\\u")).toBe(true);
            expect(win32.isAbsolute("D:/x")).toBe(true);
            expect(win32.isAbsolute("a/b")).toBe(false);
            expect(win32.parse("D:/Temp/x.png").root).toBe("D:/");
            expect(win32.parse("/home/u").root).toBe("/");
        });

        it("takes the extension off a forward-slash path", () => {
            expect(win32.extname("Hiyori.2048/texture_00.png")).toBe(".png");
            expect(extname("Hiyori.2048/texture_00.png")).toBe(".png");
        });

        it("collapses parent segments across either separator", () => {
            expect(win32.normalize("D:/Temp/demo/../demo/Mao")).toBe("D:/Temp/demo/Mao");
            expect(win32.normalize("D:\\Temp\\demo\\..\\demo\\Mao")).toBe("D:\\Temp\\demo\\Mao");
            expect(win32.normalize("a/b/../c")).toBe("a/c");
            expect(win32.normalize("D:\\")).toBe("D:\\");
            expect(win32.normalize("D:\\..")).toBe("D:\\");
        });

        /**
         * The deliberate deviation from `path.win32`, which would answer backslashes for all three:
         * the style the caller wrote is the style it gets back.
         */
        it("writes back the separator the input used", () => {
            expect(win32.join("D:/Temp/demo", "Mao")).toBe("D:/Temp/demo/Mao");
            expect(win32.join("D:\\Temp\\demo", "Mao")).toBe("D:\\Temp\\demo\\Mao");
            expect(win32.join("/home/u", "Mao")).toBe("/home/u/Mao");
            // No separator to copy anywhere: fall back to the platform's.
            expect(win32.join("D:", "drop")).toBe("D:\\drop");
        });

        it("leaves POSIX alone, where a backslash is a legal file name character", () => {
            expect(posix.basename("weird\\name.png")).toBe("weird\\name.png");
            expect(posix.dirname("weird\\name.png")).toBe(".");
            expect(posix.isAbsolute("\\home")).toBe(false);
        });
    });

    it("still round-trips through parse for the platform default", () => {
        const parsed = parse(join("a", "b", "c.png"));
        expect(parsed.base).toBe("c.png");
        expect(parsed.ext).toBe(".png");
        expect(basename(join("a", "b", "c.png"))).toBe("c.png");
    });
});
