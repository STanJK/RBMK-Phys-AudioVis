export const CORE_RADIUS = 15;
export const ROD_SPACING = 1.02;
export const ROD_LENGTH = 5.8;
export const ROD_WIDTH = 0.72;
export const CORE_TOP_Y = 0;
export const MAX_GUIDED_PROTRUSION = ROD_LENGTH - 0.35;
export const CONTAINMENT_WALL_HEIGHT = ROD_LENGTH * 2;
export const CONTAINMENT_WALL_RADIUS = 16.2;
export const HEIGHT_LIMIT_Y = CORE_TOP_Y + ROD_LENGTH * 5;
export const RANDOM_EJECTION_INTERVAL_SECONDS = 3;
export const RANDOM_EJECTION_HEAT_SECONDS = 3;
export const RANDOM_EJECTION_COOL_DELAY_SECONDS = 15;
export const RANDOM_EJECTION_COOL_DURATION_SECONDS = 5;
export const RANDOM_EJECTION_RECOVERY_COOL_SECONDS = 5;
export const RANDOM_EJECTION_RESPONSE_MIN = 0.4;
export const RANDOM_EJECTION_RESPONSE_MAX = 0.7;
export const RANDOM_EJECTION_UPWARD_MULTIPLIER = 10;
export const AZ5_RED_HOLD_SECONDS = 0.75;
export const AZ5_LAUNCH_SPEED = 24;

export interface RodSpec {
  channel: number;
  gridX: number;
  gridZ: number;
  radius: number;
  x: number;
  z: number;
}

export function createRodLayout(): RodSpec[] {
  const rods: RodSpec[] = [];

  for (let gridX = -CORE_RADIUS; gridX <= CORE_RADIUS; gridX += 1) {
    for (let gridZ = -CORE_RADIUS; gridZ <= CORE_RADIUS; gridZ += 1) {
      const radius = Math.hypot(gridX, gridZ);
      if (radius > CORE_RADIUS) continue;

      rods.push({
        channel: rods.length + 1,
        gridX,
        gridZ,
        radius,
        x: gridX * ROD_SPACING,
        z: gridZ * ROD_SPACING,
      });
    }
  }

  return rods;
}

export const ROD_LAYOUT = createRodLayout();
