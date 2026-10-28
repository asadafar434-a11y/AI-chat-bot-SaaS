export type CalculatorFieldKind = "number" | "string" | "boolean" | "date";

export type CalculatorFieldSchema = {
  key: string;
  label: string;
  kind: CalculatorFieldKind;
  required: boolean;
  unit?: string;
  /** Часть расчёта, которой принадлежит поле (ставится combineCalculators) — для подзаголовков в форме ввода. */
  section?: string;
};

/** Flat bag of named values a calculator reads from; same shape as FlowInput.data. */
export type CalculatorInput = Record<string, unknown>;

export type CalculatorValue = {
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit?: string;
};

export type CalculatorResult = {
  values: CalculatorValue[];
  explanation: string;
  usedInputs: string[];
  ruleIds: string[];
  sourceUrls: string[];
  needsInput: CalculatorFieldSchema[];
  warnings: string[];
};

export type CalculatorDescriptor = {
  sphereKey: string;
  subSphereKey: string;
  title: string;
  description: string;
  inputSchema: CalculatorFieldSchema[];
  outputSchema: CalculatorFieldSchema[];
  ruleIds: string[];
  sourceUrls: string[];
  calculate: (input: CalculatorInput) => CalculatorResult;
};
