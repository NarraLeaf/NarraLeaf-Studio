import { describe, expect, it } from "vitest";
import type { ProjectAppTag } from "@shared/types/appTag";
import type { ProjectDlc } from "@shared/types/dlc";
import {
    defaultTestEdition,
    describeTestEdition,
    isDefaultTestEdition,
    resolveTestEdition,
    testEditionLogLines,
} from "./testEdition";

/**
 * Which build a headless test's game is, from the names on its line.
 *
 * Wrong in either direction is silent: a name read as some other variant, or a DLC quietly left
 * out, is a run that passes on a build the line never named. So every name either resolves to
 * exactly one thing the project has, or the line is refused with the ones it could have named.
 */
const DEMO_ID = "0d9b5f6e-2a41-4f5e-9c1d-7e3a8b6c5d42";
const FEST_ID = "7c1e4a90-3b2d-4e6f-8a17-9d0c2b5e4f13";

const variants: ProjectAppTag[] = [
    { id: DEMO_ID, name: "Demo", overrides: {} } as ProjectAppTag,
    { id: FEST_ID, name: "Next Fest: Demo", overrides: {} } as ProjectAppTag,
];

const dlcs: ProjectDlc[] = [
    { id: "epilogue", name: "Epilogue", attachTo: "main" },
    { id: "summer_route", name: "Summer Route", attachTo: "main" },
    { id: "demo_voices", name: "Voice pack", attachTo: DEMO_ID },
];

const resolve = (variantName: string | null, dlcNames: string[] = []) =>
    resolveTestEdition({ variantName, dlcNames, variants, dlcs });

describe("resolveTestEdition", () => {
    it("runs the release build with no DLC when the line names neither", () => {
        const result = resolve(null);

        expect(result).toEqual({ ok: true, edition: defaultTestEdition() });
        expect(defaultTestEdition()).toEqual({ variant: { id: "main", name: "main" }, dlc: [] });
    });

    it("finds a variant by the name its author gave it, whatever the case", () => {
        expect(resolve("demo")).toEqual({
            ok: true,
            edition: { variant: { id: DEMO_ID, name: "Demo" }, dlc: [] },
        });
        // A name with a colon, which is why the flag only takes the `=` form.
        expect(resolve("Next Fest: Demo")).toMatchObject({ ok: true, edition: { variant: { id: FEST_ID } } });
    });

    it("answers `main` as the release build", () => {
        expect(resolve("main")).toEqual({ ok: true, edition: defaultTestEdition() });
    });

    it("does not take a variant's generated id for its name", () => {
        const result = resolve(DEMO_ID);

        expect(result.ok).toBe(false);
    });

    it("refuses a variant the project does not have, and lists the ones it does", () => {
        expect(resolve("Dmeo")).toEqual({
            ok: false,
            reason: 'The project has no build variant "Dmeo". It has: main, Demo, Next Fest: Demo.',
        });
    });

    it("refuses a name two variants share rather than picking one", () => {
        const result = resolveTestEdition({
            variantName: "Demo",
            dlcNames: [],
            variants: [...variants, { id: "b3", name: "demo", overrides: {} } as ProjectAppTag],
            dlcs,
        });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.reason).toMatch(/^More than one build variant is called "Demo"/);
    });

    it("finds a DLC by its name or by its id, and keeps the project's order", () => {
        expect(resolve(null, ["summer route", "epilogue"])).toEqual({
            ok: true,
            edition: {
                variant: { id: "main", name: "main" },
                dlc: [{ id: "epilogue", name: "Epilogue" }, { id: "summer_route", name: "Summer Route" }],
            },
        });
    });

    it("installs a DLC named twice once", () => {
        const result = resolve(null, ["Epilogue", "epilogue"]);

        expect(result.ok && result.edition.dlc).toEqual([{ id: "epilogue", name: "Epilogue" }]);
    });

    it("refuses a DLC the project does not have, and lists the ones this variant can install", () => {
        expect(resolve(null, ["Epilog"])).toEqual({
            ok: false,
            reason: 'The project has no DLC "Epilog". DLC for "main": Epilogue (epilogue), Summer Route (summer_route).',
        });
    });

    it("says so when the project has no DLC at all", () => {
        const result = resolveTestEdition({ variantName: null, dlcNames: ["Epilogue"], variants, dlcs: [] });

        expect(result).toEqual({
            ok: false,
            reason: 'The project has no DLC "Epilogue". It has none, so --test-dlc has nothing to install.',
        });
    });

    it("refuses a DLC made for another variant, which no player of this one can install", () => {
        expect(resolve(null, ["Voice pack"])).toEqual({
            ok: false,
            reason: 'DLC "Voice pack" attaches to the "Demo" variant, not to "main", so no player of "main" can install it.'
                + " Run it with --test-variant=Demo."
                + ' DLC for "main": Epilogue (epilogue), Summer Route (summer_route).',
        });
        expect(resolve("Demo", ["Epilogue"])).toEqual({
            ok: false,
            reason: 'DLC "Epilogue" attaches to the "main" variant, not to "Demo", so no player of "Demo" can install it.'
                + " Run it with --test-variant=main."
                + ' DLC for "Demo": Voice pack (demo_voices).',
        });
    });

    it("quotes a variant name the suggestion could not carry bare", () => {
        const result = resolveTestEdition({
            variantName: null,
            dlcNames: ["Fest voices"],
            variants,
            dlcs: [{ id: "fest_voices", name: "Fest voices", attachTo: FEST_ID }],
        });

        expect(!result.ok && result.reason).toContain('Run it with --test-variant="Next Fest: Demo".');
        expect(!result.ok && result.reason).toContain('No DLC attaches to "main".');
    });

    it("installs a DLC with the variant it attaches to", () => {
        expect(resolve("Demo", ["demo_voices"])).toEqual({
            ok: true,
            edition: { variant: { id: DEMO_ID, name: "Demo" }, dlc: [{ id: "demo_voices", name: "Voice pack" }] },
        });
    });
});

describe("what a run says about its build", () => {
    it("names the release build and no DLC, rather than saying nothing", () => {
        expect(testEditionLogLines(defaultTestEdition())).toEqual(["variant: main, the release build", "DLC: none"]);
        expect(isDefaultTestEdition(defaultTestEdition())).toBe(true);
        expect(describeTestEdition(defaultTestEdition())).toBe("");
    });

    it("names a chosen variant and DLC by the names their author gave them", () => {
        const edition = {
            variant: { id: DEMO_ID, name: "Demo" },
            dlc: [{ id: "demo_voices", name: "Voice pack" }],
        };

        expect(testEditionLogLines(edition)).toEqual([
            'variant: "Demo" (--test-variant)',
            'DLC: "Voice pack" (--test-dlc)',
        ]);
        expect(isDefaultTestEdition(edition)).toBe(false);
        expect(describeTestEdition(edition)).toBe('as variant "Demo" with DLC "Voice pack"');
        expect(describeTestEdition({ variant: { id: "main", name: "main" }, dlc: edition.dlc }))
            .toBe('with DLC "Voice pack"');
    });

    it("never prints a variant's generated id", () => {
        const edition = { variant: { id: DEMO_ID, name: "Demo" }, dlc: [] };

        for (const line of [...testEditionLogLines(edition), describeTestEdition(edition)]) {
            expect(line).not.toContain(DEMO_ID);
        }
    });
});
