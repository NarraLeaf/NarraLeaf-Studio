import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * The menus of the title bar, coordinated as one bar.
 *
 * Each menu draws its own button and its own popup; what none of them can own alone is the pair of
 * rules that make a row of menus read as a menu bar. Only one is on screen at a time, and once one
 * is open the pointer alone moves between them - a slide sideways opens the next and drops the one
 * behind it, with no second click. So the open menu is held here, by id, and every member asks the
 * bar rather than keeping a boolean of its own.
 *
 * `hotTrack` marks which members the pointer may walk. The action groups (File, Edit, Help, and any
 * a plugin registers) are the bar; the project switcher and the Run button are controls that happen
 * to carry a menu, and an author crossing them on the way to a window control never asked to see it.
 * They stay under the one-at-a-time rule - opening either still closes whatever was open - and it is
 * only the hover that is withheld, in both directions: a menu does not open out of them either.
 *
 * A member used outside a bar keeps working on its own, which is what the standalone branch in
 * {@link useTitleBarMenu} is for. It simply has no siblings to exclude or chain to.
 */
interface OpenMenu {
    id: string;
    hotTrack: boolean;
}

interface TitleBarMenusActions {
    setOpen(id: string, hotTrack: boolean, open: boolean): void;
    hover(id: string, hotTrack: boolean): void;
    release(id: string): void;
}

/**
 * Which menu is open, and what a member may do about it - deliberately two contexts.
 *
 * The actions never change identity, which is what lets a member hold one of them for its whole
 * life: a member's release-on-unmount runs off `TitleBarMenusActions`, and if that object were
 * replaced whenever the open menu changed, the effect would tear down and re-run on every open -
 * releasing the menu it had just opened. Handing the id down separately keeps the two apart.
 */
const TitleBarMenusActionsContext = createContext<TitleBarMenusActions | null>(null);
const TitleBarMenusOpenIdContext = createContext<string | null>(null);

export interface TitleBarMenusProps {
    className?: string;
    children: React.ReactNode;
}

/** The row that holds the title bar's menus, and the one open menu between them. */
export function TitleBarMenus({ className, children }: TitleBarMenusProps) {
    const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);

    // Written as updaters so the callbacks never close over the open menu: their identity has to
    // stay put, or every member's dismissal listener would be torn down and rebuilt on each change.
    const setOpen = useCallback((id: string, hotTrack: boolean, open: boolean) => {
        setOpenMenu(current => (open ? { id, hotTrack } : current?.id === id ? null : current));
    }, []);

    const hover = useCallback((id: string, hotTrack: boolean) => {
        setOpenMenu(current => (
            current && current.id !== id && current.hotTrack && hotTrack ? { id, hotTrack } : current
        ));
    }, []);

    const release = useCallback((id: string) => {
        setOpenMenu(current => (current?.id === id ? null : current));
    }, []);

    const actions = useMemo<TitleBarMenusActions>(
        () => ({ setOpen, hover, release }),
        [setOpen, hover, release],
    );

    return (
        <TitleBarMenusActionsContext.Provider value={actions}>
            <TitleBarMenusOpenIdContext.Provider value={openMenu?.id ?? null}>
                <div className={className}>{children}</div>
            </TitleBarMenusOpenIdContext.Provider>
        </TitleBarMenusActionsContext.Provider>
    );
}

export interface TitleBarMenuOptions {
    /** Whether the pointer alone may open this menu while a sibling is already open. */
    hotTrack?: boolean;
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
export function useTitleBarMenu(id: string, { hotTrack = false }: TitleBarMenuOptions = {}): TitleBarMenu {
    const bar = useContext(TitleBarMenusActionsContext);
    const openId = useContext(TitleBarMenusOpenIdContext);
    const ref = useRef<HTMLDivElement>(null);
    const [standaloneOpen, setStandaloneOpen] = useState(false);
    const open = bar ? openId === id : standaloneOpen;

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

    // A menu that leaves the bar while it is open would take the bar's answer with it: the row would
    // go on believing something is on screen, and hand the next hover a chain that leads nowhere.
    useEffect(() => () => bar?.release(id), [bar, id]);

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
