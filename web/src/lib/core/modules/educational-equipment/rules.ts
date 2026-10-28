import { requiredDocumentRule } from "../../common/document-rule.ts";
import type { Rule } from "../../flow/types.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";

export const educationalEquipmentRules: Rule[] = [
  requiredDocumentRule({
    id: "educational-equipment.conformity",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Учебное оборудование имеет подтверждение соответствия",
    requiredDocument: "Сертификат или декларация соответствия",
    validationLogic: "conformityRequired === true → conformityDocument подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "conformityRequired",
    evidenceField: "conformityDocument",
    notRequiredDetail: "Подтверждение соответствия не требуется",
    missingRequiredDetail: "Не определено, требуется ли подтверждение соответствия",
    missingEvidenceDetail: "Нет подтверждения сертификата или декларации",
    notConfirmedDetail: "Сертификат или декларация соответствия не подтверждены",
    confirmedDetail: "Подтверждение соответствия есть",
  }),
  requiredDocumentRule({
    id: "educational-equipment.sanitary",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Учебное оборудование имеет санитарно-эпидемиологическое заключение",
    requiredDocument: "Санитарно-эпидемиологическое заключение",
    validationLogic: "sanitaryRequired === true → sanitaryConclusion подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "sanitaryRequired",
    evidenceField: "sanitaryConclusion",
    notRequiredDetail: "Санитарно-эпидемиологическое заключение не требуется",
    missingRequiredDetail: "Не определено, требуется ли санитарно-эпидемиологическое заключение",
    missingEvidenceDetail: "Нет подтверждения санитарно-эпидемиологического заключения",
    notConfirmedDetail: "Санитарно-эпидемиологическое заключение не подтверждено",
    confirmedDetail: "Санитарно-эпидемиологическое заключение подтверждено",
  }),
];
