import { NextRequest, NextResponse } from 'next/server';

type Procedure = 'auction' | 'quotation' | 'contest' | 'single';
type Law = '44-ФЗ' | '223-ФЗ';

interface Tender {
  id: string;
  title: string;
  customer: string;
  region: string;
  nmck: number;
  law: Law;
  procedure: Procedure;
  platform: string;
  okpd: string;
  deadline: string;
  publishedAt: string;
  relevance: number;
}

// Статические данные — заменить на запрос к ЕИС при появлении API-ключа.
const TENDERS: Tender[] = [
  { id: '0173200001326000001', title: 'Поставка ноутбуков и периферийного оборудования', customer: 'ГБОУ «Школа №1502»', region: 'Москва', nmck: 2140000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.20.11', deadline: '2026-10-18', publishedAt: '2026-10-01', relevance: 96 },
  { id: '32100098765', title: 'Поставка многофункциональных устройств (МФУ) и картриджей', customer: 'АО «Почта России»', region: 'Москва', nmck: 3580000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП Газпромбанк', okpd: '28.23.21', deadline: '2026-10-25', publishedAt: '2026-09-28', relevance: 91 },
  { id: '0173200001326000003', title: 'Поставка серверов и систем хранения данных', customer: 'ГКУ «Инфогород»', region: 'Москва', nmck: 8900000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '26.20.14', deadline: '2026-10-30', publishedAt: '2026-09-25', relevance: 84 },
  { id: '0173200001326000004', title: 'Поставка источников бесперебойного питания', customer: 'ФГУП «НИИ Автоматики»', region: 'Московская область', nmck: 760000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '27.11.50', deadline: '2026-10-12', publishedAt: '2026-10-03', relevance: 78 },
  { id: '0173200001326000005', title: 'Поставка сетевого оборудования (коммутаторы, маршрутизаторы)', customer: 'Департамент ИТ г. Москвы', region: 'Москва', nmck: 12500000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.30.11', deadline: '2026-11-05', publishedAt: '2026-10-04', relevance: 88 },
  { id: '0362100000126001234', title: 'Поставка расходных материалов для оргтехники', customer: 'ГБУЗ «ГКБ №52» ДЗМ', region: 'Москва', nmck: 430000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '32.99.19', deadline: '2026-10-14', publishedAt: '2026-10-05', relevance: 82 },
  { id: '0173300001426000012', title: 'Поставка мониторов и графических рабочих станций', customer: 'ГБОУ «МГТУ им. Баумана»', region: 'Москва', nmck: 4850000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '26.20.17', deadline: '2026-11-08', publishedAt: '2026-10-04', relevance: 93 },
  { id: '0173200001326000010', title: 'Техническое обслуживание серверного оборудования и систем хранения', customer: 'ГКУ «Московская дирекция транспорта»', region: 'Москва', nmck: 3200000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.20.19', deadline: '2026-10-28', publishedAt: '2026-10-03', relevance: 89 },
  { id: '0173200001326000018', title: 'Поставка серверных стоек, комплектующих и кабельных органайзеров', customer: 'ГБОУ «Школа №1551»', region: 'Москва', nmck: 980000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '26.20.14', deadline: '2026-10-10', publishedAt: '2026-10-05', relevance: 90 },
  { id: '32200099001', title: 'Обслуживание и ремонт копировально-множительной техники', customer: 'АО «РЖД»', region: 'Москва', nmck: 1640000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП РЖД', okpd: '28.23.29', deadline: '2026-10-31', publishedAt: '2026-10-01', relevance: 85 },
  { id: '32100111222', title: 'Поставка лицензий на программное обеспечение для управления проектами', customer: 'ПАО «Газпром нефть»', region: 'Санкт-Петербург', nmck: 7800000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП ГПБ', okpd: '58.29.11', deadline: '2026-11-01', publishedAt: '2026-09-27', relevance: 71 },
  { id: '32100055333', title: 'Поставка и монтаж системы видеонаблюдения и контроля доступа', customer: 'ПАО «Сбербанк»', region: 'Москва', nmck: 9200000, law: '223-ФЗ', procedure: 'contest', platform: 'Сбербанк-АСТ', okpd: '26.30.50', deadline: '2026-10-27', publishedAt: '2026-09-30', relevance: 67 },
  { id: '32100077889', title: 'Услуги облачной инфраструктуры (IaaS) и технической поддержки', customer: 'АО «Аэрофлот»', region: 'Москва', nmck: 34500000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП Газпромбанк', okpd: '63.11.12', deadline: '2026-11-30', publishedAt: '2026-09-25', relevance: 79 },
  { id: '0173200001326000014', title: 'Поставка источников постоянного тока и зарядных устройств', customer: 'ФГБУ «НИИ Электроники»', region: 'Новосибирская область', nmck: 1100000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '27.11.29', deadline: '2026-10-16', publishedAt: '2026-10-04', relevance: 74 },
  { id: '0319200000126001010', title: 'Поставка компьютерной техники для образовательных учреждений', customer: 'Министерство образования Красноярского края', region: 'Красноярский край', nmck: 6700000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.20.11', deadline: '2026-10-24', publishedAt: '2026-10-02', relevance: 76 },
  { id: '0173200001326000015', title: 'Строительно-монтажные работы по прокладке структурированной кабельной системы', customer: 'АО «Мосэнерго»', region: 'Московская область', nmck: 8300000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '43.21.10', deadline: '2026-11-20', publishedAt: '2026-09-26', relevance: 55 },
  { id: '0162300002126000016', title: 'Поставка лабораторного оборудования и измерительных приборов', customer: 'ФГБУ «РФЯЦ-ВНИИЭФ»', region: 'Нижегородская область', nmck: 15600000, law: '44-ФЗ', procedure: 'contest', platform: 'РТС-тендер', okpd: '26.51.33', deadline: '2026-11-10', publishedAt: '2026-09-28', relevance: 47 },
  { id: '0173200001326000011', title: 'Поставка телекоммуникационного оборудования для центра обработки данных', customer: 'ФСО России', region: 'Москва', nmck: 22400000, law: '44-ФЗ', procedure: 'single', platform: 'ЕИС', okpd: '26.30.22', deadline: '2026-10-20', publishedAt: '2026-09-29', relevance: 62 },
  { id: '0162300001526000007', title: 'Поставка медицинского оборудования для диагностики', customer: 'ФГБУ «НМИЦ онкологии»', region: 'Санкт-Петербург', nmck: 18700000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '32.50.13', deadline: '2026-11-15', publishedAt: '2026-09-30', relevance: 43 },
  { id: '0173200001326000008', title: 'Поставка офисной мебели для государственных учреждений', customer: 'Минтруд России', region: 'Москва', nmck: 5200000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '31.01.11', deadline: '2026-10-22', publishedAt: '2026-10-02', relevance: 31 },
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.toLowerCase().trim() ?? '';
  const law = sp.get('law') ?? 'all';
  const procedure = sp.get('procedure') ?? 'all';
  const priceMin = Number(sp.get('priceMin') ?? 0);
  const priceMax = Number(sp.get('priceMax') ?? 0);
  const region = sp.get('region') ?? '';
  const okpd = sp.get('okpd') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const sort = sp.get('sort') ?? 'relevance';
  const pageSize = 8;

  let results = TENDERS.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q) && !t.customer.toLowerCase().includes(q) &&
        !t.id.includes(q) && !t.okpd.startsWith(q)) return false;
    if (law !== 'all' && t.law !== law) return false;
    if (procedure !== 'all' && t.procedure !== procedure) return false;
    if (priceMin > 0 && t.nmck < priceMin) return false;
    if (priceMax > 0 && t.nmck > priceMax) return false;
    if (region && t.region !== region) return false;
    if (okpd && !t.okpd.startsWith(okpd)) return false;
    return true;
  });

  if (sort === 'price_asc') results.sort((a, b) => a.nmck - b.nmck);
  else if (sort === 'price_desc') results.sort((a, b) => b.nmck - a.nmck);
  else if (sort === 'deadline') results.sort((a, b) => a.deadline.localeCompare(b.deadline));
  else results.sort((a, b) => b.relevance - a.relevance);

  const total = results.length;
  const items = results.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}
