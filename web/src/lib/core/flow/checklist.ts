import type { FlowResult, RiskLevel } from "./types.ts";

export type ChecklistStatus = "confirmed" | "required";

export type ChecklistItem = {
  document: string;
  status: ChecklistStatus;
  riskLevel: RiskLevel;
  ruleIds: string[];
  source: string | null;
};

const RISK_ORDER: Record<RiskLevel, number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const isHigherRisk = (left: RiskLevel, right: RiskLevel): boolean => RISK_ORDER[left] > RISK_ORDER[right];

const sortChecklist = (items: ChecklistItem[]): ChecklistItem[] =>
  [...items].sort((left, right) => {
    if (left.status !== right.status) return left.status === "required" ? -1 : 1;
    if (left.riskLevel !== right.riskLevel) return RISK_ORDER[right.riskLevel] - RISK_ORDER[left.riskLevel];
    return left.document.localeCompare(right.document, "ru");
  });

export const buildDocumentChecklist = (result: FlowResult): ChecklistItem[] => {
  const items = new Map<string, ChecklistItem>();

  for (const finding of result.findings) {
    if (!finding.requiredDocument) continue;
    const status: ChecklistStatus = finding.status === "passed" ? "confirmed" : "required";
    const riskLevel = finding.riskLevel ?? "low";
    const existing = items.get(finding.requiredDocument);
    if (!existing) {
      items.set(finding.requiredDocument, {
        document: finding.requiredDocument,
        status,
        riskLevel,
        ruleIds: finding.ruleId ? [finding.ruleId] : [],
        source: finding.source,
      });
      continue;
    }
    if (status === "required") existing.status = "required";
    if (isHigherRisk(riskLevel, existing.riskLevel)) existing.riskLevel = riskLevel;
    if (finding.ruleId && !existing.ruleIds.includes(finding.ruleId)) existing.ruleIds.push(finding.ruleId);
    if (!existing.source && finding.source) existing.source = finding.source;
  }

  return sortChecklist([...items.values()]);
};
