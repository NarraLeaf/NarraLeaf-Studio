import { ListChecks } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { PROBLEMS_PANEL_ID } from "./lintIds";
import { ProblemsPanel } from "./ProblemsPanel";

/**
 * The Problems panel, in the bottom dock.
 *
 * A panel rather than the editor tab the report used to be: a document is something an author opens
 * to read, and these findings are something they keep in view while they work - beside the Console,
 * the way a code editor keeps its problems list under the code.
 */
export const problemsPanelModule: PanelModule = {
    metadata: {
        id: PROBLEMS_PANEL_ID,
        titleKey: "placeholders.moduleTitles.problems",
        get title() {
            return translate("placeholders.moduleTitles.problems");
        },
        // The mark the check command has always carried: one subject, one glyph.
        icon: <ListChecks className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        // Right after the Console, the bottom dock's first resident.
        order: 1,
    },
    component: ProblemsPanel,
};
