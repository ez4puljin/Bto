// The rules of an app's own update (ADR-0166), without the phone: the rest is in use-app-update.ts.

export interface AppRelease {
  version: string;
  versionCode: number;
  sizeBytes: number;
}

/** The release when it is newer than this build, else null. An unknown build offers nothing. */
export function updateOf(
  release: AppRelease | null | undefined,
  installedCode: number | null | undefined,
): AppRelease | null {
  if (!release || !installedCode) return null;
  return release.versionCode > installedCode ? release : null;
}

/** «75» for a size in bytes: whole megabytes, at least one. */
export function megabytesOf(sizeBytes: number): number {
  return Math.max(1, Math.round(sizeBytes / (1024 * 1024)));
}

/** How far a download is, 0–100; an unknown total counts as nothing yet. */
export function percentOf(written: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((written / total) * 100)));
}

/** The server's address of an app's APK. */
export function apkUrlOf(server: string, variant: string): string {
  return `${server}/api/v1/app-releases/${variant}/apk`;
}

/** What a press of «Шинэчлэл шалгах» found (ADR-0174 #10). */
export type CheckOutcome = 'found' | 'latest' | 'offline';

/**
 * The answer to a check: a newer release is downloaded at once, the same or an older one means
 * this is the newest, and a server that did not answer is said so (the phone is off its Wi-Fi).
 */
export function checkOutcomeOf(
  answered: boolean,
  release: AppRelease | null | undefined,
  installedCode: number | null | undefined,
): CheckOutcome {
  if (!answered) return 'offline';
  return updateOf(release, installedCode) ? 'found' : 'latest';
}
