import { describe, expect, it } from "vitest";
import { join, normalize, posix } from "./path";

describe("path polyfill", () => {
    it("preserves POSIX roots when joining project files", () => {
        expect(join("/Users/nomen/Documents/dev/test/hello", "hello.nlproj")).toBe(
            "/Users/nomen/Documents/dev/test/hello/hello.nlproj",
        );
    });

    it("keeps absolute POSIX paths absolute while normalizing parent segments", () => {
        expect(normalize("/Users/nomen/../nomen/Documents")).toBe("/Users/nomen/Documents");
        expect(posix.normalize("/..")).toBe("/");
    });
});
