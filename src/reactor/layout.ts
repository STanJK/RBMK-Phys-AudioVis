export const CORE_RADIUS = 15;
export const ROD_SPACING = 1.02;
export const ROD_LENGTH = 5.8;
export const ROD_WIDTH = 0.72;
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
