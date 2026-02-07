import { Square } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps, UIInspectorData, DockerBarItem, DockerBarContext, InspectorContext } from "../types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";

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

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    };
}

// ─── Renderer ───────────────────────────────────────────────────────────────

function RectangleRenderer({ element, children }: WidgetRendererProps) {
    const props = getProps(element);

    const borderRadius = props.borderRadiusLinked
        ? `${props.borderRadius}px`
        : `${props.borderRadiusTL}px ${props.borderRadiusTR}px ${props.borderRadiusBR}px ${props.borderRadiusBL}px`;

    const style: React.CSSProperties = {
        width: "100%",
        height: "100%",
        backgroundColor: props.backgroundColor,
        borderRadius,
        borderColor: props.borderColor,
        borderWidth: props.borderWidth > 0 ? `${props.borderWidth}px` : undefined,
        borderStyle: props.borderWidth > 0 ? props.borderStyle : undefined,
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
    };

    const hasImage = Boolean(props.backgroundImage);

    return (
        <div style={style}>
            {hasImage && (
                <img
                    src={props.backgroundImage}
                    alt=""
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: props.backgroundFit as React.CSSProperties["objectFit"],
                        pointerEvents: "none",
                    }}
                    draggable={false}
                />
            )}
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

    type D = UIInspectorData;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.rectangle:${element.id}`,
        title: element.name ?? "Rectangle",
        fields: [
            // ── Fill Section ────────────────────────────────────────
            defineField<D, any>({
                id: "props.backgroundColor",
                type: "text",
                label: "Background",
                getValue: (data: D) => getProps(data.element).backgroundColor,
                setValue: (_data: D, value: string) => patchProps({ backgroundColor: value }),
                order: 10,
            }),
            defineField<D, any>({
                id: "props.backgroundImage",
                type: "text",
                label: "Image URL",
                placeholder: "https://... or asset path",
                getValue: (data: D) => getProps(data.element).backgroundImage,
                setValue: (_data: D, value: string) => patchProps({ backgroundImage: value }),
                order: 11,
            }),
            defineField<D, any>({
                id: "props.backgroundFit",
                type: "select",
                label: "Image Fit",
                options: IMAGE_FIT_OPTIONS,
                getValue: (data: D) => getProps(data.element).backgroundFit,
                setValue: (_data: D, value: string | number) => patchProps({ backgroundFit: String(value) }),
                order: 12,
            }),

            // ── Border Radius Section ───────────────────────────────
            defineField<D, any>({
                id: "props.borderRadiusLinked",
                type: "checkbox",
                label: "Link Radius",
                getValue: (data: D) => getProps(data.element).borderRadiusLinked,
                setValue: (_data: D, value: boolean) => patchProps({ borderRadiusLinked: value }),
                order: 20,
            }),
            defineField<D, any>({
                id: "props.borderRadius",
                type: "number",
                label: "Radius",
                min: 0,
                step: 1,
                getValue: (data: D) => getProps(data.element).borderRadius,
                setValue: (data: D, value: number) => {
                    const linked = getProps(data.element).borderRadiusLinked;
                    if (linked) {
                        patchProps({
                            borderRadius: value,
                            borderRadiusTL: value,
                            borderRadiusTR: value,
                            borderRadiusBL: value,
                            borderRadiusBR: value,
                        });
                    } else {
                        patchProps({ borderRadius: value });
                    }
                },
                hidden: (data: D) => !getProps(data.element).borderRadiusLinked,
                order: 21,
            }),
            defineField<D, any>({
                id: "props.borderRadiusTL",
                type: "number",
                label: "Top Left",
                min: 0,
                step: 1,
                getValue: (data: D) => getProps(data.element).borderRadiusTL,
                setValue: (_data: D, value: number) => patchProps({ borderRadiusTL: value }),
                hidden: (data: D) => getProps(data.element).borderRadiusLinked,
                order: 22,
            }),
            defineField<D, any>({
                id: "props.borderRadiusTR",
                type: "number",
                label: "Top Right",
                min: 0,
                step: 1,
                getValue: (data: D) => getProps(data.element).borderRadiusTR,
                setValue: (_data: D, value: number) => patchProps({ borderRadiusTR: value }),
                hidden: (data: D) => getProps(data.element).borderRadiusLinked,
                order: 23,
            }),
            defineField<D, any>({
                id: "props.borderRadiusBL",
                type: "number",
                label: "Bottom Left",
                min: 0,
                step: 1,
                getValue: (data: D) => getProps(data.element).borderRadiusBL,
                setValue: (_data: D, value: number) => patchProps({ borderRadiusBL: value }),
                hidden: (data: D) => getProps(data.element).borderRadiusLinked,
                order: 24,
            }),
            defineField<D, any>({
                id: "props.borderRadiusBR",
                type: "number",
                label: "Bottom Right",
                min: 0,
                step: 1,
                getValue: (data: D) => getProps(data.element).borderRadiusBR,
                setValue: (_data: D, value: number) => patchProps({ borderRadiusBR: value }),
                hidden: (data: D) => getProps(data.element).borderRadiusLinked,
                order: 25,
            }),

            // ── Border Section ──────────────────────────────────────
            defineField<D, any>({
                id: "props.borderWidth",
                type: "number",
                label: "Border Width",
                min: 0,
                step: 1,
                getValue: (data: D) => getProps(data.element).borderWidth,
                setValue: (_data: D, value: number) => patchProps({ borderWidth: value }),
                order: 30,
            }),
            defineField<D, any>({
                id: "props.borderColor",
                type: "text",
                label: "Border Color",
                getValue: (data: D) => getProps(data.element).borderColor,
                setValue: (_data: D, value: string) => patchProps({ borderColor: value }),
                order: 31,
            }),
            defineField<D, any>({
                id: "props.borderStyle",
                type: "select",
                label: "Border Style",
                options: BORDER_STYLE_OPTIONS,
                getValue: (data: D) => getProps(data.element).borderStyle,
                setValue: (_data: D, value: string | number) => patchProps({ borderStyle: String(value) }),
                order: 32,
            }),
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
        },
    }),

    render: (props) => <RectangleRenderer {...props} />,

    createInspector: createRectangleInspector,

    createDockerBarItems: createRectangleDockerBarItems,

    createMultiSelectDockerBarItems: createRectangleDockerBarItems,
};
