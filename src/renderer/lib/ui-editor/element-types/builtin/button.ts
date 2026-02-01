import { ElementTypeDefinition } from "../types";

export const ButtonElementType: ElementTypeDefinition = {
    type: "nl.button",
    displayName: "Button",
    createDefaultElement: () => ({
        type: "nl.button",
        name: "Button",
        layout: {
            x: 0,
            y: 0,
            width: 160,
            height: 44,
            opacity: 1,
            visible: true,
        },
        props: {
            text: "Button",
            variant: "primary",
        },
    }),
};
