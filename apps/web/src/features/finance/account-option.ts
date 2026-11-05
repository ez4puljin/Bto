/** An account as a typed choice shows it, found by its code too (ADR-0152). */
export const accountOption = (account: { id: number; code: string; name: string }) => ({
  value: String(account.id),
  label: `${account.code} · ${account.name}`,
  keys: [account.code],
});
