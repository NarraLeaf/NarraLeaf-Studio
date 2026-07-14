import { Terminal } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { ConsolePanel } from "./ConsolePanel";
import { PanelPosition } from "../../registry/types";

/**
 * Console panel module
 * Displays application logs and console output
 */
export const consoleModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:console",
        get title() { return translate("placeholders.moduleTitles.console"); },
        icon: <Terminal className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        order: 0,
    },
    component: ConsolePanel,
};

