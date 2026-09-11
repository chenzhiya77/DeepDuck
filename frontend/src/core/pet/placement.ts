export interface PetOffset {
  /** 盒子右缘到容器右缘的距离 */
  right: number;
  /** 盒子顶边到容器顶边的距离 */
  top: number;
}

export interface PetBox {
  /** 盒子边长(CSS px) */
  size: number;
}

export interface PetViewport {
  width: number;
  height: number;
}

/** 缩放范围(spec §10.2):64–512 CSS px,恒取偶数 */
export const PET_DISPLAY_SIZE_MIN = 64;
/**
 * 上界 512 = **帧的像素数**,是在 1:1 临界点之上刻意留 1.5× 插值余量的封顶值(用户裁定)。
 * 整帧 1:1 的最后一个偶数点是 `512 ÷ 用户屏 DPR 1.5 ≈ 341`,340 及以下不插值、341 以上开始
 * 放大;512 时整帧 1.5×。它不是清晰度上限(那是下面那个),也不是 1:1 点。
 */
export const PET_DISPLAY_SIZE_MAX = 512;
/**
 * **完全不插值**的最后一个偶数盒子 = `帧像素 512 ÷ 用户屏 DPR 1.5 ≈ 341` ⇒ 340。
 * 341 以上整帧开始被放大(到上界 512 是 1.5×)。**注意这条与 DPR 有关**:DPR 2 的屏 ⇒ 256。
 */
export const PET_DISPLAY_SIZE_SHARP_MAX = 340;
/** 与 manifest 的默认值一致(= §8 的帧内占比补偿值) */
export const PET_DISPLAY_SIZE_DEFAULT = 158;

/** 恒为偶数 CSS px:盒宽在设备像素上对齐,否则右缘会露出邻帧的亚像素鬼影(spec §10) */
export function evenBoxSize(displaySize: number): number {
  return 2 * Math.round(displaySize / 2);
}

/**
 * 存量设置与用户输入都从这里收口:非有限数回落默认,越界收进 64–512,最后取偶。
 * 放在纯函数里而不是控件里 —— 换控件、手改 localStorage、旧版本存量值都绕不过它。
 */
export function normalizeDisplaySize(value: unknown): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : PET_DISPLAY_SIZE_DEFAULT;
  return evenBoxSize(
    Math.min(Math.max(raw, PET_DISPLAY_SIZE_MIN), PET_DISPLAY_SIZE_MAX),
  );
}

/** 吸附点:滑杆落在 338(不插值上限的前一步)时吸到 340,让用户能精确落在边界上 */
export const PET_DISPLAY_SIZE_SNAP_FROM = 338;

/**
 * 松手时提交的值:先收口(取偶 / 越界 / 非法),再把 `338` 吸到不插值上限 340。
 *
 * 控件只在 `pointerup` / `keyup` / `blur` 时调它 —— 拖动中改盒子尺寸会重排并重置
 * `background-position` 的百分比基准,动画会抖(spec §9.1 / §10.2)。
 */
export function commitDisplaySize(value: unknown): number {
  const size = normalizeDisplaySize(value);
  return size === PET_DISPLAY_SIZE_SNAP_FROM
    ? PET_DISPLAY_SIZE_SHARP_MAX
    : size;
}

function clampAxis(value: number, max: number): number {
  // 容器比盒子还小时(max <= 0)钉在 0,不产生负偏移
  if (max <= 0) return 0;
  return Math.min(Math.max(value, 0), max);
}

/**
 * 把摆放偏移 clamp 到面板可见区:盒子必须整只留在容器内(spec §10.1)。
 *
 * 这是**渲染时的纯计算,不回写设置** —— sidecar 拖窄或窗口 resize 之后,
 * 盒子临时被挤回可见区;面板恢复宽度时它回到用户摆的位置,而不是被永久
 * 挪走。与 480px 容器隐藏、缩放正交。
 */
export function clampOffset(
  offset: PetOffset,
  box: PetBox,
  viewport: PetViewport,
): PetOffset {
  return {
    right: clampAxis(offset.right, viewport.width - box.size),
    top: clampAxis(offset.top, viewport.height - box.size),
  };
}
