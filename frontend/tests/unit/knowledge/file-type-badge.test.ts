/**
 * Suffix → icon category, mirrored row-for-row from frame 「01 分类色板与图标」
 * of the Ardot design file (720819382141740). The design is the authority: when
 * a suffix moves between categories there, the expectation here moves with it.
 */
import { describe, expect, it } from "@rstest/core";

import {
  type FileTypeKind,
  fileTypeKind,
} from "@/components/workspace/knowledge/file-type-badge";

const DESIGN_ROWS: [FileTypeKind, string[]][] = [
  ["word", ["doc", "docx", "wps", "pages", "rtf", "txt"]],
  ["sheet", ["xls", "xlsx", "csv", "numbers", "et"]],
  ["ppt", ["ppt", "pptx", "key", "dps"]],
  ["pdf", ["pdf"]],
  ["code", ["md", "markdown", "json", "yaml", "xml", "py", "js", "sql"]],
  ["image", ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"]],
  ["media", ["mp4", "mov", "avi", "mkv", "mp3", "wav"]],
  ["archive", ["zip", "rar", "7z", "tar", "gz"]],
];

describe("fileTypeKind 按设计稿分类表映射后缀", () => {
  for (const [kind, suffixes] of DESIGN_ROWS) {
    it(`${kind}：${suffixes.join(" / ")}`, () => {
      for (const suffix of suffixes) {
        expect(fileTypeKind(`文档.${suffix}`)).toBe(kind);
      }
    });
  }

  it("决策①：Markdown 归「代码与数据」，不与 .docx 共用文档蓝", () => {
    expect(fileTypeKind("笔记.md")).toBe("code");
    expect(fileTypeKind("笔记.md")).not.toBe(fileTypeKind("规范.docx"));
  });

  it("后缀大小写与目录前缀不影响判定", () => {
    expect(fileTypeKind("REPORT.PDF")).toBe("pdf");
    expect(fileTypeKind("季度报告.Docx")).toBe("word");
    expect(fileTypeKind("a/b/c/readme.MARKDOWN")).toBe("code");
  });

  it("未知后缀与无后缀文件名走灰色兜底", () => {
    expect(fileTypeKind("未知.xyz")).toBe("unknown");
    expect(fileTypeKind("LICENSE")).toBe("unknown");
    // 前导点号是 dotfile 的后缀起点，不能当成 .gitignore 的类型信息
    expect(fileTypeKind(".gitignore")).toBe("unknown");
  });
});
