/** 极简 YAML frontmatter 读写:仅支持扁平 key: value,值不允许换行。 */

export type FrontmatterData = Record<string, string | number>;

export function serializeFrontmatter(data: FrontmatterData): string {
  const lines = Object.entries(data).map(([k, v]) => {
    const value = String(v);
    if (value.includes("\n") || k.includes(":")) {
      throw new Error(`frontmatter 不支持换行值或冒号键: ${k}`);
    }
    return `${k}: ${value}`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

export function parseFrontmatter(content: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      body: content,
      data: {},
    };
  }
  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return {
    data,
    body: content.slice(match[0].length),
  };
}
