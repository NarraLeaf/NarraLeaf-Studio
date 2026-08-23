import { createContext, useContext, type ReactNode } from "react";
import { useServers, type ServersState } from "@/lib/vcs/servers";

/**
 * The servers this installation is signed in to, read once for the whole flow.
 *
 * Hoisted for the same reason the preferences are: the Team screen adds a server and the pane beside
 * it shows the list, and two components each reading the list for themselves would leave the pane
 * showing "no server" for as long as nobody re-read it. One read, one reload, one answer.
 *
 * The read is local - `listServers` opens no socket - so this costs a message and is safe to ask on
 * mount, whether or not setup ever reaches the Team screen.
 */
const OnboardingServersContext = createContext<ServersState | null>(null);

export function useOnboardingServers(): ServersState {
    const value = useContext(OnboardingServersContext);
    if (!value) {
        throw new Error("useOnboardingServers must be used inside OnboardingServersProvider");
    }
    return value;
}

export function OnboardingServersProvider({ children }: { children: ReactNode }) {
    const servers = useServers();
    return (
        <OnboardingServersContext.Provider value={servers}>
            {children}
        </OnboardingServersContext.Provider>
    );
}
