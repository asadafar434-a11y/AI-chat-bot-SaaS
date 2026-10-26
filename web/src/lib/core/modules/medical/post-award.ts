export type PostAwardProductKind = "device" | "medicine";

export type PostAwardInput = {
  productKind: PostAwardProductKind;
  installationRequired?: boolean;
  verificationRequired?: boolean;
  maintenanceRequired?: boolean;
  warrantyRequired?: boolean;
  coldChainRequired?: boolean;
  markingRequired?: boolean;
};

export type PostAwardItem = {
  id: string;
  title: string;
  reason: string;
};

const baseItems: PostAwardItem[] = [
  { id: "contract", title: "Подписанный контракт", reason: "Основной документ исполнения" },
  { id: "invoice", title: "Счёт или УПД", reason: "Подтверждение поставки и оплаты" },
  { id: "acceptance", title: "Акт приёмки", reason: "Подтверждение передачи товара" },
];

const deviceItems: PostAwardItem[] = [
  { id: "device-passport", title: "Технический паспорт", reason: "Документ медизделия" },
  { id: "device-manual", title: "Руководство по эксплуатации на русском", reason: "Документ медизделия" },
];

const medicineItems: PostAwardItem[] = [
  { id: "medicine-registration", title: "Копия РУ лекарственного препарата", reason: "Документ лекарства" },
  { id: "medicine-shelf-life", title: "Подтверждение остаточного срока годности", reason: "Документ лекарства" },
];

const conditional = (enabled: boolean | undefined, item: PostAwardItem): PostAwardItem[] =>
  enabled ? [item] : [];

export const buildPostAwardChecklist = (input: PostAwardInput): PostAwardItem[] => {
  const items = [...baseItems];

  if (input.productKind === "device") {
    items.push(...deviceItems);
    items.push(
      ...conditional(input.warrantyRequired, {
        id: "device-warranty",
        title: "Гарантийный талон",
        reason: "Требуется гарантия",
      }),
      ...conditional(input.installationRequired, {
        id: "device-installation",
        title: "Акт монтажа и ввода в эксплуатацию",
        reason: "Требуется монтаж",
      }),
      ...conditional(input.verificationRequired, {
        id: "device-verification",
        title: "Свидетельство о поверке или калибровке",
        reason: "Требуется поверка",
      }),
      ...conditional(input.maintenanceRequired, {
        id: "device-maintenance",
        title: "Документы на ТО и лицензия",
        reason: "Требуется техническое обслуживание",
      })
    );
  }

  if (input.productKind === "medicine") {
    items.push(...medicineItems);
    items.push(
      ...conditional(input.coldChainRequired, {
        id: "medicine-cold-chain",
        title: "Подтверждение холодовой цепи",
        reason: "Требуется холодовая цепь",
      }),
      ...conditional(input.markingRequired, {
        id: "medicine-marking",
        title: "Подтверждение маркировки",
        reason: "Требуется маркировка",
      })
    );
  }

  return items;
};
