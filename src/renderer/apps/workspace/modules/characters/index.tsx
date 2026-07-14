import { Users } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { CharacterPanel } from "./CharacterPanel";

export const charactersModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:characters",
        // Resolved lazily on read (module registration runs after i18n init).
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

