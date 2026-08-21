/**
 * `struct` - the shapes a project's data is described with, and every control that edits one.
 *
 * Its own namespace rather than a block under `widgets.list`, because the same vocabulary is read
 * in three places that are not the list inspector: the field pickers on blueprint node cards, the
 * diagnostics that report a field nothing declares, and the item table.
 */
export const struct = {
    type: {
        string: "String",
        number: "Number",
        boolean: "Boolean",
        image: "Image",
        color: "Color",
        json: "JSON",
    },
    field: {
        name: "Name",
        type: "Type",
        add: "Add field",
        remove: "Remove field",
        newName: "Field",
        none: "No fields",
        engineOwned: "This list receives its fields from the engine.",
        picker: "Field",
        visiblePicker: "Visible from field",
        pickerEmpty: "No field",
    },
    row: {
        add: "Add row",
        remove: "Remove row",
        duplicate: "Duplicate row",
        moveUp: "Move up",
        moveDown: "Move down",
        none: "No rows",
        number: "#",
    },
    image: {
        select: "Select image",
        selectTitle: "Select image",
        clear: "Clear image",
    },
} as const;
