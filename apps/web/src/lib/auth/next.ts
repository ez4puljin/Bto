/** Where to go after login: only same-site paths, never `//host` or a backslash host (open redirect). */
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}
