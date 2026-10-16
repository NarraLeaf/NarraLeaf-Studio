import { Mic } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { VoicePanel } from "./VoicePanel";

export const voicePanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:voice",
        // The header and rail read the key, so they follow a live language switch; `title` is
        // captured as a string at registration.
        titleKey: "placeholders.moduleTitles.voice",
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
