import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSource } from "@/lib/workspace/services/assets/types";

/** Prefix for system / generic stacks selectable without a project font file */
export const BUILTIN_EDITOR_FONT_ID_PREFIX = "builtin:font:" as const;

type BuiltinFontDef = {
    id: string;
    name: string;
    /** Full CSS font-family value for Chromium */
    cssFamily: string;
    description?: string;
};

/**
 * Built-in editor font entries: generic families and common system font stacks
 * supported by Chromium on typical desktop OS installs.
 */
const BUILTIN_FONT_DEFS: BuiltinFontDef[] = [
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}system-ui`,
        name: "System UI",
        cssFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        description: "Platform UI font stack",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}sans-serif`,
        name: "Sans-serif (generic)",
        cssFamily: "sans-serif",
        description: "Generic sans-serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}serif`,
        name: "Serif (generic)",
        cssFamily: "serif",
        description: "Generic serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}monospace`,
        name: "Monospace (generic)",
        cssFamily: "monospace",
        description: "Generic monospace",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}arial`,
        name: "Arial / Helvetica",
        cssFamily: "Arial, Helvetica, sans-serif",
        description: "Common Latin sans-serif stack",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}times`,
        name: "Times New Roman",
        cssFamily: '"Times New Roman", Times, serif',
        description: "Common serif stack",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}georgia`,
        name: "Georgia",
        cssFamily: "Georgia, 'Times New Roman', serif",
        description: "Screen-oriented serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}courier`,
        name: "Courier New",
        cssFamily: '"Courier New", Courier, monospace',
        description: "Common monospace stack",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}verdana`,
        name: "Verdana",
        cssFamily: "Verdana, Geneva, sans-serif",
        description: "Wide metrics sans-serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}trebuchet`,
        name: "Trebuchet MS",
        cssFamily: '"Trebuchet MS", sans-serif',
        description: "Humanist sans-serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}consolas`,
        name: "Consolas",
        cssFamily: 'Consolas, "Courier New", monospace',
        description: "Common code font stack (Windows / fallback)",
    },
];

const CSS_BY_ID = new Map<string, string>();
const NAME_BY_ID = new Map<string, string>();

function toVirtualAsset(def: BuiltinFontDef): Asset<AssetType.Font, AssetSource.Local> {
    return {
        id: def.id,
        type: AssetType.Font,
        name: def.name,
        hash: def.id,
        source: AssetSource.Local,
        meta: {},
        tags: ["builtin", "system-font"],
        description: def.description ?? "",
    };
}

for (const def of BUILTIN_FONT_DEFS) {
    CSS_BY_ID.set(def.id, def.cssFamily);
    NAME_BY_ID.set(def.id, def.name);
}

/** Virtual assets for AssetSelector.virtualGroups */
export const EDITOR_BUILTIN_FONT_ASSETS: Asset<AssetType.Font, AssetSource.Local>[] =
    BUILTIN_FONT_DEFS.map(toVirtualAsset);

/** Single virtual group: Built-in fonts (Chromium-friendly stacks) */
export const EDITOR_BUILTIN_FONT_VIRTUAL_GROUP = {
    id: "editor-builtin-fonts",
    title: "Built-in fonts",
    defaultExpanded: true,
    assets: EDITOR_BUILTIN_FONT_ASSETS,
};

export function isBuiltinEditorFontAssetId(assetId: string): boolean {
    return assetId.startsWith(BUILTIN_EDITOR_FONT_ID_PREFIX);
}

export function getBuiltinEditorFontCssFamily(assetId: string): string | null {
    return CSS_BY_ID.get(assetId) ?? null;
}

export function getBuiltinEditorFontDisplayName(assetId: string): string | null {
    return NAME_BY_ID.get(assetId) ?? null;
}
