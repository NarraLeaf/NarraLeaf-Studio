import { getInterface } from "@/lib/app/bridge";

type ClipboardPublication = {
    kind: "ui-elements" | "ui-surfaces";
    copyId: string | undefined;
    reservation: Promise<number | null>;
};

let pending: ClipboardPublication | null = null;

/** Only the most recent UI copy may publish after preparing its assets and translations. */
export function beginUiClipboardPublication(kind: ClipboardPublication["kind"], copyId: string | undefined): ClipboardPublication {
    let reservation: Promise<number | null>;
    try {
        reservation = getInterface().clipboard.beginUiPublication(kind).then(
            status => status.success ? status.data.publicationId ?? null : null,
            () => null,
        );
    } catch {
        reservation = Promise.resolve(null);
    }
    const publication = { kind, copyId, reservation };
    pending = publication;
    return publication;
}

export function isCurrentUiClipboardPublication(publication: ClipboardPublication): boolean {
    return pending === publication;
}

export function isUiClipboardPublicationPending(kind: ClipboardPublication["kind"], copyId: string | undefined): boolean {
    return copyId != null && pending?.kind === kind && pending.copyId === copyId;
}

export function finishUiClipboardPublication(publication: ClipboardPublication): void {
    if (pending === publication) {
        pending = null;
    }
}
