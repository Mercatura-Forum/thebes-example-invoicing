# thebes-example-invoicing

Folio — on-chain invoicing with a settlement ledger, built on
[Thebes Protocol](https://thebesprotocol.com): a Motoko
backend over the shared [`thebes-lib`](https://github.com/Mercatura-Forum/thebes-lib)
`Invoices` module, and a document-first React frontend served as certified assets.

The property this example proves: **an invoice settles exactly — never over,
never under, never out of order.** Totals are recomputed on-chain from line
items (a client can never supply a total); payments accumulate against an
issued invoice and can never exceed it; the payment that lands exactly on the
total flips the invoice to `paid` in the same atomic step; an invoice that has
taken money can no longer be voided. Issuing takes a due date and receivables
age against it (current / 1–30 / 31–60 / 60+ days). A **public oracle**
(`invariantReportView`) re-proves five laws on every read, and the seal carries
the conservation: billed = collected + outstanding.

Live demo: <https://memphis.mercaturaforum.com/_/raw/128363932940845/index.html>

## Architecture

```
frontend (React + Vite + Tailwind)   →   invoicing backend (Motoko)
   @thebes/sdk  ── boundary client       mo:thebes-lib ── Admin / Invoices / Pagination
   Memphis passkey gate                  invoice lifecycle · on-chain audit trail
```

- **frontend/** uses `@thebes/sdk` for the boundary client, typed query/update
  calls, React hooks, and the Memphis passkey gate. The SDK is **vendored** under
  `frontend/vendor/@thebes/sdk` and resolved as a local dependency
  (upstream source of truth: [`thebes-sdk`](https://github.com/Mercatura-Forum/thebes-sdk)).
- **motoko/** uses `thebes-lib` for `Admin` (owner / pause), `Invoices` (lifecycle
  + audit trail), and `Pagination`; the actor in `main.mo` is a thin shell over the
  module. The library is **vendored** under `motoko/thebes-lib` and resolved as a
  local Mops dependency.

Both halves are self-contained: the repository builds with no external Git or Mops
toolkit pins. The frontend asset-canister wasm is the one artifact fetched at
deploy time (see [Deploy](#deploy)).

## Identity

The header sign-in is a Memphis (contract **921**) **frontend gate**. It gives
the UI a display name and nothing more: this example's backend authorises on
`msg.caller` through `thebes-lib`'s `Admin`, and never verifies a Memphis
session. No write here is gated by who you signed in as.

That is correct for an owner-and-admin surface, which is what this example is.
**It is not enough if you are copying this for anything user-scoped** — a
balance, a profile, a document someone owns. For that, take the session token
as a call argument and verify it on the backend:

```motoko
switch (await* MemphisAuth.verifyWithAudience(gate, token, AUDIENCE)) {
  case (#ok(id)) { /* id.principal — key user state on this */ };
  case (#err(_)) { /* refuse */ };
};
```

`origin` on the gate is a pseudonym namespace and is frozen for the life of the
app; `AUDIENCE` is the web origin you are served from, and it is the one line
that changes when you move to your own domain. On your own domain the passkey
ceremony cannot run in the page — a page may only claim a WebAuthn RP ID that is
a registrable-domain suffix of its own origin — so use `<MemphisConnectGate>`
from `@thebes/sdk`.

Full guide, both halves: **[`docs/memphis.md`](https://github.com/Mercatura-Forum/thebes-sdk/blob/main/docs/memphis.md)**.

## Backend interface (selected)

| Method | Kind | Purpose |
| --- | --- | --- |
| `createInvoice` | update | Open a draft from parallel line-item arrays; totals recomputed on-chain. |
| `issueOrTrap` | update | `draft → issued` with a due date (issuer only; traps on a failed guard). |
| `recordPaymentOrTrap` | update | Record a (possibly partial) payment — recipient only, never above the total; the exact-settling payment flips the invoice to `paid` atomically. |
| `voidOrTrap` | update | Void an unpaid invoice — refused once any money has been collected. |
| `myInvoicesView` / `getLineItems` / `invoiceTrailView` | query | Flat invoice records (with paid-so-far and due dates), line items, and the merged audit-trail + payment history. |
| `agingView` | query | The caller's receivables by days overdue. |
| `invariantReportView` / `invoicingSealView` | query | The public five-law oracle and the billed = collected + outstanding seal. |
| `claimOwner` / `setPaused` | update | Ownership and pause surface (from `thebes-lib`'s `Admin`). |
| `seedDemo` | update | Seed a lived-in demo book: settled via two partials, part-paid, 40-days overdue, and a draft. |

Amounts are in e8s (8 decimals); tax is in basis points (10% = 1000 bps). Every
lifecycle transition appends to an immutable on-chain audit trail.

## Toolchain

- **Motoko compiler 1.4.1.** `mops install` fetches the pinned compiler to
  `~/.cache/mops/moc/1.4.1/moc` (macOS: `~/Library/Caches/mops/moc/1.4.1/moc`).
  Use that binary — the `moc` on a default `PATH` may be a different version, or
  Qt's unrelated Meta-Object Compiler.
- **Node 18+** and **[Mops](https://mops.one)** for the two builds.
- **[`thebes-deploy`](https://github.com/Mercatura-Forum/Thebes-Protocol-/releases)**
  to deploy. The prebuilt binary is Linux x86-64; on other platforms build it from
  the release source bundle (`cargo build --release -p thebes-deploy`).

## Run locally

```sh
# Frontend
cd frontend
npm install            # resolves the vendored @thebes/sdk
npm run dev            # sync-sdk copies the browser runtimes into public/, then Vite serves

# Backend (compile-check)
cd ../motoko
mops install           # resolves the vendored thebes-lib + the pinned compiler
"$(ls "$HOME/.cache/mops/moc/1.4.1/moc" "$HOME/Library/Caches/mops/moc/1.4.1/moc" 2>/dev/null | head -1)" --check $(mops sources) main.mo
```

## Deploy

`thebes.toml` describes the deploy. Its `validators` array is pre-filled with the
current WAN cluster endpoints; run `thebes-deploy init` to confirm or refresh them.

> **Deploying your own copy?** The committed `cid` values pin the **live catalog
> deployment** (that's what the demo links serve — only its controller can
> upgrade it). Before your first deploy, set `cid = "auto"` on each canister:
> the deploy allocates fresh canisters you control and writes their ids back
> into the manifest.

### 1. Backend

```sh
thebes-deploy identity new me      # one-time local signing identity
thebes-deploy deploy invoicing     # build + install + verify → prints the backend cid
```

### 2. Frontend

The frontend installs an asset canister, then uploads your built bundle. Fetch the
asset-canister wasm once (it is referenced by `thebes.toml` as `asset_canister.wasm`):

```sh
curl -L -o asset_canister.wasm \
  https://github.com/Mercatura-Forum/Thebes-Protocol-/releases/download/asset-canister-v0.1.0/asset_canister.wasm
```

Build the bundle and point it at your backend cid (the frontend reads
`window.INVOICING_CID` at runtime), then deploy:

```sh
cd frontend && npm run build && cd ..
# inject the backend cid from step 1 into the built page:
sed -i 's#<head>#<head><script>window.INVOICING_CID=YOUR_INVOICING_CID;</script>#' frontend/dist/index.html
thebes-deploy deploy web           # install asset canister + upload bundle + verify
```

The deploy prints the live URL:
`https://memphis.mercaturaforum.com/_/raw/<web-cid>/index.html`.

For a machine-readable deploy contract, see [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
