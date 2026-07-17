import { Users } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { CharacterPanel } from "./CharacterPanel";

/** Exported so callers can reveal the panel without re-typing the id (e.g. "Create character"). */
export const CHARACTERS_PANEL_ID = "narraleaf-studio:characters";

export const charactersModule: PanelModule = {
    metadata: {
        id: CHARACTERS_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.characters",
        get title() {
            return translate("placeholders.moduleTitles.characters");
        },
        icon: <Users className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: true,
        order: 10,
    },
    component: CharacterPanel,
};

