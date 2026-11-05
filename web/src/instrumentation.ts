// Запускается один раз при старте сервера Next. Здесь включается ежедневная загрузка закупок из Ростендера; сам старт сервера она не задерживает.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTenderSync } = await import("@/server/rostender/schedule");
  void startTenderSync().catch(() => undefined);
}
