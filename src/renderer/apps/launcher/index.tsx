import { renderAppAsync } from "@lib/renderApp";

export async function main() {
    await renderAppAsync(<div>Hello, world!</div>);
}

main();