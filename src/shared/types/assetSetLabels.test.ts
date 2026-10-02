import { describe, expect, it } from "vitest";
import {
    formatAssetSetCoordinateReading,
    readAssetSetAxis,
    readAssetSetCoordinate,
    readAssetTag,
    readAssetTags,
    type AssetSetAxisNaming,
} from "./assetSetLabels";
import { makeAssetSetAxis, type AssetSet, type AssetSetAxis } from "./assetSet";
import { planAssetSet } from "./assetSetPlan";

/** An author edition's id, which is a uuid like every edition an author makes. */
const DEMO_ID = "0b5e1d9c-4f2a-4e8b-9c3d-7a6f5e4d3c2b";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function naming(overrides: Partial<AssetSetAxisNaming> = {}): AssetSetAxisNaming {
    return {
        locales: new Map([["en", "English"], ["zh-CN", "简体中文"]]),
        editions: new Map([["main", "main"], [DEMO_ID, "Demo"]]),
        words: { language: "Language", edition: "Variant", deletedEdition: "Deleted variant" },
        ...overrides,
    };
}

function set(axis: AssetSetAxis): AssetSet {
    return { id: "s", name: "alice", type: "image", filter: ["set:s"], axis };
}

describe("readAssetSetAxis", () => {
    it("names a language axis and the language", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("locale", ["en", "zh-CN"]), "zh-CN", naming()))
            .toEqual({ axis: "Language", value: "简体中文" });
    });

    it("names an edition axis and the edition", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("release", ["main", DEMO_ID]), DEMO_ID, naming()))
            .toEqual({ axis: "Variant", value: "Demo" });
    });

    it("prints a language the project no longer declares as its code", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("locale", ["ja"]), "ja", naming()))
            .toEqual({ axis: "Language", value: "ja" });
    });

    it("calls an edition the project no longer has deleted, and never prints its id", () => {
        const reading = readAssetSetAxis(makeAssetSetAxis("release", ["main", DEMO_ID]), DEMO_ID, naming({ editions: new Map() }));
        expect(reading).toEqual({ axis: "Variant", value: "Deleted variant" });
        expect(JSON.stringify(reading)).not.toMatch(UUID);
    });

    it("names the release edition before the edition list has been read", () => {
        // `main` is synthesized, never stored, and called the same in every project.
        expect(readAssetSetAxis(makeAssetSetAxis("release", ["main"]), "main", naming({ editions: new Map() })).value)
            .toBe("main");
        // And under the id it had before it was called `main`.
        expect(readAssetSetAxis(makeAssetSetAxis("release", ["main"]), "release", naming({ editions: new Map() })).value)
            .toBe("main");
    });

    it("ignores surrounding space on either side", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("release", [DEMO_ID]), ` ${DEMO_ID} `, naming()))
            .toEqual({ axis: "Variant", value: "Demo" });
    });
});

describe("readAssetSetCoordinate", () => {
    it("reads the set's own axis", () => {
        const readings = readAssetSetCoordinate(
            set(makeAssetSetAxis("locale", ["en", "zh-CN"])),
            { locale: "en" },
            naming(),
        );
        expect(readings).toEqual([{ axis: "Language", value: "English" }]);
    });

    it("answers nothing when the coordinate says nothing about that axis", () => {
        const readings = readAssetSetCoordinate(
            set(makeAssetSetAxis("release", [DEMO_ID])),
            { locale: "en" },
            naming(),
        );
        expect(readings).toEqual([]);
    });

    it("writes one line for a row that has one", () => {
        expect(formatAssetSetCoordinateReading([
            { axis: "Variant", value: "Demo" },
            { axis: "Language", value: "English" },
        ])).toBe("Variant: Demo · Language: English");
    });
});

describe("readAssetTag", () => {
    it("prints no set's own tag: it is the set's id, and the set is drawn as a folder", () => {
        expect(readAssetTag("set:a55e7001-0000-4000-8000-000000000001", naming())).toBeNull();
    });

    it("prints a language tag the way a set's row prints the value", () => {
        expect(readAssetTag("locale:zh-CN", naming())).toBe("Language: 简体中文");
    });

    it("prints an edition tag by the edition's name", () => {
        expect(readAssetTag(`release:${DEMO_ID}`, naming())).toBe("Variant: Demo");
        expect(readAssetTag("release:main", naming())).toBe("Variant: main");
    });

    it("prints an edition tag whose edition is gone without its id", () => {
        const label = readAssetTag(`release:${DEMO_ID}`, naming({ editions: new Map() }));
        expect(label).toBe("Variant: Deleted variant");
        expect(label).not.toMatch(UUID);
    });

    it("prints the author's own tags as they were written", () => {
        expect(readAssetTag("title", naming())).toBe("title");
        expect(readAssetTag("char:alice", naming())).toBe("char:alice");
    });
});

describe("readAssetTags", () => {
    it("keeps the stored order and the stored tag each label stands for", () => {
        expect(readAssetTags(["title", "set:s", "locale:en"], naming())).toEqual([
            { tag: "title", label: "title" },
            { tag: "locale:en", label: "Language: English" },
        ]);
    });

    it("prints no id for any tag the set wizard writes", () => {
        // What a file carries once it is a member of a set - planned the way the wizard plans it.
        const edition = planAssetSet({
            setId: "a55e7001-0000-4000-8000-000000000002",
            kind: "release",
            values: [{ value: "main", label: "main" }, { value: DEMO_ID, label: "Demo" }],
            files: [{ id: "f", name: "cover_demo", tags: [] }],
            members: new Map([[DEMO_ID, "f"]]),
        });
        const written = edition.tagsByFile.get("f") ?? [];
        expect(written.some(tag => UUID.test(tag))).toBe(true);
        for (const reading of [naming(), naming({ editions: new Map() })]) {
            const labels = readAssetTags(written, reading).map(entry => entry.label).join(" ");
            expect(labels).not.toMatch(UUID);
            expect(labels).not.toMatch(/\b(set|release):/);
        }
    });
});
