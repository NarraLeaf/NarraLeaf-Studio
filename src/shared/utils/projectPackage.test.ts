import { describe, expect, it } from "vitest";
import {
    PROJECT_PACKAGE_FORMAT,
    PROJECT_PACKAGE_FORMAT_VERSION,
    decodeProjectPackage,
    encodeProjectPackage,
    normalizeProjectPackagePath,
    shouldExcludeProjectPackagePath,
} from "./projectPackage";

describe("project package", () => {
    it("round-trips binary file entries", () => {
        const encoded = encodeProjectPackage({
            format: PROJECT_PACKAGE_FORMAT,
            version: PROJECT_PACKAGE_FORMAT_VERSION,
            createdAt: "2026-01-01T00:00:00.000Z",
            projectName: "Demo",
            projectIdentifier: "com.example.demo",
            directories: ["assets/content"],
            files: [
                { path: "Demo.nlproj", data: new Uint8Array([1, 2, 3]) },
                { path: "assets/content/file.bin", data: new Uint8Array([4, 5]) },
            ],
        });

        const decoded = decodeProjectPackage(encoded);
        expect(decoded.projectName).toBe("Demo");
        expect(decoded.directories).toEqual(["assets/content"]);
        expect(Array.from(decoded.files[0].data)).toEqual([1, 2, 3]);
        expect(Array.from(decoded.files[1].data)).toEqual([4, 5]);
    });

    it("rejects absolute and traversal paths", () => {
        expect(() => normalizeProjectPackagePath("../victim.txt")).toThrow("unsafe segments");
        expect(() => normalizeProjectPackagePath("assets/../victim.txt")).toThrow("unsafe segments");
        expect(() => normalizeProjectPackagePath("/tmp/victim.txt")).toThrow("relative");
        expect(() => normalizeProjectPackagePath("C:/tmp/victim.txt")).toThrow("relative");
    });

    it("excludes editor caches and export artifacts", () => {
        expect(shouldExcludeProjectPackagePath("editor/cache/thumbnail/a.png")).toBe(true);
        expect(shouldExcludeProjectPackagePath("editor/assets/remote/hash")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/cache/state.json")).toBe(true);
        expect(shouldExcludeProjectPackagePath("exports/demo.nlspkg")).toBe(true);
        expect(shouldExcludeProjectPackagePath("editor/ui/uidoc.json")).toBe(false);
        expect(shouldExcludeProjectPackagePath("assets/content/ab/cd/file")).toBe(false);
    });
});
