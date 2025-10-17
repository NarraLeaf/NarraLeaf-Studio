import { BaseApp } from "../baseApp";
import { Manager } from "./manager";

export class WindowManager extends Manager {
    constructor(app: BaseApp) {
        super(app);
    }

    async initialize(): Promise<void> {
        
    }
}
