import { AssetType } from "../assets/assetTypes";
import type { Asset } from "../assets/types";
import { AssetsService } from "../core/AssetsService";
import { Service } from "../Service";
import { IUIEditorFontFaceService, Services, WorkspaceContext } from "../services";

export type EditorFontAcquireResult =
    | { ok: true; cssFamily: string }
    | { ok: false; error: string };

type FontEntry = {
    refCount: number;
    readonly cssFamily: string;
    loaded?: {
        blobUrl: string;
        fontFace: FontFace;
    };
    loading?: Promise<EditorFontAcquireResult>;
};

const UNSUPPORTED_FORMATS = new Set(["ttc", "otc", "eot", "svg"]);

function cssFamilyForAssetId(assetId: string): string {
    return `nlEditorFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function formatHint(format: string): string | null {
    const f = format.toLowerCase().replace(/^\./, "");
    if (UNSUPPORTED_FORMATS.has(f)) {
        return null;
    }
    const map: Record<string, string> = {
        woff2: "woff2",
        woff: "woff",
        ttf: "truetype",
        otf: "opentype",
    };
    return map[f] ?? null;
}

/**
 * Ref-counted FontFace registration for UI editor previews (canvas + inspector).
 * Ties blob URLs to document.fonts entries and tears them down when unused.
 */
export class UIEditorFontFaceService extends Service<UIEditorFontFaceService> implements IUIEditorFontFaceService {
    private assetsService: AssetsService | null = null;
    private readonly entries = new Map<string, FontEntry>();
    private unsubscribers: Array<() => void> = [];

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        await depend([assetsService]);
        this.assetsService = assetsService;

        this.unsubscribers.push(
            assetsService.getEvents().on("deleted", (asset: Asset<AssetType>) => {
                if (asset.type === AssetType.Font) {
                    this.invalidate(asset.id);
                }
            }),
            assetsService.getEvents().on("updated", (asset: Asset<AssetType>) => {
                if (asset.type === AssetType.Font) {
                    this.invalidate(asset.id);
                }
            }),
        );
    }

    public dispose(_ctx: WorkspaceContext): void | Promise<void> {
        for (const u of this.unsubscribers) {
            u();
        }
        this.unsubscribers = [];
        for (const id of [...this.entries.keys()]) {
            this.invalidate(id);
        }
        this.assetsService = null;
    }

    public async acquire(assetId: string): Promise<EditorFontAcquireResult> {
        const assetsService = this.assetsService;
        if (!assetsService) {
            return { ok: false, error: "Assets service not ready" };
        }

        let entry = this.entries.get(assetId);
        if (!entry) {
            entry = { refCount: 0, cssFamily: cssFamilyForAssetId(assetId) };
            this.entries.set(assetId, entry);
        }
        entry.refCount += 1;

        if (entry.loaded) {
            return { ok: true, cssFamily: entry.cssFamily };
        }

        if (!entry.loading) {
            entry.loading = this.loadIntoEntry(assetId, entry).finally(() => {
                const current = this.entries.get(assetId);
                if (current) {
                    current.loading = undefined;
                }
            });
        }

        const result = await entry.loading;
        if (!result.ok) {
            entry.refCount -= 1;
            if (entry.refCount <= 0) {
                this.entries.delete(assetId);
            }
        }
        return result;
    }

    public release(assetId: string): void {
        const entry = this.entries.get(assetId);
        if (!entry) {
            return;
        }
        entry.refCount -= 1;
        if (entry.refCount <= 0) {
            this.teardownLoaded(entry);
            this.entries.delete(assetId);
        }
    }

    public invalidate(assetId: string): void {
        const entry = this.entries.get(assetId);
        if (!entry) {
            return;
        }
        this.teardownLoaded(entry);
        this.entries.delete(assetId);
    }

    private teardownLoaded(entry: FontEntry): void {
        if (!entry.loaded) {
            return;
        }
        try {
            void document.fonts.delete(entry.loaded.fontFace);
        } catch {
            // ignore
        }
        URL.revokeObjectURL(entry.loaded.blobUrl);
        entry.loaded = undefined;
    }

    private async loadIntoEntry(assetId: string, entry: FontEntry): Promise<EditorFontAcquireResult> {
        const assetsService = this.assetsService;
        if (!assetsService) {
            return { ok: false, error: "Assets service not ready" };
        }

        const asset = assetsService.getAssets()[AssetType.Font]?.[assetId];
        if (!asset) {
            return { ok: false, error: "Font asset not found" };
        }

        const extFmt = (asset.ext ?? "").toLowerCase().replace(/^\./, "");
        if (extFmt && UNSUPPORTED_FORMATS.has(extFmt)) {
            return {
                ok: false,
                error: `Font format ".${extFmt}" is not supported in the editor`,
            };
        }

        const fetched = await assetsService.fetch(asset);
        if (!fetched.success || !fetched.data?.data) {
            return { ok: false, error: fetched.error ?? "Failed to load font" };
        }

        const buffer = fetched.data.data;
        const metaFmt = fetched.data.metadata.format.toLowerCase().replace(/^\./, "");
        const resolvedFormat = metaFmt || extFmt;
        if (UNSUPPORTED_FORMATS.has(resolvedFormat)) {
            return {
                ok: false,
                error: `Font format ".${resolvedFormat}" is not supported in the editor`,
            };
        }
        const finalHint = formatHint(resolvedFormat);
        if (finalHint === null) {
            return { ok: false, error: "Font format is not supported in the editor" };
        }

        if (this.entries.get(assetId) !== entry) {
            return { ok: false, error: "Font load aborted" };
        }

        const mimeByHint: Record<string, string> = {
            woff2: "font/woff2",
            woff: "font/woff",
            truetype: "font/ttf",
            opentype: "font/otf",
        };
        const mime = mimeByHint[finalHint] ?? "application/octet-stream";

        const blob = new Blob([new Uint8Array(buffer)], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const src = `url(${blobUrl}) format('${finalHint}')`;

        let fontFace: FontFace;
        try {
            fontFace = new FontFace(entry.cssFamily, src);
            await fontFace.load();
            document.fonts.add(fontFace);
        } catch (err) {
            URL.revokeObjectURL(blobUrl);
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        if (this.entries.get(assetId) !== entry) {
            try {
                void document.fonts.delete(fontFace);
            } catch {
                // ignore
            }
            URL.revokeObjectURL(blobUrl);
            return { ok: false, error: "Font load aborted" };
        }

        entry.loaded = { blobUrl, fontFace };
        return { ok: true, cssFamily: entry.cssFamily };
    }
}
