import { Mic } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { VoicePanel } from "./VoicePanel";

export const voicePanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:voice",
        // Resolved lazily on read (module registration runs after i18n init).
        get title() {
            return translate("placeholders.moduleTitles.voice");
        },
        icon: <Mic className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: 26,
    },
    component: VoicePanel,
};

export { VoicePanel };
