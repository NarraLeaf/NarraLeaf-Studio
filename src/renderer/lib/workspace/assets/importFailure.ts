import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import type { ExchangeProblem } from "@shared/utils/exchangeProblem";
import { basename } from "@shared/utils/path";
import type { AssetImportRefusal } from "@/lib/workspace/services/assets/assetImportRefusal";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What a surface says about a file the author tried to bring into the project and could not: an
 * asset, a translation file, a recording script, a story script.
 *
 * Every function here answers in the author's terms and never passes on a reader's or an importer's
 * own message. Those are English whatever the interface speaks, and they name paths - the file picked,
 * and for an asset the place it was being copied to, which is its id split into folders. A failure
 * with nothing an author can act on gets no reason at all rather than a guess: the file is named, and
 * the message stays in the log.
 */

/** "Could not import “x.csv”.", then why when there is a reason. `name` may be a path; only its file name is used. */
export function describeImportFailure(name: string, reason: string | null, t: Translate): string {
    const headline = t("workspace.shell.import.failed", { name: basename(name) });
    return reason ? t("workspace.shell.import.withReason", { headline, reason }) : headline;
}

/** How many failed files a summary spells out before it says how many more there were. */
const SUMMARY_LIMIT = 3;

/**
 * Several failed files as the detail under one notice: a line per file, by name and why, the first
 * few of them, then how many more. `reason` is already a sentence, or null for "no reason to give".
 */
export function summarizeImportFailures(
    failures: readonly { path: string; reason: string | null }[],
    t: Translate,
): string {
    const lines = failures.slice(0, SUMMARY_LIMIT).map(failure => describeImportFailure(failure.path, failure.reason, t));
    const remaining = failures.length - lines.length;
    if (remaining > 0) {
        lines.push(t("assets.import.moreFailures", { count: remaining }));
    }
    return lines.join("\n");
}

/**
 * Why a file the author picked could not be read, for the two answers they can act on. The file is
 * outside the project, so "missing" means it is gone from where they picked it, not from the project
 * folder.
 */
export function importReadFailureReason(code: string | undefined, t: Translate): string | null {
    switch (code) {
        case FsRejectErrorCode.NOT_FOUND:
            return t("workspace.shell.import.reason.missing");
        case FsRejectErrorCode.PERMISSION_DENIED:
            return t("workspace.shell.import.reason.accessDenied");
        default:
            return null;
    }
}

/** The problems that mean the whole file was turned away, rather than one entry of it skipped. */
const FILE_LEVEL: ReadonlySet<ExchangeProblem["code"]> = new Set(["empty", "noIdColumn", "notFormat", "noRows"]);

/**
 * The problem that explains a translation file or recording script with nothing importable in it:
 * the first one about the file as a whole, or "no entries" when every entry was skipped one by one.
 */
export function fileLevelProblem(problems: readonly ExchangeProblem[]): ExchangeProblem {
    return problems.find(problem => FILE_LEVEL.has(problem.code)) ?? { code: "noRows" };
}

/** One problem with a translation file or a recording script, as a sentence. */
export function describeExchangeProblem(problem: ExchangeProblem, t: Translate): string {
    switch (problem.code) {
        case "empty":
            return t("workspace.shell.import.reason.empty");
        case "noIdColumn":
            return t("workspace.shell.import.reason.noIdColumn");
        case "notFormat":
            return t("workspace.shell.import.reason.notFormat", { format: problem.format === "xliff" ? "XLIFF" : "JSON" });
        case "noRows":
            return t("workspace.shell.import.reason.noRows");
        case "missingId":
            if (problem.at && "row" in problem.at) {
                return t("workspace.shell.import.skipped.missingIdAtRow", { n: problem.at.row });
            }
            if (problem.at && "entry" in problem.at) {
                return t("workspace.shell.import.skipped.missingIdAtEntry", { n: problem.at.entry });
            }
            return t("workspace.shell.import.skipped.missingId");
        case "notEntry":
            return problem.at && "entry" in problem.at
                ? t("workspace.shell.import.skipped.notEntryAtEntry", { n: problem.at.entry })
                : t("workspace.shell.import.skipped.notEntry");
        case "unreadableLine":
            return t("workspace.shell.import.skipped.unreadableLine", { n: problem.at.line });
    }
}

/**
 * Why one file of an asset import did not become an asset, or null when there is nothing an author
 * could do about it (the file is then listed by name alone).
 */
export function describeAssetImportRefusal(refusal: AssetImportRefusal | undefined, t: Translate): string | null {
    if (!refusal) {
        return null;
    }
    switch (refusal.kind) {
        case "sourceUnreadable":
            return importReadFailureReason(refusal.fsCode, t);
        case "empty":
            return t("workspace.shell.import.reason.empty");
        case "wrongType":
            return t("workspace.shell.import.reason.wrongType", { ext: refusal.ext });
        case "cannotUse": {
            const [first, second] = refusal.convertTo;
            const params = { ext: refusal.ext, first, second };
            switch (refusal.use) {
                case "display":
                    return t("workspace.shell.import.reason.cannotDisplay", params);
                case "play":
                    return t("workspace.shell.import.reason.cannotPlay", params);
                case "use":
                    return t("workspace.shell.import.reason.cannotUse", params);
            }
            return null;
        }
        case "mismatch":
            return t("workspace.shell.import.reason.mismatch", { ext: refusal.ext, actual: refusal.actual });
        case "undecodable":
            return t("workspace.shell.save.unreadableReason.damaged");
        case "copyFailed":
            // The copy's destination is the project folder, so a refusal is said about that folder
            // rather than about "the file", which is how a save's reason reads.
            switch (refusal.fsCode) {
                case FsRejectErrorCode.PERMISSION_DENIED:
                    return t("workspace.shell.import.reason.projectReadOnly");
                case FsRejectErrorCode.NO_SPACE:
                    return t("workspace.shell.save.reason.diskFull");
                default:
                    return t("workspace.shell.import.reason.copyFailed");
            }
        case "notAFolder":
            return t("workspace.shell.import.reason.notAFolder");
        case "emptyFolder":
            return t("workspace.shell.import.reason.emptyFolder");
        case "copyIncomplete":
            return t("workspace.shell.import.reason.copyIncomplete");
    }
}
