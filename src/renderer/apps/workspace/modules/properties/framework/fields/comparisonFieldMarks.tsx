import { createContext, useContext, type ReactNode } from "react";
import type { FieldDefinition, PropertyEditorSchema } from "../types";

/**
 * Which fields of an inspector hold a different value in the other half of a comparison.
 *
 * # One value per field, and it is the selected half's
 *
 * A field draws what the version the author picked says, never both. Two values in one row would
 * mean a second control beside every existing one, and the controls are widget-authored across the
 * whole widget-module tree - fifty inspectors, each with its own `render` callbacks - so a two-column
 * field is not a change to the framework but a rewrite of every schema in the project. What the
 * framework CAN do without touching any of them is mark the row and put the counterpart on the
 * hover, which is what this does.
 *
 * # The difference is measured through the schemas, not read off the diff
 *
 * The change model carries no before and after values - they travel as label parameters, for display
 * only, and only where a producer chose to include them - and its addressing is per element property
 * (`layout`, `style`, `props`), which is coarser than a row. But an inspector field already knows how
 * to read its own value: `getValue` is the whole contract. So each half gets a schema of its own and
 * the two are compared field by field, by id. That is exact per row, needs nothing from the producer,
 * and cannot fall behind a widget that adds a field.
 *
 * **Two schemas rather than one schema over two elements**, and that is not tidiness. A schema's
 * getters close over the document service they were built with - the position fields resolve an
 * element's place on the Surface by walking its parents through it - so running one half's schema
 * over the other half's element reads one version's tree with the other version's element in hand,
 * and answers that the two agree when they do not.
 *
 * Fields with no `getValue` are not marked. An `inlineRow` or a `custom` field hands rendering to its
 * caller and there is nothing to read; marking them by guessing would put a mark on a row whose value
 * did not change.
 */

export interface ComparisonFieldMark {
    /** The hover text: what the other half holds, already worded by the caller. */
    readonly tip: string;
}

export type ComparisonFieldMarks = ReadonlyMap<string, ComparisonFieldMark>;

const ComparisonFieldMarksContext = createContext<ComparisonFieldMarks | null>(null);

/** Give every field below this point its mark, by field id. */
export function ComparisonFieldMarksProvider({
    marks,
    children,
}: {
    marks: ComparisonFieldMarks;
    children: ReactNode;
}) {
    return <ComparisonFieldMarksContext.Provider value={marks}>{children}</ComparisonFieldMarksContext.Provider>;
}

/** This field's mark, or null outside a comparison and for a field whose value is the same. */
export function useComparisonFieldMark(fieldId: string): ComparisonFieldMark | null {
    return useContext(ComparisonFieldMarksContext)?.get(fieldId) ?? null;
}

/** A field's value in one half, or `undefined` where the field has none to read. */
type FieldValue = { readonly read: true; readonly value: unknown } | { readonly read: false };

const UNREAD: FieldValue = { read: false };

/**
 * Every field a schema draws, tabs and sections included.
 *
 * Flattened rather than walked in place because the comparison is per field id, and a section is a
 * heading rather than a value - it has nothing of its own to differ.
 */
function flattenFields<TData>(schema: PropertyEditorSchema<TData>): FieldDefinition<TData>[] {
    const out: FieldDefinition<TData>[] = [];
    const take = (fields: readonly FieldDefinition<TData>[] | undefined): void => {
        for (const field of fields ?? []) {
            if (field.type === "section") {
                take(field.fields);
                continue;
            }
            out.push(field);
        }
    };
    take(schema.fields);
    for (const tab of schema.tabs ?? []) {
        take(tab.fields);
    }
    return out;
}

/**
 * One field's value in one half.
 *
 * `inputGroup` and `dropdownGroup` are read as the list of their items' values: they are one row with
 * several inputs in it, so one mark on the row is the honest granularity - position is X and Y, and
 * "X changed" and "position changed" are the same sentence to a reader.
 *
 * Guarded, because a getter written for the live document can be handed a version that predates the
 * field it reads. A getter that throws leaves the field unmarked, which is the same answer as a field
 * that has no value to read - and much better than a rail that fails to render.
 */
function readFieldValue<TData>(field: FieldDefinition<TData>, data: TData): FieldValue {
    try {
        if ("getValue" in field && typeof field.getValue === "function") {
            return { read: true, value: (field.getValue as (data: TData) => unknown)(data) };
        }
        if (field.type === "inputGroup") {
            return { read: true, value: field.inputs.map(input => input.getValue(data)) };
        }
        if (field.type === "dropdownGroup") {
            return { read: true, value: field.dropdowns.map(dropdown => dropdown.getValue(data)) };
        }
        return UNREAD;
    } catch {
        return UNREAD;
    }
}

/** Compared as JSON, because a field's value is data: a colour is an object and a tag list an array. */
function sameValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true;
    }
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        // A value that will not serialise - a React node from a getter that returns one - is compared
        // by identity above and treated as unchanged here rather than reported as a difference on
        // every render.
        return true;
    }
}

/** One half's inspector: the schema built for it, and the data it was built to read. */
export interface ComparisonFieldSide<TData> {
    readonly schema: PropertyEditorSchema<TData>;
    readonly data: TData;
}

/**
 * The marks for one inspector, given both halves' inspectors for the same element.
 *
 * Returns an empty map when there is nothing to compare against, which is what an element only one
 * half holds produces: everything about it differs, and a panel where every row is marked says
 * nothing that the strip at the top has not already said better.
 *
 * A field the other half's schema does not have at all is left unmarked. It means the two versions
 * gave the element different types, and every row would then be a difference - which is the same
 * "everything differs" case, said one row at a time.
 */
export function collectComparisonFieldMarks<TData>(
    here: ComparisonFieldSide<TData>,
    there: ComparisonFieldSide<TData> | null,
    /** How to word the hover for one counterpart value. Supplied by the caller, which has the locale. */
    describe: (value: unknown) => string,
): ComparisonFieldMarks {
    const marks = new Map<string, ComparisonFieldMark>();
    if (there === null) {
        return marks;
    }
    const counterparts = new Map(flattenFields(there.schema).map(field => [field.id, field]));
    for (const field of flattenFields(here.schema)) {
        const counterpart = counterparts.get(field.id);
        if (!counterpart) {
            continue;
        }
        const mine = readFieldValue(field, here.data);
        const theirs = readFieldValue(counterpart, there.data);
        if (!mine.read || !theirs.read || sameValue(mine.value, theirs.value)) {
            continue;
        }
        marks.set(field.id, { tip: describe(theirs.value) });
    }
    return marks;
}

/**
 * A counterpart value as one line of hover text.
 *
 * Short and unquoted: it sits in a tooltip beside a version's name, and a value long enough to need
 * wrapping is one the author should read in the other half rather than in a hover. Nothing is
 * invented for a value that has none - an empty string is stated as empty rather than as `""`.
 */
export function describeComparisonValue(value: unknown, emptyWord: string): string {
    if (value === null || value === undefined || value === "") {
        return emptyWord;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}
