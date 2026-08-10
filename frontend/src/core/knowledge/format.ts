/**
 * Shared timestamp rendering for knowledge panels (document table, wiki
 * entries). Locale follows the active i18n locale; unparsable values render
 * verbatim.
 */
export function formatKnowledgeTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
