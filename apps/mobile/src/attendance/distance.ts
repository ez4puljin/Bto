/** «45 м» under a kilometre, «1.2 км» from there (one decimal, «12 км» from ten). */
export function formatDistance(meters: number): string {
  const whole = Math.max(0, Math.round(meters));
  if (whole < 1000) return `${whole} м`;
  const km = whole / 1000;
  return `${km < 10 ? km.toFixed(1) : String(Math.round(km))} км`;
}
