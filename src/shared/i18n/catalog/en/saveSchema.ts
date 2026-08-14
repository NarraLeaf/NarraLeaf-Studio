/**
 * `saveSchema` - the project's save fields, edited from a save node's card.
 *
 * The names are the author's own; everything here is chrome around them. There is no explanatory
 * string and no empty state: an empty list with an add button under it is already the whole answer
 * to "what does a slot carry", and a paragraph saying so would be one more thing to read every time.
 */
export const saveSchema = {
    title: "Save fields",
    open: "Save fields",
    type: {
        string: "String",
        integer: "Integer",
        float: "Float",
        boolean: "Boolean",
        json: "JSON",
        array: "Array",
    },
    field: {
        name: "Name",
        type: "Type",
        default: "Default",
        add: "Add field",
        remove: "Remove field",
        newName: "Field",
    },
} as const;
