/**
 * rehype-citation-marks (phase-2 batch-1, P2): splits ``[n]`` markers inside
 * hast text nodes into ``<sup data-citation-index="n">n</sup>`` elements so
 * the markdown renderer can swap them for superscript citation marks. Text
 * inside code/pre subtrees is never touched (a ``[1]`` in a code block is
 * not a citation). Applied only after streaming ends (the chat panel gates
 * the plugin on ``isLoading``) so a half-typed ``[`` never flickers.
 *
 * Hand-rolled recursive walk — no unist-util-visit dependency.
 */

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** 1–2 digits only: citation numbers never reach three digits, and the bound keeps array-index text like [100] literal. */
const CITATION_PATTERN = /\[(\d{1,2})\]/g;

const SKIP_TAGS = new Set(["code", "pre"]);

function splitText(value: string): HastNode[] {
  CITATION_PATTERN.lastIndex = 0;
  const out: HastNode[] = [];
  let cursor = 0;
  for (let match = CITATION_PATTERN.exec(value); match !== null; match = CITATION_PATTERN.exec(value)) {
    const index = Number(match[1]);
    if (match.index > cursor) {
      out.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    out.push({
      type: "element",
      tagName: "sup",
      properties: { dataCitationIndex: index },
      children: [{ type: "text", value: String(index) }],
    });
    cursor = match.index + match[0].length;
  }
  if (out.length === 0) {
    return [{ type: "text", value }];
  }
  if (cursor < value.length) {
    out.push({ type: "text", value: value.slice(cursor) });
  }
  return out;
}

function walk(node: HastNode): void {
  if (!node.children || SKIP_TAGS.has(node.tagName ?? "")) {
    return;
  }
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...splitText(child.value));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** Rehype plugin: rewrite ``[n]`` text into sup elements carrying the citation index. */
export function rehypeCitationMarks() {
  return (tree: HastNode) => {
    walk(tree);
  };
}
