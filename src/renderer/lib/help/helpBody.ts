/**
 * The whole markup language a help topic gets.
 *
 * Three constructs: a line of prose is a paragraph, a blank line separates paragraphs, and a line
 * beginning `- ` is a bullet. Consecutive bullets are one list. That is the entire grammar, and it
 * is deliberately not Markdown - a topic that needs a heading, a link or emphasis has outgrown the
 * eight-line budget and should be two topics joined by `related` (docs/help-system.md §6).
 *
 * Each prose line is its own paragraph rather than being joined with the next: joining would insert
 * a space, which is wrong in Chinese, and the authored bodies already put one paragraph per line.
 */

export type HelpBlock =
    | { kind: "paragraph"; text: string }
    | { kind: "list"; items: string[] };

const BULLET_MARK = "-";
const BULLET = `${BULLET_MARK} `;

export function parseHelpBody(body: string): HelpBlock[] {
    const blocks: HelpBlock[] = [];
    let list: string[] | null = null;

    const closeList = () => {
        if (list && list.length > 0) {
            blocks.push({ kind: "list", items: list });
        }
        list = null;
    };

    for (const rawLine of body.split("\n")) {
        const line = rawLine.trim();
        if (!line) {
            closeList();
            continue;
        }
        // `line` is already trimmed, so an empty bullet arrives as a bare "-" rather than "- ".
        // Recognising it as a bullet is what keeps it from rendering as a paragraph of one dash.
        if (line === BULLET_MARK || line.startsWith(BULLET)) {
            const item = line.slice(BULLET_MARK.length).trim();
            if (!item) {
                continue;
            }
            if (list) {
                list.push(item);
            } else {
                list = [item];
            }
            continue;
        }
        closeList();
        blocks.push({ kind: "paragraph", text: line });
    }
    closeList();

    return blocks;
}
