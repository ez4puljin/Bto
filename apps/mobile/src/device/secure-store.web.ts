// The web copy of the app (`pnpm mobile:web`, for looking at the screens on a computer): expo-secure-store
// has nothing on the web, so the session and the kept login live in the browser's sessionStorage —
// gone when the tab closes, never written to disk as a phone's would be.

export function getItemAsync(key: string): Promise<string | null> {
  return Promise.resolve(sessionStorage.getItem(key));
}

export function setItemAsync(key: string, value: string): Promise<void> {
  sessionStorage.setItem(key, value);
  return Promise.resolve();
}

export function deleteItemAsync(key: string): Promise<void> {
  sessionStorage.removeItem(key);
  return Promise.resolve();
}
