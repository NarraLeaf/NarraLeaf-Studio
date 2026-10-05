import { useEffect } from "react";
import { ListChecks } from "lucide-react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import type { LintService } from "@/lib/workspace/services/core/LintService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { useWorkspace } from "../../context";
import { LINT_PROJECT_COMMAND_ID, PROBLEMS_PANEL_ID } from "./lintIds";
import { publishRowProblems, setProblemsPanelOpener } from "./rowProblems";

/**
 * The project check's two standing duties in a workspace window: keeping the findings current while
 * the project is edited, and the palette entry that checks it afresh (ruling R3).
 *
 * Mounted by the workspace layout, which is exactly the window that should run checks in the
 * background - a command-line `--lint` or `--build` opens the same project without it, sweeps once,
 * and leaves no schedule behind.
 *
 * **No `when` gate on the command, deliberately.** A sweep is read-only, so the entry stays listed
 * and runnable while the workspace is frozen - inspecting a frozen revision is exactly when an
 * author wants to ask what is wrong with it. That the exemption is intended is recorded in
 * `freezeActionPolicy`'s command table, which the panel's re-check control also reads.
 *
 * The panel opens immediately and the sweep runs behind it: the findings already on show stay there
 * meanwhile, marked as being checked, and progress is on the `lint` console channel.
 */
export function LintCommands() {
    const { context, isInitialized } = useWorkspace();

    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        const lintService = context.services.get<LintService>(Services.Lint);
        // The scene editor's row marks read the same report the panel lists, through a store of
        // their own so a new report re-renders only the rows whose findings changed.
        publishRowProblems(lintService.getLastReport());
        const offReport = lintService.onReportChanged(publishRowProblems);
        setProblemsPanelOpener(() => context.services.get<UIService>(Services.UI).panels.show(PROBLEMS_PANEL_ID));
        const releaseLive = lintService.startLive();
        return () => {
            releaseLive();
            offReport();
            setProblemsPanelOpener(null);
            publishRowProblems(null);
        };
    }, [context, isInitialized]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);

        return commandService.register({
            id: LINT_PROJECT_COMMAND_ID,
            titleKey: "lint.command.runProject",
            categoryKey: "lint.command.category",
            icon: <ListChecks className="w-4 h-4" />,
            run: () => {
                context.services.get<UIService>(Services.UI).panels.show(PROBLEMS_PANEL_ID);
                void context.services.get<LintService>(Services.Lint).run().catch(error => {
                    // A sweep that cannot even assemble its context has nothing to report *into* -
                    // the panel stays on whatever it had. Logged rather than raised: the one
                    // message an author needs about a broken project is the findings themselves.
                    console.warn("[LintCommands] project check failed", error);
                });
            },
        });
    }, [context]);

    return null;
}
