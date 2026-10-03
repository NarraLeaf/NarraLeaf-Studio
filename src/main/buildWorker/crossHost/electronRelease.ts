import { downloadArtifact } from "@electron/get";
import { reportDownload } from "../downloadReporting";

/**
 * Electron's release zip for a platform Studio packages without that platform's tools.
 *
 * Fetched through `@electron/get`, the downloader electron-builder itself uses, with the same mirror
 * setting (`build.electronMirror`), the same checksum verification against the release's
 * SHASUMS256.txt and the same cache - so a zip any earlier build on this machine downloaded is not
 * downloaded again, by either path.
 */

const TRANSFER_ID_PREFIX = "electron-release";

export async function fetchElectronRelease(input: {
    version: string;
    platform: "darwin" | "linux";
    arch: "x64" | "arm64";
    mirror?: string;
}): Promise<string> {
    const id = `${TRANSFER_ID_PREFIX}-${input.platform}-${input.arch}`;
    let announced = false;
    try {
        return await downloadArtifact({
            version: input.version,
            platform: input.platform,
            arch: input.arch,
            artifactName: "electron",
            ...(input.mirror ? { mirrorOptions: { mirror: input.mirror } } : {}),
            downloadOptions: {
                quiet: true,
                // Called only when there is something to download: a cached zip reports nothing,
                // which is what it should look like.
                getProgressCallback: async (progress: { transferred: number; total?: number }) => {
                    if (!announced) {
                        announced = true;
                        reportDownload({ phase: "start", id, kind: "toolchainDownload" });
                    }
                    reportDownload({ phase: "advance", id, done: progress.transferred, total: progress.total ?? null });
                },
            },
        });
    } finally {
        if (announced) {
            reportDownload({ phase: "end", id });
        }
    }
}
