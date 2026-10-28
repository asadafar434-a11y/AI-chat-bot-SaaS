import { securityCleaningCateringCalculator } from "./security-cleaning-catering.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validSecurityCleaningCateringInput } from "../modules/security-cleaning-catering/fixtures.ts";

testStandardCalculator(
  "security-cleaning-catering",
  securityCleaningCateringCalculator,
  validSecurityCleaningCateringInput.data,
  sampleExecutionCostInput,
);
