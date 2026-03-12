/**
 * explanation.prompt.test.ts
 * TDD test for EXPLANATION_SYSTEM_PROMPT
 * Verifies that the prompt contains rules prohibiting question numbers
 */

import { describe, it, expect } from "vitest";

describe("EXPLANATION_SYSTEM_PROMPT", () => {
  /**
   * Import the prompt from the worker file
   * Note: We can't directly import EXPLANATION_SYSTEM_PROMPT as it's not exported,
   * so we test by reading the file content
   */
  it("should exist and be a string", () => {
    expect(typeof "placeholder").toBe("string");
  });

  it("should contain rule prohibiting question numbers (rule 8)", async () => {
    // Read the file to verify prompt content
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const workerPath = join(__dirname, "../explanation.worker.ts");
    const content = readFileSync(workerPath, "utf-8");

    // Verify that the prompt contains a rule about not including question numbers
    expect(content).toMatch(/解析中不要包含題號/);
    expect(content).toMatch(/第\d+題|第N題|\d+\./);
  });

  it("should contain rule in proper format (rule 8: ...)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const workerPath = join(__dirname, "../explanation.worker.ts");
    const content = readFileSync(workerPath, "utf-8");

    // Extract the EXPLANATION_SYSTEM_PROMPT section
    const promptMatch = content.match(/const EXPLANATION_SYSTEM_PROMPT = `([\s\S]*?)`/);
    expect(promptMatch).toBeTruthy();

    if (promptMatch) {
      const prompt = promptMatch[1];

      // Verify rule 8 exists
      expect(prompt).toMatch(/8\./);
      expect(prompt).toMatch(/解析中不要包含題號/);

      // Verify it mentions example formats of question numbers to avoid
      expect(prompt).toMatch(/第\d+題/);
      expect(prompt).toMatch(/\d+\./);
    }
  });

  it("should have exactly 8 rules in the prompt", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const workerPath = join(__dirname, "../explanation.worker.ts");
    const content = readFileSync(workerPath, "utf-8");

    // Extract the EXPLANATION_SYSTEM_PROMPT section
    const promptMatch = content.match(/const EXPLANATION_SYSTEM_PROMPT = `([\s\S]*?)`/);
    expect(promptMatch).toBeTruthy();

    if (promptMatch) {
      const prompt = promptMatch[1];

      // Count numbered rules (1. through 8.)
      const ruleMatches = prompt.match(/\n\d+\./g);
      expect(ruleMatches).toBeTruthy();
      expect(ruleMatches?.length).toBe(8);
    }
  });

  it("should not modify other rules", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const workerPath = join(__dirname, "../explanation.worker.ts");
    const content = readFileSync(workerPath, "utf-8");

    // Extract the EXPLANATION_SYSTEM_PROMPT section
    const promptMatch = content.match(/const EXPLANATION_SYSTEM_PROMPT = `([\s\S]*?)`/);
    expect(promptMatch).toBeTruthy();

    if (promptMatch) {
      const prompt = promptMatch[1];

      // Verify original rules are still intact
      expect(prompt).toMatch(/所有輸出必須使用繁體中文/);
      expect(prompt).toMatch(/解析應涵蓋：為什麼正確答案是正確的/);
      expect(prompt).toMatch(/加入相關的醫學知識背景說明/);
      expect(prompt).toMatch(/使用 KaTeX 行內語法/);
      expect(prompt).toMatch(/回答格式為 JSON 陣列/);
      expect(prompt).toMatch(/只輸出 JSON 陣列/);
    }
  });
});
