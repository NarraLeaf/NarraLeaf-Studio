import { BaseApp } from "../baseApp";

export abstract class Manager<Dependencies extends Manager<any>[] = []> {
    protected app: BaseApp;
    constructor(app: BaseApp) {
        this.app = app;
    }

    abstract initialize(deps: Dependencies): Promise<void>;
}
