/**
 * Thrown by GraphExecutor so dispatchers can attach graph/node ids to execution.error.
 */
export class BlueprintGraphExecutionError extends Error {
    public constructor(
        message: string,
        public readonly nodeId: string,
    ) {
        super(message);
        this.name = "BlueprintGraphExecutionError";
    }
}
