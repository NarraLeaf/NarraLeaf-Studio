import { describeUnattendedRefusal } from "@shared/types/commandLineRun";
import { Services, type WorkspaceContext } from "../services/services";
import { UIService } from "../services/core/UIService";

/**
 * The renderer's half of "a window with nobody at the screen may not ask anybody anything".
 *
 * The main process refuses the questions it raises - file pickers, a plugin's permission prompt
 * (`unattendedPrompt.ts`). Two more can be raised from inside this page, and a command-line run's
 * page draws no interface to show them in:
 *
 * - **A workspace dialog** (`UIService.dialogs`). It is a promise resolved by a button in the
 *   dialog layer, and a run's window mounts no layer at all - so the promise never settles, and
 *   whatever awaited it waits for the run's thirty-minute silence deadline.
 * - **`alert()`, `confirm()` and `prompt()`**, which a plugin's code can call as easily as Studio's.
 *   Chromium blocks the whole page on them until somebody answers.
 *
 * Either ends the run on the spot as an `environment` refusal naming what was asked, for the reason
 * the main process's refusal does: a run that could not ask what the person at a screen would have
 * been asked has not answered the question it was run for. The page's own three are answered as a
 * closed box would answer them (nothing, `false`, `null`) so the code that called one moves on while
 * the process exits.
 *
 * Returns the undo, for completeness; a run's window never needs it, since the process exits with
 * the run.
 */
export function guardUnattendedWindow(
    context: WorkspaceContext,
    refuse: (message: string) => void,
): () => void {
    let refused = false;
    const refuseOnce = (what: string) => {
        if (refused) {
            return;
        }
        refused = true;
        refuse(describeUnattendedRefusal(what));
    };

    const ui = context.services.get<UIService>(Services.UI);
    const stopDialogs = ui.getEvents().on("dialogOpened", dialog => {
        refuseOnce(`Something in this run opened a dialog${dialog.title ? ` ("${dialog.title}")` : ""}`);
    });

    const page = window as Window & typeof globalThis;
    const originals = { alert: page.alert, confirm: page.confirm, prompt: page.prompt };
    page.alert = (message?: unknown) => {
        refuseOnce(`Something in this run called alert(${quote(message)})`);
    };
    page.confirm = (message?: string) => {
        refuseOnce(`Something in this run called confirm(${quote(message)})`);
        return false;
    };
    page.prompt = (message?: string) => {
        refuseOnce(`Something in this run called prompt(${quote(message)})`);
        return null;
    };

    return () => {
        stopDialogs();
        page.alert = originals.alert;
        page.confirm = originals.confirm;
        page.prompt = originals.prompt;
    };
}

function quote(message: unknown): string {
    return message === undefined ? "" : JSON.stringify(String(message));
}
