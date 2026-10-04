import type { Translator } from "@shared/i18n";

/**
 * What to tell an author whose build died fetching something.
 *
 * A failed toolset download reaches the build console as a bare stack - `RequestError: unable to
 * verify the first certificate`, then a dozen frames inside `got` - which says nothing about the one
 * thing the author can do about it: the download mirrors under Settings › Network. This reads the
 * failure for the shapes a download takes and, when it finds one, says where those settings are.
 *
 * Read off the message because there is nothing else to read: electron-builder's 7-Zip and NSIS
 * fetches happen inside its own call and fail out of it as an ordinary error, with no download
 * announced before them that the console could have tracked.
 */

/**
 * The verification failures Node reports when the certificate a server presents does not chain to a
 * root it trusts. Against github.com, or a mirror with a sound certificate, that is almost never the
 * server: it is something on the author's machine answering in its place - a proxy, a network
 * "accelerator", an antivirus program inspecting HTTPS - whose root Windows trusts and Node does not.
 */
const CERTIFICATE_FAILURE =
    /unable to verify the first certificate|unable to get local issuer certificate|self[- ]signed certificate|certificate has expired|certificate is not yet valid|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID/i;

/**
 * Failures that can only have come from a download.
 *
 * `got`'s error classes, at the start of a line because that is where a stack names them, are what
 * electron-builder's and `@electron/get`'s fetches throw. `fetch failed` is undici's, which is what
 * Studio's own fetches throw, and the two `download` phrasings are how the Zig and AppImage toolset
 * fetches word theirs. Deliberately not bare errno codes: an `ECONNREFUSED` can come from a signing
 * server or a local socket, where a mirror is no answer.
 */
const DOWNLOAD_FAILURE =
    /^(?:RequestError|HTTPError|TimeoutError|ReadError|MaxRedirectsError)\b|\bfetch failed\b|\bcould not download https?:|\bdownload of https?:\S+ failed with HTTP\b/m;

export type DownloadFailureKind = "certificate" | "download";

/** `null` when the failure does not look like a download at all. */
export function classifyDownloadFailure(message: string): DownloadFailureKind | null {
    if (CERTIFICATE_FAILURE.test(message)) {
        return "certificate";
    }
    if (DOWNLOAD_FAILURE.test(message)) {
        return "download";
    }
    return null;
}

/**
 * The console lines to print under a failed build, in order; empty when the failure is not a
 * download. A certificate failure gets both: the mirror works around it, and the second line names
 * the likelier cause, which a mirror leaves in place for everything else on the machine.
 */
export function downloadFailureHints(message: string, translator: Translator): string[] {
    const kind = classifyDownloadFailure(message);
    if (kind === null) {
        return [];
    }
    const lines = [
        translator.t("build.mirror.downloadFailed", {
            section: translator.t("settings.categories.network.label"),
        }),
    ];
    if (kind === "certificate") {
        lines.push(translator.t("build.mirror.certificateFailed"));
    }
    return lines;
}
