/** The two apps of one Expo project (ADR-0006 #1, ADR-0084): the sales rep's and the stores' «Bto300». */
export type AppVariant = 'staff' | 'customer';

export interface AppConfig {
  variant: AppVariant;
  /** The address `pnpm mobile:apk` built in, or null. */
  defaultServer: string | null;
  /** A production build talks only to `defaultServer`: no server screen, no server chip. */
  serverFixed: boolean;
}

/** `app.config.ts`'s `extra`, read defensively: an old or odd build is the staff app. */
export function appConfigOf(extra: unknown): AppConfig {
  const value = (typeof extra === 'object' && extra !== null ? extra : {}) as Record<
    string,
    unknown
  >;
  const defaultServer =
    typeof value.defaultServer === 'string' && value.defaultServer !== ''
      ? value.defaultServer
      : null;
  return {
    variant: value.variant === 'customer' ? 'customer' : 'staff',
    defaultServer,
    serverFixed: value.serverFixed === true && defaultServer !== null,
  };
}
