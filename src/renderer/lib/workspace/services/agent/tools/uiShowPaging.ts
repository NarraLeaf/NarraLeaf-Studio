/**
 * `ui_show` of a page too large for one answer, in parts that join back into text `ui_apply` takes.
 *
 * One answer carries {@link AGENT_TEXT_LIMIT} characters. A large page (the skeleton's settings page
 * prints about 99 000) used to be cut there with a sentence after it, so the only way to edit it was
 * ui_patch, and an agent that applied the cut text back got a parse error at the sentence - or, had
 * the cut fallen on a clean line, would have deleted every element after it.
 *
 * Now the text is served in parts at line boundaries. Each part ends with a `# ui_show part:` comment
 * naming its characters, the whole length and the revision it was printed at, so the parts joined in
 * order are the page's text with a few comment lines in it - which the `.ui` format strips wherever
 * they stand. `ui_apply` reads those comments back: a source holding some parts but not all of them,
 * parts printed at different revisions, or a pre-paging cut, is refused with a sentence that says so,
 * instead of being parsed (or applied) as if it were the whole page.
 *
 * Comments in English per project convention.
 */

/** The comment every part ends with. Parsed back by {@link checkUiShowParts}; change both together. */
const PART_LINE = /^# ui_show part: characters (\d+)-(\d+) of (\d+) at revision (\d+)\b/;
/** The sentence the cut before paging ended with, which may still be in an agent's context. */
const OLD_CUT_LINE = /^\.\.\. cut at (\d+) of (\d+) characters\./m;

export type UiShowPart = {
    /** The part, its closing comment included. */
    text: string;
    /** Where the next part starts, or null when this part reaches the end. */
    next: number | null;
    total: number;
};

/**
 * The part of `text` that starts at `offset` and fits in `limit` characters, cut after a whole line.
 * Null when `offset` is not where a line starts (or is past the end): parts only join cleanly at the
 * offsets the parts themselves hand out.
 */
export function uiShowPart(text: string, offset: number, limit: number, revision: number): UiShowPart | null {
    const total = text.length;
    if (offset < 0 || offset >= Math.max(total, 1) || (offset > 0 && text[offset - 1] !== "\n")) {
        return null;
    }
    let end = Math.min(total, offset + limit);
    if (end < total) {
        const cut = text.lastIndexOf("\n", end - 1);
        // A single line longer than a whole part is served whole rather than split inside itself.
        const lineEnd = text.indexOf("\n", offset);
        end = cut >= offset ? cut + 1 : lineEnd < 0 ? total : lineEnd + 1;
    }
    const body = text.slice(offset, end);
    const last = end >= total;
    const tail = last
        ? offset === 0 ? "the whole page." : "the last part; join every part in order and pass the result to ui_apply."
        : `call ui_show again with offset=${end} for the next part, then join every part in order before ui_apply.`;
    return {
        text: `${body}${body.endsWith("\n") ? "" : "\n"}# ui_show part: characters ${offset}-${end} of ${total} at revision ${revision} - ${tail}\n`,
        next: last ? null : end,
        total,
    };
}

/**
 * Why `source` is not a whole page as ui_show printed it, or null when it is (or holds no parts).
 */
export function checkUiShowParts(source: string): string | null {
    const old = OLD_CUT_LINE.exec(source);
    if (old) {
        return `This is ui_show's answer cut short at ${old[1]} of ${old[2]} characters, not the whole page: applying it would delete every element after the cut. `
            + "Call ui_show again (it now serves a large page in parts, with `offset`), join the parts, and apply that - or edit the page with ui_patch.";
    }
    const parts: { start: number; end: number; total: number; revision: number }[] = [];
    for (const line of source.split(/\r?\n/)) {
        const match = PART_LINE.exec(line.trim());
        if (match) {
            parts.push({ start: Number(match[1]), end: Number(match[2]), total: Number(match[3]), revision: Number(match[4]) });
        }
    }
    if (parts.length === 0) {
        return null;
    }
    const revisions = [...new Set(parts.map(part => part.revision))];
    if (revisions.length > 1) {
        return `The source joins ui_show parts printed at different revisions (${revisions.join(", ")}): the page changed between them, so they do not make one page. Call ui_show again from offset 0 and join the new parts.`;
    }
    const totals = [...new Set(parts.map(part => part.total))];
    const ordered = [...parts].sort((a, b) => a.start - b.start);
    const missing: string[] = [];
    let at = 0;
    for (const part of ordered) {
        if (part.start > at) {
            missing.push(`${at}-${part.start}`);
        }
        at = Math.max(at, part.end);
    }
    const total = Math.max(...totals);
    if (at < total) {
        missing.push(`${at}-${total}`);
    }
    if (totals.length > 1 || missing.length > 0) {
        return `The source holds ${parts.length} part(s) of ui_show's text but not the whole page: characters ${missing.join(", ") || "of another printing"} of ${total} are missing. `
            + "Applying it would delete every element in the missing part. Call ui_show with each `offset` it names until the part that says it is the last, join them all in order, and apply that.";
    }
    return null;
}
