// Что показать человеку, когда запрос к серверу не удался. Сервер отвечает коротким обычным текстом — его и показываем.
// Но между браузером и сервером бывают чужие: страница ошибки хостинга или прокси приходит куском HTML, а при обрыве сети
// браузер сам пишет по-английски «Failed to fetch». Человек должен видеть понятную фразу, а не код.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

export const OFFLINE_TEXT = "Нет связи с сервером — проверьте интернет.";
export const TIMEOUT_TEXT = "Сервер не ответил вовремя — повторите через минуту.";

const BY_STATUS: Record<number, string> = {
  400: "Сервер не принял запрос. Обновите страницу и попробуйте ещё раз.",
  401: "Нужно снова войти по паролю — обновите страницу.",
  403: "Доступ закрыт. Обновите страницу и войдите заново.",
  404: "Сервер не нашёл нужное — возможно, приложение обновили. Обновите страницу.",
  408: TIMEOUT_TEXT,
  409: "Данные изменились, пока вы работали. Обновите страницу и повторите.",
  413: "Слишком много данных для одной отправки — отправляйте файлы по одному или меньшими частями.",
  422: "Сервер не принял данные в таком виде. Проверьте файлы и повторите.",
  429: "Слишком много запросов подряд — подождите минуту и повторите.",
  500: "На сервере что-то сломалось. Повторите через минуту; если не поможет — напишите владельцу сервиса.",
  502: "Сервер временно не отвечает — повторите через минуту.",
  503: "Сервис временно недоступен — повторите через минуту.",
  504: "Сервер не успел ответить — повторите через минуту. Если так повторится, разбирайте документы по частям.",
};

// Длиннее — это уже не сообщение, а страница или след ошибки.
const MAX_TEXT = 600;
const LOOKS_LIKE_PAGE = /^\s*(<!doctype|<html|<\?xml|<body|<head|<title|<h1|<pre)|<\/?(html|body|head|div|center|script)\b/i;

// Текст ошибки из ответа сервера. Свой короткий текст сервера — как есть; пустой ответ, страница, JSON и след ошибки — понятной
// фразой по коду ответа; кода в списке нет — fallback. own — свои фразы для кодов там, где общая фраза хуже: например, в списке
// файлов «сервер не смог прочитать файл» точнее, чем «на сервере что-то сломалось».
export async function errorText(res: Response, fallback: string, own: Record<number, string> = {}): Promise<string> {
  const text = (await res.text().catch(() => "")).trim();
  const type = res.headers.get("content-type") ?? "";
  const plain = text && text.length <= MAX_TEXT && !/text\/html|json/i.test(type) && !LOOKS_LIKE_PAGE.test(text) && !/^[{[]/.test(text);
  return plain ? text : (own[res.status] ?? BY_STATUS[res.status] ?? fallback);
}

// Браузеры по-разному называют обрыв сети: Chrome — «Failed to fetch», Firefox — «NetworkError…», Safari — «Load failed».
const NETWORK = /failed to fetch|networkerror|load failed|fetch failed|network request failed|network connection/i;

// Текст для человека из исключения запроса: нет сети — понятная фраза; своё сообщение (его бросил errorText) — как есть;
// чужая ошибка программы по-английски — fallback, а не «Cannot read properties of undefined».
export function errorMessage(error: unknown, fallback = "Не получилось — обновите страницу и повторите."): string {
  if (error instanceof Error && error.name === "TimeoutError") return TIMEOUT_TEXT;
  if (error instanceof Error && error.name === "AbortError") return "Запрос остановлен.";
  if (error instanceof TypeError) return NETWORK.test(error.message) ? OFFLINE_TEXT : fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
