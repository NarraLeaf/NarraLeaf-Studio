export type ImageFillMode = "cover" | "contain" | "stretch" | "crop" | "tile";

export interface ImageFillCropPlacement {
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
}

export interface ImageFill {
    mode: ImageFillMode;
    assetId?: string | null;
    cropPlacement?: ImageFillCropPlacement;
}
