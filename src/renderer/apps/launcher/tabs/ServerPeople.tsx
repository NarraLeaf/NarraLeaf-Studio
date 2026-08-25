import { useEffect, useRef, useState } from "react";

import { getInterface } from "@/lib/app/bridge";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { TranslationKey } from "@shared/i18n";
import type { VcsServerMember } from "@shared/types/vcs";
import { SERVER_PROBLEM_KEYS } from "./serverProblemKeys";

/**
 * Who else works on this server.
 *
 * A version has always carried a name and an address, and until now that was the whole of
 * what an author knew about anybody: a string on a revision they either recognised or did
 * not. This is the roster behind those strings, and it answers the two questions a name on
 * a revision raises - who is that, and are they still here.
 *
 * **The address is read with the list and drawn for one member at a time.** Within a
 * server it is not a secret: every account can ask for this list, and the address is on
 * every revision that account ever recorded. But a panel that prints twenty addresses at
 * once is a different artefact from an address beside one version - it is a thing that
 * gets photographed and pasted elsewhere - and there is no moment in reading a list of
 * colleagues when all twenty are wanted. So a row shows a name and a username, and opening
 * one shows that person's address.
 *
 * Drawn only where the server advertised `members`. A deployment that offers no roster has
 * no roster here, and that is not an error to report - it is a fact about the server, and
 * there is nothing an author would do about it.
 *
 * **It fills the region it is given and does its own scrolling.** It used to be a capped box
 * beneath the project list, which put two scrollers in three hundred pixels and charged
 * every reading of the projects for a list nobody had asked to see. It is now one of the
 * views the tab swaps between, and it carries no heading and no border of its own: the tab
 * that brought somebody here is still on screen above it and lit, and the rule under that
 * tab is the only line this screen draws.
 */
export function ServerPeople({ remoteOrigin }: { remoteOrigin: string }) {
    const { t } = useTranslation();
    const [members, setMembers] = useState<VcsServerMember[] | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    /** Whose address is on screen. One at a time: opening a second closes the first. */
    const [opened, setOpened] = useState<string | null>(null);
    // Which read is current. Clicking down a list of servers leaves older reads in flight,
    // and the one that started first must not be the one that lands last.
    const latest = useRef(0);

    useEffect(() => {
        const ticket = latest.current + 1;
        latest.current = ticket;
        setMembers(null);
        setProblem(null);
        setOpened(null);

        void (async () => {
            const result = await getInterface().vcs
                .listServerMembers(remoteOrigin)
                .catch(() => null);
            if (ticket !== latest.current) return;
            if (!result?.success) {
                setProblem("launcher.servers.problem.unknown");
                return;
            }
            if (!result.data.ok) {
                setProblem(SERVER_PROBLEM_KEYS[result.data.problem.kind]);
                return;
            }
            setMembers(result.data.members);
        })();
    }, [remoteOrigin]);

    return (
        <section className="flex min-h-0 flex-1 flex-col" data-server-people={remoteOrigin}>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {members === null && problem === null && (
                    <p className="px-3 py-2 text-xs text-fg-subtle">
                        {t("launcher.servers.people.loading")}
                    </p>
                )}
                {problem !== null && (
                    <p className="px-3 py-2 text-xs text-danger">{t(problem)}</p>
                )}
                {members?.length === 0 && (
                    <p className="px-3 py-2 text-xs text-fg-subtle">
                        {t("launcher.servers.people.none")}
                    </p>
                )}
                {members !== null && peopleFirst(members).map(member => (
                    <MemberRow
                        key={member.username}
                        member={member}
                        opened={opened === member.username}
                        onToggle={() => setOpened(current => (
                            current === member.username ? null : member.username
                        ))}
                    />
                ))}
            </div>
        </section>
    );
}

/**
 * People, then machines, each group in the order the server gave.
 *
 * **Service accounts are listed rather than hidden**, and marked for what they are. They
 * are left in because they are what a reader is looking for on the day a version turns up
 * recorded by "ci" - a name with no face behind it is precisely the name somebody needs to
 * be able to look up, and a roster that quietly omits some accounts is a roster that
 * disagrees with the versions beside it. They go last because they are not colleagues, and
 * a list of eight people should not be read past four build agents to reach the fifth.
 */
export function peopleFirst(members: readonly VcsServerMember[]): VcsServerMember[] {
    return [
        ...members.filter(member => !member.serviceAccount),
        ...members.filter(member => member.serviceAccount),
    ];
}

/**
 * One account: a name, the name it answers to, and what is true of it.
 *
 * The marks are words, not badges. An operator and a disabled account are worth knowing
 * about on the day they matter and are noise on every other day, so they read at the size
 * everything secondary on this screen reads at, in the colour everything secondary reads
 * in. A coloured pill would make "Ada administers this server" the loudest thing in a list
 * whose subject is who works here.
 */
function MemberRow({
    member,
    opened,
    onToggle,
}: {
    member: VcsServerMember;
    opened: boolean;
    onToggle: () => void;
}) {
    const { t } = useTranslation();
    const marks = [
        member.operator ? t("launcher.servers.people.operator") : null,
        member.serviceAccount ? t("launcher.servers.people.serviceAccount") : null,
        member.disabled ? t("launcher.servers.people.disabled") : null,
    ].filter((mark): mark is string => mark !== null);

    return (
        <button
            type="button"
            aria-expanded={opened}
            onClick={onToggle}
            data-server-member={member.username}
            className={cn(
                "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left",
                "cursor-default transition-colors duration-150 hover:bg-fill",
            )}
        >
            <span
                aria-hidden
                className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    "text-2xs font-medium text-white",
                    // An account the server has stopped accepting is still on the list and
                    // still worth recognising; it is just not somebody to write to.
                    member.disabled && "opacity-40 saturate-50",
                )}
                style={{ backgroundColor: nameMonogramColor(member.displayName) }}
            >
                {nameInitials(member.displayName)}
            </span>
            <span className="min-w-0 flex-1">
                <span className={cn(
                    "block truncate text-sm",
                    member.disabled ? "text-fg-muted" : "text-fg",
                )}>
                    {member.displayName}
                </span>
                {/* The username is not the display name repeated: it is what a revision is
                    written with, so a name on a version can be matched to a person here. */}
                {member.username !== member.displayName && (
                    <span className="block truncate text-2xs text-fg-subtle">{member.username}</span>
                )}
                {opened && (
                    <span
                        className="mt-1 block truncate text-2xs text-fg-muted"
                        data-member-address={member.username}
                    >
                        {member.email.trim() === ""
                            ? t("launcher.servers.people.noAddress")
                            : member.email}
                    </span>
                )}
            </span>
            {marks.length > 0 && (
                <span className="flex shrink-0 flex-wrap justify-end gap-2 text-2xs text-fg-subtle">
                    {marks.map(mark => <span key={mark}>{mark}</span>)}
                </span>
            )}
        </button>
    );
}
