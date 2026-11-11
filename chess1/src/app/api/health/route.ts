// src/app/api/health/route.ts  (или app/api/health/route.ts)
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok" });
}