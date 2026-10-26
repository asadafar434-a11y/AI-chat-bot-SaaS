import { runCoreRequest } from "@/server/core/http";

export const dynamic = "force-dynamic";

/** Алиас медицинского модуля: POST /api/core/medical/run. */
export async function POST(request: Request) {
  return runCoreRequest(request, "medical");
}
