import { Users } from "lucide-react";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { CharacterPanel } from "./CharacterPanel";

export const charactersModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:characters",
        title: "Characters",
        icon: <Users className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: true,
        order: 1,
    },
    component: CharacterPanel,
};

