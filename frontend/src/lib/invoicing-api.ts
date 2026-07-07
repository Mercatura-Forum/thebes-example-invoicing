/**
 * invoicing-api.ts — typed reads/writes for the Folio settlement backend.
 * Reads use flat `*View` methods; line items travel as parallel scalar vecs
 * and are zipped + totalled on-chain (a client can never supply a total).
 */
import { query, update, encodeArg, encodeArgs, decodeVecRecord, decodeNat, identity } from '@thebes/sdk'
import { INVOICING_CID } from './config'
import { calibrate } from './chainTime'

export interface InvoiceView {
  id: bigint
  issuer: string
  recipient: string
  taxBps: bigint
  subtotalE8s: bigint
  taxE8s: bigint
  totalE8s: bigint
  paidE8s: bigint
  status: string
  itemCount: bigint
  createdAt: bigint
  dueNs: bigint // 0 = none
  mineAsIssuer: bigint // 1 = the caller issued it
  nowNs: bigint
}
export interface LineItem { description: string; quantity: bigint; unitPriceE8s: bigint }
export interface TrailEvent { at: bigint; by: string; event: string; amountE8s: bigint }
export interface AgingRow { bucket: string; outstandingE8s: bigint; invoices: bigint }
export interface SealRow {
  invoices: bigint; billedE8s: bigint; collectedE8s: bigint; outstandingE8s: bigint
  violations: bigint; checkedAt: bigint
}
export interface ViolationRow { rule: string; detail: string }

type F = { name: string; type: 'nat' | 'int' | 'bool' | 'text' | 'principal' }
const nat = (name: string): F => ({ name, type: 'nat' })
const int = (name: string): F => ({ name, type: 'int' })
const text = (name: string): F => ({ name, type: 'text' })
const principal = (name: string): F => ({ name, type: 'principal' })

const INVOICE_FIELDS: F[] = [
  nat('id'), principal('issuer'), principal('recipient'), nat('taxBps'),
  nat('subtotalE8s'), nat('taxE8s'), nat('totalE8s'), nat('paidE8s'),
  text('status'), nat('itemCount'), int('createdAt'), int('dueNs'), nat('mineAsIssuer'), int('nowNs'),
]
const ITEM_FIELDS: F[] = [text('description'), nat('quantity'), nat('unitPriceE8s')]
const TRAIL_FIELDS: F[] = [int('at'), principal('by'), text('event'), nat('amountE8s')]
const AGING_FIELDS: F[] = [text('bucket'), nat('outstandingE8s'), nat('invoices')]
const SEAL_FIELDS: F[] = [
  nat('invoices'), nat('billedE8s'), nat('collectedE8s'), nat('outstandingE8s'),
  nat('violations'), int('checkedAt'),
]
const VIOLATION_FIELDS: F[] = [text('rule'), text('detail')]

export const decodeInvoices = (h: string) => {
  const rows = decodeVecRecord(h, INVOICE_FIELDS) as unknown as InvoiceView[]
  if (rows.length > 0) calibrate(rows[0].nowNs)
  return rows
}
export const decodeItems = (h: string) => decodeVecRecord(h, ITEM_FIELDS) as unknown as LineItem[]
export const decodeTrail = (h: string) => decodeVecRecord(h, TRAIL_FIELDS) as unknown as TrailEvent[]
export const decodeAging = (h: string) => decodeVecRecord(h, AGING_FIELDS) as unknown as AgingRow[]
export const decodeSeal = (h: string) => {
  const rows = decodeVecRecord(h, SEAL_FIELDS) as unknown as SealRow[]
  if (rows.length > 0) calibrate(rows[0].checkedAt)
  return rows[0]
}
export const decodeViolations = (h: string) => decodeVecRecord(h, VIOLATION_FIELDS) as unknown as ViolationRow[]

export const M = {
  myInvoices: 'myInvoicesView',
  items: 'getLineItems',
  trail: 'invoiceTrailView',
  aging: 'agingView',
  seal: 'invoicingSealView',
  invariants: 'invariantReportView',
} as const

export const idArg = (id: bigint) => encodeArg({ type: 'nat', value: id })

// ── Writes ──

/** Create a draft billed to `recipient` (56-hex principal). Totals are computed on-chain. */
export async function createInvoice(
  recipientHex: string, descriptions: string[], quantities: bigint[], unitPrices: bigint[], taxBps: number,
): Promise<void> {
  await update(INVOICING_CID, 'createInvoice', encodeArgs([
    { type: 'principal', value: recipientHex },
    { type: 'vec', inner: { type: 'text' }, value: descriptions },
    { type: 'vec', inner: { type: 'nat' }, value: quantities },
    { type: 'vec', inner: { type: 'nat' }, value: unitPrices },
    { type: 'nat', value: BigInt(taxBps) },
  ]))
}

/** Issue a draft with a due date (chain ns) — it becomes collectible. */
export async function issueInvoice(id: bigint, dueNs: bigint): Promise<void> {
  await update(INVOICING_CID, 'issueOrTrap', encodeArgs([{ type: 'nat', value: id }, { type: 'int', value: dueNs }]))
}

/** Record a (possibly partial) payment → returns paid-so-far; throws on overpay etc. */
export async function recordPayment(id: bigint, amountE8s: bigint, note: string): Promise<bigint> {
  const r = await update(INVOICING_CID, 'recordPaymentOrTrap', encodeArgs([
    { type: 'nat', value: id }, { type: 'nat', value: amountE8s }, { type: 'text', value: note },
  ]))
  return decodeNat(r.reply_hex ?? r.reply ?? '')
}

/** Void an unpaid, uncollected invoice. */
export async function voidInvoice(id: bigint): Promise<void> {
  await update(INVOICING_CID, 'voidOrTrap', encodeArg({ type: 'nat', value: id }))
}

export async function seedDemo(): Promise<void> {
  await update(INVOICING_CID, 'seedDemo')
}

/** One-shot chain-clock calibration (the seal carries checkedAt). */
export async function calibrateChainClock(): Promise<void> {
  const r = await query(INVOICING_CID, M.seal)
  decodeSeal(r.reply_hex ?? r.reply ?? '')
}

export { query, identity, INVOICING_CID }
