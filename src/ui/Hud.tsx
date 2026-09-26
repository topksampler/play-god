import { timeOfDay } from '../sim/environment';
import { useWorldThrottled } from '../sim/react';

const TOD = { dawn: '🌅 dawn', day: '☀️ day', dusk: '🌇 dusk', night: '🌙 night' } as const;
const WX = { clear: 'clear', cloudy: '☁️ cloudy', rain: '🌧 rain', storm: '⛈ storm' } as const;

/** On-screen world clock and weather (actual world state). */
export function Hud() {
  const w = useWorldThrottled(500);
  return (
    <div className="hud">
      {TOD[timeOfDay(w.time)]} · {WX[w.weather]} · t={w.time.toFixed(0)}s · next weather ~{Math.max(0, w.nextWeatherAt - w.time).toFixed(0)}s
      {w.paused && <b> · PAUSED</b>}
    </div>
  );
}
