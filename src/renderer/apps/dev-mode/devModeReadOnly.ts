import { createContext, useContext } from "react";

/**
 * True while an agent's play-test holds this Dev Mode session. The author may watch and open the
 * debug tools, but nothing that changes the running game: fast-forward, jumping to a row, editing a
 * variable, loading or deleting a save, breakpoints and stepping, the safe-area overlay (it would be
 * in the agent's screenshots), and dismissing issues (the agent is told about the same ones).
 */
export const DevModeReadOnlyContext = createContext(false);

export function useDevModeReadOnly(): boolean {
    return useContext(DevModeReadOnlyContext);
}
