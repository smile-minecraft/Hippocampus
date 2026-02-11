import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";

// Load env from web/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const connectionString = process.env.DATABASE_URL?.replace("file:", "") || "prisma/dev.db";
const adapter = new PrismaBetterSqlite3({ url: connectionString });
const prisma = new PrismaClient({ adapter });

// Config
const RAW_DIR = path.resolve(__dirname, "../../docs/raw_pdfs");
const PROCESSED_DIR = path.resolve(__dirname, "../../docs/processed_pdfs");

// Setup Gemini
if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY is missing!");
    process.exit(1);
}
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
You are a strictly structured data extraction engine.
Analyze the medical exam PDF.
Extract all multiple-choice questions.

RULES:
1. Output MUST be a valid JSON Array. NO Markdown code blocks.
2. Map "options" to a simple string array.
3. If the answer is marked/circled, record the index (0-3). If not, use -1.
4. Auto-tag the question with 3-5 relevant medical keywords (e.g. "Anatomy", "Cranial Nerves").

JSON Structure:
[
  {
    "content": "Question text...",
    "options": ["(A)...", "(B)...", "(C)...", "(D)..."],
    "answerIndex": 0,
    "explanation": "Explanation text or empty string",
    "difficulty": 3,
    "tags": ["Tag1", "Tag2"]
  }
]
`;

async function main() {
    // Ensure dirs exist
    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
    if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

    const files = fs.readdirSync(RAW_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
    console.log(`📂 Found ${files.length} PDFs to process.`);

    for (const file of files) {
        console.log(`\n🚀 Processing: ${file}`);
        const filePath = path.join(RAW_DIR, file);

        try {
            // 1. Upload
            const uploadResult = await fileManager.uploadFile(filePath, {
                mimeType: "application/pdf",
                displayName: file,
            });

            let fileState = await fileManager.getFile(uploadResult.file.name);
            while (fileState.state === "PROCESSING") {
                process.stdout.write(".");
                await new Promise(r => setTimeout(r, 2000));
                fileState = await fileManager.getFile(uploadResult.file.name);
            }

            // 2. Generate
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                { fileData: { mimeType: uploadResult.file.mimeType, fileUri: uploadResult.file.uri } },
                { text: SYSTEM_PROMPT },
            ]);

            const rawText = result.response.text();
            // Cleanup markdown if AI ignores instructions
            const jsonText = rawText.replace(/```json|```/g, "").trim();
            const questions = JSON.parse(jsonText);

            console.log(`   ✅ Extracted ${questions.length} questions. Inserting into DB...`);

            // 3. Insert with Relations
            for (const q of questions) {
                await prisma.question.create({
                    data: {
                        content: q.content,
                        options: JSON.stringify(q.options), // Store array as JSON string
                        answerIndex: q.answerIndex,
                        explanation: q.explanation || "",
                        difficulty: q.difficulty || 1,
                        tags: {
                            connectOrCreate: q.tags.map((tag: string) => ({
                                where: { slug: tag.toLowerCase().replace(/\s+/g, "-") },
                                create: {
                                    name: tag,
                                    slug: tag.toLowerCase().replace(/\s+/g, "-"),
                                    category: "AI_GENERATED"
                                }
                            }))
                        }
                    }
                });
            }

            // 4. Move to processed
            fs.renameSync(filePath, path.join(PROCESSED_DIR, file));
            console.log(`   🎉 Done! Moved ${file} to processed folder.`);

        } catch (e) {
            console.error(`   ❌ Error processing ${file}:`, e);
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
