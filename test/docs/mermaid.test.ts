// @vitest-environment jsdom

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import mermaid from "mermaid";
import { describe, expect, it } from "vitest";

const EXCLUDED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);
const MERMAID_BLOCK = /```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/g;

describe("Mermaid documentation", () => {
  it("parses every Mermaid block in the repository", async () => {
    const failures: string[] = [];
    let diagramCount = 0;

    for (const file of await findMarkdownFiles(process.cwd())) {
      const markdown = await readFile(file, "utf8");
      for (const match of markdown.matchAll(MERMAID_BLOCK)) {
        diagramCount += 1;
        const diagram = match[1];
        if (diagram === undefined) continue;

        try {
          await mermaid.parse(diagram);
        } catch (error) {
          const line = markdown.slice(0, match.index).split(/\r?\n/).length;
          failures.push(
            `${path.relative(process.cwd(), file)}:${line}: ${String(error)}`,
          );
        }
      }
    }

    expect(diagramCount).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...(await findMarkdownFiles(path.join(directory, entry.name))));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files.sort();
}
