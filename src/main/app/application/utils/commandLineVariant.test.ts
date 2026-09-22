import { describe, expect, it } from "vitest";
import type { ProjectAppTag } from "@shared/types/appTag";
import { findCommandLineVariant, namesReleaseVariant } from "./commandLineVariant";

/**
 * A variant on a command line is named the way its author named it, for `--build-variant` and
 * `--test-variant` alike. The stored id is a generated uuid nothing in Studio shows, so a value that
 * is one is refused - and the refusal says the word to use instead, without repeating the id.
 */
const DEMO_ID = "0d9b5f6e-2a41-4f5e-9c1d-7e3a8b6c5d42";

const stored: ProjectAppTag[] = [
    { id: DEMO_ID, name: "Demo", overrides: {} } as ProjectAppTag,
    { id: "7c1e4a90-3b2d-4e6f-8a17-9d0c2b5e4f13", name: "Next Fest: Demo", overrides: {} } as ProjectAppTag,
];

describe("findCommandLineVariant", () => {
    it("finds a variant by its name, whatever the case", () => {
        const found = findCommandLineVariant(stored, "demo", "--build-variant");

        expect(found.ok && found.variant.id).toBe(DEMO_ID);
    });

    it("answers main as the release build", () => {
        const found = findCommandLineVariant(stored, "Main", "--build-variant");

        expect(found.ok && found.variant.id).toBe("main");
    });

    it("refuses a stored id and names the variant it belongs to, not the id", () => {
        const found = findCommandLineVariant(stored, DEMO_ID, "--build-variant");

        expect(found).toEqual({
            ok: false,
            reason: '--build-variant names a variant by its name, not by the id it is stored under.'
                + ' That one is called "Demo": write --build-variant=Demo.',
        });
    });

    it("quotes a suggested name that is more than one word", () => {
        const found = findCommandLineVariant(stored, "7c1e4a90-3b2d-4e6f-8a17-9d0c2b5e4f13", "--test-variant");

        expect(!found.ok && found.reason).toContain('write --test-variant="Next Fest: Demo".');
    });

    it("refuses a name the project does not have and lists the ones it does", () => {
        expect(findCommandLineVariant(stored, "Dmeo", "--build-variant")).toEqual({
            ok: false,
            reason: 'The project has no build variant "Dmeo". It has: main, Demo, Next Fest: Demo.',
        });
    });

    it("does not take the word the release build was stored under before it was renamed", () => {
        expect(findCommandLineVariant(stored, "release", "--build-variant").ok).toBe(false);
    });
});

describe("namesReleaseVariant", () => {
    it("is true for main in any case, and for nothing else", () => {
        expect(namesReleaseVariant("main")).toBe(true);
        expect(namesReleaseVariant(" MAIN ")).toBe(true);
        expect(namesReleaseVariant("release")).toBe(false);
        expect(namesReleaseVariant("Demo")).toBe(false);
    });
});
