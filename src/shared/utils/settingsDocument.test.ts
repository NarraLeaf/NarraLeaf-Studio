import { describe, expect, it } from "vitest";
import {
    composeSettingsDocument,
    parseSettingsDocument,
    planSettingsImport,
    serializeSettingsDocument,
    SettingsDocumentError,
    SETTINGS_DOCUMENT_FORMAT_VERSION,
    validateSettingValue,
    type SettingsValueSpec,
} from "@shared/utils/settingsDocument";

const SPECS: SettingsValueSpec[] = [
    { key: "ui.themeMode", kind: "enum", options: ["auto", "light", "dark"] },
    { key: "ui.zoomPercent", kind: "number", min: 50, max: 200 },
    { key: "editor.softWrap", kind: "boolean" },
    { key: "versionControl.authorName", kind: "string" },
    { key: "network.downloadRewrites", kind: "json" },
];

const doc = (settings: Record<string, unknown>) =>
    composeSettingsDocument({
        settings,
        studioVersion: "0.4.0",
        platform: "win32",
        exportedAt: "2026-08-05T00:00:00.000Z",
    });

describe("composeSettingsDocument", () => {
    it("stamps the format version and sorts keys so two exports are the same bytes", () => {
        const composed = doc({ b: 1, a: 2 });
        expect(composed.formatVersion).toBe(SETTINGS_DOCUMENT_FORMAT_VERSION);
        expect(Object.keys(composed.settings)).toEqual(["a", "b"]);
    });

    it("round-trips through serialize and parse", () => {
        const composed = doc({ "ui.themeMode": "dark" });
        expect(parseSettingsDocument(serializeSettingsDocument(composed))).toEqual(composed);
    });

    // A settings file is a settings file: a header and the keys, and nothing else ever rides along.
    it("carries nothing but the header and the settings", () => {
        expect(Object.keys(doc({ a: 1 })).sort()).toEqual([
            "exportedAt",
            "formatVersion",
            "platform",
            "settings",
            "studioVersion",
        ]);
    });
});

describe("parseSettingsDocument", () => {
    it("refuses text that is not JSON", () => {
        expect(() => parseSettingsDocument("{ truncated")).toThrow(SettingsDocumentError);
    });

    it("refuses a JSON value that is not a document", () => {
        expect(() => parseSettingsDocument("[1,2,3]")).toThrow(SettingsDocumentError);
        expect(() => parseSettingsDocument("\"hello\"")).toThrow(SettingsDocumentError);
    });

    // Refusing rather than best-efforting is the point of the field: a later shape could change
    // what a key means, and guessing applies the new meaning under the old rules.
    it("refuses a version it does not read", () => {
        expect(() => parseSettingsDocument(JSON.stringify({ formatVersion: 99, settings: {} })))
            .toThrow(/version 99/);
    });

    it("refuses a document with no settings object", () => {
        expect(() => parseSettingsDocument(JSON.stringify({ formatVersion: 1 }))).toThrow(SettingsDocumentError);
        expect(() => parseSettingsDocument(JSON.stringify({ formatVersion: 1, settings: [] })))
            .toThrow(SettingsDocumentError);
    });

    it("tolerates missing metadata, which is cosmetic", () => {
        const parsed = parseSettingsDocument(JSON.stringify({ formatVersion: 1, settings: { a: 1 } }));
        expect(parsed.settings).toEqual({ a: 1 });
        expect(parsed.studioVersion).toBe("");
    });
});

describe("validateSettingValue", () => {
    it("checks booleans, numbers and their bounds", () => {
        expect(validateSettingValue({ key: "x", kind: "boolean" }, true)).toBeNull();
        expect(validateSettingValue({ key: "x", kind: "boolean" }, "true")).toBe("expected true or false");
        expect(validateSettingValue({ key: "x", kind: "number", min: 1, max: 5 }, 3)).toBeNull();
        expect(validateSettingValue({ key: "x", kind: "number", min: 1, max: 5 }, 0)).toContain("minimum");
        expect(validateSettingValue({ key: "x", kind: "number", min: 1, max: 5 }, 9)).toContain("maximum");
        expect(validateSettingValue({ key: "x", kind: "number" }, Number.NaN)).toBe("expected a number");
    });

    it("checks enum membership when options are known", () => {
        const spec: SettingsValueSpec = { key: "x", kind: "enum", options: ["a", "b"] };
        expect(validateSettingValue(spec, "a")).toBeNull();
        expect(validateSettingValue(spec, "c")).toContain("not one of");
        // A gap in the spec must not reject a value that is probably fine.
        expect(validateSettingValue({ key: "x", kind: "enum" }, "anything")).toBeNull();
    });

    it("waves through json-shaped values, whose own readers normalize them", () => {
        expect(validateSettingValue({ key: "x", kind: "json" }, [{ from: "a" }])).toBeNull();
        expect(validateSettingValue({ key: "x", kind: "json" }, undefined)).toBe("no value");
    });
});

describe("planSettingsImport", () => {
    it("separates what would change from what would not", () => {
        const plan = planSettingsImport(
            doc({ "ui.themeMode": "dark", "editor.softWrap": false }),
            SPECS,
            { "ui.themeMode": "auto", "editor.softWrap": false },
        );
        expect(plan.entries.find(entry => entry.key === "ui.themeMode")?.verdict).toBe("apply");
        expect(plan.entries.find(entry => entry.key === "editor.softWrap")?.verdict).toBe("same");
        expect(plan.applicable.map(entry => entry.key)).toEqual(["ui.themeMode"]);
    });

    it("reports a key this build does not have, and does not apply it", () => {
        const plan = planSettingsImport(doc({ "some.futureKey": 1 }), SPECS, {});
        expect(plan.entries[0]?.verdict).toBe("unknown");
        expect(plan.applicable).toHaveLength(0);
    });

    it("reports an out-of-range value with its reason, and does not apply it", () => {
        const plan = planSettingsImport(doc({ "ui.zoomPercent": 9000 }), SPECS, { "ui.zoomPercent": 100 });
        expect(plan.entries[0]?.verdict).toBe("invalid");
        expect(plan.entries[0]?.reason).toContain("maximum");
        expect(plan.applicable).toHaveLength(0);
    });

    it("compares structurally, so an equal array is not a change", () => {
        const rules = [{ from: "https://a/", to: "https://b/", enabled: true }];
        const plan = planSettingsImport(
            doc({ "network.downloadRewrites": rules }),
            SPECS,
            { "network.downloadRewrites": [{ from: "https://a/", to: "https://b/", enabled: true }] },
        );
        expect(plan.entries[0]?.verdict).toBe("same");
    });
});
