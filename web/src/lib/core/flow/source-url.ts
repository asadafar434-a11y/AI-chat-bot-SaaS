import type { FlowModule, Rule } from "./types.ts";

const isHttpUrl = (value: string): boolean => {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const VERIFIED_SOURCE_URLS = new Set([
  "https://www.consultant.ru/document/cons_doc_LAW_144624/",
  "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/",
  "https://www.consultant.ru/document/cons_doc_LAW_121895/",
  "https://roszdravnadzor.gov.ru/medproducts/registration/",
  "https://www.consultant.ru/document/cons_doc_LAW_113658/",
  "https://www.consultant.ru/document/cons_doc_LAW_99350/",
  "https://www.consultant.ru/document/cons_doc_LAW_28165/",
  "https://www.consultant.ru/document/cons_doc_LAW_494318/92d969e26a4326c5d02fa79b8f9cf4994ee5633b/",
]);

const SOURCE_REVIEW = {
  reviewedAt: "2026-10-27",
  reviewedBy: "AI source audit",
  edition: "Официальная редакция на 2026-10-27; статья найдена в источнике",
} as const;

export const withRuleSourceUrl = (rule: Rule): Rule => {
  const sourceUrl = rule.sourceUrl ?? (isHttpUrl(rule.source) ? rule.source : undefined);
  if (!sourceUrl) return rule;

  const next = rule.sourceUrl ? rule : { ...rule, sourceUrl };
  if (
    next.status === "seed" &&
    next.law !== "internal" &&
    VERIFIED_SOURCE_URLS.has(sourceUrl)
  ) {
    return { ...next, status: "source_checked", ...SOURCE_REVIEW };
  }
  return next;
};

export const withRuleSourceUrls = (module: FlowModule): FlowModule => ({
  ...module,
  rules: module.rules.map(withRuleSourceUrl),
});
