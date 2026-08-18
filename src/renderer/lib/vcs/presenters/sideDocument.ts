import { useEffect, useMemo, useState } from "react";
import type { DocumentSpec } from "@shared/documents/types";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { useWorkspace } from "@/apps/workspace/context";
import { comparisonSideKey, type ComparisonSide } from "./comparisonSide";

/**
 * One side of a comparison, parsed back into the document it is.
 *
 * The counterpart to `useSideObjectUrl`, which turns a side into something an `<img>` can point at.
 * A presenter that DRAWS a document rather than describing it needs the other thing: the object the
 * editor's own renderer takes. Both read the same two ways - a revision's bytes through `readBlob`,
 * the working tree's off disk through `readWorkingFile` - and neither of them is in the change
 * model, which is deliberately about what differs and not where it came from.
 *
 * **Parsed through the document spec, not through `JSON.parse`.** The spec is the gate that decides
 * whether these bytes are the format they claim to be, and it is the same gate the comparison itself
 * went through in the main process - so a document this refuses is one the change list also could
 * not read, rather than a second opinion drawn from a renderer.
 *
 * **No migration runs.** `uiDocumentSpec.parse` and `uiGraphsSpec.parse` are shape gates; the
 * eleven interface migrations live on `UIDocumentService` and cannot be reached from here (they need
 * a service to run at all). A document written by an older Studio is therefore drawn as it was
 * written, which is the honest thing for a picture of the past to do, and is why nothing here writes
 * anything back.
 */

export type SideDocumentStatus =
  /** Nothing was asked for: this side does not hold the file, or there is no such side. */
  | "absent"
  | "loading"
  /** {@link SideDocument.document} is there. */
  | "ready"
  /** The file is there and past the ceiling the read applies. */
  | "tooLarge"
  /** Read in full, and not a document of this format. */
  | "unreadable"
  | "failed";

export interface SideDocument<T> {
  readonly status: SideDocumentStatus;
  /** Non-null only when `ready`. */
  readonly document: T | null;
  /** Why it could not be read, when it could not. */
  readonly error: string | null;
}

const NOTHING: SideDocument<never> = { status: "absent", document: null, error: null };

/**
 * Read one side of the comparison and parse it, or say why not.
 *
 * @param side which side to read, or null for a side that does not hold this file - an addition has
 *  no `before` and a removal has no `after`, and asking for one would be a read that can only fail.
 * @param path repository-relative.
 * @param spec the format to read it as. Held by identity: every spec in the project is a module
 *  constant, so this is stable across renders and is safe as a dependency.
 */
export function useSideDocument<T>(
  side: ComparisonSide | null,
  path: string,
  spec: DocumentSpec<T>
): SideDocument<T> {
  const { context } = useWorkspace();
  const [state, setState] = useState<SideDocument<T>>(NOTHING);

  const service = useMemo(
    () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
    [context]
  );

  const key = comparisonSideKey(side);
  const revision = side?.at === "revision" ? side.revision : null;

  useEffect(() => {
    if (!service || !side) {
      setState(NOTHING);
      return;
    }

    let cancelled = false;
    setState({ status: "loading", document: null, error: null });

    void (async () => {
      try {
        const bytes =
          revision === null
            ? await service.readWorkingFile(path)
            : await service.readBlob(revision, path);
        if (cancelled) return;
        if (bytes === null) {
          setState({ status: "tooLarge", document: null, error: null });
          return;
        }
        setState({ status: "ready", document: parseSideDocument(spec, path, bytes), error: null });
      } catch (thrown) {
        if (cancelled) return;
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        // A read that failed and a document that would not parse are different facts and
        // stay different: one is the repository, the other is the file, and an author who
        // is told "unreadable" for a network fault looks in the wrong place.
        setState({
          status: thrown instanceof SideDocumentParseError ? "unreadable" : "failed",
          document: null,
          error: message
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `side` itself is excluded on purpose: it is written as an object literal at the call
    // sites, and `key` plus `revision` carry everything about it that changes a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, key, revision, path, spec]);

  return state;
}

/** Thrown for bytes that are not this format, so the hook can tell that from a failed read. */
export class SideDocumentParseError extends Error {}

/**
 * Bytes to a document, or a {@link SideDocumentParseError}.
 *
 * Exported for its tests: the three ways this fails - not UTF-8 text, not JSON, not this format -
 * are three different sentences at the author, and a component test cannot reach any of them.
 */
export function parseSideDocument<T>(spec: DocumentSpec<T>, path: string, bytes: Uint8Array): T {
  let raw: unknown;
  try {
    // Fatal rather than lenient: a decoder that substitutes U+FFFD turns a truncated file into
    // one that parses to something nobody wrote, and the canvas would then draw it.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    raw = JSON.parse(text) as unknown;
  } catch (thrown) {
    throw new SideDocumentParseError(thrown instanceof Error ? thrown.message : String(thrown));
  }
  try {
    return spec.parse(raw, {
      path,
      corrupt: (reason: string) => {
        throw new SideDocumentParseError(reason);
      }
    });
  } catch (thrown) {
    throw thrown instanceof SideDocumentParseError
      ? thrown
      : new SideDocumentParseError(thrown instanceof Error ? thrown.message : String(thrown));
  }
}
