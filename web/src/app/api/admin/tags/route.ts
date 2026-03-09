import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { CreateTagSchema } from "@/lib/schemas";
import { type TagDimension } from "@prisma/client";

export async function GET(request: NextRequest): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") return Res.forbidden();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const search = searchParams.get("search") || "";
    const dimension = searchParams.get("dimension") as TagDimension | null;

    const skip = (page - 1) * limit;

    const where = {
        ...(search ? {
            OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { groupName: { contains: search, mode: "insensitive" as const } }
            ]
        } : {}),
        ...(dimension ? { dimension } : {})
    };

    try {
        const [total, tags] = await Promise.all([
            db.tag.count({ where }),
            db.tag.findMany({
                where,
                skip,
                take: limit,
                orderBy: [{ dimension: "asc" }, { groupName: "asc" }, { name: "asc" }],
                include: {
                    _count: {
                        select: { questions: true }
                    }
                }
            })
        ]);

        return Res.ok({
            data: tags,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e: any) {
        console.error("Tags API DB Error:", e);
        return Res.internal(`Database query failed: ${e.message || String(e)}`);
    }
}

const UpdateTagSchema = CreateTagSchema.partial();

export async function PATCH(request: NextRequest): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") return Res.forbidden();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Res.badRequest("缺少標籤 ID");

    let body: unknown;
    try { body = await request.json(); }
    catch { return Res.badRequest("Body 必須是 JSON"); }

    const parsed = UpdateTagSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    try {
        const tag = await db.tag.update({
            where: { id },
            data: parsed.data
        });
        return Res.ok(tag);
    } catch (err: any) {
        if (err.code === "P2002") {
            return Res.conflict("相同維度與群組下的標籤已存在，或 Slug 重複");
        }
        return Res.internal();
    }
}

export async function DELETE(request: NextRequest): Promise<Response> {
    const role = request.headers.get("x-user-role");
    // 只有 ADMIN 允許硬刪除標籤
    if (role !== "ADMIN") return Res.forbidden("僅管理員可刪除標籤");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Res.badRequest("缺少標籤 ID");

    try {
        // 因 schema 使用 onDelete: Cascade，關聯的 QuestionTag 會一併刪除
        await db.tag.delete({ where: { id } });
        return Res.ok({ message: "刪除成功" });
    } catch {
        return Res.internal();
    }
}
