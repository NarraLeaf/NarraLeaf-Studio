import { createContext, useContext } from "react";
import type { EntryTextsProps } from "narraleaf-react";

/**
 * One entry of the NVL slot component's `dialogs` prop. NarraLeaf React does not export the
 * `NvlDialogProxy` name, so the shape is typed structurally through the exported
 * `EntryTextsProps` fields plus the proxy `index`.
 */
export type NvlSlotDialogProxy = Pick<
    EntryTextsProps,
    "entry" | "gameState" | "words" | "useTypeEffect" | "isActive"
> & {
    index: number;
};

/**
 * Raw NVL dialog proxies for the currently rendered NVL slot surface, keyed by item index.
 * Raw proxies hold class instances (GameState, Word) and must never flow through the JSON
 * list item store; the private `nl.nvl.texts` leaf reads them from this context instead.
 */
export const NvlSlotItemsContext = createContext<readonly NvlSlotDialogProxy[] | null>(null);

export function useNvlSlotItems(): readonly NvlSlotDialogProxy[] | null {
    return useContext(NvlSlotItemsContext);
}
