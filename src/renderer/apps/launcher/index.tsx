import { renderAppAsync } from "@lib/renderApp";

export async function main() {
    await renderAppAsync(<div className="text-red-500">Hello, world!</div>);
}

main();