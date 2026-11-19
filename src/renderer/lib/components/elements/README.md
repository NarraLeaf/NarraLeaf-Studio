# UI elements

Shared React components for the Studio interface. Import them from
`@/lib/components/elements`. The [design system](../../../../../docs/design-system.md)
defines their use, semantic colour tokens, control sizes and overlay conventions for both themes.

## Design Principles

- **Themes**: Semantic colour tokens support both light and dark Studio themes
- **Minimal Animations**: Smooth transitions without excessive motion
- **Consistent Spacing**: Using Tailwind's spacing system for consistency
- **Accessible**: Proper focus states and keyboard navigation
- **TypeScript**: Full type safety with comprehensive prop interfaces

## Components

### Button

Universal button component with multiple variants and sizes.

```tsx
import { X } from "lucide-react";
import { Button, IconButton } from "@/lib/components/elements";

// Basic button
<Button variant="primary" onClick={handleClick}>
    Click me
</Button>

// Icon button
<IconButton
    variant="ghost"
    size="md"
    onClick={handleClose}
    aria-label="Close"
    data-tip="Close"
>
    <X size={16} />
</IconButton>
```

**Variants**: `primary`, `secondary`, `ghost`, `danger`
**Sizes**: `sm`, `md`, `lg`

### Progress

Progress indicators for loading states and progress tracking.

```tsx
import { Progress, ProgressCircle } from "@/lib/components/elements";

// Linear progress
<Progress value={75} max={100} />

// Circular progress
<ProgressCircle value={75} size={40} showValue />
```

**Types**: `Progress` (linear), `ProgressIndeterminate`, `ProgressCircle`

### Input

Text input components with icons and validation states.

```tsx
import { Input, TextArea, SearchInput, InputGroup } from "@/lib/components/elements";

// Basic input
<Input placeholder="Enter text..." />

// With label and validation
<InputGroup label="Email" required error={emailError}>
    <Input type="email" value={email} onChange={setEmail} />
</InputGroup>

// Search input
<SearchInput placeholder="Search..." />
```

**Components**: `Input`, `TextArea`, `SearchInput`, `InputGroup`

### Card

Container components for organizing content.

```tsx
import {
    Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, InteractiveCard,
} from "@/lib/components/elements";

// Basic card
<Card>
    <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description</CardDescription>
    </CardHeader>
    <CardContent>Content here</CardContent>
    <CardFooter>
        <Button>Action</Button>
    </CardFooter>
</Card>

// Interactive card
<InteractiveCard
    title="Project"
    description="Project description"
    icon={<FolderIcon />}
    onClick={openProject}
    actions={<Button size="sm">Open</Button>}
/>
```

**Components**: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `InteractiveCard`

### Modal

Dialog components for overlays and confirmations.

```tsx
import { Modal, ConfirmModal, AlertModal } from "@/lib/components/elements";

// Basic modal
<Modal isOpen={isOpen} onClose={closeModal} title="Modal Title">
    <p>Modal content</p>
</Modal>

// Confirmation dialog
<ConfirmModal
    isOpen={showConfirm}
    onClose={() => setShowConfirm(false)}
    onConfirm={handleConfirm}
    title="Confirm Action"
    message="Are you sure you want to proceed?"
/>
```

**Components**: `Modal`, `ConfirmModal`, `AlertModal`, `ModalHeader`, `ModalBody`, `ModalFooter`

### Select

Dropdown and combobox components for selections.

```tsx
import { Select, Combobox } from "@/lib/components/elements";

const options = [
    { value: "option1", label: "Option 1" },
    { value: "option2", label: "Option 2" },
];

// Basic select
<Select
    options={options}
    value={selectedValue}
    onChange={setSelectedValue}
    placeholder="Select an option"
/>

// Combobox with search
<Combobox
    options={options}
    value={selectedValue}
    onChange={setSelectedValue}
    placeholder="Search options..."
/>
```

**Components**: `Select`, `Combobox`, `SelectGroup`

## Colour and tooltips

Use semantic tokens such as `bg-surface`, `border-edge`, `text-fg` and `hover:bg-fill`.
The design system defines their roles and theme behaviour. Give a control a tooltip with
`data-tip`; icon-only controls also need an `aria-label`. Use `TooltipGroup` from
`@/lib/tooltip` for a row of controls.

## Animation Guidelines

- **Transitions**: `transition-colors duration-200`
- **Transforms**: Used sparingly for dropdowns and modals
- **Loading**: `animate-pulse` for subtle loading indicators
- **Avoid**: Excessive motion, bounce effects, or complex animations

## Usage

Import components from the main index:

```tsx
import {
    Button,
    Progress,
    Input,
    Card,
    Modal,
    Select
} from "@/lib/components/elements";
```

All components are built with React 19 and TypeScript, providing full type safety and modern React patterns.
