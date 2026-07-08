import { useEffect, useState } from 'react'
import { MemphisGate, SignOutChip, useQuery } from '@thebes/sdk'
import { INVOICING_CID, formatE8s } from './lib/config'
import { wallDate, toChainNs, chainNowNs } from './lib/chainTime'
import * as api from './lib/invoicing-api'

/**
 * Folio — document-first invoicing. The centerpiece is the invoice itself:
 * a print-grade sheet whose totals are computed by the contract, whose
 * settlement is stamped by the chain, and whose trail is immutable. The book
 * view carries the receivables aging shelf; the footer seal re-proves the
 * conservation law (billed = collected + outstanding) on every page.
 */

type View = { name: 'book' } | { name: 'doc'; id: bigint } | { name: 'new' }

export function App() {
  return (
    <MemphisGate appName="Folio" tagline="On-chain invoicing, built on Thebes">
      <Shell />
    </MemphisGate>
  )
}

function themePreference(): boolean {
  const saved = localStorage.getItem('folio-theme')
  if (saved) return saved === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function Shell() {
  const [view, setView] = useState<View>({ name: 'book' })
  const [dark, setDark] = useState(themePreference)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('folio-theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => { api.calibrateChainClock().catch(() => {}) }, [])

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-y-1.5 px-5 py-3">
          <button onClick={() => setView({ name: 'book' })} className="font-doc text-xl font-bold tracking-tight">
            Folio<span className="text-[var(--color-teal)]">.</span>
          </button>
          <nav className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => setView({ name: 'book' })}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view.name === 'book' ? 'bg-[var(--color-teal)]/10 text-[var(--color-teal-ink)]' : 'text-ink-soft hover:text-ink'}`}>
              The book
            </button>
            <button onClick={() => setView({ name: 'new' })}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view.name === 'new' ? 'bg-[var(--color-teal)]/10 text-[var(--color-teal-ink)]' : 'text-ink-soft hover:text-ink'}`}>
              + New invoice
            </button>
            <button
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft ring-1 ring-[var(--color-line)] hover:text-ink"
            >
              {dark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              )}
            </button>
            <SignOutChip className="ml-1 border-l border-[var(--color-line)] pl-3" />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8">
        {view.name === 'book' && <Book open={(id) => setView({ name: 'doc', id })} />}
        {view.name === 'doc' && <Document id={view.id} back={() => setView({ name: 'book' })} />}
        {view.name === 'new' && <Compose done={() => setView({ name: 'book' })} />}
      </main>

      <footer className="mx-auto w-full max-w-4xl px-5 py-8 text-xs text-ink-soft">
        <p>
          Totals are computed by the contract, never the client. Payments accumulate
          and can never overshoot; the exact-settling payment stamps the invoice paid
          in the same atomic step; an invoice that has taken money cannot be voided.
        </p>
        <Seal />
      </footer>
    </div>
  )
}

function Seal() {
  const { data } = useQuery<api.SealRow>(INVOICING_CID, api.M.seal, undefined, api.decodeSeal)
  if (!data) return null
  const ok = Number(data.violations) === 0
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 nums text-[11px]" data-testid="folio-seal">
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {ok ? (
        <span>
          <b className="text-ink">Receivables conserved on-chain</b> · {formatE8s(data.billedE8s)} billed ={' '}
          {formatE8s(data.collectedE8s)} collected + {formatE8s(data.outstandingE8s)} outstanding ·{' '}
          {data.invoices.toString()} invoices · 0 violations
        </span>
      ) : (
        <span className="font-semibold text-red-600">The oracle reports {data.violations.toString()} violation(s).</span>
      )}
    </div>
  )
}

function fmtDate(ns: bigint): string {
  return wallDate(ns).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function num(id: bigint): string {
  return `INV-${(Number(id) + 1).toString().padStart(4, '0')}`
}
function overdueDays(inv: api.InvoiceView): number {
  if (inv.status !== 'issued' || inv.dueNs === 0n) return 0
  const d = Number((chainNowNs() - inv.dueNs) / 86_400_000_000_000n)
  return d > 0 ? d : 0
}

// ── The book ────────────────────────────────────────────────────────────────

function Book({ open }: { open: (id: bigint) => void }) {
  const inv = useQuery<api.InvoiceView[]>(INVOICING_CID, api.M.myInvoices, undefined, api.decodeInvoices)
  const aging = useQuery<api.AgingRow[]>(INVOICING_CID, api.M.aging, undefined, api.decodeAging)
  const [seeding, setSeeding] = useState(false)
  const [err, setErr] = useState<string>()

  async function seed() {
    setSeeding(true); setErr(undefined)
    try { await api.seedDemo(); inv.refetch(); aging.refetch() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setSeeding(false) }
  }

  if (inv.loading) return <p className="text-sm text-ink-soft">Opening the book…</p>
  if (inv.error) return <p className="text-sm text-red-600">{inv.error}</p>
  const rows = inv.data ?? []

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-line)] bg-surface p-10 text-center">
        <p className="font-doc text-xl">The book is empty</p>
        <p className="mt-1 text-sm text-ink-soft">Load a demo book — settled, part-paid, overdue and draft folios — or compose your first invoice.</p>
        <div className="mt-4 flex justify-center gap-3">
          <button className="btn" onClick={seed} disabled={seeding}>{seeding ? 'Opening…' : 'Load the demo book'}</button>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </div>
    )
  }

  const maxOut = Math.max(...(aging.data ?? []).map((a) => Number(a.outstandingE8s)), 1)

  return (
    <div className="space-y-8">
      {/* Aging shelf — receivables by how long they've been waiting. */}
      <section>
        <div className="flex items-baseline justify-between">
          <h1 className="font-doc text-2xl font-bold">Receivables</h1>
          <p className="text-xs text-ink-soft">outstanding, by days overdue</p>
        </div>
        <div className="mt-4 grid grid-cols-4 items-end gap-3" style={{ minHeight: 130 }} data-testid="aging-shelf">
          {(aging.data ?? []).map((a) => {
            const h = Math.max((Number(a.outstandingE8s) / maxOut) * 110, Number(a.invoices) > 0 ? 14 : 3)
            const hot = a.bucket === '31-60' || a.bucket === '60+'
            return (
              <div key={a.bucket} className="flex flex-col items-center gap-1.5">
                <p className="nums text-xs font-semibold">{Number(a.outstandingE8s) > 0 ? formatE8s(a.outstandingE8s) : '—'}</p>
                <div className={`w-full rounded-t-md shelf ${hot ? 'shelf-hot' : ''}`} style={{ height: h }} />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{a.bucket}{a.bucket !== 'current' ? ' days' : ''}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* The folios */}
      <section>
        <h2 className="font-doc text-lg font-bold">Folios</h2>
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const od = overdueDays(r)
            return (
              <li key={r.id.toString()}>
                <button onClick={() => open(r.id)} className="card flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:border-[var(--color-teal)]">
                  <div className="flex items-center gap-3">
                    <span className="font-doc font-bold nums">{num(r.id)}</span>
                    <StatusChip status={od > 0 ? 'overdue' : r.status} days={od} />
                  </div>
                  <div className="text-right">
                    <p className="nums font-semibold text-[var(--color-amount)]">{formatE8s(r.totalE8s)}</p>
                    {r.paidE8s > 0n && r.status === 'issued' && (
                      <p className="text-[11px] text-ink-soft nums">{formatE8s(r.paidE8s)} collected</p>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function StatusChip({ status, days = 0 }: { status: string; days?: number }) {
  const tone: Record<string, string> = {
    draft: 'bg-stone-500/10 text-stone-500 ring-stone-400/40',
    issued: 'bg-teal-500/10 text-[var(--color-teal-ink)] ring-teal-500/40',
    paid: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/40',
    void: 'bg-red-500/10 text-red-500 ring-red-400/40',
    overdue: 'bg-amber-500/15 text-amber-600 ring-amber-500/50',
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${tone[status] ?? tone.draft}`}>
      {status}{status === 'overdue' && days > 0 ? ` ${days}d` : ''}
    </span>
  )
}

// ── The document ────────────────────────────────────────────────────────────

function Document({ id, back }: { id: bigint; back: () => void }) {
  const inv = useQuery<api.InvoiceView[]>(INVOICING_CID, api.M.myInvoices, undefined, api.decodeInvoices)
  const items = useQuery<api.LineItem[]>(INVOICING_CID, api.M.items, api.idArg(id), api.decodeItems, [id.toString()])
  const trail = useQuery<api.TrailEvent[]>(INVOICING_CID, api.M.trail, api.idArg(id), api.decodeTrail, [id.toString()])
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()

  const doc = (inv.data ?? []).find((r) => r.id === id)
  if (inv.loading) return <p className="text-sm text-ink-soft">Fetching the folio…</p>
  if (!doc) return <p className="text-sm text-ink-soft">Folio not found. <button className="underline" onClick={back}>Back</button></p>

  const od = overdueDays(doc)
  const stamp = doc.status === 'paid' ? 'PAID' : doc.status === 'void' ? 'VOID' : od > 0 ? 'OVERDUE' : doc.status === 'draft' ? 'DRAFT' : null
  const remaining = doc.totalE8s - doc.paidE8s

  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true); setErr(undefined)
    try { await fn(); inv.refetch(); trail.refetch() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <button onClick={back} className="text-sm text-[var(--color-teal-ink)] hover:underline">← The book</button>

      {/* The sheet */}
      <section className="sheet relative" data-testid="invoice-sheet">
        {stamp && <span className={`stamp stamp-${stamp.toLowerCase()}`} data-testid="stamp">{stamp}</span>}
        <header className="flex items-start justify-between">
          <div>
            <p className="font-doc text-3xl font-bold nums">{num(doc.id)}</p>
            <p className="mt-1 text-xs text-ink-soft">raised {fmtDate(doc.createdAt)}{doc.dueNs !== 0n && <> · due {fmtDate(doc.dueNs)}</>}</p>
          </div>
          <div className="text-right text-xs text-ink-soft">
            <p><span className="font-semibold text-ink">From</span> <span className="font-mono">{doc.issuer.slice(0, 10)}…</span></p>
            <p className="mt-0.5"><span className="font-semibold text-ink">To</span> <span className="font-mono">{doc.recipient.slice(0, 10)}…</span></p>
          </div>
        </header>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="pb-2 font-semibold">Description</th>
              <th className="pb-2 text-right font-semibold">Qty</th>
              <th className="pb-2 text-right font-semibold">Unit</th>
              <th className="pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="nums">
            {(items.data ?? []).map((li, i) => (
              <tr key={i} className="border-b border-dashed border-[var(--color-line)]">
                <td className="py-2 font-doc">{li.description}</td>
                <td className="py-2 text-right">{li.quantity.toString()}</td>
                <td className="py-2 text-right">{formatE8s(li.unitPriceE8s)}</td>
                <td className="py-2 text-right">{formatE8s(li.quantity * li.unitPriceE8s)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-56 space-y-1 text-sm nums">
          <p className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{formatE8s(doc.subtotalE8s)}</span></p>
          {doc.taxBps > 0n && (
            <p className="flex justify-between"><span className="text-ink-soft">Tax ({(Number(doc.taxBps) / 100).toFixed(1)}%)</span><span>{formatE8s(doc.taxE8s)}</span></p>
          )}
          <p className="flex justify-between border-t border-[var(--color-ink)] pt-1 font-doc text-base font-bold">
            <span>Total</span><span className="text-[var(--color-amount)]">{formatE8s(doc.totalE8s)}</span>
          </p>
          {doc.paidE8s > 0n && (
            <>
              <p className="flex justify-between text-emerald-600"><span>Collected</span><span>−{formatE8s(doc.paidE8s)}</span></p>
              <p className="flex justify-between font-semibold"><span>Balance due</span><span>{formatE8s(remaining)}</span></p>
            </>
          )}
        </div>

        <p className="mt-6 border-t border-[var(--color-line)] pt-3 text-[10px] text-ink-soft">
          Totals computed by contract {INVOICING_CID} · settlement enforced on-chain · trail immutable
        </p>
      </section>

      {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</p>}

      {/* Actions */}
      <section className="flex flex-wrap items-center gap-3">
        {doc.status === 'draft' && (
          <>
            <button className="btn" disabled={busy} onClick={run(() => api.issueInvoice(id, toChainNs(Date.now() + 14 * 86_400_000)))}>
              Issue · due in 14 days
            </button>
            <button className="btn-ghost" disabled={busy} onClick={run(() => api.voidInvoice(id))}>Void draft</button>
          </>
        )}
        {doc.status === 'issued' && (
          <div className="card flex flex-wrap items-center gap-3 p-3" data-testid="pay-box">
            <p className="text-sm font-semibold">Record payment</p>
            <input className="w-32 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm nums"
              placeholder={formatE8s(remaining)} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn" disabled={busy || !amount}
              onClick={run(() => api.recordPayment(id, BigInt(Math.round(Number(amount) * 1e8)), ''))}>
              {busy ? 'Recording…' : 'Record'}
            </button>
            <button className="btn-ghost" disabled={busy}
              onClick={run(() => api.recordPayment(id, remaining, 'settlement'))}>
              Settle exactly · {formatE8s(remaining)}
            </button>
            {doc.paidE8s === 0n && <button className="btn-ghost" disabled={busy} onClick={run(() => api.voidInvoice(id))}>Void</button>}
          </div>
        )}
      </section>

      {/* The trail */}
      <section>
        <h2 className="font-doc text-lg font-bold">Trail</h2>
        <ol className="mt-2 space-y-1.5 border-l-2 border-[var(--color-line)] pl-4 text-sm">
          {(trail.data ?? []).map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[1.32rem] top-1.5 h-2 w-2 rounded-full bg-[var(--color-teal)]" />
              <span className="font-semibold">{e.event}</span>
              {e.amountE8s > 0n && <span className="nums text-[var(--color-amount)]"> · {formatE8s(e.amountE8s)}</span>}
              <span className="text-xs text-ink-soft nums"> · {fmtDate(e.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

// ── Compose ─────────────────────────────────────────────────────────────────

interface DraftItem { description: string; quantity: string; unit: string }

function Compose({ done }: { done: () => void }) {
  const [recipient, setRecipient] = useState('')
  const [taxPct, setTaxPct] = useState('10')
  const [items, setItems] = useState<DraftItem[]>([{ description: '', quantity: '1', unit: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()

  const subtotal = items.reduce((s, it) => s + Math.round(Number(it.unit || '0') * 1e8) * Number(it.quantity || '0'), 0)
  const tax = Math.floor(subtotal * Math.round(Number(taxPct || '0') * 100) / 10_000)

  async function create() {
    setBusy(true); setErr(undefined)
    try {
      await api.createInvoice(
        recipient.trim() || api.identity(),
        items.map((i) => i.description.trim() || 'Item'),
        items.map((i) => BigInt(i.quantity || '1')),
        items.map((i) => BigInt(Math.round(Number(i.unit || '0') * 1e8))),
        Math.round(Number(taxPct || '0') * 100),
      )
      done()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const set = (i: number, k: keyof DraftItem, v: string) =>
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)))

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-doc text-2xl font-bold">New invoice</h1>
      <div className="sheet space-y-4">
        <label className="block text-sm">Billed to (56-hex principal — blank bills yourself, handy for the demo)
          <input className="inp mt-1 font-mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={api.identity()} />
        </label>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
            <input className="inp" placeholder="Description" value={it.description} onChange={(e) => set(i, 'description', e.target.value)} />
            <input className="inp nums" placeholder="qty" inputMode="numeric" value={it.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} />
            <input className="inp nums" placeholder="unit price" inputMode="decimal" value={it.unit} onChange={(e) => set(i, 'unit', e.target.value)} />
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button className="text-sm text-[var(--color-teal-ink)] hover:underline" onClick={() => setItems((a) => [...a, { description: '', quantity: '1', unit: '' }])}>+ line</button>
          <label className="text-sm">Tax %
            <input className="inp ml-2 w-16 nums" inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
          </label>
        </div>
        <div className="ml-auto w-56 space-y-1 border-t border-[var(--color-line)] pt-2 text-sm nums">
          <p className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{formatE8s(BigInt(subtotal))}</span></p>
          <p className="flex justify-between"><span className="text-ink-soft">Tax</span><span>{formatE8s(BigInt(tax))}</span></p>
          <p className="flex justify-between font-doc font-bold"><span>Total</span><span className="text-[var(--color-amount)]">{formatE8s(BigInt(subtotal + tax))}</span></p>
        </div>
        <p className="text-[11px] text-ink-soft">This preview is client math — the contract recomputes every figure on-chain and its number is the one that binds.</p>
      </div>
      {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</p>}
      <button className="btn" onClick={create} disabled={busy}>{busy ? 'Raising…' : 'Raise draft'}</button>
    </div>
  )
}
