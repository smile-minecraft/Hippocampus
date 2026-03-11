/**
 * GET /api/wiki/[slug]
 *
 * Returns a single wiki article by slug (title-derived).
 * Since WikiArticle doesn't have a `slug` column, we match by
 * converting the URL slug back to a title pattern and searching
 * with case-insensitive matching. Falls back to UUID-based lookup.
 *
 * Public endpoint — no auth required (consumed by SSR in wiki/[slug]/page.tsx).
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

    // Strategy 1: Convert slug back to potential title (replace hyphens with spaces)
    const titleSearch = decodedSlug.replace(/-/g, ' ')

    // Try to find by title (case-insensitive, ignoring hyphens vs spaces)
    let article = await db.wikiArticle.findFirst({
        where: {
            deletedAt: null,
            status: 'PUBLISHED',
            title: {
                equals: titleSearch,
                mode: 'insensitive',
            },
        },
        select: {
            id: true,
            title: true,
            content: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        },
    })

    // Strategy 2: If title match fails, try contains (handles partial slug matches)
    if (!article) {
        article = await db.wikiArticle.findFirst({
            where: {
                deletedAt: null,
                status: 'PUBLISHED',
                title: {
                    contains: titleSearch,
                    mode: 'insensitive',
                },
            },
            select: {
                id: true,
                title: true,
                content: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        })
    }

    // Strategy 3: Try UUID-based lookup (the slug might be an article ID)
    if (!article) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidRegex.test(decodedSlug)) {
            article = await db.wikiArticle.findFirst({
                where: {
                    id: decodedSlug,
                    deletedAt: null,
                    status: 'PUBLISHED',
                },
                select: {
                    id: true,
                    title: true,
                    content: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                },
            })
        }
    }

    if (!article) {
        return Res.notFound('找不到此知識條目')
    }

    // Generate a slug for the response (for consistency with the WikiArticle type)
    const articleSlug = article.title
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

    return Res.ok({
        id: article.id,
        slug: articleSlug,
        title: article.title,
        content: article.content,
        publishedAt: article.createdAt.toISOString(),
    })
}
