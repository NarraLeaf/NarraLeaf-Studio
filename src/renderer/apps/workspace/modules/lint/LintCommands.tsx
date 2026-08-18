import { useEffect } from "react";
import { ListChecks } from "lucide-react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { useWorkspace } from "../../context";
import { LINT_PROJECT_COMMAND_ID } from "./lintIds";
import { runProjectLint } from "./lintRunController";
import { openLintReportTab } from "./openLintReportTab";

/**
 * The palette entry that sweeps the project (ruling R3).
 *
 * Registered from a mounted component rather than declared in a table, the way
 * {@link WorkspaceFreezeCommands} is: the registration closes over the live workspace context and
 * the disposer unregisters it when the project window goes away.
 *
 * **No `when` gate, deliberately.** A sweep is read-only, so the entry stays listed and runnable
 * while the workspace is frozen - inspecting a frozen revision is exactly when an author wants to
 * ask what is wrong with it. That the exemption is intended, rather than an omission nobody noticed,
 * is recorded in `freezeActionPolicy`'s command table, which is what the report tab's re-run control
 * reads.
 *
 * The tab opens immediately and the sweep runs behind it, rather than the other way round: the run
 * takes seconds on a real project, and a palette entry that appeared to do nothing for that long
 * would be pressed twice. Progress is on the `lint` console channel meanwhile.
 */
export function LintCommands() {
  const { context } = useWorkspace();

  useEffect(() => {
    if (!context) {
      return;
    }
    const commandService = context.services.get<CommandService>(Services.Command);

    return commandService.register({
      id: LINT_PROJECT_COMMAND_ID,
      titleKey: "lint.command.runProject",
      categoryKey: "lint.command.category",
      // The report tab's own glyph (`openLintReportTab`): one sweep, one mark for it.
      icon: <ListChecks className="w-4 h-4" />,
      run: () => {
        openLintReportTab(context);
        void runProjectLint(context).catch((error) => {
          // A sweep that cannot even assemble its context has nothing to report *into* -
          // the tab is open and stays on whatever it had. Logged rather than raised: the
          // one message an author needs about a broken project is the report itself.
          console.warn("[LintCommands] project lint failed", error);
        });
      }
    });
  }, [context]);

  return null;
}
