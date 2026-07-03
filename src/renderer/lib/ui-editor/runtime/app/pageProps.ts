import type { PageProps } from "./types";

export function clonePageProps(props: PageProps | undefined): PageProps {
    if (!props) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(props)) as PageProps;
    } catch {
        return {};
    }
}
