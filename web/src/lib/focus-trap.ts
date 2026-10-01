// Куда уйдёт фокус по Tab (или Shift+Tab) в окне поверх страницы. Чистая логика без DOM: окно вызывает её со списком своих
// фокусируемых элементов, а решение проверяется тестом (focus-trap.test.ts).
//
//  'stay' — браузер сам переведёт фокус к следующему элементу, и он останется внутри окна;
//  элемент — фокус надо увести на него: иначе он вышел бы за край окна на страницу под затемнением;
//  null   — в окне нечего выбирать: фокус остаётся на самом окне.
//
// inside — стоит ли фокус внутри окна. Элемент внутри может не быть в списке: прокручиваемая область с длинным текстом
// получает фокус с клавиатуры сама (так делают Chrome и Firefox). Такой элемент не трогаем — решает браузер, а если он
// выведет фокус из окна, вернёт его обратно страж фокуса из useDialogFocus (ui.tsx).
export function tabTarget<T>(items: readonly T[], active: T | null, back: boolean, dialog: T, inside: boolean): T | "stay" | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (active === dialog) return back ? last : "stay";
  // Фокус вне окна (например, после щелчка по затемнению) или нигде — возвращаем в начало или в конец окна.
  if (active === null || !inside) return back ? last : first;
  if (!items.includes(active)) return "stay";
  if (back) return active === first ? last : "stay";
  return active === last ? first : "stay";
}
