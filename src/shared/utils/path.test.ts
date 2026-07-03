import { describe, expect, it } from "vitest";
import { join, normalize, posix } from "./path";

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
});
