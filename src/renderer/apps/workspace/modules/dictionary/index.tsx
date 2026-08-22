import { BookMarked } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { DictionaryPanel } from "./DictionaryPanel";
import { DICTIONARY_PANEL_ID, type DictionaryPanelPayload } from "./openDictionaryPanel";

/**
 * Dictionary panel (right dock).
 *
 * A static module, like the variables panel beside it, because what it edits is a PROJECT resource:
 * the terms live in `editor/dictionary.json` and are authored here, so the panel has to be reachable
 * without a story open. What the story editor adds is the other direction - a term added from a row,
 * and a mark that opens this panel on the entry behind it.
 *
 * `order: 2` puts it under Variables, so the panels that are always on the rail stay adjacent and
 * the story editor's own transient panels remain a contiguous block below them. `defaultVisible`
 * stays false: the win is that the icon is always present, and flipping this would rewrite the saved
 * right-dock layout of every existing project.
 */
export const dictionaryPanelModule: PanelModule<DictionaryPanelPayload> = {
    metadata: {
        id: DICTIONARY_PANEL_ID,
        // Resolved lazily on read (module registration runs before i18n init).
        titleKey: "placeholders.moduleTitles.dictionary",
        get title() {
            return translate("placeholders.moduleTitles.dictionary");
        },
        icon: <BookMarked className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 2,
    },
    component: DictionaryPanel,
};

export { DictionaryPanel } from "./DictionaryPanel";
export { DICTIONARY_PANEL_ID, openDictionaryPanel, type DictionaryPanelPayload } from "./openDictionaryPanel";
