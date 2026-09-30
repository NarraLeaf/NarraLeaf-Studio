/**
 * How a lane reaches the game's global blueprint with a pointer input.
 *
 * A key press reaches the global blueprint from the one listener the running game installs on the
 * window (`app/keyboardOwner`). A pointer input has no such place: it lands on whatever lane is
 * under it, and the first lane it lands on is the only thing that knows what it was - which gesture,
 * which device, and what was under the pointer. So the game hands every lane it draws this one
 * function, and the lane calls it before answering the input itself.
 *
 * The function is the game's, not the lane's. It runs the global blueprint on the host every other
 * global dispatch uses, so an `On Action` on the global blueprint does the same thing whether a key
 * or a click raised it, and whichever lane the click happened to land on.
 *
 * Absent (null) wherever nothing is running a game: the editor's previews and a version diff draw
 * surfaces with no global blueprint behind them, and a click on a picture must not start one.
 *
 * Comments in English per project convention.
 */

import { createContext } from "react";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import type { UIInputActionEventPayload } from "@shared/types/ui-editor/inputActionEvent";

/**
 * Run the global blueprint's `On Action` heads for these actions, resolving once they have run.
 *
 * `eventControl` is the input's own: a global handler that stops propagation on it keeps the input
 * from whatever is on screen, exactly as it does for a key. Never rejects - a failure is the game's
 * to report, and a lane waiting on this must not be left holding a rejected promise.
 */
export type GlobalInputActionAnswerer = (
    payloads: readonly UIInputActionEventPayload[],
    eventControl: BehaviorGraphEventControl,
) => Promise<void>;

export const GlobalInputActionContext = createContext<GlobalInputActionAnswerer | null>(null);
