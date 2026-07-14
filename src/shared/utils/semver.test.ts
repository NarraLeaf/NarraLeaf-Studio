import { describe, expect, it } from "vitest";
import { classifyCompatibility, compareSemver, parseSemver } from "./semver";

describe("parseSemver", () => {
    it("parses major.minor.patch", () => {
        expect(parseSemver("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [], build: "" });
    });

    it("parses prerelease and build metadata", () => {
        expect(parseSemver("1.2.3-beta.1")).toMatchObject({ prerelease: ["beta", "1"] });
        expect(parseSemver("1.2.3+build.5")).toMatchObject({ build: "build.5", prerelease: [] });
    });

    it("returns null for invalid input", () => {
        expect(parseSemver("1.2")).toBeNull();
        expect(parseSemver("v1.2.3")).toBeNull();
        expect(parseSemver(42 as unknown as string)).toBeNull();
    });
});

describe("compareSemver", () => {
    it("orders by major, minor, patch", () => {
        expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
        expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
        expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    });

    it("treats a prerelease as lower than its release", () => {
        expect(compareSemver("1.2.3-beta", "1.2.3")).toBe(-1);
        expect(compareSemver("1.2.3", "1.2.3-beta")).toBe(1);
    });

    it("orders prerelease identifiers per semver", () => {
        expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
        expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
        expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    });

    it("sorts unparseable versions first", () => {
        expect(compareSemver("garbage", "1.0.0")).toBe(-1);
        expect(compareSemver("1.0.0", "garbage")).toBe(1);
    });
});

describe("classifyCompatibility", () => {
    it("is satisfied for the same version", () => {
        expect(classifyCompatibility("1.4.0", "1.4.0")).toBe("satisfied");
    });

    it("is satisfied when installed is a newer minor/patch of the same major", () => {
        expect(classifyCompatibility("1.4.0", "1.6.2")).toBe("satisfied");
    });

    it("is outdated when installed is an older minor of the same major", () => {
        expect(classifyCompatibility("1.4.0", "1.2.0")).toBe("outdated");
    });

    it("is incompatible across major versions in either direction", () => {
        expect(classifyCompatibility("1.4.0", "2.0.0")).toBe("incompatible");
        expect(classifyCompatibility("2.0.0", "1.9.9")).toBe("incompatible");
    });

    it("is incompatible when a version cannot be parsed", () => {
        expect(classifyCompatibility("1.0.0", "not-a-version")).toBe("incompatible");
    });
});
