/**
 * invoicing-api.ts — typed reads/writes for the invoicing backend over the
 * thebes SDK. Reads use the backend's flat `*View` query methods so the SDK's
 * flat-record decoder suffices; line items are sent as parallel scalar vecs
 * (which the boundary encodes directly) and zipped on-chain.
 */
import { query, update, encodeArgs, decodeVecRecord, identity } from '@thebes/sdk'
import { INVOICING_CID } from './config'

export interface InvoiceView {
  id: bigint
  issuer: string // principal hex
  recipient: string // principal hex
  taxBps: bigint
  subtotalE8s: bigint
  taxE8s: bigint
  totalE8s: bigint
  status: string // draft | issued | paid | void
  itemCount: bigint
  createdAt: bigint
}

const INVOICE_FIELDS = [
  { name: 'id', type: 'nat' as const },
  { name: 'issuer', type: 'principal' as const },
  { name: 'recipient', type: 'principal' as const },
  { name: 'taxBps', type: 'nat' as const },
  { name: 'subtotalE8s', type: 'nat' as const },
  { name: 'taxE8s', type: 'nat' as const },
  { name: 'totalE8s', type: 'nat' as const },
  { name: 'status', type: 'text' as const },
  { name: 'itemCount', type: 'nat' as const },
  { name: 'createdAt', type: 'int' as const },
]

export function decodeInvoices(replyHex: string): InvoiceView[] {
  return decodeVecRecord(replyHex, INVOICE_FIELDS) as unknown as InvoiceView[]
}

export interface LineItem {
  description: string
  quantity: bigint
  unitPriceE8s: bigint
}

const LINE_ITEM_FIELDS = [
  { name: 'description', type: 'text' as const },
  { name: 'quantity', type: 'nat' as const },
  { name: 'unitPriceE8s', type: 'nat' as const },
]

export function decodeLineItems(replyHex: string): LineItem[] {
  return decodeVecRecord(replyHex, LINE_ITEM_FIELDS) as unknown as LineItem[]
}

/** Query method names used with useQuery. */
export const M = {
  myInvoices: 'myInvoicesView',
  allInvoices: 'allInvoicesView',
  lineItems: 'getLineItems',
} as const

export interface DraftLine {
  description: string
  quantity: number
  unitPriceE8s: bigint
}

// ── Writes ──

/** Create an invoice already issued. Line items go as parallel scalar vecs. */
export async function createIssued(recipientHex: string, lines: DraftLine[], taxBps: number): Promise<void> {
  await update(INVOICING_CID, 'createIssued', encodeArgs([
    { type: 'principal', value: recipientHex },
    { type: 'vec', inner: { type: 'text' }, value: lines.map((l) => l.description) },
    { type: 'vec', inner: { type: 'nat' }, value: lines.map((l) => BigInt(l.quantity)) },
    { type: 'vec', inner: { type: 'nat' }, value: lines.map((l) => l.unitPriceE8s) },
    { type: 'nat', value: BigInt(taxBps) },
  ]))
}

export async function issue(id: bigint): Promise<void> {
  await update(INVOICING_CID, 'issueOrTrap', encodeArgs([{ type: 'nat', value: id }]))
}
export async function pay(id: bigint): Promise<void> {
  await update(INVOICING_CID, 'payOrTrap', encodeArgs([{ type: 'nat', value: id }]))
}
export async function voidInvoice(id: bigint): Promise<void> {
  await update(INVOICING_CID, 'voidOrTrap', encodeArgs([{ type: 'nat', value: id }]))
}
export async function seedDemo(): Promise<void> {
  await update(INVOICING_CID, 'seedDemo')
}

export { query, identity, INVOICING_CID }
