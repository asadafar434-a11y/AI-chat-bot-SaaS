import { Badge, Tooltip, type Tone } from './ui';

// Насколько можно верить находке. Метка стоит у каждого вывода раздела «Аналитика», чтобы факт не путали с догадкой (решение владельца, 21.10.2026):
// confirmed — прочитано из документа заказчика или пересчитано кодом по его цифрам; own — посчитано по тому, что ввели вы; estimate — сумма «если случится» по условиям договора и допущениям; hypothesis — предположение, нужна проверка;
// unchecked — проверить не удалось, данных нет. Выдуманных цифр нет ни под одной меткой.
export type Certainty = 'confirmed' | 'own' | 'estimate' | 'hypothesis' | 'unchecked';

const KINDS: Record<Certainty, { tone: Tone; label: string; hint: string }> = {
  confirmed: { tone: 'success', label: 'Подтверждено', hint: 'Прочитано из документа заказчика или пересчитано программой по его цифрам.' },
  own: { tone: 'info', label: 'По вашим данным', hint: 'Посчитано по ценам и данным, которые ввели вы. Проверьте, что они верны и сопоставимы.' },
  estimate: { tone: 'info', label: 'Оценка', hint: 'Посчитано по условиям договора и допущениям, которые видно и можно поменять. Это не факт, а расчёт «если случится».' },
  hypothesis: { tone: 'warn', label: 'Гипотеза', hint: 'Предположение, а не установленный факт. Нужна проверка человеком.' },
  unchecked: { tone: 'neutral', label: 'Не проверено', hint: 'Проверить не удалось: нет документа, источника или данных.' },
};

export function CertaintyBadge({ kind }: { kind: Certainty }) {
  const k = KINDS[kind];
  return (
    <Tooltip content={k.hint} side="bottom" align="start">
      <span>
        <Badge tone={k.tone}>{k.label}</Badge>
      </span>
    </Tooltip>
  );
}
