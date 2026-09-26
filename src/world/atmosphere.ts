import { Color, Vector3 } from 'three';

/**
 * Shared per-frame uniforms for sky, water, grass and clouds. Sky.tsx writes these once per frame
 * (from sim time and weather); materials reference the same objects, so they update together.
 */
export const ATMOS = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new Color('#fff1d6') },
  uZenith: { value: new Color('#4f8fd8') },
  uHorizon: { value: new Color('#cfe4f2') },
  /** Wind strength multiplier (calm 0.6 → storm 2.4). */
  uWind: { value: 1 },
  /** 0 = full day, 1 = deep night. */
  uNight: { value: 0 },
  /** 0 = clear, 1 = heavy overcast. */
  uOvercast: { value: 0 },
};
