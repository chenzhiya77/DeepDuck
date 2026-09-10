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
