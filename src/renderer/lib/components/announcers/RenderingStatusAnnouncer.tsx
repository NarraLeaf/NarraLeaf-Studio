import { getInterface } from "@/lib/app/bridge";
import { useEffect, useRef } from "react";

export function RenderingStatusAnnouncer() {
    const emitted = useRef(false);

    useEffect(() => {
        if (emitted.current) {
            return;
        }
        emitted.current = true;
        getInterface().window.ready();
    }, []);

    return <></>;
};
