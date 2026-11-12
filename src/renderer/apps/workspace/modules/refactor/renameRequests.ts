import { useEffect, useRef } from "react";
import type { RenameRequest } from "@/lib/workspace/services/refactor/resolveRename";

/**
 * "Rename this, with a preview" - asked from wherever the author is (a panel row, a story row's
 * menu, the command palette) and answered by the one dialog `RenamePreviewHost` keeps mounted in the
 * workspace shell.
 *
 * A request names the thing by id only. The host reads its current name and every reference when the
 * dialog opens, so a request built from a row that has since changed still previews what is there.
 */
export type { RenameRequest };

const listeners = new Set<(request: RenameRequest) => void>();

export function requestRename(request: RenameRequest): void {
    listeners.forEach(listener => listener(request));
}

export function useRenameRequests(onRequest: (request: RenameRequest) => void): void {
    const handler = useRef(onRequest);
    handler.current = onRequest;
    useEffect(() => {
        const listener = (request: RenameRequest) => handler.current(request);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);
}
