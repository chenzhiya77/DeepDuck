/**
 * rehype-citation-marks (phase-2 batch-1, P2): splits ``[n]`` markers inside
 * hast text nodes into ``<sup data-citation-index="n">n</sup>`` elements so
 * the markdown renderer can swap them for superscript citation marks. Text
 * inside code/pre subtrees is never touched (a ``[1]`` in a code block is
 * not a citation). Applied only after streaming ends (the chat panel gates
 * the plugin on ``isLoading``) so a half-typed ``[`` never flickers.
 */
import { describe, expect, test } from "@rstest/core";

import { rehypeCitationMarks } from "@/core/knowledge/rehype-citation-marks";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function paragraph(...children: HastNode[]): HastNode {
  return { type: "element", tagName: "p", children };
}

function text(value: string): HastNode {
  return { type: "text", value };
}

function run(tree: HastNode): HastNode {
  rehypeCitationMarks()(tree);
  return tree;
}

describe("rehypeCitationMarks", () => {
  test("rewrites [n] into a sup carrying data-citation-index", () => {
    const tree = run(paragraph(text("依据文档 [1] 可知")));
    const children = tree.children ?? [];
    expect(children).toHaveLength(3);
    expect(children[0]).toEqual(text("依据文档 "));
    expect(children[1]).toMatchObject({
      type: "element",
      tagName: "sup",
      properties: { dataCitationIndex: 1 },
      children: [text("1")],
    });
    expect(children[2]).toEqual(text(" 可知"));
  });

  test("leaves plain text untouched", () => {
    const tree = run(paragraph(text("没有引用的句子")));
    expect(tree.children).toEqual([text("没有引用的句子")]);
  });

  test("never touches code/pre subtrees", () => {
    const code: HastNode = { type: "element", tagName: "code", children: [text("arr[1] = 0")] };
    const tree = run(paragraph(text("见代码 "), code));
    expect(tree.children?.[1]).toEqual(code);
  });

  test("splits consecutive marks without crashing (一句多标容错)", () => {
    const tree = run(paragraph(text("结论[1][2]。")));
    const children = tree.children ?? [];
    expect(children.filter((node) => node.tagName === "sup")).toHaveLength(2);
    expect(children[1]).toMatchObject({ properties: { dataCitationIndex: 1 } });
    expect(children[2]).toMatchObject({ properties: { dataCitationIndex: 2 } });
  });

  test("ignores three-digit brackets (not a citation)", () => {
    const tree = run(paragraph(text("编号 [123] 不是引用")));
    expect(tree.children).toEqual([text("编号 [123] 不是引用")]);
  });

  test("recurses into nested elements like list items", () => {
    const tree = run({
      type: "element",
      tagName: "ul",
      children: [{ type: "element", tagName: "li", children: [text("条目 [2]")] }],
    });
    const li = tree.children?.[0];
    expect(li?.children?.[1]).toMatchObject({ tagName: "sup", properties: { dataCitationIndex: 2 } });
  });
});
