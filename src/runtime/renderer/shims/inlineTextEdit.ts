export function beginInlineTextEdit(): void {
    /* Preview runtime has no inline editor. */
}

export function beginOrExplainInlineTextEdit(): boolean {
    /* Preview runtime has no inline editor. */
    return false;
}

export function resolveInlineTextEditHost(): null {
    /* Preview runtime has no inline editor, so no renderer may host one. */
    return null;
}
