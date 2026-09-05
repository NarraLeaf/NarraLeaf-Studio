import { getInterface } from "@/lib/app/bridge";
import type { FontCoverageResult } from "@shared/typography/fontCoverage";
import { sniffFontFormat } from "@shared/typography/fontFormats";
import { AssetData, AssetType, FontAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Asset } from "./types";
import { AssetServiceBase } from "./AssetServiceBase";

export class FontService extends AssetServiceBase {
    /** See {@link readCoverage}: keyed on id and content hash, held for the window. */
    private readonly coverage = new Map<string, Promise<FontCoverageResult>>();

    /**
     * What this font can draw, and which code pages its vendor declared.
     *
     * Answered by the main process (`fontAction.ts`), not here: WOFF2 wraps a font in a Brotli
     * stream and a renderer has no Brotli decompressor, so a `.woff2` in the library is simply
     * unreadable from this side. What crosses back is a range list rather than the file.
     *
     * Memoised for the window's lifetime, keyed on the asset's content hash where it has one. Both
     * callers ask repeatedly - `typography` lint asks once per language of the project, the Design
     * panel asks on every render of a row - and re-reading a thirty-megabyte CJK face for each is a
     * cost neither of them needs to pay. The hash in the key is what makes replacing a font's bytes
     * invalidate the answer; an asset with no hash yet is keyed on its id alone and re-read once the
     * hash arrives.
     *
     * Never throws. Every failure is an arm of {@link FontCoverageResult}, because a caller that
     * cannot read a font must say "cannot assert" rather than "covers nothing" - the second one puts
     * a glyph warning on every line of the script.
     */
    public async readCoverage(asset: Asset<AssetType.Font>): Promise<FontCoverageResult> {
        const key = `${asset.id}@${asset.hash ?? ""}`;
        const cached = this.coverage.get(key);
        if (cached) {
            return cached;
        }
        const pending = this.probeCoverage(asset).catch((): FontCoverageResult => ({
            ok: false,
            reason: "malformed",
        }));
        this.coverage.set(key, pending);
        return pending;
    }

    private async probeCoverage(asset: Asset<AssetType.Font>): Promise<FontCoverageResult> {
        const result = await getInterface().probeFontCoverage(this.getAssetPath(asset.id));
        return result.success && result.data
            ? result.data.result
            : { ok: false, reason: "malformed" };
    }

    public async readLocalFont(asset: Asset<AssetType.Font>): Promise<RequestStatus<AssetData<AssetType.Font>>> {
        const path = this.getAssetPath(asset.id);
        const fileResult = await this.getFileSystemService().readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read font file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        return this.readFontFromBuffer(asset, fileResult.data);
    }

    public async readFontFromBuffer(asset: Asset<AssetType.Font>, buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.Font>>> {
        const size = buffer.byteLength;
        const format = this.detectFontFormat(asset, buffer);

        try {
            const metadata = await this.getFontMetadata(buffer, format);

            return {
                success: true,
                data: {
                    data: buffer,
                    metadata: {
                        ...metadata,
                        format,
                        size,
                    },
                },
            };
        } catch (_error) {
            return {
                success: true,
                data: {
                    data: buffer,
                    metadata: {
                        format,
                        size,
                    },
                },
            };
        }
    }


    private async getFontMetadata(buffer: Uint8Array, format: string): Promise<Partial<Omit<FontAssetMetadata, 'format' | 'size'>>> {
        // Font metadata extraction is complex and requires parsing font tables
        // For now, we'll return empty metadata
        // In the future, can use libraries like opentype.js for detailed parsing
        return {};
    }

    /**
     * What format this font is, asked of the bytes before the name.
     *
     * The name is a guess and the bytes are a statement, and the guess fails in a way that is not
     * visible: an asset with no `ext` and no dot in its name - what every library entry written by
     * anything other than Studio's own import looks like, the shipped skeleton's included - guessed
     * `"unknown"`, and `UIEditorFontFaceService` reads a format it has no `format()` hint for as one
     * it cannot draw. So a perfectly ordinary TrueType was reported to the author as
     * "Font format is not supported in the editor" and the canvas drew the interface font instead.
     *
     * The name still answers when the bytes cannot - a file too short to carry a tag, or a format
     * this build does not know - so nothing that worked before stops working.
     */
    private detectFontFormat(asset: Asset, buffer?: Uint8Array): string {
        return sniffFontFormat(buffer) ?? asset.ext ?? this.detectFromName(asset.name);
    }

    private detectFromName(name: string): string {
        const parts = name.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown';
    }
}

