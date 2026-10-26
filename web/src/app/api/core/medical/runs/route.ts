import { listCoreRunsRequest } from "@/server/core/http";

export const dynamic = "force-dynamic";

/** Алиас медицинского модуля: GET /api/core/medical/runs. */
export async function GET(request: Request) {
  return listCoreRunsRequest(request, "medical");
}
