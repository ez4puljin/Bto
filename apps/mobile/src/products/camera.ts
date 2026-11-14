/** The long side the server keeps of a photo (ADR-0030), with room to spare for a sharp scale-down. */
const WANTED_LONG_SIDE = 1600;

/**
 * The picture size to ask the camera for: the smallest it offers whose long side reaches 1600 px,
 * so a photo is a few hundred kilobytes instead of the sensor's megabytes; undefined (the camera's
 * own) when it names none that large or none this reads. Sizes come as "1920x1080" on Android.
 */
export function pictureSizeFor(sizes: readonly string[]): string | undefined {
  let best: { name: string; area: number } | undefined;
  for (const name of sizes) {
    const match = /^(\d{2,5})x(\d{2,5})$/.exec(name);
    if (!match) continue;
    const width = Number.parseInt(match[1] ?? '', 10);
    const height = Number.parseInt(match[2] ?? '', 10);
    if (Math.max(width, height) < WANTED_LONG_SIDE) continue;
    const area = width * height;
    if (!best || area < best.area) best = { name, area };
  }
  return best?.name;
}
