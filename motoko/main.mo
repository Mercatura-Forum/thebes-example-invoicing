/// Invoicing — a standalone Thebes example over the shared Invoices module.
///
/// The backend owns one Admin state (owner/pause) and one Invoices state, and
/// exposes the invoice lifecycle. Every mutation that can fail a guard is an
/// `*OrTrap` method: the underlying module returns a Result, and the actor traps
/// on `#err` so a failed guard rejects the call instead of being silently
/// swallowed by the client.

import Invoices "mo:thebes-lib/Invoices";
import Admin "mo:thebes-lib/Admin";
import Pagination "mo:thebes-lib/Pagination";
import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";

persistent actor Invoicing {

  var admin = Admin.init();
  let invoices = Invoices.init();

  // ── Admin ──────────────────────────────────────────────────────────────────
  public shared (msg) func claimOwner() : async Bool { Admin.claimOwner(admin, msg.caller) };
  public query func getOwner() : async ?Principal { Admin.getOwner(admin) };
  public shared (msg) func setPaused(v : Bool) : async Bool { Admin.setPaused(admin, msg.caller, v) };
  public query func isPaused() : async Bool { Admin.isPaused(admin) };

  // ── Create ───────────────────────────────────────────────────────────────--
  // The caller is always the issuer; totals are recomputed on-chain.
  // Line items arrive as parallel arrays (frontend-friendly Candid: vecs of
  // scalars), zipped into LineItems on-chain.
  func zip(descriptions : [Text], quantities : [Nat], unitPricesE8s : [Nat]) : [Invoices.LineItem] {
    Array.tabulate<Invoices.LineItem>(
      descriptions.size(),
      func(i) {
        {
          description = descriptions[i];
          quantity = if (i < quantities.size()) quantities[i] else 0;
          unitPriceE8s = if (i < unitPricesE8s.size()) unitPricesE8s[i] else 0;
        };
      },
    );
  };

  public shared (msg) func createInvoice(
    recipient : Principal, descriptions : [Text], quantities : [Nat], unitPricesE8s : [Nat], taxBps : Nat,
  ) : async Invoices.Invoice {
    Admin.requireNotPaused(admin);
    Invoices.create(invoices, Time.now(), msg.caller, recipient, zip(descriptions, quantities, unitPricesE8s), taxBps);
  };

  public shared (msg) func createIssued(
    recipient : Principal, descriptions : [Text], quantities : [Nat], unitPricesE8s : [Nat], taxBps : Nat,
  ) : async Invoices.Invoice {
    Admin.requireNotPaused(admin);
    Invoices.createIssued(invoices, Time.now(), msg.caller, recipient, zip(descriptions, quantities, unitPricesE8s), taxBps);
  };

  // ── Lifecycle (OrTrap — no swallowed #err) ───────────────────────────────--
  public shared (msg) func issueOrTrap(id : Invoices.InvoiceId) : async Invoices.Invoice {
    Admin.requireNotPaused(admin);
    switch (Invoices.issue(invoices, Time.now(), msg.caller, id)) { case (#ok i) i; case (#err e) Runtime.trap(e) };
  };
  public shared (msg) func payOrTrap(id : Invoices.InvoiceId) : async Invoices.Invoice {
    Admin.requireNotPaused(admin);
    switch (Invoices.markPaid(invoices, Time.now(), msg.caller, id)) { case (#ok i) i; case (#err e) Runtime.trap(e) };
  };
  public shared (msg) func voidOrTrap(id : Invoices.InvoiceId) : async Invoices.Invoice {
    Admin.requireNotPaused(admin);
    switch (Invoices.void(invoices, Time.now(), msg.caller, id)) { case (#ok i) i; case (#err e) Runtime.trap(e) };
  };

  // ── Reads ──────────────────────────────────────────────────────────────────
  public query func getInvoice(id : Invoices.InvoiceId) : async ?Invoices.Invoice { Invoices.get(invoices, id) };
  public query func invoiceCount() : async Nat { Invoices.count(invoices) };

  public shared query (msg) func myInvoices(offset : Nat, limit : Nat) : async Pagination.Page<Invoices.Invoice> {
    Pagination.page(Invoices.forPrincipal(invoices, msg.caller), offset, limit);
  };
  public query func allInvoices(offset : Nat, limit : Nat) : async Pagination.Page<Invoices.Invoice> {
    Pagination.page(Invoices.all(invoices), offset, limit);
  };

  // Flat views — a frontend decodes these directly (no nested vec/variant fields).
  public type InvoiceView = {
    id : Nat;
    issuer : Principal;
    recipient : Principal;
    taxBps : Nat;
    subtotalE8s : Nat;
    taxE8s : Nat;
    totalE8s : Nat;
    status : Text;
    itemCount : Nat;
    createdAt : Int;
  };

  func toView(i : Invoices.Invoice) : InvoiceView {
    {
      id = i.id; issuer = i.issuer; recipient = i.recipient;
      taxBps = i.taxBps; subtotalE8s = i.subtotalE8s; taxE8s = i.taxE8s;
      totalE8s = i.totalE8s; status = Invoices.statusText(i.status);
      itemCount = i.lineItems.size(); createdAt = i.createdAt;
    };
  };

  public shared query (msg) func myInvoicesView() : async [InvoiceView] {
    Array.map<Invoices.Invoice, InvoiceView>(Invoices.forPrincipal(invoices, msg.caller), toView);
  };

  public query func allInvoicesView() : async [InvoiceView] {
    Array.map<Invoices.Invoice, InvoiceView>(Invoices.all(invoices), toView);
  };

  // Flat line items for an invoice detail view.
  public query func getLineItems(id : Invoices.InvoiceId) : async [Invoices.LineItem] {
    switch (Invoices.get(invoices, id)) { case (?i) i.lineItems; case null [] };
  };

  // ── Demo seed ────────────────────────────────────────────────────────────--
  public shared (msg) func seedDemo() : async Bool {
    ignore Admin.claimOwner(admin, msg.caller);
    let items = [
      { description = "Design consultation (hrs)"; quantity = 8; unitPriceE8s = 150_000_000 },
      { description = "Hosting (months)"; quantity = 12; unitPriceE8s = 20_000_000 },
    ];
    ignore Invoices.createIssued(invoices, Time.now(), msg.caller, msg.caller, items, 1000);
    ignore Invoices.create(invoices, Time.now(), msg.caller, msg.caller, [{ description = "Draft item"; quantity = 1; unitPriceE8s = 99_000_000 }], 0);
    true;
  };
};
