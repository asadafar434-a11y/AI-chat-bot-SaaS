import { createServiceModule } from "../../common/service-module.ts";
import { eventsRules } from "./rules.ts";

export const eventsModule = createServiceModule({
  key: "events",
  name: "Мероприятия",
  version: "0.1.0",
  serviceKind: "events",
  serviceLabel: "мероприятия",
  template: "events-application",
  extraFields: [
    "venueRequired",
    "venueConfirmed",
    "safetyRequired",
    "safetyConfirmed",
    "staffRequired",
    "staffConfirmed",
  ],
  extraRules: eventsRules,
  extraChecks: [
    {
      id: "check.venue",
      ruleId: "events.venue",
      label: "Проверка площадки",
      failTo: "report",
    },
    {
      id: "check.safety",
      ruleId: "events.safety",
      label: "Проверка плана безопасности",
      failTo: "report",
    },
    {
      id: "check.staff",
      ruleId: "events.staff",
      label: "Проверка персонала и оборудования",
      failTo: "report",
    },
  ],
});
