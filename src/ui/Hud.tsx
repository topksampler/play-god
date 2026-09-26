import { timeOfDay } from '../sim/environment';
import { useSim, useWorldThrottled } from '../sim/react';

const TOD = { dawn: '🌅 dawn', day: '☀️ day', dusk: '🌇 dusk', night: '🌙 night' } as const;
const WX = { clear: 'clear', cloudy: '☁️ cloudy', rain: '🌧 rain', storm: '⛈ storm' } as const;

/** On-screen world clock and weather (actual world state). */
export function Hud() {
  const w = useWorldThrottled(500);
  const brainLimit = useSim().getTimeScale();
  return (
    <div className="hud">
      {TOD[timeOfDay(w.time)]} · {WX[w.weather]} · t={w.time.toFixed(0)}s · next weather ~{Math.max(0, w.nextWeatherAt - w.time).toFixed(0)}s
      {brainLimit < 0.98 && <b> · sim slowed to {brainLimit.toFixed(2)}× (fly brains limiting)</b>}
      {w.paused && <b> · PAUSED</b>}
    </div>
  );
}
