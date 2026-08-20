import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * The menus of the title bar, coordinated as one bar.
 *
 * Each menu draws its own button and its own popup; what none of them can own alone are the rules
 * that make a row of menus read as a menu bar. Only one is on screen at a time; once one is open the
 * pointer moves between them on its own, and so do the arrow keys; and Alt reaches any of them
 * directly. So the open menu is held here, by id, and every member asks the bar rather than keeping
 * a boolean of its own.
 *
 * `hotTrack` marks which members are the bar. The action groups (File, Edit, Help, and any a plugin
 * registers) are; the project switcher and the Run button are controls that happen to carry a menu,
 * and an author crossing them on the way to a window control never asked to see it. They stay under
 * the one-at-a-time rule - opening either still closes whatever was open, and Escape still closes
 * them - and what is withheld is the walking: the pointer and the arrow keys neither enter them nor
 * leave from them.
 *
 * A member used outside a bar keeps working on its own, which is what the standalone branch in
 * {@link useTitleBarMenu} is for. It simply has no siblings to exclude or walk to.
 */
interface OpenMenu {
    id: string;
    hotTrack: boolean;
}

/**
 * What a member tells the bar about itself. Held as one mutable object per member so registration
 * survives every render: the bar reads the fields when a key arrives, not when they were written.
 */
interface TitleBarMenuRecord {
    element: React.RefObject<HTMLDivElement | null>;
    hotTrack: boolean;
    /** The letter Alt reaches this menu by, if it has one. */
    mnemonic?: string;
    /** First refusal on a key while this menu is open; true means it was consumed. */
    onKeyDown?: (event: KeyboardEvent) => boolean;
}

interface TitleBarMenusActions {
    setOpen(id: string, hotTrack: boolean, open: boolean): void;
    hover(id: string, hotTrack: boolean): void;
    register(id: string, record: TitleBarMenuRecord): void;
    unregister(id: string, record: TitleBarMenuRecord): void;
}

/**
 * Which menu is open, whether the accelerators are showing, and what a member may do about it -
 * deliberately three contexts.
 *
 * The actions never change identity, which is what lets a member hold one of them for its whole
 * life: a member's release-on-unmount runs off `TitleBarMenusActions`, and if that object were
 * replaced whenever the open menu changed, the effect would tear down and re-run on every open -
 * releasing the menu it had just opened. Handing the id and the reveal down separately keeps them
 * apart.
 */
const TitleBarMenusActionsContext = createContext<TitleBarMenusActions | null>(null);
const TitleBarMenusOpenIdContext = createContext<string | null>(null);
const TitleBarMnemonicRevealContext = createContext<boolean>(false);

export interface TitleBarMenusProps {
    className?: string;
    children: React.ReactNode;
    /**
     * Stand the bar's keyboard down. Set while a modal dialog is up: the dialog owns the keyboard,
     * and this is the same gate `KeybindingService` puts on its own bindings.
     */
    suspended?: boolean;
}

/** The row that holds the title bar's menus, and the one open menu between them. */
export function TitleBarMenus({ className, children, suspended = false }: TitleBarMenusProps) {
    const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
    const [revealMnemonics, setRevealMnemonics] = useState(false);
    const members = useRef(new Map<string, TitleBarMenuRecord>()).current;
    // Read inside window listeners, which are installed once and must not close over a stale answer.
    const openMenuRef = useRef<OpenMenu | null>(null);
    openMenuRef.current = openMenu;

    // Written as updaters so the callbacks never close over the open menu: their identity has to
    // stay put, or every member's listeners would be torn down and rebuilt on each change.
    const setOpen = useCallback((id: string, hotTrack: boolean, open: boolean) => {
        setOpenMenu(current => (open ? { id, hotTrack } : current?.id === id ? null : current));
    }, []);

    const hover = useCallback((id: string, hotTrack: boolean) => {
        setOpenMenu(current => (
            current && current.id !== id && current.hotTrack && hotTrack ? { id, hotTrack } : current
        ));
    }, []);

    const register = useCallback((id: string, record: TitleBarMenuRecord) => {
        members.set(id, record);
    }, [members]);

    // A menu that leaves the bar while it is open would take the bar's answer with it: the row would
    // go on believing something is on screen, and hand the next hover a chain that leads nowhere.
    const unregister = useCallback((id: string, record: TitleBarMenuRecord) => {
        if (members.get(id) === record) {
            members.delete(id);
        }
        setOpenMenu(current => (current?.id === id ? null : current));
    }, [members]);

    const actions = useMemo<TitleBarMenusActions>(
        () => ({ setOpen, hover, register, unregister }),
        [setOpen, hover, register, unregister],
    );

    /**
     * The bar in the order it is drawn, which is the order the arrow keys walk.
     *
     * Ordered by document position rather than by registration: members mount in whatever order
     * React gets to them, and the row an author is looking at is the DOM's.
     */
    const walkable = useCallback((): { id: string; element: HTMLElement }[] => {
        return [...members.entries()]
            .flatMap(([id, record]) => (
                record.hotTrack && record.element.current ? [{ id, element: record.element.current }] : []
            ))
            .sort((a, b) => (
                a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
            ));
    }, [members]);

    const step = useCallback((delta: number): boolean => {
        const open = openMenuRef.current;
        if (!open?.hotTrack) return false;
        const bar = walkable();
        const index = bar.findIndex(entry => entry.id === open.id);
        if (index < 0 || bar.length < 2) return false;
        const next = bar[(index + delta + bar.length) % bar.length];
        setOpenMenu({ id: next.id, hotTrack: true });
        return true;
    }, [walkable]);

    // While a menu is open it owns the keyboard, so this listens in capture: an Escape belongs to the
    // menu on screen, not to whichever editor happens to hold focus behind it. The open member gets
    // first refusal, because only it knows whether the key means something inside its own popup -
    // Escape closing one submenu level, an arrow opening the next.
    useEffect(() => {
        if (suspended) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const open = openMenuRef.current;
            if (!open) return;
            const record = members.get(open.id);
            const consume = () => {
                event.preventDefault();
                event.stopPropagation();
            };

            if (record?.onKeyDown?.(event)) {
                consume();
                return;
            }
            if (event.key === "Escape") {
                setOpenMenu(current => (current?.id === open.id ? null : current));
                consume();
                return;
            }
            if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.altKey && !event.ctrlKey && !event.metaKey) {
                if (step(event.key === "ArrowRight" ? 1 : -1)) consume();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [suspended, members, step]);

    // Alt: the accelerators, and the hint that says what they are.
    //
    // An accelerator is the weaker claim on a key. `KeybindingService` marks what it has handled on
    // the same event, so a binding an author can see and rebind - Alt+H aligns in the UI editor -
    // keeps the key, and the menu answers only where that binding is not live. The verdict is read
    // one task later rather than straight away: read inside the listener it would only be right
    // while the service happened to have been registered first, and "which listener was installed
    // first" is not something a menu bar should be resting on.
    useEffect(() => {
        if (suspended) {
            setRevealMnemonics(false);
            return;
        }
        const pending: number[] = [];
        const clear = () => setRevealMnemonics(false);
        // A window that is no longer the one being typed into has no business holding a menu open:
        // this is what every menu bar on the platform does when its application steps back.
        const onBlur = () => {
            clear();
            setOpenMenu(null);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            const altAlone = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
            setRevealMnemonics(altAlone);
            if (!altAlone || event.repeat || event.isComposing) return;
            for (const [id, record] of members) {
                if (!record.mnemonic || !matchesMnemonic(event, record.mnemonic)) continue;
                pending.push(window.setTimeout(() => {
                    if (event.defaultPrevented) return;
                    setOpenMenu({ id, hotTrack: record.hotTrack });
                }, 0));
                return;
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Alt" || !event.altKey) clear();
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        // Alt+Tab leaves with the key still down; without this the hint would be showing on return.
        window.addEventListener("blur", onBlur);
        return () => {
            pending.forEach(window.clearTimeout);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, [suspended, members]);

    return (
        <TitleBarMenusActionsContext.Provider value={actions}>
            <TitleBarMenusOpenIdContext.Provider value={openMenu?.id ?? null}>
                <TitleBarMnemonicRevealContext.Provider value={revealMnemonics}>
                    <div className={className}>{children}</div>
                </TitleBarMnemonicRevealContext.Provider>
            </TitleBarMenusOpenIdContext.Provider>
        </TitleBarMenusActionsContext.Provider>
    );
}

/**
 * Does this Alt chord name that letter?
 *
 * Matched on the physical key first: with a Chinese or Japanese layout active `event.key` can be
 * anything, while the key under the author's finger is still the one the hint drew.
 */
function matchesMnemonic(event: KeyboardEvent, mnemonic: string): boolean {
    const letter = mnemonic.toUpperCase();
    return event.code === `Key${letter}` || event.key.toUpperCase() === letter;
}

export interface TitleBarMenuOptions {
    /** Whether the pointer and the arrow keys may walk to this menu while a sibling is open. */
    hotTrack?: boolean;
    /** The letter Alt reaches this menu by. Undeclared means no accelerator. */
    mnemonic?: string;
    /** First refusal on a key while this menu is open; return true if it was consumed. */
    onKeyDown?: (event: KeyboardEvent) => boolean;
}

export interface TitleBarMenu {
    /** Goes on the element wrapping the button and its popup; it decides what counts as "outside". */
    ref: React.RefObject<HTMLDivElement | null>;
    open: boolean;
    setOpen: (open: boolean) => void;
    close: () => void;
    toggle: () => void;
    /** Goes on the button that opens the menu. */
    triggerProps: { onPointerEnter: () => void };
}

/**
 * Join one menu to the title bar's row: see {@link TitleBarMenus} for what membership buys.
 */
export function useTitleBarMenu(
    id: string,
    { hotTrack = false, mnemonic, onKeyDown }: TitleBarMenuOptions = {},
): TitleBarMenu {
    const bar = useContext(TitleBarMenusActionsContext);
    const openId = useContext(TitleBarMenusOpenIdContext);
    const ref = useRef<HTMLDivElement>(null);
    const [standaloneOpen, setStandaloneOpen] = useState(false);
    const open = bar ? openId === id : standaloneOpen;

    // One record for the member's whole life, refreshed in place. Registering a new object per
    // render would put the registration effect on a treadmill; reading a stale one would hand the
    // bar last render's key handler.
    const record = useRef<TitleBarMenuRecord>({ element: ref, hotTrack, mnemonic, onKeyDown });
    useEffect(() => {
        record.current.hotTrack = hotTrack;
        record.current.mnemonic = mnemonic;
        record.current.onKeyDown = onKeyDown;
    });

    useEffect(() => {
        const entry = record.current;
        bar?.register(id, entry);
        return () => bar?.unregister(id, entry);
    }, [bar, id]);

    const setOpen = useCallback((next: boolean) => {
        if (bar) {
            bar.setOpen(id, hotTrack, next);
        } else {
            setStandaloneOpen(next);
        }
    }, [bar, id, hotTrack]);

    const close = useCallback(() => setOpen(false), [setOpen]);
    const toggle = useCallback(() => setOpen(!open), [setOpen, open]);
    const onPointerEnter = useCallback(() => bar?.hover(id, hotTrack), [bar, id, hotTrack]);
    const triggerProps = useMemo(() => ({ onPointerEnter }), [onPointerEnter]);

    // Dismissal on a pointer that lands anywhere else. It sits with the member rather than with the
    // bar so a menu still closes when it is used without one, and because only one member is ever
    // open there is only ever one listener. Capture, so a control underneath cannot answer first.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (ref.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        return () => window.removeEventListener("pointerdown", onPointerDown, true);
    }, [open, setOpen]);

    return { ref, open, setOpen, close, toggle, triggerProps };
}

/** Whether the bar is currently showing what Alt reaches. */
export function useMnemonicReveal(): boolean {
    return useContext(TitleBarMnemonicRevealContext);
}

/**
 * A menu's label with its accelerator marked.
 *
 * The letter is underlined where the label already contains it, and appended in brackets where it
 * does not - `File` against `文件(F)`, which is what every menu bar on the platform does once the
 * labels stop being English. The bracket half is permanent, because a hint that only exists while
 * Alt is held is no hint at all in a language whose labels can never carry the underline; the
 * underline itself appears with Alt, so a label that can carry it stays clean until it is asked for.
 */
export function MnemonicLabel({ label, mnemonic, reveal }: {
    label: string;
    mnemonic?: string;
    reveal: boolean;
}) {
    const index = mnemonic ? label.toUpperCase().indexOf(mnemonic.toUpperCase()) : -1;

    if (!mnemonic) {
        return <>{label}</>;
    }
    if (index < 0) {
        return (
            <>
                {label}
                <span className="text-fg-subtle">
                    ({reveal ? <u>{mnemonic.toUpperCase()}</u> : mnemonic.toUpperCase()})
                </span>
            </>
        );
    }
    return (
        <>
            {label.slice(0, index)}
            {reveal ? <u>{label.slice(index, index + 1)}</u> : label.slice(index, index + 1)}
            {label.slice(index + 1)}
        </>
    );
}
