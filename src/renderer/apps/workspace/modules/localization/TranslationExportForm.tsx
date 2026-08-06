/**
 * The two questions an export asks: which format the translator wants, and how
 * much of the table to send.
 *
 * Both are selects and nothing else. The format rows name the tool that opens
 * them - a translator asks for "a Poedit file", never for "gettext PO" - and the
 * scope rows carry their own counts, the same way the translation table's own
 * filter does.
 *
 * The form owns its selection and reports it upward: the dialog's footer buttons
 * are snapshotted when the dialog opens and cannot read React state.
 *
 * Both selects take the default `md` height, which is the dialog tier (see
 * docs/design-system.md §3). They asked for `sm` and came out 28px against the
 * dialog's own 36px footer buttons - a two-field form reading as an afterthought
 * inside its own dialog.
 *
 * Comments in English per project convention.
 */

import { useCallback, useState } from "react";
import { FieldLabel, Select, type SelectOption } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { TRANSLATION_EXCHANGE_FORMATS, type TranslationExchangeFormat } from "@shared/utils/localizationExchange";
import type { TranslationExportScope } from "@/lib/workspace/services/localization/localizationModel";

/** Typed as keys rather than strings on purpose: a key that does not exist fails to compile. */
const FORMAT_LABELS: Record<TranslationExchangeFormat, { label: TranslationKey; hint: TranslationKey }> = {
    csv: { label: "workspace.localization.exchange.formatCsv", hint: "workspace.localization.exchange.formatCsvHint" },
    xliff: { label: "workspace.localization.exchange.formatXliff", hint: "workspace.localization.exchange.formatXliffHint" },
    po: { label: "workspace.localization.exchange.formatPo", hint: "workspace.localization.exchange.formatPoHint" },
    json: { label: "workspace.localization.exchange.formatJson", hint: "workspace.localization.exchange.formatJsonHint" },
} as const;

export type TranslationExportFormProps = {
    totalCount: number;
    pendingCount: number;
    initialFormat: TranslationExchangeFormat;
    initialScope: TranslationExportScope;
    onChange: (format: TranslationExchangeFormat, scope: TranslationExportScope) => void;
};

export function TranslationExportForm({
    totalCount,
    pendingCount,
    initialFormat,
    initialScope,
    onChange,
}: TranslationExportFormProps) {
    const { t } = useTranslation();
    const [format, setFormat] = useState<TranslationExchangeFormat>(initialFormat);
    const [scope, setScope] = useState<TranslationExportScope>(initialScope);

    const changeFormat = useCallback((next: TranslationExchangeFormat) => {
        setFormat(next);
        onChange(next, scope);
    }, [onChange, scope]);

    const changeScope = useCallback((next: TranslationExportScope) => {
        setScope(next);
        onChange(format, next);
    }, [onChange, format]);

    const formatOptions: SelectOption[] = TRANSLATION_EXCHANGE_FORMATS.map(id => ({
        value: id,
        label: t(FORMAT_LABELS[id].label),
        secondaryLabel: t(FORMAT_LABELS[id].hint),
    }));

    const scopeOptions: SelectOption[] = [
        { value: "all", label: `${t("workspace.localization.exchange.scopeAll")} (${totalCount})` },
        { value: "pending", label: `${t("workspace.localization.exchange.scopePending")} (${pendingCount})` },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div>
                <FieldLabel as="div">{t("workspace.localization.exchange.formatLabel")}</FieldLabel>
                <Select
                    options={formatOptions}
                    value={format}
                    onChange={value => changeFormat(value as TranslationExchangeFormat)}
                    ariaLabel={t("workspace.localization.exchange.formatLabel")}
                    fullWidth
                    portalMenu
                />
            </div>
            <div>
                <FieldLabel as="div">{t("workspace.localization.exchange.scopeLabel")}</FieldLabel>
                <Select
                    options={scopeOptions}
                    value={scope}
                    onChange={value => changeScope(value as TranslationExportScope)}
                    ariaLabel={t("workspace.localization.exchange.scopeLabel")}
                    fullWidth
                    portalMenu
                />
            </div>
        </div>
    );
}
