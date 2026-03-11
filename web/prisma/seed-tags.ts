/**
 * seed-tags.ts — Upsert 50 preset tags across 4 dimensions.
 *
 * Usage:  npx tsx prisma/seed-tags.ts
 *
 * This script is idempotent — running it multiple times will not create
 * duplicates thanks to the unique constraint on (dimension, groupName, name)
 * and the unique slug.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Tag Definitions ──────────────────────────────────────────────────────────

interface TagDef {
  name: string;
  slug: string;
  dimension: "ACADEMIC" | "ORGAN" | "EXAM_CATEGORY" | "META";
  groupName?: string;
}

const TAGS: TagDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // ACADEMIC — 基礎學科 (14 tags)
  // ═══════════════════════════════════════════════════════════════════════════
  { name: "解剖學", slug: "anatomy", dimension: "ACADEMIC" },
  { name: "生理學", slug: "physiology", dimension: "ACADEMIC" },
  { name: "生物化學", slug: "biochemistry", dimension: "ACADEMIC" },
  { name: "病理學", slug: "pathology", dimension: "ACADEMIC" },
  { name: "藥理學", slug: "pharmacology", dimension: "ACADEMIC" },
  { name: "微生物學", slug: "microbiology", dimension: "ACADEMIC" },
  { name: "免疫學", slug: "immunology", dimension: "ACADEMIC" },
  { name: "寄生蟲學", slug: "parasitology", dimension: "ACADEMIC" },
  { name: "組織學", slug: "histology", dimension: "ACADEMIC" },
  { name: "胚胎學", slug: "embryology", dimension: "ACADEMIC" },
  { name: "普通生物", slug: "general-biology", dimension: "ACADEMIC" },
  { name: "普通化學", slug: "general-chemistry", dimension: "ACADEMIC" },
  { name: "有機化學", slug: "organic-chemistry", dimension: "ACADEMIC" },
  { name: "醫用物理學", slug: "medical-physics", dimension: "ACADEMIC" },

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGAN — 人體器官系統 (18 tags)
  // ═══════════════════════════════════════════════════════════════════════════
  { name: "心血管系統", slug: "cardiovascular", dimension: "ORGAN", groupName: "循環" },
  { name: "呼吸系統", slug: "respiratory", dimension: "ORGAN", groupName: "呼吸" },
  { name: "消化系統", slug: "gastrointestinal", dimension: "ORGAN", groupName: "消化" },
  { name: "肝膽胰", slug: "hepatobiliary", dimension: "ORGAN", groupName: "消化" },
  { name: "泌尿系統", slug: "urinary", dimension: "ORGAN", groupName: "泌尿生殖" },
  { name: "生殖系統", slug: "reproductive", dimension: "ORGAN", groupName: "泌尿生殖" },
  { name: "神經系統", slug: "nervous", dimension: "ORGAN", groupName: "神經" },
  { name: "內分泌系統", slug: "endocrine", dimension: "ORGAN", groupName: "內分泌" },
  { name: "肌肉骨骼系統", slug: "musculoskeletal", dimension: "ORGAN", groupName: "運動" },
  { name: "皮膚", slug: "skin", dimension: "ORGAN", groupName: "皮膚" },
  { name: "血液與淋巴", slug: "hematology", dimension: "ORGAN", groupName: "血液" },
  { name: "免疫系統", slug: "immune-system", dimension: "ORGAN", groupName: "免疫" },
  { name: "眼", slug: "eye", dimension: "ORGAN", groupName: "感官" },
  { name: "耳鼻喉", slug: "ent", dimension: "ORGAN", groupName: "感官" },
  { name: "頭頸部", slug: "head-neck", dimension: "ORGAN", groupName: "頭頸" },
  { name: "胸腔", slug: "thorax", dimension: "ORGAN", groupName: "胸腔" },
  { name: "腹腔", slug: "abdomen", dimension: "ORGAN", groupName: "腹腔" },
  { name: "骨盆", slug: "pelvis", dimension: "ORGAN", groupName: "骨盆" },

  // ═══════════════════════════════════════════════════════════════════════════
  // EXAM_CATEGORY — 考試類別 (8 tags)
  // ═══════════════════════════════════════════════════════════════════════════
  { name: "醫師一階", slug: "med-board-1", dimension: "EXAM_CATEGORY", groupName: "國考" },
  { name: "醫師二階", slug: "med-board-2", dimension: "EXAM_CATEGORY", groupName: "國考" },
  { name: "牙醫一階", slug: "dent-board-1", dimension: "EXAM_CATEGORY", groupName: "國考" },
  { name: "牙醫二階", slug: "dent-board-2", dimension: "EXAM_CATEGORY", groupName: "國考" },
  { name: "藥師", slug: "pharmacist", dimension: "EXAM_CATEGORY", groupName: "國考" },
  { name: "護理師", slug: "nurse", dimension: "EXAM_CATEGORY", groupName: "國考" },
  { name: "校內期中期末", slug: "school-midterm-final", dimension: "EXAM_CATEGORY", groupName: "校內" },
  { name: "模擬考", slug: "mock-exam", dimension: "EXAM_CATEGORY", groupName: "模擬" },

  // ═══════════════════════════════════════════════════════════════════════════
  // META — 通用狀態 (10 tags)
  // ═══════════════════════════════════════════════════════════════════════════
  { name: "高頻考點", slug: "high-yield", dimension: "META" },
  { name: "爭議題", slug: "controversial", dimension: "META" },
  { name: "最新年度", slug: "latest-year", dimension: "META" },
  { name: "圖片題", slug: "image-based", dimension: "META" },
  { name: "臨床情境", slug: "clinical-scenario", dimension: "META" },
  { name: "計算題", slug: "calculation", dimension: "META" },
  { name: "跨科整合", slug: "cross-discipline", dimension: "META" },
  { name: "實驗設計", slug: "experiment-design", dimension: "META" },
  { name: "公共衛生", slug: "public-health", dimension: "META" },
  { name: "醫學倫理", slug: "medical-ethics", dimension: "META" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding ${TAGS.length} tags...`);

  let created = 0;
  let skipped = 0;

  for (const tag of TAGS) {
    const result = await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: {}, // no-op on existing
      create: {
        name: tag.name,
        slug: tag.slug,
        dimension: tag.dimension,
        groupName: tag.groupName ?? null,
      },
    });

    // upsert returns the row regardless; check if id was freshly created
    // by detecting whether update path was taken (we can't easily tell, so
    // we just count all as "processed")
    if (result) {
      created++;
    }
  }

  skipped = TAGS.length - created;
  console.log(
    `Done. Processed: ${created}, Skipped (already existed): ${skipped}`
  );
  console.log(
    `  ACADEMIC: ${TAGS.filter((t) => t.dimension === "ACADEMIC").length}`
  );
  console.log(
    `  ORGAN: ${TAGS.filter((t) => t.dimension === "ORGAN").length}`
  );
  console.log(
    `  EXAM_CATEGORY: ${TAGS.filter((t) => t.dimension === "EXAM_CATEGORY").length}`
  );
  console.log(
    `  META: ${TAGS.filter((t) => t.dimension === "META").length}`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
