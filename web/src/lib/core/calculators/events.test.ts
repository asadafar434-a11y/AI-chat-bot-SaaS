import { eventsCalculator } from "./events.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validEventsInput } from "../modules/events/fixtures.ts";

testStandardCalculator("events", eventsCalculator, validEventsInput.data, sampleExecutionCostInput);
