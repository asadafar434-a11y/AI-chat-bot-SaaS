import { stationeryCalculator } from "./stationery.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validStationeryInput } from "../modules/stationery/fixtures.ts";

testStandardCalculator("stationery", stationeryCalculator, validStationeryInput.data, sampleLogisticsInput);
