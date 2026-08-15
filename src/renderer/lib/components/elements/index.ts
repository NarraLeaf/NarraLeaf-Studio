// Button components
export { Button, IconButton } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

// The one control size scale (see docs/design-system.md §3). Exported so a
// hand-rolled control can sit at the same height as the shared components
// instead of guessing a number.
export { CONTROL_SIZE_CLASS, CONTROL_SQUARE_CLASS, CONTROL_HEIGHT_CLASS } from "./controlSize";
export type { ControlSize } from "./controlSize";

// Accordion components
export { Accordion, AccordionItem, NestedAccordion } from "./Accordion";
export type { AccordionProps, AccordionItemProps, NestedAccordionProps } from "./Accordion";

// ContextMenu components
export { ContextMenu, ContextMenuSeparator, useContextMenu } from "./ContextMenu";
export type { ContextMenuProps, ContextMenuItemDef, ContextMenuSeparatorDef, ContextMenuDef } from "./ContextMenu";

// Progress components
export { Progress, ProgressIndeterminate, ProgressCircle } from "./Progress";
export type { ProgressProps, ProgressVariant, ProgressSize } from "./Progress";

// Input components
export { Input, TextArea, SearchInput, InputGroup } from "./Input";
export type { BaseInputProps, InputVariant, InputSize } from "./Input";

// Card components
export {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
    InteractiveCard
} from "./Card";
export type { CardProps, CardVariant, CardSize } from "./Card";

// Modal components
export {
    Modal,
    ConfirmModal,
    AlertModal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    dialogFooterButtonClass,
    useEscapeToClose
} from "./Modal";
export type { ModalProps } from "./Modal";

// Select components
export { Select, Combobox, SelectGroup } from "./Select";
export type { SelectProps, SelectOption } from "./Select";

// Switch components
export { Switch } from "./Switch";
export type { SwitchProps, SwitchSize, SwitchVariant } from "./Switch";

// Tooltip / hint components
export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";
export { HintPopover, AnchoredPanel } from "./HintPopover";
export type { HintPopoverProps, AnchoredPanelProps, PanelAnchor } from "./HintPopover";

// Slider components
export { Slider } from "./Slider";
export type { SliderProps } from "./Slider";

// Badge component
export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";

// TabStrip component (docs/design-system.md §7)
export { TabStrip } from "./Tabs";
export type { TabItem, TabStripProps } from "./Tabs";

// EmptyState component
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

// FieldLabel component (the eyebrow label; see docs/design-system.md §7)
export { FieldLabel } from "./FieldLabel";
export type { FieldLabelProps } from "./FieldLabel";

// SectionCard / PanelHeader (docs/design-system.md §7). Both are listed there as shared components
// and were reachable only by deep import until now, which is how a panel ends up hand-rolling one.
export { SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";
export { PanelHeader } from "./PanelHeader";

// Inspection-only control (survives a read-only `<fieldset disabled>` clamp)
export { InspectOnlyButton } from "./InspectOnlyButton";
export type { InspectOnlyButtonProps } from "./InspectOnlyButton";
