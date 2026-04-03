export type ImageObjectFit = "cover" | "contain" | "fill";

export type ImageWidgetProps = {
    /** Service asset id when using project assets */
    assetId: string;
    /** Optional external / legacy URL when assetId is empty */
    imageUrl: string;
    objectFit: ImageObjectFit;
    borderRadius: number;
    /** 0–1 displayed opacity */
    imageOpacity: number;
};

export const defaultImageWidgetProps: ImageWidgetProps = {
    assetId: "",
    imageUrl: "",
    objectFit: "cover",
    borderRadius: 0,
    imageOpacity: 1,
};
