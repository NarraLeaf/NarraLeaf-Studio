import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { describeAssetExportFailure } from "./assetExportFailure";

const UUID_HEX = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}|[0-9a-f]{28}/i;
// What Node says when a copy out of the library fails: both paths, the first of them the asset's
// storage path - its id split into folders.
const NODE_REASON = "EACCES: permission denied, copyfile 'D:/projects/my-game/assets/content/4b/64/5b591723" +
    "4ac998abe6859b837bef' -> 'C:/Users/author/Desktop/castle.png'";

describe("describeAssetExportFailure", () => {
    it.each(SUPPORTED_LOCALES)("words a filesystem failure from its code, never from Node's message (%s)", locale => {
        const t = createTranslator(locale).t;
        for (const code of ["EACCES", "EPERM", "ENOENT", "ENOSPC", "EBUSY"]) {
            const sentence = describeAssetExportFailure({ code, reason: NODE_REASON }, t);
            expect(sentence, `${locale} ${code}`).not.toMatch(UUID_HEX);
            expect(sentence, `${locale} ${code}`).not.toContain("assets");
            expect(sentence, `${locale} ${code}`).not.toMatch(/[{}]/);
        }
        expect(describeAssetExportFailure({ code: "EACCES", reason: NODE_REASON }, t))
            .toBe(t("assets.export.reason.permissionDenied"));
        expect(describeAssetExportFailure({ code: "ENOENT", reason: NODE_REASON }, t))
            .toBe(t("assets.export.reason.sourceMissing"));
    });

    it("passes the export's own refusals through: they are sentences already", () => {
        const en = createTranslator("en").t;
        expect(describeAssetExportFailure({ reason: "This file is outside the project and was not exported." }, en))
            .toBe("This file is outside the project and was not exported.");
        expect(describeAssetExportFailure({ reason: null }, en)).toBe("Unknown error");
    });
});
