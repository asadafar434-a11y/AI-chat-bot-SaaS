import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth"],
  experimental: {
    // Прокси входа (src/proxy.ts) держит тело запроса в памяти, по умолчанию — только первые 10 МБ,
    // и больший файл приходил обрезанным. Файлы идут по одному, каждый — до 40 МБ (MAX_FILE_MB).
    proxyClientMaxBodySize: "45mb",
  },
};

export default nextConfig;
