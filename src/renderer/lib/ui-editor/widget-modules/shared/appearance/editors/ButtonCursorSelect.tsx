import { useMemo } from "react";
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
import { useTranslation } from "@/lib/i18n";
import { Select, type SelectOption, type SelectProps } from "@/lib/components/elements/Select";
import type { ButtonCursorValue } from "@shared/types/ui-editor/appearance";
import { isButtonCursorValue } from "@shared/types/ui-editor/appearance";

const iconClassName = "w-4 h-4";

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
    const { t } = useTranslation();
    const options = useMemo<SelectOption[]>(
        () => [
            { value: "auto", label: t("widgetAppearance.cursor.auto"), icon: <MousePointer className={iconClassName} /> },
            { value: "default", label: t("widgetAppearance.cursor.default"), icon: <MousePointer2 className={iconClassName} /> },
            { value: "pointer", label: t("widgetAppearance.cursor.pointer"), icon: <MousePointerClick className={iconClassName} /> },
            { value: "text", label: t("widgetAppearance.cursor.text"), icon: <TextCursor className={iconClassName} /> },
            { value: "move", label: t("widgetAppearance.cursor.move"), icon: <Move className={iconClassName} /> },
            { value: "grab", label: t("widgetAppearance.cursor.grab"), icon: <Hand className={iconClassName} /> },
            { value: "grabbing", label: t("widgetAppearance.cursor.grabbing"), icon: <HandGrab className={iconClassName} /> },
            { value: "crosshair", label: t("widgetAppearance.cursor.crosshair"), icon: <Crosshair className={iconClassName} /> },
            { value: "help", label: t("widgetAppearance.cursor.help"), icon: <CircleQuestionMark className={iconClassName} /> },
            { value: "wait", label: t("widgetAppearance.cursor.wait"), icon: <Hourglass className={iconClassName} /> },
            { value: "progress", label: t("widgetAppearance.cursor.progress"), icon: <LoaderCircle className={iconClassName} /> },
            { value: "not-allowed", label: t("widgetAppearance.cursor.notAllowed"), icon: <Ban className={iconClassName} /> },
        ],
        [t]
    );
    return (
        <Select
            value={normalizeButtonCursorValue(value)}
            options={options}
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
