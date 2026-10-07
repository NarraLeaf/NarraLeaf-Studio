import type { AssetSelectorVirtualGroup } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { translate } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import type { TranslationKey } from "@shared/i18n";

/** Prefix for system / generic stacks selectable without a project font file */
export const BUILTIN_EDITOR_FONT_ID_PREFIX = "builtin:font:" as const;

/** What kind of typeface a stack is, which is what the picker prints under its name. */
type BuiltinFontKind = "system" | "sansSerif" | "serif" | "monospace";

type BuiltinFontDef = {
    id: string;
    /**
     * A typeface's own name, printed as it is in every language (Arial is Arial in a zh Studio).
     * Absent for a generic stack, whose name is a word and so comes from the catalog.
     */
    name?: string;
    kind: BuiltinFontKind;
    /** Full CSS font-family value for Chromium */
    cssFamily: string;
};

/**
 * Built-in editor font entries: generic families and common system font stacks
 * supported by Chromium on typical desktop OS installs.
 */
const BUILTIN_FONT_DEFS: BuiltinFontDef[] = [
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}system-ui`,
        kind: "system",
        cssFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}sans-serif`,
        kind: "sansSerif",
        cssFamily: "sans-serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}serif`,
        kind: "serif",
        cssFamily: "serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}monospace`,
        kind: "monospace",
        cssFamily: "monospace",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}arial`,
        name: "Arial / Helvetica",
        kind: "sansSerif",
        cssFamily: "Arial, Helvetica, sans-serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}times`,
        name: "Times New Roman",
        kind: "serif",
        cssFamily: '"Times New Roman", Times, serif',
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}georgia`,
        name: "Georgia",
        kind: "serif",
        cssFamily: "Georgia, 'Times New Roman', serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}courier`,
        name: "Courier New",
        kind: "monospace",
        cssFamily: '"Courier New", Courier, monospace',
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}verdana`,
        name: "Verdana",
        kind: "sansSerif",
        cssFamily: "Verdana, Geneva, sans-serif",
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}trebuchet`,
        name: "Trebuchet MS",
        kind: "sansSerif",
        cssFamily: '"Trebuchet MS", sans-serif',
    },
    {
        id: `${BUILTIN_EDITOR_FONT_ID_PREFIX}consolas`,
        name: "Consolas",
        kind: "monospace",
        cssFamily: 'Consolas, "Courier New", monospace',
    },
];

/** The catalog word for each kind: the generic stack's name, and the line under every stack's name. */
const GENERIC_NAME_KEYS: Record<BuiltinFontKind, TranslationKey> = {
    system: "brand.fonts.builtin.systemUi",
    sansSerif: "brand.fonts.builtin.sansSerif",
    serif: "brand.fonts.builtin.serif",
    monospace: "brand.fonts.builtin.monospace",
};

const KIND_KEYS: Record<BuiltinFontKind, TranslationKey> = {
    system: "brand.fonts.builtin.kind.system",
    sansSerif: "brand.fonts.builtin.kind.sansSerif",
    serif: "brand.fonts.builtin.kind.serif",
    monospace: "brand.fonts.builtin.kind.monospace",
};

const CSS_BY_ID = new Map<string, string>();
const DEF_BY_ID = new Map<string, BuiltinFontDef>();

for (const def of BUILTIN_FONT_DEFS) {
    CSS_BY_ID.set(def.id, def.cssFamily);
    DEF_BY_ID.set(def.id, def);
}

function displayName(def: BuiltinFontDef): string {
    return def.name ?? translate(GENERIC_NAME_KEYS[def.kind]);
}

/**
 * One stack as a picker row, named in the interface's language when it is generic.
 *
 * No tags: the picker prints a row's tags under its name, and these are not files an author tagged.
 * The line under the name is the description - the kind of typeface - which the picker prints for
 * its caller-supplied rows instead.
 */
function toVirtualAsset(def: BuiltinFontDef): Asset<AssetType.Font, AssetSource.Local> {
    return {
        id: def.id,
        type: AssetType.Font,
        name: displayName(def),
        hash: def.id,
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: translate(KIND_KEYS[def.kind]),
    };
}

/**
 * The font picker's built-in group, built per call so its words are in the interface's language at
 * the moment the picker opens - a group built once at module load would keep the language Studio
 * started in.
 */
export function editorBuiltinFontVirtualGroup(): AssetSelectorVirtualGroup {
    return {
        id: "editor-builtin-fonts",
        title: translate("brand.fonts.builtin.group"),
        defaultExpanded: true,
        assets: BUILTIN_FONT_DEFS.map(toVirtualAsset),
    };
}

export function isBuiltinEditorFontAssetId(assetId: string): boolean {
    return assetId.startsWith(BUILTIN_EDITOR_FONT_ID_PREFIX);
}

export function getBuiltinEditorFontCssFamily(assetId: string): string | null {
    return CSS_BY_ID.get(assetId) ?? null;
}

export function getBuiltinEditorFontDisplayName(assetId: string): string | null {
    const def = DEF_BY_ID.get(assetId);
    return def ? displayName(def) : null;
}
