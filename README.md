# thebes-example-invoicing

On-chain invoicing built on [Thebes Protocol](https://github.com/Mercatura-Forum/Thebes-Protocol-):
a Motoko backend over the shared [`thebes-lib`](https://github.com/Mercatura-Forum/thebes-lib)
`Invoices` module, and a React frontend served as certified assets. Create
invoices from line items, move them through a guarded `draft → issued → paid`
(or `void`) lifecycle, and read them back from chain state — totals are always
recomputed on-chain, never trusted from the client. It is a self-contained
example of the full shape of a Thebes application.

## Architecture

```
frontend (React + Vite + Tailwind)   →   invoicing backend (Motoko)
   @thebes/sdk  ── boundary client       mo:thebes-lib ── Admin / Invoices / Pagination
   Memphis passkey gate                  invoice lifecycle · on-chain audit trail
```

- **frontend/** uses `@thebes/sdk` for the boundary client, typed query/update
  calls, React hooks, and the Memphis passkey gate. The SDK is **vendored** under
  `frontend/vendor/@thebes/sdk` and resolved as a local dependency.
- **motoko/** uses `thebes-lib` for `Admin` (owner / pause), `Invoices` (lifecycle
  + audit trail), and `Pagination`; the actor in `main.mo` is a thin shell over the
  module. The library is **vendored** under `motoko/thebes-lib` and resolved as a
  local Mops dependency.

Both halves are self-contained: the repository builds with no external Git or Mops
toolkit pins. The frontend asset-canister wasm is the one artifact fetched at
deploy time (see [Deploy](#deploy)).

## Backend interface (selected)

| Method | Kind | Purpose |
| --- | --- | --- |
| `createInvoice` / `createIssued` | update | Open an invoice from parallel line-item arrays; totals recomputed on-chain. |
| `issueOrTrap` | update | `draft → issued` (issuer only; traps on a failed guard). |
| `payOrTrap` | update | `issued → paid` (issuer or recipient). |
| `voidOrTrap` | update | `draft`/`issued → void` (issuer only; a paid invoice cannot be voided). |
| `myInvoicesView` / `allInvoicesView` | query | Invoices as flat records the frontend decodes directly. |
| `getInvoice` / `getLineItems` | query | Full invoice (with audit trail) / its line items. |
| `claimOwner` / `setPaused` | update | Ownership and pause surface (from `thebes-lib`'s `Admin`). |
| `seedDemo` | update | Seed a couple of demo invoices. |

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
