/**
 * Reference usage: what a widget type looks like in an interface somebody actually shipped.
 *
 * The catalogue answers what a prop is called and what its default is. It cannot answer what a real
 * list, a real save slot or a real dialogue box is made of, and no amount of prose beside the type
 * would stay true. So the answer comes from the shipped skeleton template - eleven surfaces, eleven
 * components, a Title, a Config, a Save and Load pair, a Backlog and a Dialogue - printed in the same
 * format `ui apply` reads, so an example can be copied into a file and applied.
 *
 * `--project` points the same scan at any project instead.
 *
 * Pure: the document is handed in. Finding the skeleton on disk is `project.ts`'s job
 * (`readSkeletonDocument`), and Studio's agent bridge hands in whichever document it has.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { propAssignmentKey } from "./dsl/parse";
import { printElementTree } from "./dsl/print";
import { elementPath } from "./model";

export type UsageSite = {
    /** Which surface or component definition holds it. */
    owner: string;
    ownerKind: "surface" | "component";
    path: string;
    element: UIElement;
    pool: Record<string, UIElement>;
};

export function findUsages(document: UIDocument, elementType: string): UsageSite[] {
    const out: UsageSite[] = [];
    for (const surface of document.surfaces) {
        for (const element of Object.values(document.elements)) {
            if (element.type !== elementType) {
                continue;
            }
            if (rootOf(document.elements, element) !== surface.rootElementId) {
                continue;
            }
            out.push({
                owner: surface.name,
                ownerKind: "surface",
                path: elementPath(document.elements, element),
                element,
                pool: document.elements,
            });
        }
    }
    for (const component of document.components ?? []) {
        const pool = component.elements ?? {};
        for (const element of Object.values(pool)) {
            if (element.type !== elementType) {
                continue;
            }
            out.push({
                owner: component.name,
                ownerKind: "component",
                path: elementPath(pool, element),
                element,
                pool,
            });
        }
    }
    return out;
}

function rootOf(pool: Record<string, UIElement>, element: UIElement): string {
    let current = element;
    const seen = new Set<string>();
    while (current.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        const parent = pool[current.parentId];
        if (!parent) {
            break;
        }
        current = parent;
    }
    return current.id;
}

/** Full text of each site, subtree and all, in the format `ui apply` reads. */
export function formatUsages(
    sites: readonly UsageSite[],
    limit: number,
    options: { withoutChildren?: boolean } = {},
): string {
    if (sites.length === 0) {
        return "No occurrence found.";
    }
    const shown = sites.slice(0, limit);
    const blocks = shown.map(site => {
        const header = `# ${site.ownerKind} "${site.owner}"  ${site.path}`;
        return [
            header,
            ...printElementTree(site.pool, site.element.id, 0, { withoutChildren: options.withoutChildren }),
        ].join("\n");
    });
    if (sites.length > shown.length) {
        blocks.push(`# ${sites.length - shown.length} more occurrence(s); raise --limit to see them.`);
    }
    return blocks.join("\n\n");
}

/** What a single prop is actually set to across every occurrence, commonest first. */
export function formatPropValues(sites: readonly UsageSite[], propKey: string): string {
    const counts = new Map<string, { count: number; where: string[] }>();
    for (const site of sites) {
        const props = (site.element.props ?? {}) as Record<string, unknown>;
        if (!(propKey in props)) {
            continue;
        }
        const key = JSON.stringify(props[propKey]) ?? "undefined";
        const entry = counts.get(key) ?? { count: 0, where: [] };
        entry.count += 1;
        entry.where.push(`${site.owner} / ${site.path}`);
        counts.set(key, entry);
    }
    if (counts.size === 0) {
        return `No occurrence sets "${propKey}".`;
    }
    return [...counts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([value, entry]) => `${String(entry.count).padStart(3)}x  ${propAssignmentKey(propKey)} = ${value}\n       ${entry.where[0]}`)
        .join("\n");
}
