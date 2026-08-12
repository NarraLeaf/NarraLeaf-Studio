import { useEffect, useMemo, useRef, useState } from "react";
import type { RevisionId } from "@shared/types/vcs";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * Turning one side of a comparison back into bytes a browser can draw.
 *
 * Every presenter that shows a file rather than describing it needs the same two things, and
 * neither of them is in the change model: which versions are being compared, and a URL for one
 * file at one of them. The change model is deliberately about what differs, not where it came
 * from - so the sides are passed down from the tab that knows, and this is where they become
 * something an `<img>`, an `<audio>` or a `<video>` can point at.
 *
 * **Two reads, because the two sides are not the same kind of thing.** A revision's bytes come
 * from the repository through `readBlob`; the working tree's come off disk through
 * `readWorkingFile`, which is bounded by a ceiling the repository side has no way to apply (see
 * `vcs/diff/documentDiff.ts`). Both arrive base64-encoded over IPC, are wrapped in a `Blob` and
 * handed back as an object URL.
 *
 * ## Two rules, both of which have a way of being broken silently
 *
 * **Every URL is revoked.** An object URL holds its blob alive until it is revoked or the
 * document goes away, and this surface is one an author moves through file by file: forty
 * selections of a few megabytes each is a few hundred megabytes of retained image data in a
 * window that is also running their project. The effect's cleanup revokes, which covers both
 * ways a URL stops being wanted - the selection moving and the pane unmounting - and it is the
 * only place a URL is created, so there is no second path to forget about.
 *
 * **`app://fs/{token}` is not an option here.** That scheme is a one-time grant handed to the
 * game runtime for one load; it is not a content address, and a second render of the same
 * element gets a URL that no longer resolves. A blob is content, and lives exactly as long as
 * this hook says it does.
 */

/** Where one side's bytes come from. */
export type ComparisonSide =
    /** The project as it is on disk now. */
    | { readonly at: "working-tree" }
    | { readonly at: "revision"; readonly revision: RevisionId };

/**
 * The two sides one comparison is between.
 *
 * `before` is null in the one repository state where there is no older side at all: a working
 * tree compared against a project with no versions recorded yet, where every file is an addition.
 */
export interface ComparisonSides {
    readonly before: ComparisonSide | null;
    readonly after: ComparisonSide;
}

export type SideBytesStatus =
    /** Nothing was asked for: this side does not hold the file, or there is no such side. */
    | "absent"
    | "loading"
    /** {@link SideBytes.url} is live. */
    | "ready"
    /** The file is there and past the ceiling the read applies. */
    | "tooLarge"
    /** Read in full, and not a format this can be drawn from. */
    | "unsupported"
    | "failed";

export interface SideBytes {
    readonly status: SideBytesStatus;
    /** Live only while this hook is mounted with this side and path. Null unless `ready`. */
    readonly url: string | null;
    /** What was read, so a caller can state a file's size. Zero unless something was read. */
    readonly size: number;
    /** The read's own message, when it failed. */
    readonly error: string | null;
}

const NOTHING: SideBytes = { status: "absent", url: null, size: 0, error: null };

/** One side as a value, so an effect can depend on it without depending on an object literal. */
export function comparisonSideKey(side: ComparisonSide | null): string {
    if (!side) return "none";
    return side.at === "revision" ? `revision:${side.revision}` : "working-tree";
}

/**
 * A URL for one file at one side of a comparison, or why there is not one.
 *
 * @param side which side to read, or null for a side that does not hold this file - an addition
 *  has no `before` and a removal has no `after`, and asking for one would be a read that can only
 *  fail.
 * @param path repository-relative.
 * @param mediaTypeOf what to label the blob, from its first bytes. Answering null means the
 *  caller cannot draw these bytes, and no URL is made for them: the blob's type is what the
 *  browser decodes by, so a caller that guessed would be handing itself a broken element instead
 *  of a stated reason. Read on every read; identity changes do not cause one.
 */
export function useSideObjectUrl(
    side: ComparisonSide | null,
    path: string,
    mediaTypeOf: (bytes: Uint8Array) => string | null,
): SideBytes {
    const { context } = useWorkspace();
    const [state, setState] = useState<SideBytes>(NOTHING);

    const service = useMemo(
        () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    // Held rather than depended on: it is written inline at nearly every call site, so depending
    // on it would re-read the file on every render of the presenter.
    const typeOf = useRef(mediaTypeOf);
    typeOf.current = mediaTypeOf;

    const key = comparisonSideKey(side);
    const revision = side?.at === "revision" ? side.revision : null;

    useEffect(() => {
        if (!service || !side) {
            setState(NOTHING);
            return;
        }

        let cancelled = false;
        let created: string | null = null;
        setState({ status: "loading", url: null, size: 0, error: null });

        void (async () => {
            try {
                const bytes = revision === null
                    ? await service.readWorkingFile(path)
                    : await service.readBlob(revision, path);
                if (cancelled) return;
                if (bytes === null) {
                    setState({ status: "tooLarge", url: null, size: 0, error: null });
                    return;
                }
                const type = typeOf.current(bytes);
                if (type === null) {
                    setState({ status: "unsupported", url: null, size: bytes.length, error: null });
                    return;
                }
                // Assigned before anything else can run: the cleanup below cannot interleave with
                // these two statements, so a URL that exists is always one the cleanup can see.
                // The cast is what every other blob in the renderer does with a `Uint8Array`: the
                // DOM types want a buffer whose backing store is not shared, and nothing here can
                // hand over a `SharedArrayBuffer` in the first place.
                created = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
                setState({ status: "ready", url: created, size: bytes.length, error: null });
            } catch (thrown) {
                if (cancelled) return;
                setState({
                    status: "failed",
                    url: null,
                    size: 0,
                    error: thrown instanceof Error ? thrown.message : String(thrown),
                });
            }
        })();

        return () => {
            cancelled = true;
            if (created) {
                // The one line this hook exists for. It runs when the selection moves and when
                // the pane goes away, which are the only two ways a URL stops being wanted.
                URL.revokeObjectURL(created);
                created = null;
            }
        };
        // `side` itself is excluded on purpose: it is written as an object literal at the call
        // sites, and `key` plus `revision` carry everything about it that changes a read.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, key, revision, path]);

    return state;
}
