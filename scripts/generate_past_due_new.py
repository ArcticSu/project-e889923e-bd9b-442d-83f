import os
import time
import argparse
import random
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

import stripe

"""
Generate Stripe test data with Test Clocks:

Scenario 1 (recover):
  active for N months -> switch to failing card -> becomes past_due -> switch back to success card -> recovers to active

Scenario 2 (linger):
  active for N months -> switch to failing card -> becomes past_due -> keep failing (linger)

Assumptions:
- You already configured Revenue recovery retries in Dashboard: 1 day / 1 day / 1 day, and "leave subscription past-due".
- You have a recurring monthly Price (PRICE_ID).
"""

# ----------------------------
# Helpers
# ----------------------------
load_dotenv()

# Note: script will re-check required env vars in main(); these top-level reads are just convenience
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
PRICE_ID = os.getenv("PRICE_ID")

def must_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing env var: {name}")
    return v

def utc_now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())

def dt(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def wait_until_testclock_ready(test_clock_id: str, timeout_sec: int = 240):
    """Stripe test clock transitions to 'ready' after advances. Poll until ready."""
    start = time.time()
    while True:
        tc = stripe.test_helpers.TestClock.retrieve(test_clock_id)
        status = tc.get("status")
        if status == "ready":
            return tc
        if time.time() - start > timeout_sec:
            raise TimeoutError(f"TestClock {test_clock_id} not ready after {timeout_sec}s (status={status})")
        time.sleep(1)

def advance_clock(test_clock_id: str, new_frozen_time: int):
    """
    Advance test clock to new_frozen_time (unix seconds).
    Must be > current frozen_time.
    """
    tc = stripe.test_helpers.TestClock.retrieve(test_clock_id)
    cur = tc["frozen_time"]
    if new_frozen_time <= cur:
        # Avoid raising: if requested time is not strictly greater than current frozen_time,
        # advance to just after current time to keep timeline moving.
        adj = cur + 1
        print(f"[Warning] requested frozen_time {new_frozen_time} <= current frozen_time {cur}; using {adj} instead")
        new_frozen_time = adj

    print(f"\n[Advance TestClock] {test_clock_id}")
    print(f"  from: {cur} ({dt(cur)})")
    print(f"  to  : {new_frozen_time} ({dt(new_frozen_time)})")
    stripe.test_helpers.TestClock.advance(test_clock_id, frozen_time=new_frozen_time)
    wait_until_testclock_ready(test_clock_id)
    tc2 = stripe.test_helpers.TestClock.retrieve(test_clock_id)
    print(f"  done: frozen_time={tc2['frozen_time']} ({dt(tc2['frozen_time'])}) status={tc2['status']}")

def create_testclock(start_time: int) -> stripe.test_helpers.TestClock:
    tc = stripe.test_helpers.TestClock.create(frozen_time=start_time, name=f"learn_tc_{start_time}")
    print(f"[Create TestClock] id={tc.id} frozen_time={tc.frozen_time} ({dt(tc.frozen_time)})")
    return tc

def create_customer(email: str, test_clock_id: str) -> stripe.Customer:
    c = stripe.Customer.create(
        email=email,
        name=email.split("@")[0],
        test_clock=test_clock_id,
        metadata={"learn": "past_due_experiment"}
    )
    print(f"[Create Customer] id={c.id} email={email} test_clock={test_clock_id}")
    return c

# def create_payment_method(card_number: str) -> stripe.PaymentMethod:
#     # If caller passed a test PaymentMethod id (pm_...), just return a lightweight object
#     # with an `id` attribute so callers can continue to use `pm.id` and attach later.
#     if isinstance(card_number, str) and card_number.startswith("pm_"):
#         class _PM:
#             def __init__(self, id):
#                 self.id = id

#         pm = _PM(card_number)
#         print(f"[Use Test PM] id={pm.id}")
#         return pm

#     # Otherwise create a real PaymentMethod (using a raw test card number).
#     pm = stripe.PaymentMethod.create(
#         type="card",
#         card={"number": card_number, "exp_month": 12, "exp_year": 2034, "cvc": "123"},
#     )
#     print(f"[Create PM] id={pm.id} card=****{card_number[-4:]}")
#     return pm

def create_payment_method(card: str) -> stripe.PaymentMethod:
    """
    card supports:
      - tok_* : Stripe test token (recommended)
      - pm_*  : existing PaymentMethod id (if you already have one)
    """
    if not isinstance(card, str):
        raise RuntimeError("card must be a string like tok_visa or tok_chargeDeclined")

    # Create a real PaymentMethod object from a token (no raw card numbers)
    if card.startswith("tok_"):
        pm = stripe.PaymentMethod.create(
            type="card",
            card={"token": card},
        )
        print(f"[Create PM from token] token={card} pm={pm.id}")
        return pm

    # If it's already a PaymentMethod id, just "wrap" it
    if card.startswith("pm_"):
        pm = stripe.PaymentMethod.retrieve(card)
        print(f"[Use Existing PM] id={pm.id}")
        return pm

    raise RuntimeError("Unsupported card. Use tok_* or pm_*")

#debug
def create_card_source(customer_id: str, token: str) -> str:
    """
    Create a card source on the customer using a tok_* token.
    Returns source id (card_...).
    """
    card = stripe.Customer.create_source(customer_id, source=token)
    # card is a Card object with id like card_...
    print(f"[Create Card Source] token={token} source={card.id} brand={getattr(card,'brand',None)} last4={getattr(card,'last4',None)}")
    return card.id

def set_default_source(customer_id: str, source_id: str):
    stripe.Customer.modify(customer_id, default_source=source_id)
    print(f"[Set Default Source] customer={customer_id} default_source={source_id}")


def attach_and_set_default_pm(customer_id: str, pm_id: str):
    # Attach the payment method to the customer and set it as the default for invoices.
    # Robust flow: attach -> retrieve -> verify 'customer' field -> retry attach if needed.
    pm_to_use = pm_id
    try:
        attached = stripe.PaymentMethod.attach(pm_id, customer=customer_id)
        attached_id = getattr(attached, "id", None) or pm_id

        # Retrieve the payment method to verify it's attached to this customer
        try:
            pm_obj = stripe.PaymentMethod.retrieve(attached_id)
        except Exception:
            pm_obj = attached

        pm_customer = pm_obj.get("customer") if hasattr(pm_obj, "get") else getattr(pm_obj, "customer", None)
        if pm_customer != customer_id:
            # Try attaching again using the returned id
            try:
                attached2 = stripe.PaymentMethod.attach(attached_id, customer=customer_id)
                attached_id = getattr(attached2, "id", attached_id)
                try:
                    pm_obj = stripe.PaymentMethod.retrieve(attached_id)
                except Exception:
                    pass
                pm_customer = pm_obj.get("customer") if hasattr(pm_obj, "get") else getattr(pm_obj, "customer", None)
            except Exception:
                pm_customer = None

        if pm_customer == customer_id:
            pm_to_use = attached_id
        else:
            # Fall back to original id; Customer.modify may still fail if not attached.
            pm_to_use = pm_id
    except Exception:
        # Attach failed (not allowed or other error) — fall back to provided id
        pm_to_use = pm_id

    # Try to set as default; if Stripe complains the PM isn't attached, attempt attach once more and retry.
    try:
        stripe.Customer.modify(
            customer_id,
            invoice_settings={"default_payment_method": pm_to_use},
        )
        print(f"[Set Default PM] customer={customer_id} default_payment_method={pm_to_use}")
    except Exception as e:
        # Attempt to attach and retry once
        try:
            stripe.PaymentMethod.attach(pm_to_use, customer=customer_id)
            stripe.Customer.modify(
                customer_id,
                invoice_settings={"default_payment_method": pm_to_use},
            )
            print(f"[Set Default PM after attach] customer={customer_id} default_payment_method={pm_to_use}")
        except Exception:
            # Give up but log a helpful message
            print(f"[Error] Could not set default payment method {pm_to_use} for customer {customer_id}: {e}")

def create_subscription_monthly(customer_id: str, price_id: str, billing_anchor_ts: int) -> stripe.Subscription:
    """
    Create a subscription whose first billing cycle starts at billing_anchor_ts.
    We avoid immediate charge at creation time by setting billing_cycle_anchor in the future
    and turning off prorations.
    """
    sub = stripe.Subscription.create(
        customer=customer_id,
        items=[{"price": price_id, "quantity": 1}],
        collection_method="charge_automatically",
        billing_cycle_anchor=billing_anchor_ts,
        proration_behavior="none",
        payment_behavior="allow_incomplete",  # create subscription even if future payments may fail
        expand=["latest_invoice.payment_intent"]
    )
    print(f"[Create Subscription] id={sub.id} status={sub.status}")
    print(f"  billing_cycle_anchor={sub.billing_cycle_anchor} ({dt(sub.billing_cycle_anchor)})")
    if sub.latest_invoice:
        li = sub.latest_invoice
        print(f"  latest_invoice={li['id']} invoice_status={li['status']}")
        pi = li.get("payment_intent")
        if pi:
            print(f"  payment_intent={pi['id']} pi_status={pi['status']}")
    return sub

def retrieve_triplet(sub_id: str):
    """Retrieve subscription, latest_invoice, payment_intent (expanded)."""
    sub = stripe.Subscription.retrieve(sub_id, expand=["latest_invoice.payment_intent"])
    li = sub.latest_invoice
    pi = li.get("payment_intent") if li else None

    print("\n[Retrieve] subscription / latest_invoice / payment_intent")
    cpe = sub.get("current_period_end")
    cps = sub.get("current_period_start")
    print(
        f"  sub: {sub.id} status={sub.status} "
        f"current_period_start={cps} ({dt(cps) if cps else 'None'}) "
        f"current_period_end={cpe} ({dt(cpe) if cpe else 'None'})"
    )
    if li:
        print(f"  inv: {li['id']} status={li['status']} created={li['created']} ({dt(li['created'])}) attempt_count={li.get('attempt_count')}")
    else:
        print("  inv: None")
    if pi:
        print(f"  pi : {pi['id']} status={pi['status']} last_payment_error={('yes' if pi.get('last_payment_error') else 'no')}")
    else:
        print("  pi : None")

    return sub


def get_sub_next_cycle(sub: stripe.Subscription) -> int:
    """Return an integer timestamp for the subscription's next billing cycle (approx).
    Try `current_period_end`, then latest_invoice.created or period_end, then billing_cycle_anchor,
    finally fall back to `utc_now_ts()+60` to keep the script progressing.
    """
    # Try current_period_end
    cpe = sub.get("current_period_end")
    if cpe:
        return int(cpe) + 60

    # Try latest_invoice fields
    li = None
    try:
        li = sub.latest_invoice
    except Exception:
        li = sub.get("latest_invoice")

    if li:
        # li may be a StripeObject or dict-like
        created = li.get("created") if hasattr(li, "get") else getattr(li, "created", None)
        if created:
            return int(created) + 60
        period_end = li.get("period_end") if hasattr(li, "get") else getattr(li, "period_end", None)
        if period_end:
            return int(period_end) + 60

    # Try billing_cycle_anchor
    bca = sub.get("billing_cycle_anchor") or getattr(sub, "billing_cycle_anchor", None)
    if bca:
        return int(bca) + 60

    # Last resort: now + 60s
    return utc_now_ts() + 60


def next_cycle_after(billing_anchor: int, cycle_index: int, cur_frozen: int, month: int = 30 * 24 * 3600) -> int:
    """Return the next cycle timestamp for `cycle_index` that is strictly after `cur_frozen`.
    If the nominal cycle (billing_anchor + cycle_index*month + 60) is in the past, compute the
    smallest k >= cycle_index such that billing_anchor + k*month + 60 > cur_frozen.
    """
    desired = int(billing_anchor) + int(cycle_index) * int(month) + 60
    if desired > cur_frozen:
        return desired

    # number of full months elapsed since billing_anchor to move past cur_frozen
    # compute k = floor((cur_frozen - billing_anchor - 60) / month) + 1
    elapsed = cur_frozen - int(billing_anchor) - 60
    if elapsed < 0:
        k = cycle_index
    else:
        k = (elapsed // month) + 1
    # ensure we don't return an index smaller than cycle_index
    if k < cycle_index:
        k = cycle_index
    return int(billing_anchor) + k * int(month) + 60


def advance_through_retries(tc_id: str, sub_id: str, buffer_seconds: int = 60, max_rounds: int = 10):
    """
    Advance the test clock through Stripe's scheduled retry timestamps by
    inspecting the subscription's latest invoice `next_payment_attempt` field.

    This is more robust than a fixed "+N days" jump because the retry
    schedule is configured in the Dashboard and not exposed as a simple
    constant via the API. We iterate up to `max_rounds` times, advancing
    to the invoice's `next_payment_attempt + buffer_seconds` each loop.
    """
    for round_idx in range(max_rounds):
        sub = stripe.Subscription.retrieve(sub_id, expand=["latest_invoice.payment_intent"])
        li = None
        try:
            li = sub.latest_invoice
        except Exception:
            li = sub.get("latest_invoice") if hasattr(sub, "get") else None

        if not li:
            print(f"[advance_through_retries] no latest_invoice found for subscription {sub_id}; stopping")
            break

        # invoice status and next attempt timestamp (if present)
        inv_status = li.get("status") if hasattr(li, "get") else getattr(li, "status", None)
        next_attempt = li.get("next_payment_attempt") if hasattr(li, "get") else getattr(li, "next_payment_attempt", None)
        attempt_count = li.get("attempt_count") if hasattr(li, "get") else getattr(li, "attempt_count", None)

        print(f"[advance_through_retries] round={round_idx} invoice={li.get('id') if hasattr(li,'get') else getattr(li,'id',None)} status={inv_status} attempt_count={attempt_count} next_attempt={next_attempt}")

        # If invoice already paid, stop
        if inv_status == "paid":
            print("[advance_through_retries] invoice already paid; done")
            break

        # If Stripe provides a next_payment_attempt timestamp, advance to it
        if next_attempt:
            cur = stripe.test_helpers.TestClock.retrieve(tc_id).frozen_time
            target = int(next_attempt) + int(buffer_seconds)
            if target <= cur:
                target = cur + 1
            print(f"[advance_through_retries] advancing test clock {tc_id} to invoice.next_payment_attempt (+{buffer_seconds}s) -> {target} ({dt(target)})")
            advance_clock(tc_id, target)
            retrieve_triplet(sub_id)
            # re-check in next iteration
            continue

        # Fallback: no explicit next_attempt provided by Stripe; advance a day and retry
        print("[advance_through_retries] no next_payment_attempt on invoice; falling back to +1 day advance")
        cur = stripe.test_helpers.TestClock.retrieve(tc_id).frozen_time
        advance_clock(tc_id, cur + 24 * 3600)
        retrieve_triplet(sub_id)

    print("[advance_through_retries] finished")


def do_cleanup(delete: bool = True):
    """Best-effort cleanup: remove customers with @example.com and test clocks named learn_tc_/clock_."""
    print('\n[Cleanup] Removing previous test customers and test clocks...')
    SLEEP = 0.12
    try:
        for cust in stripe.Customer.list(limit=100).auto_paging_iter():
            try:
                email = getattr(cust, 'email', None) or (cust.get('email') if hasattr(cust, 'get') else None)
                if email and email.endswith('@example.com') and email.startswith('test'):
                    print(f"  Found customer {cust.id} email={email}")
                    for sub in stripe.Subscription.list(customer=cust.id).auto_paging_iter():
                        try:
                            if delete:
                                stripe.Subscription.delete(sub.id)
                                time.sleep(SLEEP)
                                print(f"    deleted subscription {sub.id}")
                        except Exception:
                            pass
                    if delete:
                        try:
                            stripe.Customer.delete(cust.id)
                            time.sleep(SLEEP)
                            print(f"    deleted customer {cust.id}")
                        except Exception:
                            pass
            except Exception:
                pass
    except Exception:
        pass

    try:
        for tc in stripe.test_helpers.TestClock.list(limit=100).auto_paging_iter():
            try:
                name = getattr(tc, 'name', None)
                if name and (name.startswith('learn_tc_') or name.startswith('clock_')):
                    print(f"  Deleting test clock {tc.id} name={name}")
                    if delete:
                        try:
                            stripe.test_helpers.TestClock.delete(tc.id)
                            time.sleep(SLEEP)
                        except Exception:
                            pass
            except Exception:
                pass
    except Exception:
        pass

    print('[Cleanup] Done.')

# ----------------------------
# Scenarios
# ----------------------------

# Use Stripe test PaymentMethod IDs to avoid sending raw card numbers to the API
# SUCCESS_CARD = "pm_card_visa"
# FAIL_CARD_DECLINE = "pm_card_chargeDeclined"
SUCCESS_CARD = "tok_visa"
FAIL_CARD_DECLINE = "tok_chargeCustomerFail"

def run_recover(email: str, price_id: str, paid_months: int = 2, past_due_months: int = 1, total_months: int = 6, auto_advance: bool = True):
    """
    Plan:
    1) Create test clock & customer
    2) Set success card as default
    3) Create subscription with billing_cycle_anchor = now + 5 minutes
    4) Advance clock to first billing date -> should pay successfully
    5) Advance additional (paid_months-1) cycles -> keep paying successfully
    6) Switch default PM to failing card BEFORE next cycle
    7) Advance to next billing date + allow retries to run -> reach past_due
    8) Keep it past_due for 'past_due_months' cycles (optional)
    9) Switch back to success card
    10) Advance to next retry/billing attempt -> invoice paid, subscription returns active
    """
    print("\n====================")
    print("SCENARIO: RECOVER")
    print("====================")

    # Create test clock & customer (no reuse)
    # Use fixed baseline start time 2025-01-01 00:00:00 UTC per request
    start = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp())
    tc = create_testclock(start)
    cust = create_customer(email, tc.id)

    # Create and attach success PM from token
    pm_success = create_payment_method(SUCCESS_CARD)
    attach_and_set_default_pm(cust.id, pm_success.id)

    billing_anchor = tc.frozen_time + 5 * 60
    sub = create_subscription_monthly(cust.id, price_id, billing_anchor)
    sub_id = sub.id
    billing_anchor = int(getattr(sub, "billing_cycle_anchor", tc.frozen_time + 5 * 60))

    # Step 1: first successful payment
    advance_clock(tc.id, billing_anchor + 60)  # 1 minute after anchor
    retrieve_triplet(sub_id)

    # Step 2: additional paid months (if any) -- use billing_anchor + 30d increments
    # billing_anchor is absolute baseline; use 30 days ~= 1 month for test clocks
    MONTH = 30 * 24 * 3600
    for i in range(1, paid_months):
        cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
        next_cycle = next_cycle_after(billing_anchor, i, cur, MONTH)
        advance_clock(tc.id, next_cycle)
        retrieve_triplet(sub_id)

    # For recover scenario, ensure at least one past-due month
    if past_due_months <= 0:
        past_due_months = 1

    # Step 3: switch to failing card BEFORE next cycle
    pm_fail = create_payment_method(FAIL_CARD_DECLINE)
    attach_and_set_default_pm(cust.id, pm_fail.id)
    print("\n[Action] Switched to FAIL card. Next charge should fail and enter dunning/retries.")

    # Step 4: advance to next billing date to trigger failure (based on billing_anchor)
    cycle_index = paid_months
    cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
    fail_cycle = next_cycle_after(billing_anchor, cycle_index, cur, MONTH)
    advance_clock(tc.id, fail_cycle)
    retrieve_triplet(sub_id)

    # Step 5: advance through retries. Use invoice-driven retry timestamps when
    # available (more robust than a fixed 4-day jump which can miss scheduled
    # retry times configured in the Dashboard).
    advance_through_retries(tc.id, sub_id)

    # Optional: keep lingering for additional months while still failing
    for j in range(past_due_months - 1):
        cycle_index += 1
        cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
        next_cycle = next_cycle_after(billing_anchor, cycle_index, cur, MONTH)
        advance_clock(tc.id, next_cycle)
        # pass retries again using invoice-driven advancement
        advance_through_retries(tc.id, sub_id)

    # Step 6: delay restoring success PM until just before the next billing cycle
    # so the failed month remains as past_due in history and recovery happens on the
    # following month's billing.
    print("\n[Info] Leaving subscription past_due for this cycle; will restore success PM before next cycle.")

    # Compute next billing cycle (the month after the failed cycle)
    cycle_index += 1
    cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
    next_cycle = next_cycle_after(billing_anchor, cycle_index, cur, MONTH)

    # Set success PM just before advancing to the next cycle so the charge will use it
    attach_and_set_default_pm(cust.id, pm_success.id)
    print("\n[Action] Switched back to SUCCESS card right before next billing cycle.")

    # Immediately attempt to finalize and pay any historical draft/open invoices
    try:
        print("[Action] Finalizing and paying historical open/draft invoices for customer")
        try:
            invoices = stripe.Invoice.list(customer=cust.id)
        except Exception:
            invoices = []
        for inv in invoices.auto_paging_iter():
            st = inv.get('status') if hasattr(inv, 'get') else getattr(inv, 'status', None)
            if st == 'draft':
                try:
                    stripe.Invoice.finalize_invoice(inv.id)
                    time.sleep(0.2)
                except Exception:
                    pass
            # re-retrieve status
            try:
                inv2 = stripe.Invoice.retrieve(inv.id)
                st2 = inv2.get('status') if hasattr(inv2, 'get') else getattr(inv2, 'status', None)
            except Exception:
                st2 = st
            if st2 in ('open', 'draft'):
                try:
                    stripe.Invoice.pay(inv.id)
                    print(f"  Paid invoice {inv.id} status={st2}")
                except Exception as e:
                    print(f"  Warning: could not pay invoice {inv.id}: {e}")
    except Exception:
        pass

    # Advance to next billing cycle to trigger recovery charge
    advance_clock(tc.id, next_cycle)
    retrieve_triplet(sub_id)

    # After recovery, optionally continue advancing months so total simulated months == total_months
    # months simulated so far = paid_months + past_due_months + 1 (recovery month)
    months_done = int(paid_months) + int(past_due_months) + 1
    MONTH = 30 * 24 * 3600
    cycle_index_local = cycle_index + 1  # cycle_index currently points to the recovery cycle we've just advanced to
    while months_done < int(total_months):
        # advance to next month (paid)
        cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
        next_cycle2 = next_cycle_after(billing_anchor, cycle_index_local, cur, MONTH)
        advance_clock(tc.id, next_cycle2)
        retrieve_triplet(sub_id)
        months_done += 1
        cycle_index_local += 1

    print("\n[Done] RECOVER scenario created.")
    print(f"  customer={cust.id}")
    print(f"  subscription={sub_id}")
    print(f"  test_clock={tc.id}")

    # Auto-advance this scenario's test clock by +2 days to help finalize invoices
    if auto_advance:
        try:
            cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
            extra = 2 * 24 * 3600  # 2 days in seconds
            print(f"\n[Auto Advance] Advancing test clock {tc.id} by +2 days ({extra} seconds) to help finalize any pending invoices.")
            advance_clock(tc.id, cur + extra)
        except Exception as e:
            print(f"[Warning] Could not auto-advance test clock {tc.id}: {e}")

    return {"customer": cust.id, "subscription": sub_id, "test_clock": tc.id}

def run_linger(email: str, price_id: str, paid_months: int = 2, total_months: int = 6, auto_advance: bool = True):
    """
    Similar to recover, but once it becomes past_due, we keep failing and never switch back.
    """
    print("\n====================")
    print("SCENARIO: LINGER")
    print("====================")

    # TestClock & Customer (always create new)
    # Use fixed baseline start time 2025-01-01 00:00:00 UTC per request
    start = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp())
    tc = create_testclock(start)
    cust = create_customer(email, tc.id)

    pm_success = create_payment_method(SUCCESS_CARD)
    attach_and_set_default_pm(cust.id, pm_success.id)

    billing_anchor = tc.frozen_time + 5 * 60
    sub = create_subscription_monthly(cust.id, price_id, billing_anchor)
    sub_id = sub.id
    billing_anchor = int(getattr(sub, "billing_cycle_anchor", tc.frozen_time + 5 * 60))

    # First successful payment
    advance_clock(tc.id, billing_anchor + 60)
    retrieve_triplet(sub_id)

    # Additional paid months
    MONTH = 30 * 24 * 3600
    for i in range(1, paid_months):
        cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
        next_cycle = next_cycle_after(billing_anchor, i, cur, MONTH)
        advance_clock(tc.id, next_cycle)
        retrieve_triplet(sub_id)

    # Switch to failing: attach failing PM from token
    pm_fail = create_payment_method(FAIL_CARD_DECLINE)
    attach_and_set_default_pm(cust.id, pm_fail.id)
    print("\n[Action] Switched to FAIL card. Will linger past_due.")

    # Trigger failure at next billing date (based on billing_anchor)
    cycle_index = paid_months
    cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
    fail_cycle = next_cycle_after(billing_anchor, cycle_index, cur, MONTH)
    advance_clock(tc.id, fail_cycle)
    retrieve_triplet(sub_id)

    # Pass retries to reach past_due (use invoice-driven advancement)
    advance_through_retries(tc.id, sub_id)

    # Linger for remaining cycles until total_months is reached.
    # months_done counts months simulated so far: paid_months paid + 1 failed month
    months_done = int(paid_months) + 1
    while months_done < int(total_months):
        cycle_index += 1
        cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
        next_cycle = next_cycle_after(billing_anchor, cycle_index, cur, MONTH)
        advance_clock(tc.id, next_cycle)
        # run retries for the failed cycle (invoice-driven)
        advance_through_retries(tc.id, sub_id)
        months_done += 1

    print("\n[Done] LINGER scenario created.")
    print(f"  customer={cust.id}")
    print(f"  subscription={sub_id}")
    print(f"  test_clock={tc.id}")

    # Auto-advance this scenario's test clock by +2 days to help finalize invoices
    if auto_advance:
        try:
            cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
            extra = 2 * 24 * 3600  # 2 days
            print(f"\n[Auto Advance] Advancing test clock {tc.id} by +2 days ({extra} seconds) to help finalize any pending invoices.")
            advance_clock(tc.id, cur + extra)
        except Exception as e:
            print(f"[Warning] Could not auto-advance test clock {tc.id}: {e}")

    return {"customer": cust.id, "subscription": sub_id, "test_clock": tc.id}

# ----------------------------
# Main
# ----------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=["recover", "linger"], required=True)
    parser.add_argument("--email", required=False, default="test1@example.com", help="customer email, e.g. learn_recover_001@example.com (ignored in --count batch mode)")
    parser.add_argument("--paid_months", type=int, default=2)
    parser.add_argument("--past_due_months", type=int, default=1, help="only for recover")
    parser.add_argument("--linger_months", type=int, default=2, help="only for linger")
    parser.add_argument("--cleanup", action="store_true", help="If set, delete prior test customers and test clocks before running the scenario")
    # Batch options (when creating multiple recover users)
    parser.add_argument("--count", type=int, default=0, help="If >0, create this many users instead of a single --email")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducible paid/past_due sampling when --count>0")
    parser.add_argument("--email-prefix", type=str, default="test", help="Prefix for generated emails when --count>0 (emails: <prefix>1@example.com)")
    parser.add_argument("--min-paid", type=int, default=1, help="min paid_months when sampling for batch")
    parser.add_argument("--max-paid", type=int, default=3, help="max paid_months when sampling for batch")
    parser.add_argument("--min-past-due", type=int, default=0, help="min past_due_months when sampling for batch")
    parser.add_argument("--max-past-due", type=int, default=2, help="max past_due_months when sampling for batch")
    parser.add_argument("--total-months", type=int, default=6, help="Total months to simulate per customer (paid + past_due + recovery + extra paid months)")
    # No reuse options: the script always creates new test clock/customer and uses built-in tokens
    args = parser.parse_args()

    stripe.api_key = must_env("STRIPE_SECRET_KEY")
    price_id = must_env("PRICE_ID")

    if getattr(args, 'cleanup', False):
        try:
            do_cleanup(delete=True)
        except Exception as e:
            print(f"[Warning] cleanup failed: {e}")

    result = None

    # Batch mode: create many customers when --count>0
    if getattr(args, 'count', 0) and args.count > 0:
        if args.seed is not None:
            random.seed(args.seed)

        print(f"Batch mode: creating {args.count} customers with prefix '{args.email_prefix}' for scenario {args.scenario}")
        for i in range(1, args.count + 1):
            paid = random.randint(args.min_paid, args.max_paid)
            # email_i = f"{args.email_prefix}{i}@example.com"
            email_i = f"{args.email_prefix}{i}@actual.com"
            if args.scenario == 'recover':
                # ensure at least 1 past_due for recover
                max_pd = max(1, args.max_past_due)
                min_pd = max(1, args.min_past_due)
                past_due = random.randint(min_pd, max_pd)
                print(f"\n[Batch] ({i}/{args.count}) email={email_i} paid_months={paid} past_due_months={past_due}")
                res = run_recover(email_i, price_id, paid_months=paid, past_due_months=past_due, total_months=args.total_months)
                result = res
            else:
                # For linger batch mode: sample paid months, then linger until total_months
                print(f"\n[Batch] ({i}/{args.count}) email={email_i} paid_months={paid} total_months={args.total_months} (linger)")
                res = run_linger(email_i, price_id, paid_months=paid, total_months=args.total_months)
                result = res
            time.sleep(0.2)
    else:
        if args.scenario == "recover":
            # enforce at least 1 past_due for recover
            pd = args.past_due_months if args.past_due_months and args.past_due_months > 0 else 1
            result = run_recover(
                args.email,
                price_id,
                paid_months=args.paid_months,
                past_due_months=pd,
                total_months=args.total_months,
            )
        else:
            result = run_linger(
                args.email,
                price_id,
                paid_months=args.paid_months,
                total_months=args.total_months,
            )

    # No global auto-advance here; each scenario advances its own test clock by +2 days.

if __name__ == "__main__":
    main()
