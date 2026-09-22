import { afterEach, describe, expect, it } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { RemoteAssetFetchErrorCode } from "@shared/types/remoteAsset";
import type { ExchangeProblem } from "@shared/utils/exchangeProblem";
import { parseTranslationExchange } from "@shared/utils/localizationExchange";
import { parseVoiceCsv } from "@shared/utils/voiceCsv";
import { i18nStore, translate } from "@/lib/i18n";
import type { AssetImportRefusal } from "@/lib/workspace/services/assets/assetImportRefusal";
import {
    describeAssetImportRefusal,
    describeExchangeProblem,
    describeImportFailure,
    fileLevelProblem,
    importReadFailureReason,
    summarizeImportFailures,
    summarizeSkippedEntries,
} from "./importFailure";

/**
 * What an author is told about a file that did not make it into the project - an asset, a translation
 * file, a recording script.
 *
 * Before these, every one of them was the reader's or the importer's own sentence: `Missing required
 * column: unit_id`, `Not an XLIFF file: the root element is <html>`, `Failed to copy asset:
 * C:\Users\me\take.wav to D:\game\assets\content\53\22\b0e3…. [PERMISSION_DENIED] EACCES…`. English in
 * every interface language, and the second half of that last one is an asset's id split into folders.
 */

/** Every problem a parser can report, one of each position. */
const PROBLEMS: ExchangeProblem[] = [
    { code: "empty" },
    { code: "noIdColumn" },
    { code: "notFormat", format: "xliff" },
    { code: "notFormat", format: "json" },
    { code: "noRows" },
    { code: "missingId" },
    { code: "missingId", at: { row: 7 } },
    { code: "missingId", at: { entry: 3 } },
    { code: "notEntry" },
    { code: "notEntry", at: { entry: 2 } },
    { code: "unreadableLine", at: { line: 12 } },
    { code: "noTake" },
    { code: "noTake", at: { row: 9 } },
];

/** Every way the importer can turn a file away. */
const REFUSALS: AssetImportRefusal[] = [
    { kind: "sourceUnreadable", fsCode: FsRejectErrorCode.NOT_FOUND },
    { kind: "sourceUnreadable", fsCode: FsRejectErrorCode.PERMISSION_DENIED },
    { kind: "empty" },
    { kind: "wrongType", ext: "txt" },
    { kind: "cannotUse", ext: "avi", use: "play", convertTo: [".mp4", ".webm"] },
    { kind: "cannotUse", ext: "tiff", use: "display", convertTo: [".png", ".webp"] },
    { kind: "cannotUse", ext: "ttc", use: "use", convertTo: [".ttf", ".otf"] },
    { kind: "mismatch", ext: "png", actual: "JPEG" },
    { kind: "undecodable" },
    { kind: "copyFailed", fsCode: FsRejectErrorCode.PERMISSION_DENIED },
    { kind: "copyFailed", fsCode: FsRejectErrorCode.NO_SPACE },
    { kind: "copyFailed", fsCode: FsRejectErrorCode.IO_ERROR },
    { kind: "copyFailed" },
    { kind: "notAFolder" },
    { kind: "emptyFolder" },
    { kind: "copyIncomplete" },
    { kind: "projectNotAccepting" },
    ...Object.values(RemoteAssetFetchErrorCode).map(code => ({ kind: "remoteFetch" as const, code })),
    { kind: "remoteNoContent" },
    { kind: "remoteBundle" },
    { kind: "remoteUnplayable", cause: { kind: "codecs", codecs: ["hevc"] } },
    { kind: "remoteUnplayable", cause: { kind: "container", container: "avi" } },
    { kind: "remoteUnplayable", cause: { kind: "container", container: null } },
    { kind: "remoteUnplayable", cause: { kind: "noStreams" } },
];

/**
 * The Latin a sentence may carry: the product's name, the ID the file's own column holds, the one
 * column header a translator has to find, the format names, and the extensions and formats the
 * refusal itself names.
 */
const ALLOWED_LATIN = new Set([
    "NarraLeaf", "Studio", "ID", "unit_id", "unit", "id", "XLIFF", "JSON", "CSV", "PO",
    "txt", "avi", "mp4", "webm", "tiff", "png", "webp", "ttc", "ttf", "otf", "JPEG",
    // A remote asset's: the address kinds, the size unit, and the format names a probe reports.
    "URL", "http", "https", "MB", "HEVC", "AVI",
]);

function strayLatin(text: string): string[] {
    return (text.match(/[A-Za-z_][A-Za-z0-9_]+/g) ?? []).filter(word => !ALLOWED_LATIN.has(word));
}

/** A path, a storage id, an `app://` grant, or a reader's own English. */
const LEAKS = /[A-Z]:[\\/]|app:\/\/|[0-9a-f]{8}-|content[\\/]|EACCES|Failed to|Missing required|root element|Unreadable line|Request failed|404|https?:\/\//;

const t = translate;

describe("the wording of a failed import", () => {
    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("says every problem and every refusal in the interface's language, with no path or id", () => {
        for (const locale of ["en", "zh", "ja"] as const) {
            i18nStore.setLocale(locale);
            const sentences = [
                ...PROBLEMS.map(problem => describeExchangeProblem(problem, t)),
                ...REFUSALS.map(refusal => describeAssetImportRefusal(refusal, t) ?? ""),
            ];
            for (const sentence of sentences) {
                expect(sentence, `${locale}: every one has a sentence`).not.toBe("");
                expect(sentence, sentence).not.toMatch(LEAKS);
                expect(sentence, sentence).not.toMatch(/workspace\.|\{[a-z]+\}/);
                if (locale !== "en") {
                    expect(strayLatin(sentence), sentence).toEqual([]);
                }
            }
        }
    });

    it("names the file by its name, never its path", () => {
        i18nStore.setLocale("zh");
        const message = describeImportFailure(
            "C:\\Users\\me\\Documents\\translations\\ja.csv",
            describeExchangeProblem({ code: "noIdColumn" }, t),
            t,
        );
        expect(message).toBe("无法导入“ja.csv”；文件缺少 unit_id 列");
        i18nStore.setLocale("ja");
        expect(describeImportFailure("D:/booth/take 01.wav", null, t)).toBe("「take 01.wav」を読み込めなかった");
        i18nStore.setLocale("en");
        expect(describeImportFailure("D:/booth/take 01.wav", describeAssetImportRefusal({ kind: "empty" }, t), t))
            .toBe("Could not import “take 01.wav”. The file is empty.");
    });

    it("gives a reason only for a read an author can act on", () => {
        i18nStore.setLocale("en");
        expect(importReadFailureReason(FsRejectErrorCode.NOT_FOUND, t)).toBe("The file no longer exists.");
        expect(importReadFailureReason(FsRejectErrorCode.PERMISSION_DENIED, t)).toBe("Studio is not allowed to read the file.");
        expect(importReadFailureReason(FsRejectErrorCode.IPC_ERROR, t)).toBeNull();
        expect(importReadFailureReason(undefined, t)).toBeNull();
        // A source folder that could not be listed carries no code; the file is named without a guess.
        expect(describeAssetImportRefusal({ kind: "sourceUnreadable" }, t)).toBeNull();
        expect(describeAssetImportRefusal(undefined, t)).toBeNull();
    });

    it("says a copy the project refused about the project folder, not about the file", () => {
        i18nStore.setLocale("en");
        expect(describeAssetImportRefusal({ kind: "copyFailed", fsCode: FsRejectErrorCode.PERMISSION_DENIED }, t))
            .toBe("Studio is not allowed to write to the project folder.");
        expect(describeAssetImportRefusal({ kind: "cannotUse", ext: "avi", use: "play", convertTo: [".mp4", ".webm"] }, t))
            .toBe("NarraLeaf cannot play .avi files. Convert the file to .mp4 or .webm before importing.");
    });

    it("explains a file with nothing importable by the problem with the file, not by a skipped entry", () => {
        // Every entry of this map had the wrong shape: the file-level answer is that there is nothing
        // to import, not the first entry's complaint.
        const json = parseTranslationExchange("json", "{\"t-1\": 1, \"t-2\": 2}");
        expect(json.rows).toEqual([]);
        expect(fileLevelProblem(json.problems)).toEqual({ code: "noRows" });
        expect(fileLevelProblem(parseVoiceCsv("filename\na.wav").problems)).toEqual({ code: "noIdColumn" });
        expect(fileLevelProblem(parseTranslationExchange("xliff", "<html></html>").problems))
            .toEqual({ code: "notFormat", format: "xliff" });
        // Only skipped entries and no rows (a CSV whose every row lacks an id): still "nothing to import".
        expect(fileLevelProblem([{ code: "missingId", at: { row: 2 } }])).toEqual({ code: "noRows" });
    });

    it("says why a URL could not be fetched from the code main answered with", () => {
        i18nStore.setLocale("zh");
        expect(describeAssetImportRefusal({ kind: "remoteFetch", code: RemoteAssetFetchErrorCode.NotFound }, t))
            .toBe("服务器上没有该地址的文件");
        expect(describeAssetImportRefusal({ kind: "remoteFetch", code: RemoteAssetFetchErrorCode.Timeout }, t))
            .toBe("服务器在 30 秒内没有响应");
        expect(describeAssetImportRefusal({ kind: "remoteFetch", code: RemoteAssetFetchErrorCode.TooLarge }, t))
            .toBe("文件超过远程资产的上限 256 MB");
        expect(describeAssetImportRefusal({ kind: "remoteFetch", code: RemoteAssetFetchErrorCode.Distrusted }, t))
            .toBe(translate("workspace.shell.distrust.unavailable"));
        i18nStore.setLocale("en");
        expect(describeAssetImportRefusal({ kind: "remoteUnplayable", cause: { kind: "codecs", codecs: ["hevc"] } }, t))
            .toBe("NarraLeaf cannot play HEVC. Convert the file and import the converted copy from disk.");
    });

    it("lists skipped recording-script rows by where they sit, and counts the rest", () => {
        i18nStore.setLocale("zh");
        const problems: ExchangeProblem[] = [
            { code: "missingId", at: { row: 3 } },
            ...[5, 6, 7, 8, 9, 10].map(row => ({ code: "noTake" as const, at: { row } })),
        ];
        expect(summarizeSkippedEntries(problems, t).split("\n")).toEqual([
            "第 3 行缺少 ID",
            "第 5 行对应的对白尚未配音，其备注与状态未应用",
            "第 6 行对应的对白尚未配音，其备注与状态未应用",
            "第 7 行对应的对白尚未配音，其备注与状态未应用",
            "第 8 行对应的对白尚未配音，其备注与状态未应用",
            translate("assets.import.moreFailures", { count: 2 }),
        ]);
    });

    it("lists a few failed files and counts the rest", () => {
        i18nStore.setLocale("zh");
        const summary = summarizeImportFailures([
            { path: "D:/booth/a.mp3", reason: describeAssetImportRefusal({ kind: "empty" }, t) },
            { path: "D:/booth/b.mp3", reason: null },
            { path: "D:/booth/c.aiff", reason: describeAssetImportRefusal({ kind: "wrongType", ext: "aiff" }, t) },
            { path: "D:/booth/d.mp3", reason: null },
            { path: "D:/booth/e.mp3", reason: null },
        ], t);
        expect(summary.split("\n")).toEqual([
            "无法导入“a.mp3”；文件为空",
            "无法导入“b.mp3”",
            "无法导入“c.aiff”；此处不能导入 .aiff 文件",
            translate("assets.import.moreFailures", { count: 2 }),
        ]);
        expect(summary).not.toMatch(LEAKS);
    });
});
