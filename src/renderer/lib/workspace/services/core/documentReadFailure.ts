import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { DocumentCorruptError } from "@shared/documents/types";
import { withReadFailureReason } from "@/lib/workspace/assets/assetReadFailure";
import { ASSET_UNDECODABLE, READ_NEWER_VERSION } from "../assets/assetReadFailure";
import { DocumentReadError } from "./DocumentStorage";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * The `code` a document read that threw or came back corrupt answers with, in the vocabulary the
 * read-failure reasons are keyed by: the filesystem's own code for a file the disk would not hand
 * over, {@link READ_NEWER_VERSION} for one a newer Studio saved, {@link ASSET_UNDECODABLE} for one
 * that does not parse. Undefined for anything else, which gets no reason at all rather than a guess.
 */
export function documentReadFailureCode(error: unknown): string | undefined {
    if (error instanceof DocumentCorruptError) {
        return error.defect === "newerVersion" ? READ_NEWER_VERSION : ASSET_UNDECODABLE;
    }
    if (error instanceof DocumentReadError) {
        return error.fsError.code;
    }
    return undefined;
}

/**
 * The sentence a document service throws when a document it was asked for could not be read:
 * `headline` - the document by what the author calls it - then why, for the reasons an author can act
 * on.
 *
 * Every panel that asked shows `error.message` as it is, so the message is the author's sentence.
 * Never the read's own, which is English and names the file by its project-relative path; that one
 * stays with the error as its `cause`.
 */
export function describeDocumentReadFailure(headline: string, error: unknown, t: Translate): string {
    return withReadFailureReason(headline, documentReadFailureCode(error), t);
}
