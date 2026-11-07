const TAU = Math.PI * 2;

export function radiusToFrequency(
  radius: number,
  maxRadius: number,
  minHz = 45,
  maxHz = 14_400,
): number {
  const t = Math.min(1, Math.max(0, radius / maxRadius));
  return minHz * Math.pow(maxHz / minHz, t);
}

export function phaseToAzimuth(phaseRadians: number): number {
  const wrapped = ((phaseRadians % TAU) + TAU) % TAU;
  return wrapped;
}

export function polarToGrid(radius: number, azimuth: number) {
  return {
    x: radius * Math.cos(azimuth),
    z: radius * Math.sin(azimuth),
  };
}
