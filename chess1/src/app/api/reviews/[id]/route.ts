import { db } from "@/db";
import { reviews } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "Bad id" }, { status: 400 });
  const [row] = await db.select().from(reviews).where(eq(reviews.id, n)).limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ review: row });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "Bad id" }, { status: 400 });
  await db.delete(reviews).where(eq(reviews.id, n));
  return Response.json({ ok: true });
}
