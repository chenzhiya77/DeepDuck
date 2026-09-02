/**
 * 知识面板时间格式化（2026-09-02，方案 Task 2）：绝对（现有）+ 相对（新增）。
 * 相对时间用 Intl.RelativeTimeFormat；测试注入固定 now + 明确时间差，断言单位
 * 关键字（不精确匹配数字格式，规避 ICU 版本差异），"刚刚/just now" 为硬编码精确断言。
 */
import { describe, expect, test } from "@rstest/core";

import {
  formatKnowledgeRelativeTime,
  formatKnowledgeTimestamp,
} from "@/core/knowledge/format";

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0); // 2026-09-02T12:00:00Z
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function iso(msBeforeNow: number): string {
  return new Date(NOW - msBeforeNow).toISOString();
}

describe("formatKnowledgeTimestamp（绝对，现有）", () => {
  test("渲染年-月-日 时:分（zh-CN）", () => {
    const out = formatKnowledgeTimestamp("2026-09-02T12:00:00Z", "zh-CN");
    expect(out).toContain("2026");
    expect(out).toContain("09");
    expect(out).toContain("02");
  });

  test("不可解析值原样返回", () => {
    expect(formatKnowledgeTimestamp("not-a-date", "zh-CN")).toBe("not-a-date");
  });
});

describe("formatKnowledgeRelativeTime（相对，新增）", () => {
  test("<1 分钟：刚刚 / just now（硬编码，不走 Intl）", () => {
    expect(formatKnowledgeRelativeTime(iso(30_000), "zh-CN", NOW)).toBe("刚刚");
    expect(formatKnowledgeRelativeTime(iso(30_000), "en-US", NOW)).toBe(
      "just now",
    );
  });

  test("分钟档", () => {
    expect(formatKnowledgeRelativeTime(iso(5 * MIN), "zh-CN", NOW)).toContain(
      "分钟",
    );
    expect(formatKnowledgeRelativeTime(iso(5 * MIN), "en-US", NOW)).toContain(
      "minute",
    );
  });

  test("小时档", () => {
    expect(formatKnowledgeRelativeTime(iso(3 * HOUR), "zh-CN", NOW)).toContain(
      "小时",
    );
    expect(formatKnowledgeRelativeTime(iso(3 * HOUR), "en-US", NOW)).toContain(
      "hour",
    );
  });

  test("天档", () => {
    expect(formatKnowledgeRelativeTime(iso(3 * DAY), "zh-CN", NOW)).toContain(
      "天",
    );
    expect(formatKnowledgeRelativeTime(iso(3 * DAY), "en-US", NOW)).toContain(
      "day",
    );
  });

  test("月档", () => {
    expect(formatKnowledgeRelativeTime(iso(90 * DAY), "zh-CN", NOW)).toContain(
      "个月",
    );
    expect(formatKnowledgeRelativeTime(iso(90 * DAY), "en-US", NOW)).toContain(
      "month",
    );
  });

  test("年档", () => {
    expect(formatKnowledgeRelativeTime(iso(800 * DAY), "zh-CN", NOW)).toContain(
      "年",
    );
    expect(formatKnowledgeRelativeTime(iso(800 * DAY), "en-US", NOW)).toContain(
      "year",
    );
  });

  test("未来时间也正确（N 分钟后）", () => {
    expect(
      formatKnowledgeRelativeTime(
        new Date(NOW + 5 * MIN).toISOString(),
        "zh-CN",
        NOW,
      ),
    ).toContain("分钟");
  });

  test("不可解析值原样返回", () => {
    expect(formatKnowledgeRelativeTime("not-a-date", "zh-CN", NOW)).toBe(
      "not-a-date",
    );
  });
});
