import { afterEach, describe, expect, it } from "vitest";
import { ProjectPackageExportErrorCode } from "@shared/types/projectPackage";
import { i18nStore, translate } from "@/lib/i18n";
import { describePackageExportFailure } from "./packageExportFailure";

/**
 * What File ▸ Export Project says when it fails.
 *
 * It used to show the main process's message as it was: English in every interface language, and
 * for a file that could not be copied, `Could not copy "assets/content/53/22/b0e3…": EACCES…` - an
 * asset's id split into folders, followed by the errno.
 */

const t = translate;

describe("describePackageExportFailure", () => {
    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("has a sentence for every code, in every language, with no path, id or errno in it", () => {
        for (const locale of ["en", "zh", "ja"] as const) {
            i18nStore.setLocale(locale);
            const headline = t("actions.export.failed");
            for (const code of Object.values(ProjectPackageExportErrorCode)) {
                const sentence = describePackageExportFailure(code, t);
                expect(sentence, `${locale} ${code}`).not.toBe(headline);
                expect(sentence.startsWith(headline), sentence).toBe(true);
                expect(sentence, sentence).not.toMatch(/actions\.|\{[a-z]+\}|[A-Z]:[\\/]|[0-9a-f]{8}|E[A-Z]{3,}/);
            }
        }
    });

    it("says why in the interface's language", () => {
        i18nStore.setLocale("zh");
        expect(describePackageExportFailure(ProjectPackageExportErrorCode.FolderReadOnly, t))
            .toBe("无法导出项目；Studio 没有写入所选文件夹的权限");
        i18nStore.setLocale("en");
        expect(describePackageExportFailure(ProjectPackageExportErrorCode.ProjectUnreadable, t))
            .toBe("Could not export the project. Studio is not allowed to read some of the project's files.");
    });

    it("says only the headline for a failure it has no words for", () => {
        i18nStore.setLocale("en");
        expect(describePackageExportFailure("EIO", t)).toBe("Could not export the project.");
        expect(describePackageExportFailure(undefined, t)).toBe("Could not export the project.");
    });
});
