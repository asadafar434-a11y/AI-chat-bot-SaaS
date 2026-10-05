// Клиентская шина «данные изменились». После S11 Final Read Cutover экраны читают
// состояние с сервера, поэтому обновление после мутации — явный refetch: мутация
// завершается (S5 dual-write IndexedDB + серверная запись) и зовёт notifyDataChanged(),
// подписчики перечитывают серверное состояние.
//
// Шина намеренно не связана с IndexedDB и не использует DOM-события: это обычный
// реестр слушателей в пределах вкладки. Так она работает и в браузере, и в Node
// (тесты cutover), и событие IndexedDB больше не является способом узнать, что читать.
const listeners = new Set<() => void>();

/** Сообщить подписчикам, что данные изменились; вызывается после успешной мутации. */
export function notifyDataChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Ошибка одного подписчика не должна мешать остальным и самой мутации.
    }
  }
}

/** Подписка на изменение данных. Возвращает функцию отписки. */
export function onDataChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
