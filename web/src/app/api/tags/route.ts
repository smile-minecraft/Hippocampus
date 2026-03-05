/**
 * GET /api/tags — List all tags (public, grouped by dimension)
 * POST /api/tags — Create a tag (MODERATOR+)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";


import { type TagDimension } from "@prisma/client";
import { CreateTagSchema } from "@/lib/schemas";


export async function GET(): Promise<Response> {
    const tags = await db.tag.findMany({
        orderBy: [{ name: "asc" }],
    });

    // Group by dimension for frontend convenience
    const grouped = tags.reduce<Record<TagDimension, typeof tags>>(
        (acc, tag) => {
            const dim = tag.dimension as TagDimension;
            if (!acc[dim]) acc[dim] = [];
            acc[dim].push(tag);
            return acc;
        },
        {} as Record<TagDimension, typeof tags>
    );

    return Res.ok({ tags, grouped });
}

export async function POST(request: NextRequest): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") return Res.forbidden();

    let body: unknown;
    try { body = await request.json(); }
    catch { return Res.badRequest("請求 body 必須是有效的 JSON"); }

    const parsed = CreateTagSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    try {
        const tag = await db.tag.create({ data: parsed.data });
        return Res.created(tag);
    } catch (err: unknown) {
        if (
            typeof err === "object" && err !== null && "code" in err &&
            (err as { code: string }).code === "P2002"
        ) {
            return Res.conflict("相同維度下的 Slug 已存在");
        }
        return Res.internal();
    }
}
