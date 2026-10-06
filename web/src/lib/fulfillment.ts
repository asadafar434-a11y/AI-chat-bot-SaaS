import type { ApplicationField } from "@/lib/fields";
import { isElectronic, lawOfKind, type Law } from "@/lib/law-kind";
import type { Profile } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import type { ReqItem } from "@/lib/requirements";
import { PLAIN_FORM } from "@/lib/tp";
import { partsOf, type TpPart } from "@/lib/tp-parts";

// План выполнения требований — ядро «заявки под ключ» (решение владельца 30.09.2026). Заявку не собирают по шаблону:
// у каждого пункта «Что подать» свой способ выполнения, и он зависит от закона, вида закупки и участника:
//   compose      — составит приложение: ТП, анкету, декларацию, цену, сведения об опыте; человек проверяет;
//   upload       — приложить файл: сертификат, лицензию, выписку, устав;
//   confirm      — подтвердить: декларацию, обеспечение, документы в реестре площадки, страну происхождения;
//   platform     — передаст площадка: сведения об участнике по 44-ФЗ — прикладывать не нужно;
//   not_required — не требуется: например, устав от ИП.
// Правила — по текстам законов в src/data/laws: 44-ФЗ (ред. от 04.08.2026) — ст. 43, 223-ФЗ (ред. от 08.08.2024) —
// ст. 3.4 для закупок только у МСП. Разбор документов выписывает пункт словами заказчика; правило узнаёт его по тексту.
// Не узнали — просим приложить, как требует заказчик: лишний раз приложить безопаснее, чем не приложить.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

export type FulfillMode = "compose" | "upload" | "confirm" | "platform" | "not_required";
// Четыре статуса пункта: готово, подтвердить или проверить, сделать (приложить, вписать), не требуется.
export type PlanStatus = "done" | "confirm" | "todo" | "none";
// ul — организация (ИНН из 10 цифр), ip — ИП или физическое лицо (ИНН из 12 цифр).
export type Participant = "ul" | "ip";

export type PlanContext = {
  law: Law | null;
  electronic: boolean;
  // 223-ФЗ: закупка только для субъектов МСП — закрытый перечень того, что можно требовать (ч. 19.1 ст. 3.4).
  sme: boolean;
  participant: Participant | null;
  // Заявку подписывает руководитель, а не представитель по доверенности.
  headSigns: boolean;
  // Есть ли баллы за квалификацию: тогда опыт и специалисты — для оценки, а не для допуска.
  points: boolean;
  // Какие документы составляет приложение для этой закупки (lib/tp-parts.ts).
  parts: TpPart[];
};

export type RulePlan = {
  mode: FulfillMode;
  // Нужно ли это для этой заявки. Для баллов и «по желанию» — нет.
  mandatory: boolean;
  // Без этого, если оно нужно, заявку отклонят или площадка её вернёт.
  blocks: boolean;
  // Основание: «пп. «а» п. 2 ч. 1 ст. 43 44-ФЗ» или документация закупки.
  basis: string;
  // Что сделать — одной фразой для человека.
  todo: string;
  // Заказчик просит то, что закон требовать не разрешает (ч. 3 ст. 43 44-ФЗ, ч. 19.3 ст. 3.4 223-ФЗ).
  extra?: boolean;
  // Какой документ составляет приложение.
  part?: TpPart;
};

export type RuleId =
  | "platform"
  | "consortium"
  | "fns"
  | "extract"
  | "charter"
  | "authority"
  | "conformity"
  | "sme"
  | "declaration"
  | "license"
  | "additional"
  | "security"
  | "bank"
  | "bigdeal"
  | "points"
  | "proposal"
  | "origin"
  | "price"
  | "images"
  | "participant";

export type FulfillmentPlan = RulePlan & { item: ReqItem; rule: RuleId | null; title: string; status: PlanStatus };

const plan = (mode: FulfillMode, basis: string, todo: string, over: Partial<RulePlan> = {}): RulePlan => {
  const needed = mode !== "platform" && mode !== "not_required";
  return { mode, basis, todo, mandatory: needed, blocks: needed, ...over };
};

const law44 = (ref: string) => `${ref} 44-ФЗ`;
const sme223 = (ref: string) => `${ref} ст. 3.4 223-ФЗ`;
// Состав заявки по 223-ФЗ задаёт заказчик в документации (п. 2 ч. 10 ст. 4 223-ФЗ).
const docs = (ctx: PlanContext) => (ctx.law === "223" ? "документация закупки (п. 2 ч. 10 ст. 4 223-ФЗ)" : "документы закупки");
// Основание по закону: 44-ФЗ, 223-ФЗ для МСП или документация.
const basisOf = (ctx: PlanContext, ref44: string, refSme: string) =>
  ctx.law === "44" ? law44(ref44) : ctx.law === "223" && ctx.sme ? sme223(refSme) : docs(ctx);
const strictLaw = (ctx: PlanContext) => ctx.law === "44" || (ctx.law === "223" && ctx.sme);

const EXTRA_TODO = "закон требовать это не разрешает. Надёжнее приложить, требование можно обжаловать";

type Rule = { id: RuleId; title: string; match: RegExp; plan: (ctx: PlanContext, text: string) => RulePlan };

// Пункт сам говорит, что его формирует или передаёт площадка, — так написано у заказчика.
const BY_PLATFORM =
  /(формир[а-яё]*|переда[её]т[а-яё]*|направля[её]т[а-яё]*|предоставля[её]т[а-яё]*|да[её]тся)\s+([а-яё]+\s+){0,3}?(оператор[а-яё]*\s+)?(электронн[а-яё]*\s+)?(площадк|ЭТП(?![а-яё])|ЭП(?![а-яё]))|площадк[а-яё]*\s+(сам[а-яё]*\s+)?(формир|переда|направ)|(программно-аппаратн[а-яё]*\s+средств|функционал)[а-яё]*\s+(электронн[а-яё]*\s+)?(площадк|ЭТП(?![а-яё])|ЭП(?![а-яё]))/i;

// Заказчик сам пишет, что без этого заявку не отклонят: документы для оценки, предложение по критериям.
const NOT_GROUNDS = /не\s+является\s+(причиной|основанием)\s+(для\s+)?(отклонени|признани)/i;

// Правила — от частных к общим: первое подходящее решает.
const RULES: Rule[] = [
  {
    id: "consortium",
    title: "Документы консорциума",
    match: /консорциум|коллективн[а-яё]*\s+участник|(выступа|на\s+стороне)[^.;]{0,30}несколько\s+лиц/i,
    plan: (ctx) => plan("not_required", docs(ctx), "Нужно, только если подаёте заявку вместе с другими — консорциумом"),
  },
  {
    id: "fns",
    title: "Выписка из сервиса оценки ФНС",
    match: /сервис[а-яё]*\s+оценки/i,
    plan: (ctx) =>
      ctx.sme
        ? plan("not_required", sme223("ч. 19.1 и 19.3"), "В закупке только для МСП не нужна")
        : plan("upload", docs(ctx), "Сформируйте выписку в сервисе ФНС — не раньше срока, который указал заказчик"),
  },
  {
    id: "extract",
    title: "Выписка из ЕГРЮЛ или ЕГРИП",
    match: /ЕГРЮЛ|ЕГРИП|выписк[а-яё]*\s+из\s+единого\s+государственного\s+реестра/i,
    plan: (ctx) =>
      ctx.law === "44" && ctx.electronic
        ? plan("platform", law44("пп. «ж» п. 1 ч. 1, п. 2 ч. 6 ст. 43"), "Передаст площадка из ЕИС — прикладывать не нужно")
        : ctx.law === "223" && ctx.sme
          ? plan("upload", sme223("ч. 19.1 и 19.3"), `Приложите выписку: ${EXTRA_TODO}`, { extra: true })
          : plan("upload", docs(ctx), "Приложите выписку"),
  },
  {
    id: "charter",
    title: "Устав",
    match: /устав|учредительн[а-яё]*\s+документ/i,
    plan: (ctx) =>
      ctx.participant === "ip"
        ? plan("not_required", "у ИП нет учредительных документов", "У ИП устава нет — прикладывать нечего")
        : ctx.law === "44"
          ? plan("upload", law44("ч. 3 ст. 43"), `Приложите устав: ${EXTRA_TODO}`, { extra: true })
          : plan("upload", ctx.law === "223" && ctx.sme ? sme223("п. 1 ч. 19.1") : docs(ctx), "Приложите устав"),
  },
  {
    id: "authority",
    title: "Документ о полномочиях",
    match: /доверенност|полномочи|(приказ|решени|протокол)[а-яё]*\s+(о\s+|об\s+)?(назначени|избрани)/i,
    plan: (ctx) =>
      ctx.law === "44"
        ? plan("upload", law44("ч. 3 ст. 43"), `Приложите документ о полномочиях: ${EXTRA_TODO}`, { extra: true })
        : ctx.law === "223" && ctx.sme && (ctx.headSigns || ctx.participant === "ip")
          ? plan("not_required", sme223("п. 5 ч. 19.1"), "Подписывает руководитель или сам ИП — документ о полномочиях не нужен")
          : plan(
              "upload",
              ctx.law === "223" && ctx.sme ? sme223("п. 5 ч. 19.1") : docs(ctx),
              "Приложите документ о полномочиях подписанта: доверенность или решение о назначении руководителя"
            ),
  },
  {
    id: "conformity",
    title: "Документы о соответствии товара",
    match:
      /сертификат|регистрационн[а-яё]*\s+удостоверени|санитарно-эпидемиологическ|декларац[а-яё]*\s+о\s+соответстви[а-яё]*[^.;]{0,60}(товар|продукци|регламент|ЕАЭС|ТР\s*ТС|ГОСТ)/i,
    plan: (ctx) =>
      plan(
        "upload",
        basisOf(ctx, "пп. «в» п. 2 ч. 1 ст. 43", "п. 11 ч. 19.1"),
        strictLaw(ctx)
          ? "Приложите. Если по закону документ передают вместе с товаром, требовать его в заявке нельзя"
          : "Приложите копию документа"
      ),
  },
  {
    id: "sme",
    title: "Декларация о принадлежности к МСП",
    match: /принадлежност[а-яё]*\s+к\s+субъект|субъект[а-яё]*\s+мал[а-яё]*\s+(и\s+средн[а-яё]*\s+)?предпринимательств|(?<![а-яё])(МСП|СМП|СМСП)(?![а-яё])/i,
    plan: (ctx) =>
      ctx.parts.includes("declaration")
        ? plan("compose", docs(ctx), "Составлю декларацию по «Реквизитам» — проверьте категорию МСП", { part: "declaration" })
        : ctx.law === "44"
          ? plan(
              "platform",
              law44("пп. «к» п. 5 ч. 6 ст. 43"),
              "Отдельной декларации закон не требует: заявку участника не из СМП и СОНКО площадка вернёт сама"
            )
          : plan("upload", docs(ctx), "Приложите декларацию о принадлежности к МСП"),
  },
  {
    id: "declaration",
    title: "Декларация о соответствии требованиям к участникам",
    match:
      /декларац[а-яё]*\s+о\s+соответстви|декларац[а-яё]*[^.;]{0,30}соответстви[а-яё]*\s+(участник|требовани)|единым\s+требовани|требовани[а-яё]*[^.;]{0,40}ст(\.|ать[а-яё]*)\s*31/i,
    plan: (ctx) =>
      plan(
        "confirm",
        basisOf(ctx, "пп. «о» п. 1 ч. 1 ст. 43", "п. 9 ч. 19.1"),
        "Декларацию о соответствии требованиям к участникам включите в заявку — подтвердите, что требования выполняете"
      ),
  },
  {
    id: "license",
    title: "Лицензия или членство в СРО",
    match:
      /лиценз|(?<![а-яё])СРО(?![а-яё])|саморегулируем|реестр[а-яё]*\s+член|обязательн[а-яё]*\s+требовани[а-яё]*\s+к\s+лицам|требовани[а-яё]*\s+законодательств[а-яё]*[^.;]{0,60}к\s+лицам/i,
    plan: (ctx, text) => {
      const basis = basisOf(ctx, "пп. «н», «о» п. 1 ч. 1 ст. 43", "п. 6 и пп. «е» п. 9 ч. 19.1");
      // Заказчик пишет общими словами — лицензия нужна, только если её требует закон для этих работ или услуг.
      if (!/лиценз|(?<![а-яё])СРО(?![а-яё])|саморегулируем|реестр[а-яё]*\s+член/i.test(text)) {
        return plan("confirm", basis, "Нужно, только если для этих работ или услуг закон требует лицензию или членство в СРО", {
          mandatory: false,
        });
      }
      return strictLaw(ctx)
        ? plan(
            "upload",
            basis,
            "Приложите копию. Можно не прикладывать, если сведения есть в открытом госреестре, — тогда укажите ссылку на него в декларации"
          )
        : plan("upload", basis, "Приложите копию лицензии или выписку из реестра членов СРО");
    },
  },
  {
    id: "additional",
    title: "Документы по дополнительным требованиям",
    match: /дополнительн[а-яё]*\s+требовани|2571|ч(асть[а-яё]*|\.)\s*2(\.1)?\s+ст(\.|ать[а-яё]*)\s*31/i,
    plan: (ctx) =>
      ctx.law === "44" && ctx.electronic
        ? plan(
            "confirm",
            law44("п. 3 ч. 6, пп. «и» п. 5 ч. 6 ст. 43"),
            "В заявку не прикладывают — площадка передаст из реестра участников. Проверьте, что документы загружены в реестр на площадке: иначе заявку вернут"
          )
        : plan("upload", docs(ctx), "Приложите, если в извещении есть дополнительные требования к участникам", { mandatory: false }),
  },
  {
    id: "security",
    title: "Обеспечение заявки",
    match: /обеспечени[а-яё]*\s+заяв|независим[а-яё]*\s+гаранти|банковск[а-яё]*\s+гаранти|специальн[а-яё]*\s+(банковск[а-яё]*\s+)?сч[её]т/i,
    plan: (ctx) =>
      ctx.law === "44"
        ? plan(
            "confirm",
            law44("пп. «е», «ж» п. 5 ч. 6 ст. 43"),
            "Проверьте до подачи: деньги на спецсчёте или независимая гарантия в реестре ЕИС на нужную сумму — иначе площадка вернёт заявку"
          )
        : ctx.law === "223" && ctx.sme
          ? plan("confirm", sme223("п. 8 ч. 19.1"), "Реквизиты спецсчёта или независимая гарантия — проверьте сумму до подачи")
          : plan("upload", docs(ctx), "Приложите документ об обеспечении заявки"),
  },
  {
    id: "bank",
    title: "Реквизиты счёта",
    match: /реквизит[а-яё]*\s+(расч[её]тн[а-яё]*\s+|банковск[а-яё]*\s+)?сч[её]т|банковск[а-яё]*\s+реквизит|расч[её]тн[а-яё]*\s+сч[её]т/i,
    plan: (ctx) =>
      ctx.parts.includes("participant")
        ? plan("compose", docs(ctx), "Попадут в анкету из «Реквизитов» — проверьте", { part: "participant" })
        : plan(
            "confirm",
            ctx.law === "44" ? law44("пп. «п» п. 1 ч. 1 ст. 43") : docs(ctx),
            ctx.law === "44"
              ? "Укажите реквизиты счёта в заявке — они есть в «Реквизитах». Не нужны, если счёт откроют после заключения контракта"
              : "Укажите реквизиты счёта в заявке — они есть в «Реквизитах»"
          ),
  },
  {
    id: "bigdeal",
    title: "Решение об одобрении крупной сделки",
    match: /крупн[а-яё]*\s+сделк/i,
    plan: (ctx) =>
      ctx.participant === "ip"
        ? plan("not_required", "крупные сделки одобряют только организации", "Для ИП не нужно")
        : plan(
            "confirm",
            basisOf(ctx, "пп. «м» п. 1 ч. 1 ст. 43", "п. 7 ч. 19.1"),
            "Нужно, только если контракт или обеспечение — крупная сделка для вашей компании. Тогда приложите решение об одобрении",
            { mandatory: false }
          ),
  },
  {
    id: "points",
    title: "Для оценки: опыт, специалисты, квалификация",
    match: /опыт|квалификаци|специалист|трудов[а-яё]*\s+ресурс|деловой\s+репутаци|по\s+критери|для\s+оценки|балл/i,
    plan: (ctx, text) => {
      const part: TpPart | null = /опыт/i.test(text) ? "experience" : /специалист|трудов|кадр|персонал|работник/i.test(text) ? "staff" : null;
      // За баллы: по 44-ФЗ и в закупках для МСП по 223-ФЗ без этого не отклоняют.
      const optional = strictLaw(ctx) ? { mandatory: false, blocks: false } : {};
      const basis = basisOf(ctx, "пп. «р» п. 1 и пп. «г» п. 2 ч. 1 ст. 43", "ч. 19.2");
      return part && ctx.parts.includes(part)
        ? plan("compose", basis, "Составлю сведения по вашим документам — за них дают баллы", { part, ...optional })
        : plan("upload", basis, strictLaw(ctx) ? "Для баллов: без этого заявку не отклонят, но баллов будет меньше" : "Приложите для оценки, как просит заказчик", optional);
    },
  },
  {
    id: "proposal",
    title: "Предложение по предмету закупки",
    match:
      /предложени[а-яё]*\s+(участник[а-яё]*\s+)?(закупки\s+)?(в\s+отношении|о\s+(товар|работ|услуг|функциональн|качеств)|об?\s+(оказани|выполнени|поставк))|техническ[а-яё]*\s+предложени|характеристик|показател[а-яё]*\s+(предлагаем[а-яё]*\s+)?товар|товарн[а-яё]*\s+знак|программ[а-яё]*\s+(мероприяти|работ|оказани|проведени)|описани[а-яё]*\s+(порядк|услуг|работ|товар|как)|как\s+будете|(?<![а-яё])ТП(?![а-яё])/i,
    plan: (ctx) =>
      plan("compose", basisOf(ctx, "пп. «а» п. 2 ч. 1 ст. 43", "п. 10 ч. 19.1"), "Составлю техническое предложение — проверьте и допишите", {
        part: "tp",
      }),
  },
  {
    id: "origin",
    title: "Страна происхождения товара",
    match: /стран[а-яё]*\s+происхождени|национальн[а-яё]*\s+режим|реестров[а-яё]*\s+запис|происхождени[а-яё]*\s+товар|1875/i,
    plan: (ctx) =>
      plan(
        "confirm",
        basisOf(ctx, "пп. «б» п. 2, п. 5 ч. 1 ст. 43", "п. 12 ч. 19.1"),
        ctx.law === "44"
          ? "Укажите страну происхождения. Без документов по национальному режиму заявку сочтут предложением иностранного товара"
          : "Укажите страну происхождения товара"
      ),
  },
  {
    id: "price",
    title: "Предложение о цене",
    match: /предложени[а-яё]*\s+о\s+цен|ценов[а-яё]*\s+предложени|цен[а-яё]*\s+(контракта|договора)|сумм[а-яё]*\s+цен\s+единиц/i,
    plan: (ctx) => {
      const basis = basisOf(ctx, "п. 3 ч. 1, пп. «г» п. 5 ч. 6 ст. 43", "п. 13 ч. 19.1");
      if (ctx.parts.includes("price")) return plan("compose", basis, "Составлю предложение о цене — цену выберите на шаге «Цена»", { part: "price" });
      return plan(
        "confirm",
        basis,
        ctx.law === "44"
          ? "Выберите цену на шаге «Цена» и укажите её в заявке. Выше начальной или ноль — площадка вернёт заявку"
          : "Выберите цену на шаге «Цена» и укажите её в заявке"
      );
    },
  },
  {
    id: "images",
    title: "Изображение товара",
    match: /эскиз|рисун|черт[её]ж|фотограф|изображени/i,
    plan: (ctx) =>
      ctx.law === "44"
        ? plan("upload", law44("пп. «д» п. 2 ч. 1 ст. 43"), "По желанию: без этого заявку не отклонят", { mandatory: false, blocks: false })
        : plan("upload", docs(ctx), "Приложите изображение товара, как просит заказчик"),
  },
  {
    id: "participant",
    title: "Сведения об участнике",
    match:
      /анкет|(сведени|информаци)[а-яё]*\s+об?\s+участник|наименовани[а-яё]*\s+участник|(?<![а-яё])(ИНН|КПП|ОГРН)(?![а-яё])|паспорт|учредител|контактн|уголовно-исполнительн|организаци[а-яё]*\s+инвалид|социально\s+ориентированн/i,
    plan: (ctx) =>
      ctx.law === "44" && ctx.electronic
        ? plan("platform", law44("пп. «а»–«л» п. 1 ч. 1, п. 2 ч. 6 ст. 43"), "Передаст площадка из ЕИС — в заявку не включают")
        : ctx.parts.includes("participant")
          ? plan("compose", basisOf(ctx, "пп. «а»–«л» п. 1 ч. 1 ст. 43", "п. 1–4 ч. 19.1"), "Составлю анкету по «Реквизитам» — проверьте", {
              part: "participant",
            })
          : plan("upload", docs(ctx), "Приложите сведения об участнике по форме заказчика"),
  },
];

// Не узнали пункт — просим приложить, как требует заказчик.
const unknownPlan = (ctx: PlanContext) => plan("upload", docs(ctx), "Приложите, как требует заказчик");

export function ruleOf(item: Pick<ReqItem, "text" | "quote">, ctx: PlanContext): { rule: RuleId | null; title: string; plan: RulePlan } {
  const found = findRule(item, ctx);
  // Заказчик сам пишет, что без этого не отклонят, — пункт для оценки, а не для допуска.
  if (found.plan.mandatory && (NOT_GROUNDS.test(item.text) || NOT_GROUNDS.test(item.quote))) {
    return { ...found, plan: { ...found.plan, mandatory: false, blocks: false } };
  }
  return found;
}

const PLATFORM_PLAN = () => plan("platform", "так указано в документах закупки", "Сформирует площадка — прикладывать не нужно");

function findRule(item: Pick<ReqItem, "text" | "quote">, ctx: PlanContext): { rule: RuleId | null; title: string; plan: RulePlan } {
  // Сначала — короткий текст пункта, потом — цитата: в длинной цитате бывают оговорки вроде «при спецсчёте
  // обеспечение подтверждает площадка», поэтому по цитате площадку признаём, только если текст ничего не узнал.
  for (const probe of [item.text, item.quote]) {
    if (BY_PLATFORM.test(probe)) return { rule: "platform", title: "Формирует площадка", plan: PLATFORM_PLAN() };
    const rule = RULES.find((r) => r.match.test(probe));
    if (rule && (rule.id !== "points" || ctx.points || /балл|оценк|критери/i.test(probe))) {
      return { rule: rule.id, title: rule.title, plan: rule.plan(ctx, probe) };
    }
  }
  return { rule: null, title: item.text, plan: unknownPlan(ctx) };
}

// Кто участник — по ИНН в «Реквизитах»: 10 цифр — организация, 12 — ИП или физическое лицо.
export function participantOf(profile?: Pick<Profile, "inn">): Participant | null {
  const inn = (profile?.inn ?? "").replace(/\D/g, "");
  return inn.length === 10 ? "ul" : inn.length === 12 ? "ip" : null;
}

// Подписывает руководитель: подписант не вписан или это тот же человек, что в строке «Руководитель».
export function headSignsOf(profile?: Pick<Profile, "signer" | "head">): boolean {
  const signer = (profile?.signer ?? "").trim();
  if (!signer) return true;
  if (/доверенност/i.test(signer)) return false;
  const surname = signer.split(/[\s,]+/)[0] ?? "";
  return surname.length > 1 && (profile?.head ?? "").includes(surname);
}

// 223-ФЗ: закупка только для МСП — так сказано в способе закупки или в «Кто может участвовать».
const SME_ONLY = /только[^.;]{0,80}(субъект[а-яё]*\s+мал|(?<![а-яё])(МСП|СМСП)(?![а-яё]))/i;
const SME_KIND = /(?<![а-яё])(МСП|СМСП)(?![а-яё])|субъект[а-яё]*\s+мал[а-яё]*\s+и\s+средн/i;
export const smeOnly = (p: Pick<Purchase, "kind" | "requirements">) =>
  SME_KIND.test(p.kind) || p.requirements.who.some((item) => SME_ONLY.test(item.text));

export function contextOf(p: Purchase, profile?: Profile): PlanContext {
  const law = lawOfKind(p.kind);
  return {
    law,
    electronic: isElectronic(p.kind),
    sme: law === "223" && smeOnly(p),
    participant: participantOf(profile),
    headSigns: headSignsOf(profile),
    points: p.criteria?.howWins === "points",
    parts: partsOf(p.tp?.form ?? PLAIN_FORM, p.criteria, p.kind, p.tp?.detectedForms),
  };
}

// Пункт держит подачу, если без отметки участника заявку подавать нельзя. Площадка передаст сама, «не требуется»,
// баллы и «по желанию» отметки не ждут — иначе участник отмечал бы «готово» то, что приложение само называет лишним.
export const holdsSubmission = (plan: Pick<RulePlan, "mandatory" | "blocks">) => plan.mandatory && plan.blocks;

// Пункты «Что подать», которые держат подачу. profile — по нему узнаём ИП (у него нет устава) или организацию;
// без реквизитов пункты, зависящие от участника, считаются нужными: лишний раз приложить безопаснее, чем не приложить.
export const requiredItems = (p: Purchase, profile?: Profile): ReqItem[] => {
  const ctx = contextOf(p, profile);
  return p.requirements.submit.filter((item) => holdsSubmission(ruleOf(item, ctx).plan));
};

// Состояние документа, который составляет приложение: есть ли в нём пустые, ошибочные и неподтверждённые поля.
export function partStateOf(fields: ApplicationField[], part: TpPart): "done" | "confirm" | "todo" {
  const own = fields.filter((f) => f.part === part);
  if (own.some((f) => f.status === "invalid" || (f.status === "needs_input" && f.required))) return "todo";
  if (own.some((f) => f.status === "needs_confirmation" || f.status === "needs_input")) return "confirm";
  return "done";
}

// Статус пункта. Составленное ИИ готово, только когда человек его проверил и отметил («ИИ может заполнить, но не
// утверждает сам»). Приложить и подтвердить — по отметке «готово» у пункта.
function statusOf(rule: RulePlan, ready: boolean, composed: boolean, part: "done" | "confirm" | "todo" | null): PlanStatus {
  if (rule.mode === "platform" || rule.mode === "not_required") return "none";
  if (rule.mode === "compose") {
    if (!composed || part === "todo") return "todo";
    return ready && part === "done" ? "done" : "confirm";
  }
  if (ready) return "done";
  return rule.mode === "confirm" || !rule.mandatory ? "confirm" : "todo";
}

// План по всем пунктам «Что подать». fields — карта полей заявки (lib/fields.ts): по ней видно, заполнены ли документы,
// которые составляет приложение. Без неё составленный документ ждёт проверки.
export function fulfillmentOf(p: Purchase, opts: { profile?: Profile; fields?: ApplicationField[] } = {}): FulfillmentPlan[] {
  const ctx = contextOf(p, opts.profile);
  const ready = new Set(p.submitReady ?? []);
  return p.requirements.submit.map((item) => {
    const found = ruleOf(item, ctx);
    const part = found.plan.part && opts.fields ? partStateOf(opts.fields, found.plan.part) : null;
    return {
      ...found.plan,
      item,
      rule: found.rule,
      title: found.title,
      status: statusOf(found.plan, ready.has(item.text), Boolean(p.tp), part),
    };
  });
}

// Сводка: сколько готово, что подтвердить, что сделать, что не требуется; сколько открытого мешает подаче.
export function planSummary(plans: FulfillmentPlan[]) {
  const count = (status: PlanStatus) => plans.filter((x) => x.status === status).length;
  return {
    done: count("done"),
    confirm: count("confirm"),
    todo: count("todo"),
    none: count("none"),
    blocking: plans.filter((x) => (x.status === "todo" || x.status === "confirm") && x.mandatory && x.blocks).length,
    extra: plans.filter((x) => x.extra).length,
  };
}
