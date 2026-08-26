import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Keyboard, Mouse, Plus, Pointer, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
    formatBlueprintKeyboardBindingFromEvent,
    normalizeBlueprintKeyboardEventKeyName,
} from "@shared/types/blueprint/graph";
import { dedupeUIInputBindings, type UIInputBinding } from "@shared/types/ui-editor/inputAction";
import {
    ContextMenu,
    useContextMenu,
    type ContextMenuDef,
    type ContextMenuItemDef,
} from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    INPUT_BINDING_DEVICES,
    getInputBindingDevices,
    getInputBindingDevicesLabel,
    getInputBindingLabel,
    getInputDeviceGestures,
    getInputDeviceLabel,
    getInputPointerGestureLabel,
    type InputBindingDevice,
    type TranslateFn,
} from "./inputBindingLabels";

type InputBindingListProps = {
    bindings: readonly UIInputBinding[];
    onChange: (bindings: UIInputBinding[]) => void;
    /** Shown in place of the chips when the list is empty. */
    emptyLabel?: string;
    /** Bindings the author cannot remove here, drawn muted before the editable ones. */
    inherited?: readonly UIInputBinding[];
};

const MODIFIER_EVENT_KEYS = new Set(["alt", "control", "shift", "meta"]);

/** One picture per device, shared by the chip markings and the add menu's groups. */
const DEVICE_ICONS: Record<InputBindingDevice, LucideIcon> = {
    pointer: Mouse,
    key: Keyboard,
    touch: Pointer,
};

function isModifierOnlyEvent(event: KeyboardEvent): boolean {
    return MODIFIER_EVENT_KEYS.has(normalizeBlueprintKeyboardEventKeyName(event.key));
}

function bindingKey(binding: UIInputBinding): string {
    return binding.kind === "pointer" ? `pointer:${binding.gesture}` : `key:${binding.key}`;
}

/**
 * Which devices one chip's binding can be triggered from.
 *
 * The chips are one flat row whatever they are bound to, so a key, a scroll and a held finger sit
 * side by side reading as the same kind of thing. This is the mark that separates them, and it is
 * the quietest one that can still name two devices at once - a click and the four scroll directions
 * belong to the mouse and to touch, and both have to be readable rather than one winning.
 */
function BindingDevices({ binding, t }: { binding: UIInputBinding; t: TranslateFn }) {
    const devices = getInputBindingDevices(binding);
    if (devices.length === 0) {
        return null;
    }
    const label = getInputBindingDevicesLabel(binding, t);
    return (
        <span className="flex items-center gap-0.5 text-fg-subtle" role="img" aria-label={label} data-tip={label}>
            {devices.map(device => {
                const Icon = DEVICE_ICONS[device];
                return <Icon key={device} className="h-3 w-3" aria-hidden />;
            })}
        </span>
    );
}

/**
 * The gestures one action answers, as removable chips plus a way to add another.
 *
 * Shared by the two halves of the input model so a binding reads the same in both: the Input Actions
 * library sets what every interface inherits, and an interface's Input section adds to or replaces
 * it. `inherited` is how the second case shows the first - the project's own bindings, drawn muted
 * and with no remove button, because removing one there would be editing the project from inside a
 * page.
 *
 * Keyboard capture listens on the window in the capture phase while it is armed, the way the
 * blueprint `On Key` card does, so a binding that collides with a Studio shortcut can still be
 * recorded.
 */
export function InputBindingList({ bindings, onChange, emptyLabel, inherited }: InputBindingListProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [listening, setListening] = useState(false);
    const [preview, setPreview] = useState("");
    const pendingModifierRef = useRef("");

    const taken = new Set([...(inherited ?? []), ...bindings].map(bindingKey));

    const addBinding = useCallback(
        (binding: UIInputBinding) => {
            onChange(dedupeUIInputBindings([...bindings, binding]));
        },
        [bindings, onChange],
    );

    const removeBinding = useCallback(
        (binding: UIInputBinding) => {
            const key = bindingKey(binding);
            onChange(bindings.filter(entry => bindingKey(entry) !== key));
        },
        [bindings, onChange],
    );

    useEffect(() => {
        if (!listening) {
            pendingModifierRef.current = "";
            setPreview("");
            return undefined;
        }
        const stop = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };
        const commit = (binding: string) => {
            pendingModifierRef.current = "";
            setPreview("");
            setListening(false);
            addBinding({ kind: "key", key: binding });
        };
        const onKeyDown = (event: KeyboardEvent) => {
            stop(event);
            const binding = formatBlueprintKeyboardBindingFromEvent(event);
            if (!binding) {
                return;
            }
            setPreview(binding);
            // A held modifier is a legal binding on its own, but only once it is released - otherwise
            // Ctrl+S would be recorded as "Ctrl" the moment the author pressed Ctrl.
            if (isModifierOnlyEvent(event)) {
                pendingModifierRef.current = binding;
                return;
            }
            commit(binding);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            stop(event);
            if (!isModifierOnlyEvent(event) || !pendingModifierRef.current) {
                return;
            }
            commit(pendingModifierRef.current);
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && rootRef.current?.contains(target)) {
                return;
            }
            setListening(false);
        };
        const onBlur = () => setListening(false);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("blur", onBlur);
        };
    }, [addBinding, listening]);

    /**
     * The gestures on offer, one group per device.
     *
     * Grouped rather than flat so that picking a gesture starts from the device it is for, and so an
     * action bound only to a key shows a touch group with nothing taken in it. A gesture two devices
     * reach is listed under both and adds the same binding from either, because the device is a
     * property of the binding rather than a second thing an author chooses.
     */
    const openAddMenu = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const keyItems: ContextMenuItemDef[] = [
            {
                id: "key",
                label: t("uiEditor.inputActions.addKey"),
                onClick: () => {
                    hideMenu();
                    setListening(true);
                },
            },
        ];
        const items: ContextMenuDef = INPUT_BINDING_DEVICES.map(device => {
            const Icon = DEVICE_ICONS[device];
            return {
                id: `device:${device}`,
                label: getInputDeviceLabel(device, t),
                icon: <Icon className="h-4 w-4" aria-hidden />,
                submenu:
                    device === "key"
                        ? keyItems
                        : getInputDeviceGestures(device).map(gesture => ({
                              id: `${device}:${gesture}`,
                              label: getInputPointerGestureLabel(gesture, t),
                              disabled: taken.has(`pointer:${gesture}`),
                              onClick: () => {
                                  hideMenu();
                                  addBinding({ kind: "pointer", gesture });
                              },
                          })),
            };
        });
        setMenuItems(items);
        showMenu(event);
    };

    return (
        <div ref={rootRef} className="relative flex flex-wrap items-center gap-1">
            {(inherited ?? []).map(binding => (
                <span
                    key={`inherited:${bindingKey(binding)}`}
                    className="inline-flex min-h-7 items-center gap-1 rounded-md border border-dashed border-edge px-2 text-2xs text-fg-subtle"
                >
                    <BindingDevices binding={binding} t={t} />
                    {getInputBindingLabel(binding, t)}
                </span>
            ))}
            {bindings.map(binding => (
                <span
                    key={bindingKey(binding)}
                    className="inline-flex min-h-7 items-center gap-1 rounded-md border border-edge bg-fill-subtle pl-2 pr-1 text-2xs text-fg"
                >
                    <BindingDevices binding={binding} t={t} />
                    {getInputBindingLabel(binding, t)}
                    <button
                        type="button"
                        className="grid h-5 w-5 place-items-center rounded-md text-fg-subtle hover:bg-fill hover:text-fg"
                        onClick={() => removeBinding(binding)}
                        {...freeze.writes(
                            false,
                            t("uiEditor.inputActions.removeBinding", { binding: getInputBindingLabel(binding, t) }),
                        )}
                        aria-label={t("uiEditor.inputActions.removeBinding", {
                            binding: getInputBindingLabel(binding, t),
                        })}
                    >
                        <X className="h-3 w-3" aria-hidden />
                    </button>
                </span>
            ))}
            {bindings.length === 0 && (inherited ?? []).length === 0 ? (
                <span className="text-2xs text-fg-subtle">{emptyLabel ?? t("uiEditor.inputActions.noBindings")}</span>
            ) : null}
            <button
                type="button"
                className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-2xs transition-colors ${
                    listening
                        ? "border-primary/45 bg-primary/10 text-primary"
                        : "border-edge text-fg-muted hover:bg-fill hover:text-fg"
                }`}
                onClick={openAddMenu}
                {...freeze.writes(false, t("uiEditor.inputActions.addBinding"))}
                aria-label={t("uiEditor.inputActions.addBinding")}
            >
                {listening ? <Keyboard className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
                <span>
                    {listening ? preview || t("blueprint.keyboard.pressKey") : t("uiEditor.inputActions.addBinding")}
                </span>
            </button>
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
