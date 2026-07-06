/**
 * 运动模糊 sigma 计算
 * 参照 WinIsland src/utils/blur.rs 的 calculate_blur_sigmas：
 * - view_px_vel = |vel_view| * current_w（页面位移换算成像素速度）
 * - sigmaX = min(|vel_w| * 0.3 + view_px_vel * 0.4, 12)
 * - sigmaY = min(|vel_h| * 0.3, 10)
 *
 * 速度单位：px / (1/60 秒)，即"每帧像素"——与 spring velocity 一致
 * sigma 上限 12/10 与 WinIsland 保持一致，避免极端发散
 */
export interface MotionBlurSigma {
  /** X 方向模糊 sigma（px） */
  sigmaX: number;
  /** Y 方向模糊 sigma（px） */
  sigmaY: number;
}

export function calculateMotionBlurSigma(
  velW: number,
  velH: number,
  velView: number,
  currentW: number,
): MotionBlurSigma {
  const viewPxVel = Math.abs(velView) * currentW;
  const sigmaX = Math.min(Math.abs(velW) * 0.3 + viewPxVel * 0.4, 12);
  const sigmaY = Math.min(Math.abs(velH) * 0.3, 10);
  return { sigmaX, sigmaY };
}

/** sigma 低于此值视为静止，跳过 filter 设置以节省合成层开销 */
export const MOTION_BLUR_EPSILON = 0.4;
