/**
 * lib/ai/tag-prompt.ts
 *
 * Builds the tag-slug section of AI extraction prompts dynamically from the
 * database, replacing the previous hardcoded 60-slug list.
 *
 * Tags are cached in Redis (via the shared `cached()` helper) for 10 minutes
 * so that DB round-trips don't happen on every extraction call. When an admin
 * creates, edits, or deletes a tag the `tags:all` cache key is already
 * invalidated, causing the next extraction to pick up the fresh list.
 */

import { db } from "@/lib/db";
import { cached } from "@/lib/cache";

interface TagRow {
    slug: string;
    dimension: string;
}

// Human-readable dimension labels used in the prompt
const DIMENSION_LABELS: Record<string, string> = {
    ACADEMIC: "ACADEMIC",
    ORGAN: "ORGAN",
    EXAM_CATEGORY: "EXAM",
    META: "META",
};

// Dimension display order
const DIMENSION_ORDER = ["ACADEMIC", "ORGAN", "EXAM_CATEGORY", "META"];

/**
 * Fetch all tag slugs grouped by dimension and format them into the prompt
 * instruction block that the AI model uses to classify questions.
 *
 * Returns a string like:
 *   ACADEMIC: anatomy, physiology, biochemistry, ...
 *   ORGAN: cardiovascular, respiratory, ...
 *   EXAM: med-board-1, med-board-2, ...
 *   META: high-yield, controversial, ...
 */
async function fetchFormattedTagSlugs(): Promise<string> {
    const tags: TagRow[] = await db.tag.findMany({
        select: { slug: true, dimension: true },
        orderBy: [{ dimension: "asc" }, { name: "asc" }],
    });

    // Group by dimension
    const grouped = new Map<string, string[]>();
    for (const tag of tags) {
        const existing = grouped.get(tag.dimension) ?? [];
        existing.push(tag.slug);
        grouped.set(tag.dimension, existing);
    }

    // Format lines in canonical order
    const lines: string[] = [];
    for (const dim of DIMENSION_ORDER) {
        const slugs = grouped.get(dim);
        if (!slugs || slugs.length === 0) continue;
        const label = DIMENSION_LABELS[dim] ?? dim;
        lines.push(`   ${label}: ${slugs.join(", ")}`);
    }

    return lines.join("\n");
}

/**
 * Returns the fully formatted tag-slug prompt section, cached for 10 minutes.
 *
 * Example output:
 * ```
 * 10. **Tag Slugs**: For each question, pick 1–5 of the following tag slugs ...
 *    ACADEMIC: anatomy, physiology, ...
 *    ORGAN: cardiovascular, ...
 *    ...
 *    Output these as the "tagSlugs" array. Only use slugs from the list above.
 * ```
 */
export async function getTagSlugPromptSection(): Promise<string> {
    const slugLines = await cached("ai:tag-slugs-prompt", fetchFormattedTagSlugs, { ttl: 600 });

    return [
        `10. **Tag Slugs**: For each question, pick 1–5 of the following tag slugs that best describe the question content.`,
        slugLines,
        `   Output these as the "tagSlugs" array. Only use slugs from the list above.`,
    ].join("\n");
}
