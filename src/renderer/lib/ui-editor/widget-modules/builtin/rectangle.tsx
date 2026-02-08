import { useCallback, useEffect, useRef, useState } from "react";
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    CornerDownLeft,
    CornerDownRight,
    CornerUpLeft,
    CornerUpRight,
    Droplets,
    Eye,
    EyeOff,
    Maximize2,
    MoreHorizontal,
    Plus,
    Square,
} from "lucide-react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import type { UIWidgetModule, WidgetRendererProps, UIInspectorData, DockerBarItem, DockerBarContext, InspectorContext } from "../types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type {
    CustomFieldProps,
    ColorValue,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { ImageFill, ImageFillMode, ImageFillCropPlacement } from "@shared/types/ui-editor/imageFill";

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_FIT_OPTIONS = [
    { value: "cover", label: "Cover" },
    { value: "contain", label: "Contain" },
    { value: "fill", label: "Fill" },
    { value: "none", label: "None" },
];

const BORDER_STYLE_OPTIONS = [
    { value: "solid", label: "Solid" },
    { value: "dashed", label: "Dashed" },
    { value: "dotted", label: "Dotted" },
    { value: "none", label: "None" },
];

const FILL_TYPE_OPTIONS = [
    { value: "color", label: "Color" },
    { value: "image", label: "Image" },
];

const STROKE_ALIGN_OPTIONS = [
    { value: "none", label: "None" },
    { value: "center", label: "Center" },
    { value: "inside", label: "Inside" },
    { value: "outside", label: "Outside" },
];

const STROKE_JOIN_OPTIONS = [
    { value: "miter", label: "Miter" },
    { value: "round", label: "Round" },
    { value: "bevel", label: "Bevel" },
];

const STROKE_SIDE_BUTTONS = [
    { id: "all", icon: <Square className="w-4 h-4 text-gray-400" />, label: "All" },
    { id: "top", icon: <ArrowUp className="w-4 h-4 text-gray-400" />, label: "Top" },
    { id: "right", icon: <ArrowRight className="w-4 h-4 text-gray-400" />, label: "Right" },
    { id: "bottom", icon: <ArrowDown className="w-4 h-4 text-gray-400" />, label: "Bottom" },
    { id: "left", icon: <ArrowLeft className="w-4 h-4 text-gray-400" />, label: "Left" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

type FillType = "color" | "image";
type StrokeAlign = "none" | "center" | "inside" | "outside";
type StrokeSide = "all" | "top" | "right" | "bottom" | "left";
type StrokeJoin = "miter" | "round" | "bevel";

type RectangleProps = {
    backgroundColor: string;
    borderRadius: number;
    borderRadiusTL: number;
    borderRadiusTR: number;
    borderRadiusBL: number;
    borderRadiusBR: number;
    borderRadiusLinked: boolean;
    borderColor: string;
    borderWidth: number;
    borderStyle: string;
    backgroundImage: string;
    backgroundFit: string;
    imageFill?: ImageFill | null;
    fillType: FillType;
    fillVisible: boolean;
    fillOpacity: number;
    strokeVisible: boolean;
    strokeOpacity: number;
    strokeAlign: StrokeAlign;
    strokeSide: StrokeSide;
    borderJoin: StrokeJoin;
    cornerAdvanced: boolean;
};

function getProps(element: { props?: Record<string, unknown> }): RectangleProps {
    const p = element.props ?? {};
    return {
        backgroundColor: String(p.backgroundColor ?? "#ffffff"),
        borderRadius: Number(p.borderRadius ?? 0),
        borderRadiusTL: Number(p.borderRadiusTL ?? p.borderRadius ?? 0),
        borderRadiusTR: Number(p.borderRadiusTR ?? p.borderRadius ?? 0),
        borderRadiusBL: Number(p.borderRadiusBL ?? p.borderRadius ?? 0),
        borderRadiusBR: Number(p.borderRadiusBR ?? p.borderRadius ?? 0),
        borderRadiusLinked: p.borderRadiusLinked !== false,
        borderColor: String(p.borderColor ?? "transparent"),
        borderWidth: Number(p.borderWidth ?? 0),
        borderStyle: String(p.borderStyle ?? "solid"),
        backgroundImage: String(p.backgroundImage ?? ""),
        backgroundFit: String(p.backgroundFit ?? "cover"),
        imageFill: (p.imageFill as ImageFill | undefined) ?? undefined,
        fillType: (String(p.fillType ?? "color") as FillType),
        fillVisible: p.fillVisible !== false,
        fillOpacity: Number(p.fillOpacity ?? 1),
        strokeVisible: p.strokeVisible !== false,
        strokeOpacity: Number(p.strokeOpacity ?? 1),
        strokeAlign: (String(p.strokeAlign ?? "center") as StrokeAlign),
        strokeSide: (String(p.strokeSide ?? "all") as StrokeSide),
        borderJoin: (String(p.borderJoin ?? "miter") as StrokeJoin),
        cornerAdvanced: Boolean(p.cornerAdvanced),
    };
}

const DEFAULT_CROP_PLACEMENT: ImageFillCropPlacement = {
    leftPct: 0,
    topPct: 0,
    widthPct: 100,
    heightPct: 100,
};

function mapLegacyFitToMode(fit: string): ImageFillMode {
    const normalized = (fit ?? "").toLowerCase();
    if (normalized === "contain") return "contain";
    if (normalized === "cover") return "cover";
    if (normalized === "tile") return "tile";
    // Treat fill/none/others as stretch
    return "stretch";
}

function deriveLegacyImageFill(props: RectangleProps): ImageFill | undefined {
    const trimmed = props.backgroundImage?.trim();
    if (!trimmed) {
        return undefined;
    }
    return {
        mode: mapLegacyFitToMode(props.backgroundFit),
        assetId: null,
    };
}

function ensureCropPlacement(fill?: ImageFill): ImageFillCropPlacement {
    return fill?.cropPlacement ?? DEFAULT_CROP_PLACEMENT;
}

interface InlineMenuTriggerButtonProps {
    menu: ContextMenuDef;
    ariaLabel?: string;
}

function InlineMenuTriggerButton({ menu, ariaLabel = "More options" }: InlineMenuTriggerButtonProps) {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    const openMenu = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({ x: rect.left, y: rect.bottom + 4 });
        setVisible(true);
    }, []);

    const closeMenu = useCallback(() => {
        setVisible(false);
    }, []);

    useEffect(() => {
        if (!visible) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (
                target &&
                (buttonRef.current?.contains(target) ||
                    (target as HTMLElement).closest?.('[data-context-menu="true"]'))
            ) {
                return;
            }
            closeMenu();
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [visible, closeMenu]);

    useEffect(() => {
        if (!visible) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [visible, closeMenu]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={visible ? closeMenu : openMenu}
                aria-label={ariaLabel}
                className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>
            {visible && <ContextMenu items={menu} position={position} onClose={closeMenu} />}
        </>
    );
}

interface StrokeSideSelectorProps {
    value: StrokeSide;
    onChange: (value: StrokeSide) => void;
}

function StrokeSideSelector({ value, onChange }: StrokeSideSelectorProps) {
    return (
        <div className="flex gap-1">
            {STROKE_SIDE_BUTTONS.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    onClick={() => onChange(option.id as StrokeSide)}
                    aria-label={option.label}
                    className={`grid h-9 w-9 place-items-center rounded-lg border transition ${
                        value === option.id
                            ? "border-white/40 bg-white/10 text-white"
                            : "border-white/10 text-gray-300 hover:bg-white/5"
                    }`}
                >
                    {option.icon}
                </button>
            ))}
        </div>
    );
}

function BlueprintPlaceholder(_: CustomFieldProps<UIInspectorData>) {
    return (
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#111315] px-4 py-3">
            <div>
                <p className="text-xs uppercase text-gray-500 tracking-wider">Blueprint</p>
                <p className="text-sm text-gray-300">Link actions and behaviors</p>
            </div>
            <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/5 text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
                <Plus className="w-4 h-4" />
            </button>
        </div>
    );
}

// ─── Renderer ───────────────────────────────────────────────────────────────

function RectangleRenderer({ element, children }: WidgetRendererProps) {
    const props = getProps(element);

    const borderRadius = props.borderRadiusLinked
        ? `${props.borderRadius}px`
        : `${props.borderRadiusTL}px ${props.borderRadiusTR}px ${props.borderRadiusBR}px ${props.borderRadiusBL}px`;

    const normalizedFillOpacity = Math.max(0, Math.min(1, props.fillOpacity));
    const colorFill =
        props.fillVisible && props.fillType === "color"
            ? colorValueToCss({ hex: props.backgroundColor, alpha: normalizedFillOpacity })
            : "transparent";

    const normalizedStrokeOpacity = Math.max(0, Math.min(1, props.strokeOpacity));
    const strokeColor = colorValueToCss({ hex: props.borderColor, alpha: normalizedStrokeOpacity });

    const style: React.CSSProperties = {
        width: "100%",
        height: "100%",
        backgroundColor: colorFill,
        borderRadius,
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
    };

    const hasStroke = props.strokeVisible && props.borderWidth > 0;
    if (hasStroke) {
        style.borderStyle = props.borderStyle;
        if (props.strokeAlign === "center") {
            const sideWidth = (side: StrokeSide) =>
                props.strokeSide === "all" || props.strokeSide === side ? `${props.borderWidth}px` : "0px";

            style.borderWidth = "0px";
            style.borderTopWidth = sideWidth("top");
            style.borderRightWidth = sideWidth("right");
            style.borderBottomWidth = sideWidth("bottom");
            style.borderLeftWidth = sideWidth("left");
            style.borderColor = strokeColor;
        } else if (props.strokeAlign === "inside") {
            style.border = "none";
            style.boxShadow = `inset 0 0 0 ${props.borderWidth}px ${strokeColor}`;
        } else if (props.strokeAlign === "outside") {
            style.border = "none";
            style.outline = `${props.borderWidth}px ${props.borderStyle} ${strokeColor}`;
            style.outlineOffset = `${props.borderWidth}px`;
        } else {
            style.border = "none";
        }
    } else {
        style.border = "none";
    }

    const legacyImageUrl = props.backgroundImage?.trim() ?? "";
    const legacyFill = deriveLegacyImageFill(props);
    const activeFill = props.imageFill ?? legacyFill;
    const activeMode = activeFill?.mode;
    const { url: assetUrl } = useAssetObjectUrl(activeFill?.assetId ?? null);
    const displayUrl = assetUrl ?? (legacyImageUrl ? legacyImageUrl : null);
    const shouldRenderImage = props.fillVisible && props.fillType === "image";

    if (shouldRenderImage && activeMode === "tile" && displayUrl) {
        Object.assign(style, {
            backgroundImage: `url(${displayUrl})`,
            backgroundRepeat: "repeat",
            backgroundSize: "auto",
            backgroundPosition: "top left",
        });
    }

    const objectFitMap: Record<ImageFillMode, React.CSSProperties["objectFit"] | undefined> = {
        cover: "cover",
        contain: "contain",
        stretch: "fill",
        crop: "none",
        tile: undefined,
    };

    const renderImage = () => {
        if (!shouldRenderImage || !displayUrl || !activeMode || activeMode === "tile") {
            return null;
        }
        if (activeMode === "crop") {
            const placement = ensureCropPlacement(activeFill);
            return (
                <img
                    data-ui-image-fill="true"
                    src={displayUrl}
                    alt=""
                    draggable={false}
                    style={{
                        position: "absolute",
                        left: `${placement.leftPct}%`,
                        top: `${placement.topPct}%`,
                        width: `${placement.widthPct}%`,
                        height: `${placement.heightPct}%`,
                        objectFit: "none",
                        opacity: normalizedFillOpacity,
                        pointerEvents: "none",
                    }}
                />
            );
        }

        const objectFit = objectFitMap[activeMode] ?? "cover";
        return (
            <img
                data-ui-image-fill="true"
                src={displayUrl}
                alt=""
                draggable={false}
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit,
                        opacity: normalizedFillOpacity,
                    pointerEvents: "none",
                }}
            />
        );
    };

    return (
        <div style={style}>
            {renderImage()}
            {children}
        </div>
    );
}

// ─── Inspector ──────────────────────────────────────────────────────────────

function createRectangleInspector(ctx: InspectorContext) {
    const { element, documentService } = ctx;

    const patchProps = (patch: Partial<RectangleProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...patch,
        });
    };

    const patchLayout = (patch: Partial<WidgetRendererProps["element"]["layout"]>) => {
        documentService.updateElementLayout(element.id, patch);
    };

    const buildStrokeMenu = (props: RectangleProps): ContextMenuDef => [
        {
            id: "stroke-style",
            label: "Border Style",
            submenu: BORDER_STYLE_OPTIONS.map(option => ({
                id: `stroke-style-${option.value}`,
                label: option.label,
                onClick: () => patchProps({ borderStyle: option.value }),
            })),
        },
        {
            separator: true,
            id: "stroke-style-separator",
        },
        {
            id: "stroke-join",
            label: "Corner Join",
            submenu: STROKE_JOIN_OPTIONS.map(option => ({
                id: `stroke-join-${option.value}`,
                label: option.label,
                onClick: () => patchProps({ borderJoin: option.value as StrokeJoin }),
            })),
        },
    ];

    type D = UIInspectorData;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.rectangle:${element.id}`,
        title: element.name ?? "Rectangle",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    defineField<D, any>({
                        id: "section.cornerRadius",
                        type: "section",
                        title: "Corner Radius",
                        fields: [
                            defineField<D, any>({
                                id: "props.cornerRadiusInline",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: undefined,
                                items: [
                                    {
                                        id: "props.cornerRadiusValue",
                                        className: "flex-1",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            const handleChange = (next: string) => {
                                                const radius = Number.parseFloat(next);
                                                if (!Number.isFinite(radius)) return;
                                                onSaving(true);
                                                try {
                                                    const patch: Partial<RectangleProps> = {
                                                        borderRadius: radius,
                                                    };
                                                    if (current.borderRadiusLinked) {
                                                        patch.borderRadiusTL = radius;
                                                        patch.borderRadiusTR = radius;
                                                        patch.borderRadiusBL = radius;
                                                        patch.borderRadiusBR = radius;
                                                    }
                                                    patchProps(patch);
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <EnhancedInput
                                                    value={String(current.borderRadius)}
                                                    onChange={handleChange}
                                                    inputMode="numeric"
                                                    type="number"
                                                    min={0}
                                                    unit="px"
                                                    leftIcon={<CornerUpLeft className="w-4 h-4 text-gray-400" />}
                                                    className="flex-1"
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.cornerRadiusToggle",
                                        className: "flex-shrink-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            const toggle = () => {
                                                onSaving(true);
                                                try {
                                                    const next = !current.cornerAdvanced;
                                                    const patch: Partial<RectangleProps> = {
                                                        cornerAdvanced: next,
                                                        borderRadiusLinked: !next,
                                                    };
                                                    if (!next) {
                                                        const uniform = current.borderRadiusTL;
                                                        patch.borderRadius = uniform;
                                                        patch.borderRadiusTR = uniform;
                                                        patch.borderRadiusBL = uniform;
                                                        patch.borderRadiusBR = uniform;
                                                    }
                                                    patchProps(patch);
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <button
                                                    type="button"
                                                    onClick={toggle}
                                                    aria-pressed={current.cornerAdvanced}
                                                    aria-label="Toggle corner breakdown"
                                                    className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                                        current.cornerAdvanced ? "bg-white/10 text-white" : ""
                                                    }`}
                                                >
                                                    <Maximize2 className="w-4 h-4" />
                                                </button>
                                            );
                                        },
                                    },
                                ],
                            }),
                            defineField<D, any>({
                                id: "props.cornerRadiusTopRow",
                                type: "inputGroup",
                                gap: 0,
                                wrap: false,
                                className: "mt-3",
                                label: undefined,
                                hidden: (data: D) => !getProps(data.element).cornerAdvanced,
                                inputs: [
                                    {
                                        id: "props.borderRadiusTL",
                                        label: "TL",
                                        icon: <CornerUpLeft className="w-4 h-4 text-gray-400" />,
                                        getValue: (data: D) => String(getProps(data.element).borderRadiusTL),
                                        setValue: (_data: D, raw: string) => {
                                            const value = Number.parseFloat(raw);
                                            if (!Number.isFinite(value)) return;
                                            patchProps({ borderRadiusTL: value });
                                        },
                                    },
                                    {
                                        id: "props.borderRadiusTR",
                                        label: "TR",
                                        icon: <CornerUpRight className="w-4 h-4 text-gray-400" />,
                                        getValue: (data: D) => String(getProps(data.element).borderRadiusTR),
                                        setValue: (_data: D, raw: string) => {
                                            const value = Number.parseFloat(raw);
                                            if (!Number.isFinite(value)) return;
                                            patchProps({ borderRadiusTR: value });
                                        },
                                    },
                                ],
                            }),
                            defineField<D, any>({
                                id: "props.cornerRadiusBottomRow",
                                type: "inputGroup",
                                gap: 0,
                                wrap: false,
                                className: "mt-2",
                                label: undefined,
                                hidden: (data: D) => !getProps(data.element).cornerAdvanced,
                                inputs: [
                                    {
                                        id: "props.borderRadiusBL",
                                        label: "BL",
                                        icon: <CornerDownLeft className="w-4 h-4 text-gray-400" />,
                                        getValue: (data: D) => String(getProps(data.element).borderRadiusBL),
                                        setValue: (_data: D, raw: string) => {
                                            const value = Number.parseFloat(raw);
                                            if (!Number.isFinite(value)) return;
                                            patchProps({ borderRadiusBL: value });
                                        },
                                    },
                                    {
                                        id: "props.borderRadiusBR",
                                        label: "BR",
                                        icon: <CornerDownRight className="w-4 h-4 text-gray-400" />,
                                        getValue: (data: D) => String(getProps(data.element).borderRadiusBR),
                                        setValue: (_data: D, raw: string) => {
                                            const value = Number.parseFloat(raw);
                                            if (!Number.isFinite(value)) return;
                                            patchProps({ borderRadiusBR: value });
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.layer",
                        type: "section",
                        title: "Layer",
                        fields: [
                            defineField<D, any>({
                                id: "layout.layerControls",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: undefined,
                                items: [
                                    {
                                        id: "layout.layerOpacity",
                                        className: "flex-1",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const percent = Math.round((data.elements[0]?.layout.opacity ?? 1) * 100);
                                            const handleChange = (next: string) => {
                                                const value = Number.parseFloat(next);
                                                if (!Number.isFinite(value)) return;
                                                const clamped = Math.min(100, Math.max(0, value));
                                                onSaving(true);
                                                try {
                                                    patchLayout({ opacity: clamped / 100 });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <EnhancedInput
                                                    value={String(percent)}
                                                    onChange={handleChange}
                                                    inputMode="numeric"
                                                    unit="%"
                                                    min={0}
                                                    max={100}
                                                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                                                    className="w-28"
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "layout.layerVisible",
                                        className: "flex-shrink-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const visible = data.elements[0]?.layout.visible ?? true;
                                            const toggle = () => {
                                                onSaving(true);
                                                try {
                                                    patchLayout({ visible: !visible });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <button
                                                    type="button"
                                                    onClick={toggle}
                                                    aria-label="Toggle layer visibility"
                                                    aria-pressed={visible}
                                                    className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                                        visible ? "bg-white/10 border-white/40 text-white" : ""
                                                    }`}
                                                >
                                                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                </button>
                                            );
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.fill",
                        type: "section",
                        title: "Fill",
                        fields: [
                            defineField<D, any>({
                                id: "props.fillType",
                                type: "select",
                                label: "Fill Type",
                                options: FILL_TYPE_OPTIONS,
                                getValue: (data: D) => getProps(data.element).fillType,
                                setValue: (_data: D, value: string | number) =>
                                    patchProps({
                                        fillType: String(value) as FillType,
                                    }),
                            }),
                            defineField<D, any>({
                                id: "props.fillColorRow",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: undefined,
                                hidden: (data: D) => getProps(data.element).fillType !== "color",
                                items: [
                                    {
                                        id: "props.fillColorPicker",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            const handleColor = (next: ColorValue) => {
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        backgroundColor: next.hex,
                                                        fillOpacity: next.alpha ?? current.fillOpacity,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <ColorPickerTrigger
                                                    value={{
                                                        hex: current.backgroundColor,
                                                        alpha: current.fillOpacity,
                                                    }}
                                                    displayMode="icon"
                                                    allowOpacity={false}
                                                    onChange={handleColor}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.fillOpacityRow",
                                        className: "flex-1",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const percent = Math.round(getProps(data.element).fillOpacity * 100);
                                            const handleChange = (next: string) => {
                                                const value = Number.parseFloat(next);
                                                if (!Number.isFinite(value)) return;
                                                const clamped = Math.min(100, Math.max(0, value));
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        fillOpacity: clamped / 100,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <EnhancedInput
                                                    value={String(percent)}
                                                    onChange={handleChange}
                                                    inputMode="numeric"
                                                    unit="%"
                                                    min={0}
                                                    max={100}
                                                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.fillVisibleToggle",
                                        className: "flex-shrink-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const visible = getProps(data.element).fillVisible;
                                            const toggle = () => {
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        fillVisible: !visible,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <button
                                                    type="button"
                                                    onClick={toggle}
                                                    aria-pressed={visible}
                                                    aria-label="Toggle fill visibility"
                                                    className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                                        visible ? "bg-white/10 border-white/40 text-white" : ""
                                                    }`}
                                                >
                                                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                </button>
                                            );
                                        },
                                    },
                                ],
                            }),
                            defineField<D, any>({
                                id: "props.fillImageUrl",
                                type: "text",
                                label: "Image Fill",
                                placeholder: "https://... or asset path",
                                helpText: "Image fill editor coming soon",
                                hidden: (data: D) => getProps(data.element).fillType !== "image",
                                getValue: (data: D) => getProps(data.element).backgroundImage,
                                setValue: (_data: D, value: string) => patchProps({ backgroundImage: value }),
                            }),
                            defineField<D, any>({
                                id: "props.fillImageControls",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: undefined,
                                hidden: (data: D) => getProps(data.element).fillType !== "image",
                                items: [
                                    {
                                        id: "props.fillImageOpacity",
                                        className: "flex-1",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const percent = Math.round(getProps(data.element).fillOpacity * 100);
                                            const handleChange = (next: string) => {
                                                const value = Number.parseFloat(next);
                                                if (!Number.isFinite(value)) return;
                                                const clamped = Math.min(100, Math.max(0, value));
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        fillOpacity: clamped / 100,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <EnhancedInput
                                                    value={String(percent)}
                                                    onChange={handleChange}
                                                    inputMode="numeric"
                                                    unit="%"
                                                    min={0}
                                                    max={100}
                                                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.fillImageVisible",
                                        className: "flex-shrink-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const visible = getProps(data.element).fillVisible;
                                            const toggle = () => {
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        fillVisible: !visible,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <button
                                                    type="button"
                                                    onClick={toggle}
                                                    aria-pressed={visible}
                                                    aria-label="Toggle fill visibility"
                                                    className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                                        visible ? "bg-white/10 border-white/40 text-white" : ""
                                                    }`}
                                                >
                                                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                </button>
                                            );
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.stroke",
                        type: "section",
                        title: "Stroke",
                        fields: [
                            defineField<D, any>({
                                id: "props.strokeControls",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: undefined,
                                items: [
                                    {
                                        id: "props.strokeAlign",
                                        className: "min-w-[120px]",
                                        render: ({ data }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            return (
                                                <Select
                                                    value={current.strokeAlign}
                                                    options={STROKE_ALIGN_OPTIONS}
                                                    onChange={(value) =>
                                                        patchProps({
                                                            strokeAlign: String(value) as StrokeAlign,
                                                        })
                                                    }
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.strokeWidth",
                                        className: "w-24",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            const handleChange = (next: string) => {
                                                const width = Number.parseFloat(next);
                                                if (!Number.isFinite(width) || width < 0) return;
                                                onSaving(true);
                                                try {
                                                    patchProps({ borderWidth: width });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <EnhancedInput
                                                    value={String(current.borderWidth)}
                                                    onChange={handleChange}
                                                    inputMode="numeric"
                                                    type="number"
                                                    min={0}
                                                    unit="px"
                                                    leftIcon={<Square className="w-4 h-4 text-gray-400" />}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.strokeSide",
                                        className: "flex-shrink-0",
                                        render: ({ data }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            return (
                                                <StrokeSideSelector
                                                    value={current.strokeSide}
                                                    onChange={(value) => patchProps({ strokeSide: value })}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.strokeMore",
                                        className: "flex-shrink-0",
                                        render: ({ data }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            return (
                                                <InlineMenuTriggerButton
                                                    menu={buildStrokeMenu(current)}
                                                    ariaLabel="Open stroke settings"
                                                />
                                            );
                                        },
                                    },
                                ],
                            }),
                            defineField<D, any>({
                                id: "props.strokeColorRow",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: undefined,
                                hidden: (data: D) => !getProps(data.element).strokeVisible,
                                items: [
                                    {
                                        id: "props.strokeColorPicker",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getProps(data.element);
                                            const handleChange = (next: ColorValue) => {
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        borderColor: next.hex,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <ColorPickerTrigger
                                                    value={{
                                                        hex: current.borderColor,
                                                        alpha: current.strokeOpacity,
                                                    }}
                                                    displayMode="icon"
                                                    allowOpacity={false}
                                                    onChange={handleChange}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.strokeOpacity",
                                        className: "flex-1",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const percent = Math.round(getProps(data.element).strokeOpacity * 100);
                                            const handleChange = (next: string) => {
                                                const value = Number.parseFloat(next);
                                                if (!Number.isFinite(value)) return;
                                                const clamped = Math.min(100, Math.max(0, value));
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        strokeOpacity: clamped / 100,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <EnhancedInput
                                                    value={String(percent)}
                                                    onChange={handleChange}
                                                    inputMode="numeric"
                                                    unit="%"
                                                    min={0}
                                                    max={100}
                                                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                                                />
                                            );
                                        },
                                    },
                                    {
                                        id: "props.strokeVisible",
                                        className: "flex-shrink-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const visible = getProps(data.element).strokeVisible;
                                            const toggle = () => {
                                                onSaving(true);
                                                try {
                                                    patchProps({
                                                        strokeVisible: !visible,
                                                    });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            };

                                            return (
                                                <button
                                                    type="button"
                                                    onClick={toggle}
                                                    aria-pressed={visible}
                                                    aria-label="Toggle stroke visibility"
                                                    className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                                        visible ? "bg-white/10 border-white/40 text-white" : ""
                                                    }`}
                                                >
                                                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                </button>
                                            );
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: "Interaction",
                fields: [
                    defineField<D, any>({
                        id: "section.blueprint",
                        type: "section",
                        title: "Blueprint",
                        fields: [
                            defineField<D, any>({
                                id: "interaction.blueprint.placeholder",
                                type: "custom",
                                component: BlueprintPlaceholder,
                            }),
                        ],
                    }),
                ],
            },
        ],
    });
}

// ─── Docker Bar ─────────────────────────────────────────────────────────────

function createRectangleDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getProps(element);

    return [
        {
            kind: "number",
            id: "docker-border-radius",
            label: "Radius",
            tooltip: "Border radius",
            value: props.borderRadius,
            min: 0,
            step: 1,
            onChange: (value: number) => {
                const patch: Record<string, unknown> = {
                    ...element.props,
                    borderRadius: value,
                };
                if (props.borderRadiusLinked) {
                    patch.borderRadiusTL = value;
                    patch.borderRadiusTR = value;
                    patch.borderRadiusBL = value;
                    patch.borderRadiusBR = value;
                }
                documentService.updateElementProps(element.id, patch);
            },
        },
        {
            kind: "separator",
            id: "docker-sep-1",
        },
        {
            kind: "number",
            id: "docker-border-width",
            label: "Border",
            tooltip: "Border width",
            value: props.borderWidth,
            min: 0,
            step: 1,
            onChange: (value: number) => {
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    borderWidth: value,
                });
            },
        },
    ];
}

// ─── Module Export ───────────────────────────────────────────────────────────

export const RectangleWidgetModule: UIWidgetModule = {
    type: "nl.rectangle",
    displayName: "Rectangle",
    icon: Square,

    createDefaultElement: () => ({
        type: "nl.rectangle",
        name: "Rectangle",
        layout: {
            x: 0,
            y: 0,
            width: 200,
            height: 150,
            opacity: 1,
            visible: true,
        },
        props: {
            backgroundColor: "#ffffff",
            borderRadius: 0,
            borderRadiusTL: 0,
            borderRadiusTR: 0,
            borderRadiusBL: 0,
            borderRadiusBR: 0,
            borderRadiusLinked: true,
            borderColor: "#000000",
            borderWidth: 1,
            borderStyle: "solid",
            backgroundImage: "",
            backgroundFit: "cover",
            fillType: "color",
            fillVisible: true,
            fillOpacity: 1,
            strokeVisible: true,
            strokeOpacity: 1,
            strokeAlign: "center",
            strokeSide: "all",
            borderJoin: "miter",
            cornerAdvanced: false,
        },
    }),

    render: (props) => <RectangleRenderer {...props} />,

    createInspector: createRectangleInspector,

    createDockerBarItems: createRectangleDockerBarItems,

    createMultiSelectDockerBarItems: createRectangleDockerBarItems,
};
