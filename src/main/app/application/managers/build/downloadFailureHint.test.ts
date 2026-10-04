import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { classifyDownloadFailure, downloadFailureHints } from "./downloadFailureHint";

/** As a Windows build reported it when electron-builder's 7-Zip fetch met an intercepting proxy. */
const CERTIFICATE_STACK = [
    "RequestError: unable to verify the first certificate",
    "    at ClientRequest.<anonymous> (C:\\Studio\\resources\\app.asar.unpacked\\node_modules\\got\\dist\\source\\core\\index.js:970:111)",
    "    at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)",
].join("\n");

describe("classifyDownloadFailure", () => {
    it("reads a certificate that would not verify as its own kind", () => {
        expect(classifyDownloadFailure(CERTIFICATE_STACK)).toBe("certificate");
        expect(classifyDownloadFailure("TypeError: fetch failed (self-signed certificate in certificate chain)"))
            .toBe("certificate");
    });

    it("reads got's errors, undici's and Studio's own download wording as downloads", () => {
        expect(classifyDownloadFailure("RequestError: connect ETIMEDOUT 140.82.112.3:443\n    at ...")).toBe("download");
        expect(classifyDownloadFailure("HTTPError: Response code 404 (Not Found)")).toBe("download");
        expect(classifyDownloadFailure("TypeError: fetch failed")).toBe("download");
        expect(classifyDownloadFailure(
            "could not download https://ziglang.org/download/0.16.0/zig-x86_64-windows-0.16.0.zip (fetch failed)",
        )).toBe("download");
        expect(classifyDownloadFailure(
            "download of https://example.org/appimage.tar.gz failed with HTTP 502",
        )).toBe("download");
    });

    it("leaves failures that are not downloads alone", () => {
        expect(classifyDownloadFailure("Error: EPERM: operation not permitted, mkdir 'E:\\'")).toBeNull();
        expect(classifyDownloadFailure("Error: connect ECONNREFUSED 127.0.0.1:9000")).toBeNull();
        expect(classifyDownloadFailure("Build cancelled")).toBeNull();
        // The class name only counts where a stack names it, not mid-sentence.
        expect(classifyDownloadFailure("the step that raised a RequestError earlier was retried")).toBeNull();
    });
});

describe("downloadFailureHints", () => {
    const en = createTranslator("en");

    it("points a download failure at the network settings", () => {
        const lines = downloadFailureHints("TypeError: fetch failed", en);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("Settings › Network");
    });

    it("adds the likelier cause under a certificate failure", () => {
        const lines = downloadFailureHints(CERTIFICATE_STACK, en);
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain("certificate");
    });

    it("says nothing about a failure that is not a download", () => {
        expect(downloadFailureHints("Error: EPERM: operation not permitted, mkdir 'E:\\'", en)).toEqual([]);
    });

    it("names the settings section in the author's language", () => {
        const [line] = downloadFailureHints("TypeError: fetch failed", createTranslator("zh"));
        expect(line).toContain(createTranslator("zh").t("settings.categories.network.label"));
        expect(line).not.toContain("{section}");
    });
});
