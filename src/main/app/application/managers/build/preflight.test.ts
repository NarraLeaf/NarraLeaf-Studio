import { describe, expect, it } from "vitest";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import { readMobileOrientation } from "./preflight";

const config = (app: unknown): ProjectConfigData => ({ app, metadata: {} } as ProjectConfigData);

describe("readMobileOrientation", () => {
    it("reads each configured orientation", () => {
        for (const orientation of ["landscape", "portrait", "auto"] as const) {
            expect(readMobileOrientation(config({ mobile: { orientation } }))).toBe(orientation);
        }
    });

    it("defaults to landscape for projects saved before the setting existed", () => {
        // Every pre-existing project has no app.mobile at all; they must keep
        // building the way visual novels overwhelmingly play.
        expect(readMobileOrientation(config({}))).toBe("landscape");
        expect(readMobileOrientation(config(undefined))).toBe("landscape");
        expect(readMobileOrientation(null)).toBe("landscape");
    });

    it("falls back rather than pass an unknown value to the shell", () => {
        // The shell config is a contract; a hand-edited or newer-Studio value
        // must not reach it unchecked.
        expect(readMobileOrientation(config({ mobile: { orientation: "sideways" } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: { orientation: 42 } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: "portrait" }))).toBe("landscape");
    });
});
