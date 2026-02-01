import { Button } from "../../../components/elements/Button";
import type { ButtonVariant } from "../../../components/elements/Button";
import type { ElementRendererDefinition } from "../ElementRendererRegistry";

const normalizeVariant = (value: unknown): ButtonVariant => {
    const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
    if (typeof value === "string" && variants.includes(value as ButtonVariant)) {
        return value as ButtonVariant;
    }
    return "primary";
};

export const ButtonElementRenderer: ElementRendererDefinition = {
    type: "nl.button",
    render: ({ element, children }) => {
        const props = element.props ?? {};
        const text = typeof props.text === "string" ? props.text : "Button";
        const variant = normalizeVariant(props.variant);

        return (
            <div className="flex items-center justify-center w-full h-full">
                <Button variant={variant} fullWidth className="w-full h-full">
                    {text}
                </Button>
                {children}
            </div>
        );
    },
};
