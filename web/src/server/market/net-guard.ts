// Защита при скачивании страниц по адресам из поиска: адрес — чужие данные, и по нему нельзя ходить в частную сеть, к самому серверу или к служебным адресам облака (SSRF).
// Чистые проверки адреса и IP без сети: их проверяют тесты (npm test); сама загрузка — fetch-page.ts.

/** IPv4 или IPv6 из закрытых диапазонов: своя машина, частные сети, локальная ссылка, служебные адреса, общий адрес провайдера. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIp(mapped[1]);
  if (v.includes(":")) {
    return v === "::" || v === "::1" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff") || v.startsWith("::ffff:");
  }
  const p = v.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Адрес можно открывать: http или https, без логина и пароля, обычный порт, имя сайта (не IP-адрес) и не служебное имя. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "адрес не разобрался" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "не http и не https" };
  if (url.username || url.password) return { ok: false, reason: "в адресе есть логин или пароль" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "необычный порт" };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /^\d+(\.\d+){3}$/.test(host) || host.startsWith("[") || /^[\d.]+$/.test(host)) return { ok: false, reason: "адрес — IP или не имя сайта" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home")) return { ok: false, reason: "служебное имя" };
  return { ok: true, url };
}
