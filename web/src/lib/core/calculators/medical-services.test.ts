import { medicalServicesCalculator } from "./medical-services.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validMedicalServicesInput } from "../modules/medical-services/fixtures.ts";

testStandardCalculator("medical-services", medicalServicesCalculator, validMedicalServicesInput.data, sampleExecutionCostInput);
