import { useState } from 'react'
import { MemphisGate, SignOutChip, useQuery, identity } from '@thebes/sdk'
import { INVOICING_CID, formatE8s } from './lib/config'
import * as api from './lib/invoicing-api'

export function App() {
  return (
    <MemphisGate appName="Ledger" tagline="On-chain invoicing, built on Thebes">
      <Dashboard />
    </MemphisGate>
  )
}

function shortP(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    draft: 'bg-stone-100 text-stone-600',
    issued: 'bg-teal-50 text-teal-700',
    paid: 'bg-emerald-50 text-emerald-700',
    void: 'bg-red-50 text-red-700',
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[status] ?? 'bg-stone-100 text-stone-600'}`}>
      {status}
    </span>
  )
}

function Dashboard() {
  const me = identity()
  const {
    data: invoices,
    loading,
    error,
    refetch,
  } = useQuery<api.InvoiceView[]>(INVOICING_CID, api.M.myInvoices, undefined, api.decodeInvoices, [])

  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    setActionError(null)
    try {
      await fn()
      refetch()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Ledger</h1>
            <p className="text-xs text-[var(--color-ink-soft)]">on-chain invoicing · contract {INVOICING_CID || '—'}</p>
          </div>
          <SignOutChip />
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[380px_1fr]">
        <CreatePanel me={me} busy={busy === 'create'} onCreate={(r, lines, tax) => run('create', () => api.createIssued(r, lines, tax))} />

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">Your invoices</h2>
            <button
              className="text-xs font-medium text-[var(--color-teal-ink)] hover:underline disabled:opacity-50"
              disabled={busy === 'seed'}
              onClick={() => run('seed', api.seedDemo)}
            >
              {busy === 'seed' ? 'seeding…' : 'Seed demo'}
            </button>
          </div>

          {actionError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
          )}

          {loading && <p className="text-sm text-[var(--color-ink-soft)]">Loading…</p>}
          {error && <p className="text-sm text-red-700">Could not load invoices: {error}</p>}
          {!loading && !error && invoices && invoices.length === 0 && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-10 text-center text-sm text-[var(--color-ink-soft)]">
              No invoices yet. Create one on the left, or seed a demo.
            </div>
          )}

          <div className="space-y-3">
            {invoices?.map((inv) => (
              <article key={inv.id.toString()} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Invoice #{inv.id.toString()}</span>
                      <StatusBadge status={inv.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">
                      to {shortP(inv.recipient)} · {inv.itemCount.toString()} item{inv.itemCount === 1n ? '' : 's'} · {(Number(inv.taxBps) / 100).toString()}% tax
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-[var(--color-amount)]">{formatE8s(inv.totalE8s)}</div>
                    <div className="text-[11px] text-[var(--color-ink-soft)]">subtotal {formatE8s(inv.subtotalE8s)} + tax {formatE8s(inv.taxE8s)}</div>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  {inv.status === 'draft' && (
                    <ActionBtn label="Issue" busy={busy === `i${inv.id}`} onClick={() => run(`i${inv.id}`, () => api.issue(inv.id))} />
                  )}
                  {inv.status === 'issued' && (
                    <ActionBtn label="Mark paid" busy={busy === `p${inv.id}`} onClick={() => run(`p${inv.id}`, () => api.pay(inv.id))} />
                  )}
                  {(inv.status === 'draft' || inv.status === 'issued') && (
                    <ActionBtn label="Void" tone="danger" busy={busy === `v${inv.id}`} onClick={() => run(`v${inv.id}`, () => api.voidInvoice(inv.id))} />
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function ActionBtn({ label, onClick, busy, tone }: { label: string; onClick: () => void; busy: boolean; tone?: 'danger' }) {
  const base = tone === 'danger' ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-[var(--color-line)] text-[var(--color-teal-ink)] hover:bg-teal-50'
  return (
    <button disabled={busy} onClick={onClick} className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${base}`}>
      {busy ? '…' : label}
    </button>
  )
}

type Row = { description: string; quantity: string; price: string }

function CreatePanel({ me, onCreate, busy }: { me: string; onCreate: (recipient: string, lines: api.DraftLine[], taxBps: number) => void; busy: boolean }) {
  const [recipient, setRecipient] = useState(me)
  const [taxPct, setTaxPct] = useState('10')
  const [rows, setRows] = useState<Row[]>([{ description: '', quantity: '1', price: '' }])

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  const valid = rows.some((r) => r.description.trim() !== '' && Number(r.price) > 0)

  function submit() {
    const lines: api.DraftLine[] = rows
      .filter((r) => r.description.trim() !== '' && Number(r.price) > 0)
      .map((r) => ({
        description: r.description.trim(),
        quantity: Math.max(1, Math.trunc(Number(r.quantity) || 1)),
        unitPriceE8s: BigInt(Math.round(Number(r.price) * 1e8)),
      }))
    const taxBps = Math.max(0, Math.round(Number(taxPct) * 100))
    onCreate(recipient.trim() || me, lines, taxBps)
    setRows([{ description: '', quantity: '1', price: '' }])
  }

  return (
    <section className="self-start rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">New invoice</h2>

      <label className="block text-xs font-medium text-[var(--color-ink-soft)]">Recipient (principal)</label>
      <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="mb-3 mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 font-mono text-xs" />

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_56px_72px] gap-2">
            <input placeholder="Description" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} className="rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-sm" />
            <input placeholder="Qty" inputMode="numeric" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} className="rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-sm" />
            <input placeholder="Price" inputMode="decimal" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} className="rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-sm" />
          </div>
        ))}
      </div>
      <button onClick={() => setRows((rs) => [...rs, { description: '', quantity: '1', price: '' }])} className="mt-2 text-xs font-medium text-[var(--color-teal-ink)] hover:underline">
        + add line
      </button>

      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs font-medium text-[var(--color-ink-soft)]">Tax %</label>
        <input value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" className="w-20 rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-sm" />
      </div>

      <button
        disabled={!valid || busy}
        onClick={submit}
        className="mt-4 w-full rounded-lg bg-[var(--color-teal)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create & issue'}
      </button>
      <p className="mt-2 text-[11px] text-[var(--color-ink-soft)]">Totals are recomputed on-chain from the line items — the price you see is the price the contract stores.</p>
    </section>
  )
}
