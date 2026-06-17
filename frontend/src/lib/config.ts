/**
 * Contract id. Overridable at deploy time via a window global (the deploy step
 * injects the assigned id); otherwise falls back to the configured value so one
 * build serves any deployment.
 */
declare global {
  interface Window { INVOICING_CID?: number }
}

export const INVOICING_CID: number =
  (typeof window !== 'undefined' && window.INVOICING_CID) || 0

/** e8s (8 decimals) → display string, e.g. 440000000n → "4.40". */
export function formatE8s(e8s: bigint | number): string {
  const v = typeof e8s === 'bigint' ? e8s : BigInt(Math.trunc(e8s))
  const whole = v / 100_000_000n
  const frac = (v % 100_000_000n).toString().padStart(8, '0').slice(0, 2)
  return `${whole.toString()}.${frac}`
}
