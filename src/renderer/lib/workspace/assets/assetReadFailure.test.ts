import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { ASSET_UNDECODABLE } from "../services/assets/assetReadFailure";
import { describeAssetReadFailure } from "./assetReadFailure";

/**
 * What an asset editor says in place of an asset it could not read.
 *
 * Before, the image, audio, video, font and JSON previews printed the read's own message: "Failed to
 * read image file: File does not exist: D:\...\assets\content\51\43\dcd8e1f2...", in English in every
 * language, with the asset's id split into folders - and for a file that would not decode, whatever
 * the browser said about it.
 */

const ASSET_ID = "5143dcd8-e1f2-4b6c-8a2f-9e0d7b3a1c5e";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_ID_TAIL = /[0-9a-f]{16,}/i;

describe("describeAssetReadFailure", () => {
    const en = createTranslator("en").t;

    it("names the asset and says its file is gone when the read found nothing there", () => {
        expect(describeAssetReadFailure(ASSET_ID, "room-warm.png", FsRejectErrorCode.NOT_FOUND, en))
            .toBe("“room-warm.png” could not be read. Its file is missing from the project folder.");
    });

    it("says the file cannot be opened when it was read and would not decode", () => {
        expect(describeAssetReadFailure(ASSET_ID, "room-warm.png", ASSET_UNDECODABLE, en))
            .toBe("“room-warm.png” could not be read. Its file is damaged or is not in a format Studio can open.");
    });

    it("says only that it could not be read when the read gave nothing an author can act on", () => {
        expect(describeAssetReadFailure(ASSET_ID, "room-warm.png", FsRejectErrorCode.IPC_ERROR, en))
            .toBe("“room-warm.png” could not be read.");
        expect(describeAssetReadFailure(ASSET_ID, "room-warm.png", undefined, en))
            .toBe("“room-warm.png” could not be read.");
    });

    it("says an asset the library no longer has is gone, without its id", () => {
        const line = describeAssetReadFailure(ASSET_ID, null, FsRejectErrorCode.NOT_FOUND, en);
        expect(line).toBe("This asset is no longer in this project.");
        expect(line).not.toMatch(UUID);
    });

    it.each(SUPPORTED_LOCALES)("carries no id, no path and no placeholder in any wording (%s)", locale => {
        const t = createTranslator(locale).t;
        const lines = [FsRejectErrorCode.NOT_FOUND, FsRejectErrorCode.PERMISSION_DENIED, ASSET_UNDECODABLE, undefined]
            .flatMap(code => [
                describeAssetReadFailure(ASSET_ID, "room-warm.png", code, t),
                describeAssetReadFailure(ASSET_ID, null, code, t),
            ]);
        for (const line of lines) {
            expect(line).not.toMatch(UUID);
            expect(line).not.toMatch(HEX_ID_TAIL);
            expect(line).not.toMatch(/[\\/]assets[\\/]content/);
            expect(line).not.toMatch(/\{\w+\}/);
            if (locale !== "en") {
                // The asset's own name and the product's are the only Latin words it may carry.
                expect(line.replace(/room-warm\.png|Studio/g, "")).not.toMatch(/[A-Za-z]{3,}/);
            }
        }
    });
});
