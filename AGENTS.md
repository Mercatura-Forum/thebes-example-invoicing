# AGENTS.md — deploying this example

A canonical, copy-pasteable contract for an automated agent deploying
`thebes-example-invoicing` to a Thebes cluster. Human-readable detail is in
[README.md](README.md).

## Layout

```
thebes.toml                 deploy manifest (network + canisters)
motoko/main.mo              backend (Motoko); imports mo:thebes-lib/{Admin,Invoices,Pagination}
motoko/thebes-lib/          vendored backend library (local Mops dep — no external pin)
frontend/                   React + Vite app on @thebes/sdk
frontend/vendor/@thebes/sdk vendored SDK (local file: dep — no external pin)
```

## Toolchain (exact)

- Motoko compiler **1.4.1**, fetched by `mops install` to
  `~/.cache/mops/moc/1.4.1/moc` (macOS: `~/Library/Caches/mops/moc/1.4.1/moc`).
  Do **not** invoke a bare `moc` — a default `PATH` may resolve a different
  compiler version or Qt's Meta-Object Compiler.
- Node 18+, Mops, and the `thebes-deploy` CLI (Linux x86-64 prebuilt; build from
  the release source bundle on other platforms).
- `mops install` prints `core@2.5.0 requires moc >= 1.6.0` while 1.4.1 is pinned.
  This is expected — the cluster pins 1.4.1 and the build succeeds.

## Deploy

```sh
# 0. network: the validators in thebes.toml [networks.wan] are pre-filled with the
#    current WAN cluster; to confirm or refresh them:
thebes-deploy init            # prints current WAN cluster validators

# 1. backend
thebes-deploy identity new me
thebes-deploy deploy invoicing  # → prints the backend cid (call it INVOICING_CID)

# 2. frontend
curl -L -o asset_canister.wasm \
  https://github.com/Mercatura-Forum/Thebes-Protocol-/releases/download/asset-canister-v0.1.0/asset_canister.wasm
cd frontend && npm install && npm run build && cd ..
sed -i 's#<head>#<head><script>window.INVOICING_CID=INVOICING_CID;</script>#' frontend/dist/index.html
thebes-deploy deploy web      # → prints https://memphis.mercaturaforum.com/_/raw/<cid>/index.html
```

Verify: `curl -s -o /dev/null -w '%{http_code}' <printed-url>` returns `200`.

## Calling the backend

```sh
thebes-deploy query invoicing allInvoicesView             # queries need no identity
thebes-deploy call  invoicing seedDemo                    # updates need a local identity
```

Candid arguments are passed in textual form via `--arg`, e.g.:

```sh
# move an invoice draft → issued (issuer only)
thebes-deploy call invoicing issueOrTrap --arg '(0 : nat)'
# read one invoice's line items
thebes-deploy query invoicing getLineItems --arg '(0 : nat)'
```

Public methods exposed by `motoko/main.mo`:

| Method | Kind | Notes |
| --- | --- | --- |
| `claimOwner` / `getOwner` / `setPaused` / `isPaused` | update / query | Ownership + pause (from `thebes-lib`'s `Admin`). |
| `createInvoice` / `createIssued` | update | `--arg '(principal, vec text, vec nat, vec nat, nat)'` — recipient, descriptions, quantities, unitPricesE8s, taxBps. |
| `issueOrTrap` / `payOrTrap` / `voidOrTrap` | update | `--arg '(<id> : nat)'`; trap on a failed guard. |
| `getInvoice` / `getLineItems` | query | `--arg '(<id> : nat)'`. |
| `invoiceCount` | query | total invoice count. |
| `myInvoices` / `allInvoices` | query / shared query | `--arg '(<offset> : nat, <limit> : nat)'` — paginated. |
| `myInvoicesView` / `allInvoicesView` | shared query / query | flat records the frontend decodes directly. |
| `seedDemo` | update | seed a couple of demo invoices (claims owner on first call). |

## Conventions that affect correctness

- **`window.INVOICING_CID`** is injected into the built page at deploy time; the
  frontend reads it at runtime. If you skip the injection step, the page falls
  back to a compiled-in default and talks to the wrong backend. (This example has
  no media canister — there is no `MEDIA_CID`.)
- **`*OrTrap` methods** (`issueOrTrap`, `payOrTrap`, `voidOrTrap`) trap on a failed
  guard so the client sees a rejection instead of a silently-swallowed error.
  Frontends call the `OrTrap` form for any guarded write.
- **Boundary decoding** returns a `vec record` of scalar fields. A single record is
  a 0-or-1-element array; principal fields are 56-character hex. Decode with the
  SDK's `decodeVecRecord` / `decodeNat` / `decodeBool`.
