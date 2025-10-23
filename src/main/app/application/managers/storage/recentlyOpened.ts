import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { GlobalState, GlobalStateKeys } from "@shared/types/state/globalState";

export class RecentlyOpened {
    private readonly key = "app.recentProjects" satisfies GlobalStateKeys;

    constructor(private readonly state: GlobalState) {
    }

    public addProject({ name, path, icon }: RecentlyOpenedProject): void {
        const items = this.state.getItem(this.key);
        const updated = [
            { path, name, icon, openedAt: Date.now() },
            ...items.filter(i => i.path !== path),
        ].slice(0, 10);
        this.state.setItem(this.key, updated);
    }

    public list(): RecentlyOpenedProject[] {
        return this.state.getItem(this.key);
    }
}
