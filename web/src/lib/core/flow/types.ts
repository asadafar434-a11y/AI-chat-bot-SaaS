export type RiskLevel = "blocker" | "high" | "medium" | "low";

export type Outcome =
  | "participate"
  | "do_not_participate"
  | "prepare_application"
  | "report"
  | "needs_input"
  | "unknown";

export type AnswerKind = "boolean" | "text" | "number" | "choice";

export type RuleStatus = "seed" | "legal_reviewed";

export type RuleRef = {
  id: string;
  law: string;
  article: string;
  condition: string;
  requiredDocument: string | null;
  validationLogic: string;
  riskLevel: RiskLevel;
  effectiveFrom: string;
  source: string;
  status: RuleStatus;
};

export type RuleEvaluation = {
  passed: boolean;
  detail: string;
  missing: string[];
};

export type Rule = RuleRef & {
  evaluate: (context: FlowContext) => RuleEvaluation;
};

export type ExtractNode = {
  id: string;
  type: "extract";
  fields: string[];
  source: "required" | "optional";
  label: string;
};

export type QuestionNode = {
  id: string;
  type: "question";
  question: string;
  answer: AnswerKind;
  field: string;
  label: string;
};

export type CheckNode = {
  id: string;
  type: "check";
  ruleId: string;
  label: string;
};

export type CalcResult = {
  outputs: Record<string, unknown>;
  missing?: string[];
  detail?: string;
};

export type CalcNode = {
  id: string;
  type: "calc";
  label: string;
  compute: (context: FlowContext) => CalcResult;
};

export type ScoreResult = {
  outputs: Record<string, unknown>;
  detail?: string;
};

export type ScoreNode = {
  id: string;
  type: "score";
  label: string;
  compute: (context: FlowContext) => ScoreResult;
};

export type DecisionNode = {
  id: string;
  type: "decision";
  outcome: Extract<Outcome, "participate" | "do_not_participate" | "unknown">;
  label: string;
};

export type GenerateNode = {
  id: string;
  type: "generate";
  label: string;
  template: string;
};

export type ReportNode = {
  id: string;
  type: "report";
  label: string;
  reason: string;
};

export type FlowNode =
  | ExtractNode
  | QuestionNode
  | CheckNode
  | CalcNode
  | ScoreNode
  | DecisionNode
  | GenerateNode
  | ReportNode;

export type EdgeCondition = "always" | "yes" | "no" | "value";

export type FlowEdge = {
  from: string;
  to: string;
  on: EdgeCondition;
  value?: string;
};

export type FlowModule = {
  key: string;
  name: string;
  version: string;
  start: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  rules: Rule[];
};

export type EvidenceValue = {
  value: unknown;
  source: string;
  quote?: string;
};

export type FlowInput = {
  data: Record<string, unknown>;
  answers?: Record<string, unknown>;
  evidence?: Record<string, EvidenceValue>;
};

export type MissingInput = {
  nodeId: string;
  field: string;
  label: string;
  kind: AnswerKind | "extract";
};

export type FindingStatus = "passed" | "failed" | "unknown";

export type Finding = {
  nodeId: string;
  ruleId: string | null;
  status: FindingStatus;
  riskLevel: RiskLevel | null;
  message: string;
  law: string | null;
  article: string | null;
  requiredDocument: string | null;
  effectiveFrom: string | null;
  source: string | null;
  ruleStatus: RuleStatus | null;
};

export type TraceStatus = "ok" | "failed" | "missing" | "needs_input" | "stopped";

export type TraceStep = {
  nodeId: string;
  type: FlowNode["type"];
  status: TraceStatus;
  detail: string;
};

export type FlowResult = {
  moduleKey: string;
  moduleVersion: string;
  outcome: Outcome;
  trace: TraceStep[];
  findings: Finding[];
  missing: MissingInput[];
  outputs: Record<string, unknown>;
  visited: string[];
};

export type FlowContext = {
  input: FlowInput;
  answers: Record<string, unknown>;
  outputs: Record<string, unknown>;
  findings: Finding[];
  missing: MissingInput[];
};
