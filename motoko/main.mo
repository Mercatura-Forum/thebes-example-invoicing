/// Invoicing — a standalone Thebes example over the shared Invoices module,
/// deepened with a SETTLEMENT LEDGER.
///
/// The property this example proves: **an invoice settles exactly — never
/// over, never under, never out of order.** Totals are recomputed on-chain
/// from line items (a client can never supply a total); payments accumulate
/// against an issued invoice and can never exceed it; the invoice flips to
/// `paid` in the same atomic step as the payment that completes it; an
/// invoice that has taken money can no longer be voided. The public oracle
/// `invariantReportView` re-proves five laws over every invoice on every
/// read, and the footer seal carries the receivables conservation:
/// billed == collected + outstanding + voided-away.
///
/// Status lifecycle (lib): draft ──issue──▶ issued ──(payments == total)──▶ paid
///                           │                  │
///                           └──────void────────┴──▶ void   (only while unpaid & 0 collected)

import Invoices "mo:thebes-lib/Invoices";
import Admin "mo:thebes-lib/Admin";
import Pagination "mo:thebes-lib/Pagination";
import Principal "mo:core/Principal";
import Array "mo:core/Array";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";

persistent actor Invoicing {

  var admin = Admin.init();
  let invoices = Invoices.init();

  // ── The settlement ledger (actor-side; the lib stays pure) ────────────────
  public type Payment = { seq : Nat; invoiceId : Nat; amountE8s : Nat; by : Principal; at : Int; note : Text };
  var nextPaymentSeq : Nat = 0;
  let payments = Map.empty<Nat, List.List<Payment>>(); // invoice id → payments
  let dueAt = Map.empty<Nat, Int>();                   // invoice id → due date (ns)

  func paymentsOf(id : Nat) : List.List<Payment> {
    switch (Map.get(payments, Nat.compare, id)) {
      case (?l) l;
      case null { let l = List.empty<Payment>(); Map.add(payments, Nat.compare, id, l); l };
    };
  };
  func paidSoFar(id : Nat) : Nat {
    var sum : Nat = 0;
    for (p in List.values(paymentsOf(id))) { sum += p.amountE8s };
    sum;
  };

  // ── Admin ──────────────────────────────────────────────────────────────────
  public shared (msg) func claimOwner() : async Bool { Admin.claimOwner(admin, msg.caller) };
  public query func getOwner() : async ?Principal { Admin.getOwner(admin) };
  public shared (msg) func setPaused(v : Bool) : async Bool { Admin.setPaused(admin, msg.caller, v) };
  public query func isPaused() : async Bool { Admin.isPaused(admin) };

  // ── Create ───────────────────────────────────────────────────────────────--
  // The caller is always the issuer; totals are recomputed on-chain. Line items
  // arrive as parallel arrays (frontend-friendly Candid), zipped on-chain.
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

  // ── Lifecycle (OrTrap — no swallowed #err) ───────────────────────────────--
  // Issue with a due date: the date goes on the aging clock the moment the
  // invoice becomes collectible.
  public shared (msg) func issueOrTrap(id : Nat, dueNs : Int) : async () {
    Admin.requireNotPaused(admin);
    switch (Invoices.issue(invoices, Time.now(), msg.caller, id)) {
      case (#ok _) { Map.add(dueAt, Nat.compare, id, dueNs) };
      case (#err e) Runtime.trap(e);
    };
  };

  // Record a payment against an issued invoice. Only the RECIPIENT pays; a
  // payment may be partial but the running sum may never exceed the total,
  // and the payment that lands exactly on the total flips the invoice to
  // `paid` in the same synchronous step (no await in between).
  public shared (msg) func recordPaymentOrTrap(id : Nat, amountE8s : Nat, note : Text) : async Nat {
    Admin.requireNotPaused(admin);
    if (amountE8s == 0) Runtime.trap("A payment must be more than zero");
    switch (Invoices.get(invoices, id)) {
      case null Runtime.trap("invoice not found");
      case (?inv) {
        if (not Principal.equal(inv.recipient, msg.caller)) Runtime.trap("Only the billed party can pay this invoice");
        if (Invoices.statusText(inv.status) != "issued") Runtime.trap("Only an issued invoice can take payments (this one is " # Invoices.statusText(inv.status) # ")");
        let sofar = paidSoFar(id);
        if (sofar + amountE8s > inv.totalE8s) {
          Runtime.trap("That would overpay: " # Nat.toText(inv.totalE8s - sofar) # " e8s remain on this invoice");
        };
        List.add(paymentsOf(id), { seq = nextPaymentSeq; invoiceId = id; amountE8s; by = msg.caller; at = Time.now(); note });
        nextPaymentSeq += 1;
        if (sofar + amountE8s == inv.totalE8s) {
          // Exact settlement — flip to paid atomically with the last payment.
          switch (Invoices.markPaid(invoices, Time.now(), msg.caller, id)) {
            case (#ok _) {};
            case (#err e) Runtime.trap("settlement could not complete: " # e);
          };
        };
        paidSoFar(id);
      };
    };
  };

  // Void is only legal while nothing has been collected — money that moved
  // cannot be waved away.
  public shared (msg) func voidOrTrap(id : Nat) : async () {
    Admin.requireNotPaused(admin);
    if (paidSoFar(id) > 0) Runtime.trap("This invoice has taken payments — it can no longer be voided");
    switch (Invoices.void(invoices, Time.now(), msg.caller, id)) { case (#ok _) {}; case (#err e) Runtime.trap(e) };
  };

  // ── Reads ──────────────────────────────────────────────────────────────────
  public query func getInvoice(id : Nat) : async ?Invoices.Invoice { Invoices.get(invoices, id) };
  public query func invoiceCount() : async Nat { Invoices.count(invoices) };
  public shared query (msg) func myInvoices(offset : Nat, limit : Nat) : async Pagination.Page<Invoices.Invoice> {
    Pagination.page(Invoices.forPrincipal(invoices, msg.caller), offset, limit);
  };

  // ── Flat views ─────────────────────────────────────────────────────────────
  public type InvoiceView = {
    id : Nat; issuer : Principal; recipient : Principal;
    taxBps : Nat; subtotalE8s : Nat; taxE8s : Nat; totalE8s : Nat;
    paidE8s : Nat; status : Text; itemCount : Nat; createdAt : Int; dueNs : Int;
    mineAsIssuer : Nat; nowNs : Int;
  };

  func toView(caller : Principal, i : Invoices.Invoice, now : Int) : InvoiceView {
    {
      id = i.id; issuer = i.issuer; recipient = i.recipient;
      taxBps = i.taxBps; subtotalE8s = i.subtotalE8s; taxE8s = i.taxE8s;
      totalE8s = i.totalE8s; paidE8s = paidSoFar(i.id);
      status = Invoices.statusText(i.status);
      itemCount = i.lineItems.size(); createdAt = i.createdAt;
      dueNs = (switch (Map.get(dueAt, Nat.compare, i.id)) { case (?d) d; case null 0 });
      mineAsIssuer = if (Principal.equal(i.issuer, caller)) 1 else 0;
      nowNs = now;
    };
  };

  public shared query (msg) func myInvoicesView() : async [InvoiceView] {
    let now = Time.now();
    Array.map<Invoices.Invoice, InvoiceView>(
      Invoices.forPrincipal(invoices, msg.caller),
      func(i) = toView(msg.caller, i, now),
    );
  };

  public query func getLineItems(id : Nat) : async [Invoices.LineItem] {
    switch (Invoices.get(invoices, id)) { case (?i) i.lineItems; case null [] };
  };

  // An invoice's audit trail + payments, flattened for the document view.
  public query func invoiceTrailView(id : Nat) : async [{ at : Int; by : Principal; event : Text; amountE8s : Nat }] {
    let out = List.empty<{ at : Int; by : Principal; event : Text; amountE8s : Nat }>();
    switch (Invoices.get(invoices, id)) {
      case null {};
      case (?i) {
        for (e in i.history.values()) { List.add(out, { at = e.at; by = e.by; event = e.event; amountE8s = 0 }) };
        for (p in List.values(paymentsOf(id))) {
          List.add(out, { at = p.at; by = p.by; event = (if (p.note == "") "payment" else "payment — " # p.note); amountE8s = p.amountE8s });
        };
      };
    };
    let arr = List.toArray(out);
    Array.sort(arr, func(a : { at : Int; by : Principal; event : Text; amountE8s : Nat }, b : { at : Int; by : Principal; event : Text; amountE8s : Nat }) : { #less; #equal; #greater } { Int.compare(a.at, b.at) });
  };

  // Receivables aging over the CALLER's issued invoices: outstanding value in
  // four buckets by days overdue (0 = not yet due / current).
  public shared query (msg) func agingView() : async [{
    bucket : Text; outstandingE8s : Nat; invoices : Nat;
  }] {
    let now = Time.now();
    let day : Int = 86_400_000_000_000;
    var cur : Nat = 0; var b30 : Nat = 0; var b60 : Nat = 0; var b90 : Nat = 0;
    var nCur : Nat = 0; var n30 : Nat = 0; var n60 : Nat = 0; var n90 : Nat = 0;
    for (i in Invoices.forPrincipal(invoices, msg.caller).values()) {
      if (Principal.equal(i.issuer, msg.caller) and Invoices.statusText(i.status) == "issued") {
        let due = switch (Map.get(dueAt, Nat.compare, i.id)) { case (?d) d; case null now };
        let out = i.totalE8s - paidSoFar(i.id);
        let overdueDays = if (now <= due) 0 else Int.abs((now - due) / day);
        if (overdueDays == 0) { cur += out; nCur += 1 }
        else if (overdueDays <= 30) { b30 += out; n30 += 1 }
        else if (overdueDays <= 60) { b60 += out; n60 += 1 }
        else { b90 += out; n90 += 1 };
      };
    };
    [
      { bucket = "current"; outstandingE8s = cur; invoices = nCur },
      { bucket = "1-30"; outstandingE8s = b30; invoices = n30 },
      { bucket = "31-60"; outstandingE8s = b60; invoices = n60 },
      { bucket = "60+"; outstandingE8s = b90; invoices = n90 },
    ];
  };

  // ── The oracle: five laws over every invoice, recomputable by anyone ──────
  public query func invariantReportView() : async [{ rule : Text; detail : Text }] {
    let bad = List.empty<{ rule : Text; detail : Text }>();
    for ((id, i) in Map.entries(invoices.invoices)) {
      // R1 unit-exact totals: recompute from line items.
      var sub : Nat = 0;
      for (li in i.lineItems.values()) { sub += li.quantity * li.unitPriceE8s };
      let tax = sub * i.taxBps / 10_000;
      if (sub != i.subtotalE8s or tax != i.taxE8s or sub + tax != i.totalE8s) {
        List.add(bad, { rule = "R1 totals"; detail = "invoice #" # Nat.toText(id) # " totals do not recompute from its line items" });
      };
      let sofar = paidSoFar(id);
      let status = Invoices.statusText(i.status);
      // R2 settlement: never overpaid; paid ⟺ exactly settled.
      if (sofar > i.totalE8s) {
        List.add(bad, { rule = "R2 settle"; detail = "invoice #" # Nat.toText(id) # " collected more than its total" });
      };
      if (status == "paid" and sofar != i.totalE8s) {
        List.add(bad, { rule = "R2 settle"; detail = "invoice #" # Nat.toText(id) # " is paid but not exactly settled" });
      };
      if (status == "issued" and sofar >= i.totalE8s and i.totalE8s > 0) {
        List.add(bad, { rule = "R2 settle"; detail = "invoice #" # Nat.toText(id) # " is fully collected but still open" });
      };
      // R3 money order: payments only on invoices that were collectible.
      if ((status == "draft") and sofar > 0) {
        List.add(bad, { rule = "R3 order"; detail = "invoice #" # Nat.toText(id) # " took a payment before being issued" });
      };
      if (status == "void" and sofar > 0) {
        List.add(bad, { rule = "R3 order"; detail = "invoice #" # Nat.toText(id) # " was voided after taking money" });
      };
      // R4 payer: every payment came from the billed party.
      for (p in List.values(paymentsOf(id))) {
        if (not Principal.equal(p.by, i.recipient)) {
          List.add(bad, { rule = "R4 payer"; detail = "payment #" # Nat.toText(p.seq) # " on invoice #" # Nat.toText(id) # " is not from the billed party" });
        };
      };
      // R5 due dates: only collectible invoices carry one.
      if (Map.get(dueAt, Nat.compare, id) != null and status == "draft") {
        List.add(bad, { rule = "R5 due"; detail = "invoice #" # Nat.toText(id) # " has a due date but was never issued" });
      };
    };
    List.toArray(bad);
  };

  // One row for the footer seal: receivables conservation across the book.
  // billed(issued+paid) == collected + outstanding, recomputed from scratch.
  public query func invoicingSealView() : async [{
    invoices : Nat; billedE8s : Nat; collectedE8s : Nat; outstandingE8s : Nat;
    violations : Nat; checkedAt : Int;
  }] {
    var billed : Nat = 0; var collected : Nat = 0; var outstanding : Nat = 0;
    for ((id, i) in Map.entries(invoices.invoices)) {
      let status = Invoices.statusText(i.status);
      if (status == "issued" or status == "paid") {
        billed += i.totalE8s;
        let sofar = paidSoFar(id);
        collected += sofar;
        outstanding += i.totalE8s - sofar;
      };
    };
    var v : Nat = 0;
    for ((id, i) in Map.entries(invoices.invoices)) {
      var sub : Nat = 0;
      for (li in i.lineItems.values()) { sub += li.quantity * li.unitPriceE8s };
      if (sub + sub * i.taxBps / 10_000 != i.totalE8s) v += 1;
      if (paidSoFar(id) > i.totalE8s) v += 1;
    };
    if (billed != collected + outstanding) v += 1;
    [{ invoices = Invoices.count(invoices); billedE8s = billed; collectedE8s = collected; outstandingE8s = outstanding; violations = v; checkedAt = Time.now() }];
  };

  // ── Demo seed: a lived-in book for the CALLER (as both parties, so the
  //    browser can drive the whole lifecycle single-handed). Idempotent per
  //    caller: a no-op once the caller has any invoice. ────────────────────--
  public shared (msg) func seedDemo() : async Bool {
    Admin.requireNotPaused(admin);
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    if (Invoices.forPrincipal(invoices, msg.caller).size() > 0) return false;
    let now = Time.now();
    let day : Int = 86_400_000_000_000;

    // #1 — settled: issued, then two partial payments landing exactly on the total.
    let a = Invoices.create(invoices, now, msg.caller, msg.caller, [
      { description = "Design consultation (hrs)"; quantity = 8; unitPriceE8s = 150_000_000 },
      { description = "Hosting (months)"; quantity = 12; unitPriceE8s = 20_000_000 },
    ], 1000);
    ignore Invoices.issue(invoices, now, msg.caller, a.id);
    Map.add(dueAt, Nat.compare, a.id, now + 14 * day);
    List.add(paymentsOf(a.id), { seq = nextPaymentSeq; invoiceId = a.id; amountE8s = 1_000_000_000; by = msg.caller; at = now; note = "deposit" });
    nextPaymentSeq += 1;
    List.add(paymentsOf(a.id), { seq = nextPaymentSeq; invoiceId = a.id; amountE8s = a.totalE8s - 1_000_000_000; by = msg.caller; at = now; note = "balance" });
    nextPaymentSeq += 1;
    ignore Invoices.markPaid(invoices, now, msg.caller, a.id);

    // #2 — open with a deposit taken, due in 21 days.
    let b = Invoices.create(invoices, now, msg.caller, msg.caller, [
      { description = "Brand identity package"; quantity = 1; unitPriceE8s = 3_200_000_000 },
    ], 1000);
    ignore Invoices.issue(invoices, now, msg.caller, b.id);
    Map.add(dueAt, Nat.compare, b.id, now + 21 * day);
    List.add(paymentsOf(b.id), { seq = nextPaymentSeq; invoiceId = b.id; amountE8s = 800_000_000; by = msg.caller; at = now; note = "deposit" });
    nextPaymentSeq += 1;

    // #3 — overdue by 40 days (the aging shelf has something to show).
    let c = Invoices.create(invoices, now, msg.caller, msg.caller, [
      { description = "Retainer — March"; quantity = 1; unitPriceE8s = 1_500_000_000 },
    ], 0);
    ignore Invoices.issue(invoices, now, msg.caller, c.id);
    Map.add(dueAt, Nat.compare, c.id, now - 40 * day);

    // #4 — a draft still on the desk.
    ignore Invoices.create(invoices, now, msg.caller, msg.caller, [
      { description = "Site refresh (draft estimate)"; quantity = 1; unitPriceE8s = 990_000_000 },
    ], 0);
    true;
  };
};
