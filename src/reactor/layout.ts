export const CORE_RADIUS = 15;
export const ROD_SPACING = 1.02;
export const ROD_LENGTH = 5.8;
export const ROD_WIDTH = 0.72;
export const CORE_TOP_Y = 0;
export const MAX_GUIDED_PROTRUSION = ROD_LENGTH - 0.35;
export const CONTAINMENT_WALL_HEIGHT = ROD_LENGTH * 2;
export const CONTAINMENT_WALL_RADIUS = 16.2;
export const RANDOM_EJECTION_INTERVAL_SECONDS = 5;
export const RANDOM_EJECTION_THRESHOLD = 0.3;
export const RANDOM_EJECTION_UPWARD_MULTIPLIER = 10;
export const LAUNCH_CHANNEL = 418;

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
