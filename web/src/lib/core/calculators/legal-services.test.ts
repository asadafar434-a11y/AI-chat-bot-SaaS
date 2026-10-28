import { legalServicesCalculator } from "./legal-services.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validLegalServicesInput } from "../modules/legal-services/fixtures.ts";

testStandardCalculator("legal-services", legalServicesCalculator, validLegalServicesInput.data, sampleExecutionCostInput);
