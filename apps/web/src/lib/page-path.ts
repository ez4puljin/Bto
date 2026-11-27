/** Menu pages consolidated into a single entry keep existing browser stars and recents. */
export const canonicalMenuPath = (path: string) =>
  path === '/pricing/profiles' ? '/pricing/settings' : path;
