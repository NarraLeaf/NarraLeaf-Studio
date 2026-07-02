import {
    Ban,
    CircleQuestionMark,
    Crosshair,
    Hand,
    HandGrab,
    Hourglass,
    LoaderCircle,
    MousePointer,
    MousePointer2,
    MousePointerClick,
    Move,
    TextCursor,
} from "lucide-react";
import { Select, type SelectOption, type SelectProps } from "@/lib/components/elements/Select";
import type { ButtonCursorValue } from "@shared/types/ui-editor/appearance";
import { isButtonCursorValue } from "@shared/types/ui-editor/appearance";

const iconClassName = "w-4 h-4";

const BUTTON_CURSOR_OPTIONS: SelectOption[] = [
    { value: "auto", label: "Auto", icon: <MousePointer className={iconClassName} /> },
    { value: "default", label: "Default", icon: <MousePointer2 className={iconClassName} /> },
    { value: "pointer", label: "Pointer", icon: <MousePointerClick className={iconClassName} /> },
    { value: "text", label: "Text", icon: <TextCursor className={iconClassName} /> },
    { value: "move", label: "Move", icon: <Move className={iconClassName} /> },
    { value: "grab", label: "Grab", icon: <Hand className={iconClassName} /> },
    { value: "grabbing", label: "Grabbing", icon: <HandGrab className={iconClassName} /> },
    { value: "crosshair", label: "Crosshair", icon: <Crosshair className={iconClassName} /> },
    { value: "help", label: "Help", icon: <CircleQuestionMark className={iconClassName} /> },
    { value: "wait", label: "Wait", icon: <Hourglass className={iconClassName} /> },
    { value: "progress", label: "Progress", icon: <LoaderCircle className={iconClassName} /> },
    { value: "not-allowed", label: "Not allowed", icon: <Ban className={iconClassName} /> },
];

export function normalizeButtonCursorValue(value: unknown): ButtonCursorValue {
    return isButtonCursorValue(value) ? value : "auto";
}

type ButtonCursorSelectProps = {
    value: unknown;
    onChange: (next: ButtonCursorValue) => void;
} & Pick<SelectProps, "className" | "disabled" | "menuPlacement" | "portalMenu" | "size">;

export function ButtonCursorSelect({
    value,
    onChange,
    className,
    disabled,
    menuPlacement,
    portalMenu,
    size,
}: ButtonCursorSelectProps) {
    return (
        <Select
            value={normalizeButtonCursorValue(value)}
            options={BUTTON_CURSOR_OPTIONS}
            fullWidth
            className={className}
            disabled={disabled}
            menuPlacement={menuPlacement}
            portalMenu={portalMenu}
            size={size}
            onChange={next => onChange(normalizeButtonCursorValue(next))}
        />
    );
}
