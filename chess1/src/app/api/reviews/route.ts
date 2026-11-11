import { db } from "@/db";
import { reviews } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select({
      id: reviews.id,
      white: reviews.white,
      black: reviews.black,
      result: reviews.result,
      plies: reviews.plies,
      depth: reviews.depth,
      whiteAccuracy: reviews.whiteAccuracy,
      blackAccuracy: reviews.blackAccuracy,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .orderBy(desc(reviews.createdAt))
    .limit(30);
  return Response.json({ reviews: rows });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const data = body.data as { game?: { headers?: Record<string, string>; moves?: unknown[] }; summary?: { accuracy?: { w: number; b: number } }; settings?: { depth?: number } } | undefined;
  if (!data || !data.game || !data.summary?.accuracy) {
    return Response.json({ error: "Missing review data" }, { status: 400 });
  }
  const headers = data.game.headers ?? {};
  const [row] = await db
    .insert(reviews)
    .values({
      white: String(headers.White ?? "White").slice(0, 80),
      black: String(headers.Black ?? "Black").slice(0, 80),
      result: String(headers.Result ?? "*").slice(0, 20),
      plies: data.game.moves?.length ?? 0,
      depth: Number(data.settings?.depth ?? 20),
      whiteAccuracy: Number(data.summary.accuracy.w) || 0,
      blackAccuracy: Number(data.summary.accuracy.b) || 0,
      data,
    })
    .returning({ id: reviews.id });
  return Response.json({ id: row.id });
}
