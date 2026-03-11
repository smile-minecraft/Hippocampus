/**
 * GET /api/wiki/[slug]/related
 *
 * Returns questions related to a wiki article, identified by slug.
 * Finds the article first (same lookup as /api/wiki/[slug]),
 * then fetches questions linked via wikiArticleId FK.
 *
 * Public endpoint — no auth required.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Res } from '@/lib/api-response'

interface RouteParams {
    params: Promise<{ slug: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<Response> {
    const { slug } = await params
    const decodedSlug = decodeURIComponent(slug)
    const titleSearch = decodedSlug.replace(/-/g, ' ')

    // Find article by title (same strategy as parent route)
    let article = await db.wikiArticle.findFirst({
        where: {
            deletedAt: null,
            status: 'PUBLISHED',
            title: { equals: titleSearch, mode: 'insensitive' },
        },
        select: { id: true },
    })

    if (!article) {
        article = await db.wikiArticle.findFirst({
            where: {
                deletedAt: null,
                status: 'PUBLISHED',
                title: { contains: titleSearch, mode: 'insensitive' },
            },
            select: { id: true },
        })
    }

    // UUID fallback
    if (!article) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidRegex.test(decodedSlug)) {
            article = await db.wikiArticle.findFirst({
                where: { id: decodedSlug, deletedAt: null, status: 'PUBLISHED' },
                select: { id: true },
            })
        }
    }

    if (!article) {
        return Res.notFound('找不到此知識條目')
    }

    // Fetch related questions linked to this article
    const questions = await db.question.findMany({
        where: {
            wikiArticleId: article.id,
            deletedAt: null,
        },
        select: {
            id: true,
            year: true,
            examType: true,
            stem: true,
            options: true,
            answer: true,
            explanation: true,
            imageUrls: true,
            difficulty: true,
            createdAt: true,
            updatedAt: true,
            tags: {
                select: {
                    tag: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            dimension: true,
                        },
                    },
                },
            },
        },
        orderBy: { year: 'desc' },
        take: 50,
    })

    // Flatten the tag join structure to match the Question type
    const formatted = questions.map((q: typeof questions[number]) => ({
        ...q,
        tags: q.tags.map((qt: typeof q.tags[number]) => ({
            ...qt.tag,
            category: qt.tag.dimension,
        })),
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
    }))

    return Res.ok(formatted)
}
