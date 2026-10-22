// Защита загрузки страниц: закрытые адреса, IP вместо имени, служебные имена, чужие схемы — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUrl, isPrivateIp } from "./net-guard.ts";

test("закрытые адреса узнаются: своя машина, частные сети, локальная ссылка, облачный служебный адрес, общий адрес провайдера, IPv6 и IPv4 внутри IPv6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "не адрес"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "5.255.255.77", "172.15.0.1", "172.32.0.1", "93.184.216.34", "2a02:6b8::1", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("адрес страницы: обычный сайт проходит; IP-адрес, localhost, служебные имена, логин в адресе, чужой порт, не http — нет", () => {
  assert.ok(checkUrl("https://pst-78.ru/catalog/ugol-dpk/").ok);
  assert.ok(checkUrl("http://opt6.ru/products/x?y=1").ok);
  assert.ok(checkUrl("https://example.com:443/a").ok);
  const bad = (u: string) => {
    const r = checkUrl(u);
    return r.ok ? "ok" : r.reason;
  };
  assert.equal(bad("http://127.0.0.1/admin"), "адрес — IP или не имя сайта");
  assert.equal(bad("http://169.254.169.254/latest/meta-data"), "адрес — IP или не имя сайта");
  assert.equal(bad("http://[::1]/"), "адрес — IP или не имя сайта");
  assert.equal(bad("http://localhost/x"), "адрес — IP или не имя сайта");
  assert.equal(bad("http://db.internal/x"), "служебное имя");
  assert.equal(bad("http://printer.local/x"), "служебное имя");
  assert.equal(bad("https://user:pass@example.com/"), "в адресе есть логин или пароль");
  assert.equal(bad("https://example.com:8080/"), "необычный порт");
  assert.equal(bad("ftp://example.com/x"), "не http и не https");
  assert.equal(bad("file:///etc/passwd"), "не http и не https");
  assert.equal(bad("не адрес"), "адрес не разобрался");
  assert.equal(bad("http://2130706433/"), "адрес — IP или не имя сайта");
});
