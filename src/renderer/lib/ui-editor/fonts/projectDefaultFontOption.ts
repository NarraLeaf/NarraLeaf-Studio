import type { AssetSelectorVirtualGroup } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource } from "@/lib/workspace/services/assets/types";

/**
 * "Project default font" as a row in the font picker.
 *
 * **This id is never stored.** A widget follows the project by holding no font at all - see
 * `@shared/types/typography` for why absence is the state rather than a link - so the field that
 * offers this row maps it back to null the moment it is picked. It exists only so that the choice
 * is somewhere an author can press: having picked a typeface and changed their mind, "put it back"
 * has to be a row in the same list, not a Clear button they have to guess the meaning of.
 *
 * The `project:` prefix is a space of its own, distinct from the `builtin:font:` stacks, so nothing
 * downstream can confuse the offer with a font that resolves to something.
 *
 * Comments in English per project convention.
 */
export const PROJECT_DEFAULT_FONT_OPTION_ID = "project:font:default" as const;

/**
 * The one-row group the picker shows above the built-in stacks.
 *
 * Built per call from strings the caller translates: this module is reached from an inspector field
 * that already has the catalogue in hand, and a name baked in here would be an English word in a zh
 * Studio - the failure `@shared/types/brand` documents for the seeded colours.
 */
export function projectDefaultFontVirtualGroup(title: string, name: string): AssetSelectorVirtualGroup {
    return {
        id: "project-default-font",
        title,
        defaultExpanded: true,
        assets: [{
            id: PROJECT_DEFAULT_FONT_OPTION_ID,
            type: AssetType.Font,
            name,
            hash: PROJECT_DEFAULT_FONT_OPTION_ID,
            source: AssetSource.Local,
            meta: {},
            tags: [],
            description: "",
        }],
    };
}
