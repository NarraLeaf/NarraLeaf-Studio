/**
 * Widget type inheritance.
 *
 * Several widget types are specialisations of another one: a Dialog Sentence is a Text that the
 * dialog slot drives, and a Notification list is a List the notification bridge feeds. Before this
 * table each of those relationships was retyped at every seam that keys behaviour by element type -
 * the effect-kind table, the logic API table, the appearance backfill - and a specialisation that a
 * table forgot silently lost the capability rather than failing.
 *
 * The hierarchy lives in `shared` because both halves consume it: the workspace (inspector, canvas,
 * blueprint tooling) and the runtime shim that ships inside a built game.
 *
 * A parent link is a claim about the shape of the element's props, not about everything the parent
 * type does. Behaviour tables that are deliberately per-type - which widgets offer inline text
 * editing, which texts the localization pipeline collects - stay literal, and say so where they are
 * declared.
 */

/** Child widget type -> the type whose props and capabilities it specialises. */
export const WIDGET_TYPE_PARENTS: Readonly<Record<string, string>> = {
    "nl.dialog.sentence": "nl.text",
    "nl.nvl.texts": "nl.text",
    "nl.notification.list": "nl.list",
    "nl.choice.list": "nl.list",
    "nl.nvl.list": "nl.list",
};

/** The type a widget type directly specialises, or undefined for a root type. */
export function getWidgetTypeParent(type: string | undefined | null): string | undefined {
    if (!type) {
        return undefined;
    }
    return WIDGET_TYPE_PARENTS[type];
}

/**
 * The type itself followed by its ancestors in `parents`, nearest first.
 *
 * Cycle-safe: a table edited into a loop yields each type once instead of hanging the editor.
 */
export function walkWidgetTypeChain(
    parents: Readonly<Record<string, string>>,
    type: string | undefined | null,
): string[] {
    if (!type) {
        return [];
    }
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = type;
    while (current && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
        current = parents[current];
    }
    return chain;
}

/** The type itself followed by its ancestors, nearest first. */
export function getWidgetTypeChain(type: string | undefined | null): string[] {
    return walkWidgetTypeChain(WIDGET_TYPE_PARENTS, type);
}

/** Ancestors only, nearest first. */
export function getWidgetTypeAncestors(type: string | undefined | null): string[] {
    return getWidgetTypeChain(type).slice(1);
}

/** Whether `type` is `base` or a specialisation of it. */
export function isWidgetTypeOf(type: string | undefined | null, base: string): boolean {
    return getWidgetTypeChain(type).includes(base);
}

/**
 * Reads a type-keyed table through the inheritance chain: the nearest declared entry wins.
 *
 * Use it for tables that describe what an element's props support. A specialisation that wants the
 * parent's answer then declares nothing at all, which is also what makes a new specialisation
 * correct by default.
 */
export function resolveByWidgetType<T>(
    table: Readonly<Record<string, T>>,
    type: string | undefined | null,
): T | undefined {
    for (const candidate of getWidgetTypeChain(type)) {
        const entry = table[candidate];
        if (entry !== undefined) {
            return entry;
        }
    }
    return undefined;
}

/**
 * Every registered type that is `base` or a specialisation of it.
 *
 * `base` is included even when nothing extends it, so a caller can hand the result to a list that
 * used to be written out by hand.
 */
export function listWidgetTypesOf(base: string): string[] {
    const types = [base];
    for (const [child] of Object.entries(WIDGET_TYPE_PARENTS)) {
        if (child !== base && isWidgetTypeOf(child, base)) {
            types.push(child);
        }
    }
    return types;
}
