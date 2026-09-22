import type { RemoteAssetBytes } from "@shared/types/remoteAsset";
import { AssetType } from "../assetTypes";
import type { AssetImportRefusal, RemoteMediaSection } from "../assetImportRefusal";
import {
    type FileFormatValidationResult,
    type FileFormatValidator,
    isSvgDocument,
    looksLikeHtml,
} from "../FileFormatValidator";

/** A refusal of downloaded bytes: the log's sentence, and what the author is told. */
export interface RemoteSnapshotRefusal {
    error: string;
    refusal: AssetImportRefusal;
}

/**
 * Whether the bytes a URL answered with may become the snapshot of an asset of `type`, and why not.
 *
 * `validation` is the verdict the local importer gives the same bytes under the same name. This
 * decides which refusal the author hears when several apply, and adds the two a download is held to
 * and a file picked from disk is not:
 *
 *  1. **A web page is refused.** Declared as `text/html` (or XHTML), or HTML by its bytes. A URL
 *     that has become a sign-in page, a consent wall or an error page served with a success status
 *     answers exactly this, under whatever name the address ends in.
 *  2. **Media must look like media of its kind.** A response declared as text or a document is
 *     refused, and so are bytes that carry the signature of no format the type takes
 *     (`FileFormatValidator.recognizes`).
 *
 * The local importer passes bytes it does not recognise, on purpose, and that stays. A file on disk
 * is one the author picked and can open; a format missing from the signature table is not evidence
 * against it, and one that turns out not to decode is reported later by the `assets/unreadable` lint
 * while the author still has the file. Downloaded bytes are whatever the server chose to answer this
 * time, which the author has not seen, and the name they arrive under is the address's rather than
 * the bytes'. Unrecognised bytes there are far more often a wrong answer than an unusual format - and
 * on a refresh, refusing is what keeps the snapshot that works in place of a page.
 *
 * Only the media types are held to the second rule. JSON is checked by parsing, which a page fails
 * anyway, so the first rule only decides how that failure is worded. `Other` is the type for bytes
 * Studio holds no opinion about, an HTML file included.
 *
 * @returns the refusal, or `null` when the bytes may be stored.
 */
export function remoteSnapshotRefusal(
    type: AssetType,
    fetched: Pick<RemoteAssetBytes, "bytes" | "contentType">,
    validation: FileFormatValidationResult,
    validator: FileFormatValidator,
): RemoteSnapshotRefusal | null {
    const localVerdict = validation.success
        ? null
        : { error: validation.error || "File format validation failed", refusal: validation.refusal };
    if (type === AssetType.Other || type === AssetType.Model) {
        return localVerdict;
    }

    const declared = mediaTypeOf(fetched.contentType);
    const page = isPageType(declared) || looksLikeHtml(fetched.bytes);
    const pageRefusal: RemoteSnapshotRefusal = {
        error: `The URL answered with a web page (${declared ?? "no Content-Type"}) rather than a file`,
        refusal: { kind: "remotePage" },
    };

    if (type === AssetType.JSON) {
        return localVerdict && page ? pageRefusal : localVerdict;
    }

    const section = MEDIA_SECTION[type];
    if (!section) {
        return localVerdict;
    }
    if (page) {
        return pageRefusal;
    }
    // A name the player refuses outright (`.avi`, `.tif`) comes with a format to convert to, which is
    // more use than being told the bytes are not recognised - they often are not, being that format.
    if (localVerdict?.refusal.kind === "cannotUse") {
        return localVerdict;
    }

    // SVG is XML text, and hosts that serve files verbatim label it as text. It is still an image.
    const declaredText = isDocumentType(declared) && !(type === AssetType.Image && isSvgDocument(fetched.bytes));
    if (declaredText || !validator.recognizes(type, fetched.bytes)) {
        return {
            error: declaredText
                ? `The URL answered with ${declared}, not ${type} data`
                : `The URL's response carries no signature of a ${type} format Studio recognizes`
                    + ` (${declared ?? "no Content-Type"})`,
            refusal: { kind: "remoteUnrecognized", expected: section },
        };
    }
    return localVerdict;
}

const MEDIA_SECTION: Partial<Record<AssetType, RemoteMediaSection>> = {
    [AssetType.Image]: "image",
    [AssetType.Audio]: "media",
    [AssetType.Video]: "media",
    [AssetType.Font]: "font",
};

/** The media type of a `Content-Type` header, lower-cased and without its parameters. */
function mediaTypeOf(contentType: string | undefined): string | null {
    const type = contentType?.split(";")[0]?.trim().toLowerCase();
    return type || null;
}

function isPageType(declared: string | null): boolean {
    return declared === "text/html" || declared === "application/xhtml+xml";
}

/**
 * A type that says the response is text or a structured document rather than media. The generic
 * binary types (`application/octet-stream` and the like) are not among them: they say nothing, and
 * are what a great many servers send for every file.
 */
function isDocumentType(declared: string | null): boolean {
    if (!declared) {
        return false;
    }
    return declared.startsWith("text/")
        || declared.startsWith("multipart/")
        || declared === "application/json" || declared.endsWith("+json")
        || declared === "application/xml" || (declared.startsWith("application/") && declared.endsWith("+xml"))
        || /^application\/(x-)?(javascript|ecmascript)$/.test(declared);
}
