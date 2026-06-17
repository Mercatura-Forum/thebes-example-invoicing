# thebes-example-invoicing

On-chain invoicing on [Thebes Protocol](https://github.com/Mercatura-Forum/Thebes-Protocol-),
built on the shared [`thebes-lib`](https://github.com/Mercatura-Forum/thebes-lib)
`Invoices` module. Create invoices from line items, move them through a guarded
`draft → issued → paid` (or `void`) lifecycle, and read them back from chain
state — totals are always recomputed on-chain, never trusted from the client.

## Architecture

- **frontend/** — React + Vite, depends on [`@thebes/sdk`](https://github.com/Mercatura-Forum/thebes-sdk)
  for the boundary client, the Memphis passkey gate, and typed query/update calls.
- **motoko/** — a thin actor over `thebes-lib`'s `Invoices` (lifecycle + audit
  trail) and `Admin` (owner / pause). The reusable invoicing logic lives in
  `thebes-lib`; this app is the standalone front end for it, and the same module
  powers billing in the store, restaurant, and hospital examples.

## Backend interface (selected)

| Method | Kind | Purpose |
| --- | --- | --- |
| `createInvoice` / `createIssued` | update | Open an invoice from parallel line-item arrays; totals recomputed on-chain. |
| `issueOrTrap` | update | `draft → issued` (issuer only; traps on a failed guard). |
| `payOrTrap` | update | `issued → paid` (issuer or recipient). |
| `voidOrTrap` | update | `draft`/`issued → void` (issuer only; a paid invoice cannot be voided). |
| `myInvoicesView` | query | The caller's invoices, as flat records the frontend decodes directly. |
| `getInvoice` / `getLineItems` | query | Full invoice (with audit trail) / its line items. |
| `seedDemo` | update | Seed a couple of demo invoices. |

Amounts are in e8s (8 decimals); tax is in basis points (10% = 1000 bps). Every
lifecycle transition appends to an immutable on-chain audit trail.

## Run locally

```sh
cd frontend && npm install && npm run dev      # pulls @thebes/sdk (git dependency)
cd ../motoko && mops install && moc --check $(mops sources) main.mo
```

## Deploy

Deploy the backend wasm and the built frontend assets with
[`thebes-deploy`](https://github.com/Mercatura-Forum/Thebes-Protocol-); inject the
assigned contract id via the `window.INVOICING_CID` global the frontend reads at
runtime.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
