import { energyCalculator } from "./energy.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validEnergyInput } from "../modules/energy/fixtures.ts";

testStandardCalculator("energy", energyCalculator, validEnergyInput.data, sampleExecutionCostInput);
