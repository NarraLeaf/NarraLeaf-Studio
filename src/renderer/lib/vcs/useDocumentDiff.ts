import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { RevisionId } from "@shared/types/vcs";
import { Services } from "@/lib/workspace/services/services";
import type { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * One comparison, read once and only when someone asks for it.
 *
 * Shared by the version rail's in-place summary and the `vcs-changes` tab, because they are the same
 * read with a different amount of room to draw it in - and because the rule the read has to obey is
 * easy to break twice. **Nothing here is on a timer and nothing re-reads on its own.** A working-tree
 * comparison scans, and a scan is not a pure read: discovering a new directory records it into the
 * repository's staged state, so anything periodic reports deletions the author never made
 * (docs/version-control.md §4.17). The read happens when {@link UseDocumentDiffOptions.enabled}
 * turns true, and afterwards only through {@link DocumentDiffState.reload}.
 *
 * A read-only surface by construction, so nothing here consults the freeze: a frozen workspace is
 * exactly the state an author is in while they are trying to find out what a past version says.
 */

export type DocumentDiffRequest =
    /**
     * `readRequest` asks for a fresh read when it changes: the way back into an open comparison after
     * the author has changed something, which is a request for the list as it is now.
     */
    | { readonly mode: "working-tree"; readonly readRequest?: number }
    | { readonly mode: "between"; readonly from: RevisionId; readonly to: RevisionId };

/** The two result shapes' common half, which is all either surface draws. */
export interface DocumentDiffResult {
    readonly documents: DocumentDiffEntry[];
    /** Changed paths this stands for, whether or not `documents` carries them. */
    readonly pathCount: number;
    /** False = a budget stopped the comparison short. A surface that ignores it lies by omission. */
    readonly complete: boolean;
    /**
     * Why no bytes could be fetched, when that is what happened.
     *
     * Not the same fact as an empty `documents`, and the opposite one: "nothing changed" and "nobody
     * could read it" are the same empty list (docs §4.29).
     */
    readonly readFailure: string | null;
    /** The revision the working tree was compared against; absent in a repository with no revisions. */
    readonly head?: RevisionId;
}

export interface DocumentDiffState {
    /** True while a read is out. The first one is always a round trip to the main process. */
    readonly loading: boolean;
    /** The read failed outright - a channel error or an unavailable backend, already stringified. */
    readonly error: string | null;
    /** Null until a read has answered. Null and an empty list are different facts. */
    readonly result: DocumentDiffResult | null;
    /** Read again. The only way a comparison is ever re-read. */
    readonly reload: () => void;
}

export interface UseDocumentDiffOptions {
    /**
     * Whether the comparison is wanted at all.
     *
     * The rail passes "a row is expanded", so an author who never opens one never pays for a scan.
     */
    readonly enabled: boolean;
}

export function useDocumentDiff(
    request: DocumentDiffRequest,
    options: UseDocumentDiffOptions = { enabled: true },
): DocumentDiffState {
    const { context } = useWorkspace();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<DocumentDiffResult | null>(null);
    const generation = useRef(0);

    const service = useMemo(
        () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    // The request as a value, so an inline object literal at the call site does not re-read on every
    // render - which is the shape this hook is most likely to be used in and the one way it could
    // silently become a poll.
    const key = request.mode === "between"
        ? `between:${request.from}:${request.to}`
        : `working-tree:${request.readRequest ?? 0}`;
    const mode = request.mode;
    const from = request.mode === "between" ? request.from : null;
    const to = request.mode === "between" ? request.to : null;

    const read = useCallback(async () => {
        if (!service) {
            return;
        }
        const ticket = ++generation.current;
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const answer = mode === "between" && from && to
                ? await service.diffRevisions(from, to)
                : await service.diffWorkingTree();
            if (ticket !== generation.current) return;
            setResult(answer);
            if (answer === null) {
                // Not an exception anywhere in this stack: version control is an optional capability,
                // and "this host has none" is an answer about the installation rather than a failure.
                setError(null);
            }
        } catch (thrown) {
            if (ticket !== generation.current) return;
            // The previous answer is dropped rather than left on screen: it described a comparison
            // that is no longer the one being asked about, and a stale list beside a failed read is
            // the one thing this surface must never show.
            setResult(null);
            setError(thrown instanceof Error ? thrown.message : String(thrown));
        } finally {
            if (ticket === generation.current) setLoading(false);
        }
    }, [service, mode, from, to]);

    useEffect(() => {
        if (!options.enabled || !service) {
            setLoading(false);
            return;
        }
        void read();
        return () => { generation.current += 1; };
    }, [options.enabled, service, key, read]);

    const reload = useCallback(() => {
        if (!options.enabled) {
            return;
        }
        void read();
    }, [options.enabled, read]);

    return { loading, error, result, reload };
}

/** One document's entry out of a comparison, or null when the comparison does not carry it. */
export function findDocumentDiffEntry(
    result: DocumentDiffResult | null,
    path: string,
): DocumentDiffEntry | null {
    if (!result) {
        return null;
    }
    return result.documents.find(entry => entry.path === path) ?? null;
}
