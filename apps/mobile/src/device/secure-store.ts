// The phone's secure storage (Android Keystore through expo-secure-store). The web copy of the app,
// opened in a browser to look at the screens (`pnpm mobile:web`), keeps the same values in the
// page's own storage instead: `secure-store.web.ts`.
export { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';
