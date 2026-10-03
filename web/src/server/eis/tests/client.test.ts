// EIS Collector v1: unit-тесты HTTP-клиента (retry, 429, timeout, SOAP fault). Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelayMs, EisHttpClient, extractSoapFault } from "../client.ts";
import { EisError } from "../errors.ts";
import { mockFetchSequence } from "./helpers.ts";

const cfg = (over: Record<string, number | string> = {}) => ({
  baseUrl: "https://mock.invalid/soap",
  authToken: "test-token",
  dryRun: true,
  maxTenders: 10,
  requestDelayMs: 1,
  maxRetries: 2,
  timeoutMs: 1000,
  storagePath: "./data-test",
  ...over,
});

test("client: успех с первого раза", async () => {
  const { fetchFn } = mockFetchSequence([{ body: "<ok/>" }]);
  const client = new EisHttpClient(cfg(), fetchFn);
  assert.equal(await client.soapRequest("<env/>", { action: "t" }), "<ok/>");
});

test("client: retry при 500, затем успех", async () => {
  const { fetchFn, calls } = mockFetchSequence([{ status: 500, body: "err" }, { body: "<ok/>" }]);
  const client = new EisHttpClient(cfg(), fetchFn);
  assert.equal(await client.soapRequest("<env/>", { action: "t" }), "<ok/>");
  assert.equal(calls.length, 2);
});

test("client: 429 с Retry-After повторяется", async () => {
  const { fetchFn, calls } = mockFetchSequence([
    { status: 429, body: "slow", headers: { "retry-after": "0" } },
    { body: "<ok/>" },
  ]);
  const client = new EisHttpClient(cfg(), fetchFn);
  assert.equal(await client.soapRequest("<env/>", { action: "t" }), "<ok/>");
  assert.equal(calls.length, 2);
});

test("client: 401 не повторяется (AUTH_ERROR)", async () => {
  const { fetchFn, calls } = mockFetchSequence([{ status: 401, body: "no" }]);
  const client = new EisHttpClient(cfg(), fetchFn);
  await assert.rejects(() => client.soapRequest("<env/>", { action: "t" }), (err: unknown) => {
    assert.ok(err instanceof EisError && err.code === "AUTH_ERROR");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("client: исчерпанные повторы бросают SERVER_ERROR", async () => {
  const { fetchFn, calls } = mockFetchSequence([{ status: 503, body: "down" }]);
  const client = new EisHttpClient(cfg({ maxRetries: 1 }), fetchFn);
  await assert.rejects(() => client.soapRequest("<env/>", { action: "t" }), (err: unknown) => {
    assert.ok(err instanceof EisError && err.code === "SERVER_ERROR");
    return true;
  });
  assert.equal(calls.length, 2);
});

test("client: timeout при висящем запросе", async () => {
  const hanging = async (): Promise<Response> => new Promise(() => {});
  const client = new EisHttpClient(cfg({ timeoutMs: 20, maxRetries: 0 }), hanging);
  await assert.rejects(() => client.soapRequest("<env/>", { action: "t" }), (err: unknown) => {
    assert.ok(err instanceof EisError && err.code === "TIMEOUT");
    return true;
  });
});

test("client: SOAP Fault — не retryable, токен из fault вычищен", async () => {
  const fault =
    `<soap:Envelope><soap:Body><soap:Fault><faultcode>Client</faultcode>` +
    `<faultstring>individualPerson_token test-token is invalid</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
  const { fetchFn, calls } = mockFetchSequence([{ body: fault }]);
  const client = new EisHttpClient(cfg(), fetchFn);
  await assert.rejects(() => client.soapRequest("<env/>", { action: "t" }), (err: unknown) => {
    assert.ok(err instanceof EisError && err.code === "SOAP_FAULT");
    assert.ok(!String((err as Error).message).includes("test-token"));
    assert.ok(!String((err as Error).message).includes("<env/>"));
    return true;
  });
  assert.equal(calls.length, 1);
});

test("client: сетевая ошибка не содержит секретов", async () => {
  const boom = async (): Promise<Response> => {
    throw new Error("connect failed EIS_AUTH_TOKEN=topsecret");
  };
  const client = new EisHttpClient(cfg({ maxRetries: 0 }), boom);
  await assert.rejects(() => client.soapRequest("<env/>", { action: "t" }), (err: unknown) => {
    assert.ok(!String((err as Error).message).includes("topsecret"));
    return true;
  });
});

test("client: extractSoapFault парсит префиксы", () => {
  const f = extractSoapFault(`<soapenv:Fault><faultcode>S:Server</faultcode><faultstring>bad</faultstring></soapenv:Fault>`);
  assert.ok(f?.includes("bad"));
  assert.equal(extractSoapFault("<ok/>"), undefined);
});

test("client: backoff растёт экспоненциально", () => {
  assert.ok(backoffDelayMs(1000, 1) > backoffDelayMs(1000, 0));
  assert.ok(backoffDelayMs(1000, 2) > backoffDelayMs(1000, 1));
});
