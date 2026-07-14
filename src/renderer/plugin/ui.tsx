import React from "react";
import {
    Accordion,
    AccordionItem,
    AlertModal,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    Combobox,
    ConfirmModal,
    ContextMenu,
    ContextMenuSeparator,
    IconButton,
    Input,
    InputGroup,
    InteractiveCard,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    NestedAccordion,
    Progress,
    ProgressCircle,
    ProgressIndeterminate,
    SearchInput,
    Select,
    SelectGroup,
    Switch,
    TextArea,
    useContextMenu,
} from "@/lib/components/elements";
import type { AssetSelectorProps } from "@/apps/workspace/modules/assets/components/AssetSelector";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(" ");
}

type AssetSelectorComponent = React.ComponentType<AssetSelectorProps>;

let assetSelectorLoader: Promise<AssetSelectorComponent> | null = null;

function loadAssetSelector(): Promise<AssetSelectorComponent> {
    assetSelectorLoader ??= import("@/apps/workspace/modules/assets/components/AssetSelector")
        .then(module => module.AssetSelector);
    return assetSelectorLoader;
}

export function PluginAssetSelector(props: AssetSelectorProps) {
    const [Component, setComponent] = React.useState<AssetSelectorComponent | null>(null);

    React.useEffect(() => {
        let mounted = true;
        void loadAssetSelector().then(component => {
            if (mounted) {
                setComponent(() => component);
            }
        });
        return () => {
            mounted = false;
        };
    }, []);

    if (!Component) {
        return null;
    }
    return <Component {...props} />;
}

export type PluginPanelRootProps = DivProps & {
    padded?: boolean;
};

export function PluginPanelRoot({
    padded = true,
    className,
    children,
    ...props
}: PluginPanelRootProps) {
    return (
        <div
            className={cx(
                "h-full min-h-0 bg-surface text-fg flex flex-col overflow-hidden",
                padded && "p-3",
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}

export type PluginPanelHeaderProps = DivProps & {
    title: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
};

export function PluginPanelHeader({
    title,
    description,
    actions,
    className,
    children,
    ...props
}: PluginPanelHeaderProps) {
    return (
        <div
            className={cx("flex items-start justify-between gap-3 border-b border-edge pb-3 mb-3", className)}
            {...props}
        >
            <div className="min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{title}</div>
                {description && (
                    <div className="mt-1 text-xs text-fg-muted leading-relaxed">{description}</div>
                )}
                {children}
            </div>
            {actions && (
                <div className="flex shrink-0 items-center gap-1">{actions}</div>
            )}
        </div>
    );
}

export type PluginPanelToolbarProps = DivProps;

export function PluginPanelToolbar({
    className,
    children,
    ...props
}: PluginPanelToolbarProps) {
    return (
        <div className={cx("flex items-center gap-2 pb-3", className)} {...props}>
            {children}
        </div>
    );
}

export type PluginPanelSectionProps = DivProps & {
    title?: React.ReactNode;
    actions?: React.ReactNode;
};

export function PluginPanelSection({
    title,
    actions,
    className,
    children,
    ...props
}: PluginPanelSectionProps) {
    return (
        <section className={cx("min-w-0 py-2", className)} {...props}>
            {(title || actions) && (
                <div className="mb-2 flex items-center justify-between gap-2">
                    {title && <h3 className="text-xs font-semibold tracking-wide text-fg-muted">{title}</h3>}
                    {actions && <div className="flex items-center gap-1">{actions}</div>}
                </div>
            )}
            <div className="min-w-0">{children}</div>
        </section>
    );
}

export type PluginPanelRowProps = DivProps & {
    label?: React.ReactNode;
    description?: React.ReactNode;
    control?: React.ReactNode;
};

export function PluginPanelRow({
    label,
    description,
    control,
    className,
    children,
    ...props
}: PluginPanelRowProps) {
    return (
        <div className={cx("flex min-w-0 items-center justify-between gap-3 py-1.5", className)} {...props}>
            <div className="min-w-0">
                {label && <div className="text-sm text-fg truncate">{label}</div>}
                {description && <div className="mt-0.5 text-xs text-fg-subtle leading-relaxed">{description}</div>}
                {children}
            </div>
            {control && <div className="shrink-0">{control}</div>}
        </div>
    );
}

export type PluginPanelEmptyStateProps = DivProps & {
    icon?: React.ReactNode;
    title: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
};

export function PluginPanelEmptyState({
    icon,
    title,
    description,
    actions,
    className,
    ...props
}: PluginPanelEmptyStateProps) {
    return (
        <div
            className={cx("flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed border-edge px-4 py-6 text-center", className)}
            {...props}
        >
            {icon && <div className="mb-2 text-fg-subtle">{icon}</div>}
            <div className="text-sm font-medium text-fg">{title}</div>
            {description && <div className="mt-1 max-w-xs text-xs leading-relaxed text-fg-subtle">{description}</div>}
            {actions && <div className="mt-3 flex items-center justify-center gap-2">{actions}</div>}
        </div>
    );
}

export const pluginUi = Object.freeze({
    Button,
    IconButton,
    Input,
    TextArea,
    SearchInput,
    InputGroup,
    Select,
    Combobox,
    SelectGroup,
    Switch,
    Modal,
    ConfirmModal,
    AlertModal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ContextMenu,
    ContextMenuSeparator,
    useContextMenu,
    Progress,
    ProgressIndeterminate,
    ProgressCircle,
    Accordion,
    AccordionItem,
    NestedAccordion,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
    InteractiveCard,
    AssetSelector: PluginAssetSelector,
    Panel: Object.freeze({
        Root: PluginPanelRoot,
        Header: PluginPanelHeader,
        Toolbar: PluginPanelToolbar,
        Section: PluginPanelSection,
        Row: PluginPanelRow,
        EmptyState: PluginPanelEmptyState,
    }),
});

export type PluginUiKit = typeof pluginUi;
