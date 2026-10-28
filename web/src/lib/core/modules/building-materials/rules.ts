import { requiredDocumentRule } from "../../common/document-rule.ts";
import type { Rule } from "../../flow/types.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";

export const buildingMaterialsRules: Rule[] = [
  requiredDocumentRule({
    id: "building-materials.conformity",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Стройматериалы имеют подтверждение соответствия",
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
    id: "building-materials.batch",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Партия стройматериалов имеет паспорт качества",
    requiredDocument: "Паспорт качества партии",
    validationLogic: "batchPassportRequired === true → batchPassport подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "batchPassportRequired",
    evidenceField: "batchPassport",
    notRequiredDetail: "Паспорт партии не требуется",
    missingRequiredDetail: "Не определено, требуется ли паспорт партии",
    missingEvidenceDetail: "Нет подтверждения паспорта партии",
    notConfirmedDetail: "Паспорт качества партии не подтверждён",
    confirmedDetail: "Паспорт качества партии подтверждён",
  }),
];
