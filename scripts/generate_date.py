"""
Generate Stripe test data using Test Clocks to simulate 6 months of billing history.

Usage:
  - Set environment variable `STRIPE_SECRET_KEY` to your test secret key (sk_test_...)
  - Install dependencies: pip install -r requirements.txt
  - Run: python generate_stripe_test_data.py --count 60 --months 6

Notes:
  - The script creates one Test Clock per customer and advances it month-by-month.
  - It creates a product and a monthly price, then subscribes customers to that price.
  - For 'Active' customers, invoices are paid automatically using a working test card.
  - For 'Past Due' customers, one random invoice is left unpaid to generate past-due state.
  - For 'Canceled' customers, subscriptions are canceled after a few months.

Be careful: this operates against Stripe test API only. Do NOT use live keys.
"""

import os
import time
import random
import argparse
from datetime import datetime, timedelta, timezone

import stripe
import os

# Config defaults
DEFAULT_CUSTOMER_COUNT = 60
DEFAULT_MONTHS = 6

PAYMENT_CARD_OK = {
    'type': 'card',
    'card': {
        'number': '4242424242424242',
        'exp_month': 12,
        'exp_year': 2030,
        'cvc': '123',
    }
}

PAYMENT_CARD_DECLINE = {
    'type': 'card',
    'card': {
        'number': '4000000000000341',
        'exp_month': 12,
        'exp_year': 2030,
        'cvc': '123',
    }
}

SLEEP_BETWEEN_CALLS = 0.12


def ts(dt: datetime) -> int:
    return int(dt.timestamp())


def create_test_clock(stripe_module, frozen_time, name):
    try:
        tc = stripe_module.test_helpers.TestClock.create(frozen_time=frozen_time, name=name)
    except Exception:
        tc = stripe_module.test_helpers.test_clock.create(frozen_time=frozen_time, name=name)
    return tc


def advance_test_clock(stripe_module, clock_id, frozen_time):
    # Retrieve current clock frozen_time and ensure new frozen_time is strictly greater
    try:
        tc = stripe_module.test_helpers.TestClock.retrieve(clock_id)
        cur = getattr(tc, 'frozen_time', None) or (tc.get('frozen_time') if hasattr(tc, 'get') else None)
    except Exception:
        cur = None

    if cur is not None and frozen_time <= cur:
        frozen_time = cur + 1

    # Try advancing with RateLimit backoff (a few attempts), then poll until TestClock is 'ready'
    max_advance_attempts = 8
    backoff = 0.5
    advanced = False
    for attempt in range(max_advance_attempts):
        try:
            stripe_module.test_helpers.TestClock.advance(clock_id, frozen_time=frozen_time)
            advanced = True
            break
        except stripe.error.RateLimitError:
            time.sleep(backoff)
            backoff = min(backoff * 1.5, 5.0)
            continue
        except Exception:
            time.sleep(backoff)
            backoff = min(backoff * 1.5, 5.0)
            continue

    if not advanced:
        raise RuntimeError(f'Failed to advance test clock {clock_id} after {max_advance_attempts} attempts')

    # Poll until TestClock reports status 'ready' and frozen_time >= requested time
    timeout = 60
    start = time.time()
    while True:
        try:
            tc2 = stripe_module.test_helpers.TestClock.retrieve(clock_id)
            status = getattr(tc2, 'status', None) or (tc2.get('status') if hasattr(tc2, 'get') else None)
            new_frozen = getattr(tc2, 'frozen_time', None) or (tc2.get('frozen_time') if hasattr(tc2, 'get') else None)
            if status == 'ready' and (new_frozen is None or new_frozen >= frozen_time):
                return tc2
        except Exception:
            pass
        if time.time() - start > timeout:
            raise TimeoutError(f'TestClock {clock_id} not ready after {timeout}s (requested frozen_time={frozen_time})')
        time.sleep(1)


def cancel_subscription_retry(sub_id, max_retries=20):
    backoff = 0.5
    for attempt in range(max_retries):
        try:
            stripe.Subscription.delete(sub_id)
            return True
        except stripe.error.RateLimitError:
            time.sleep(backoff)
            backoff = min(backoff * 1.5, 2.0)
            continue
        except Exception:
            # If delete fails for other reasons (e.g., transient), try scheduling cancellation at period end
            try:
                stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
                return True
            except Exception:
                time.sleep(backoff)
                backoff = min(backoff * 1.5, 2.0)
                continue
    return False

# --- end helpers ---


def main():
    parser = argparse.ArgumentParser(description="Generate Stripe test billing data using Test Clocks")
    parser.add_argument('--count', type=int, default=DEFAULT_CUSTOMER_COUNT, help='Number of customers to create')
    parser.add_argument('--months', type=int, default=DEFAULT_MONTHS, help='Months of history to simulate')
    parser.add_argument('--seed', type=int, default=42, help='Random seed for reproducible results')
    parser.add_argument('--cleanup', action='store_true', help='Delete previously-created test data before generating')
    parser.add_argument('--active-pct', type=float, default=80.0, help='Percent of customers that should be Active')
    parser.add_argument('--canceled-pct', type=float, default=20.0, help='Percent of customers that should be Canceled')
    parser.add_argument('--annual-pct', type=float, default=20.0, help='Percent of customers that should be annual (billed yearly)')
    args = parser.parse_args()

    # Load .env if present so users can keep STRIPE_SECRET_KEY in repo root
    def _load_dotenv(path: str = ".env") -> None:
        if not os.path.exists(path):
            return
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for ln in fh:
                    ln = ln.strip()
                    if not ln or ln.startswith("#") or "=" not in ln:
                        continue
                    k, v = ln.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass

    _load_dotenv()

    stripe_key = os.environ.get('STRIPE_SECRET_KEY')
    if not stripe_key:
        print('ERROR: Set STRIPE_SECRET_KEY environment variable to your test secret key (sk_test_...)')
        return

    stripe.api_key = stripe_key
    random.seed(args.seed)

    # Validate percentages (active + canceled must sum to ~100)
    total_pct = args.active_pct + args.canceled_pct
    if abs(total_pct - 100.0) > 0.001:
        print(f'ERROR: Status percentages must sum to 100 (active + canceled). Got {total_pct}')
        return

    def do_cleanup():
        print('Cleanup: listing and removing previous test customers, subscriptions, test clocks, and products...')
        # Delete customers matching our test email/name pattern
        try:
            for cust in stripe.Customer.list(limit=100).auto_paging_iter():
                try:
                    if cust.email and cust.email.endswith('@actual.com') and (cust.email.startswith('active') or cust.email.startswith('cancel')):
                        # delete subscriptions
                        for sub in stripe.Subscription.list(customer=cust.id).auto_paging_iter():
                            try:
                                stripe.Subscription.delete(sub.id)
                                time.sleep(SLEEP_BETWEEN_CALLS)
                            except Exception:
                                pass
                        try:
                            stripe.Customer.delete(cust.id)
                            time.sleep(SLEEP_BETWEEN_CALLS)
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            pass

        # Delete test clocks with name prefix
        try:
            for tc in stripe.test_helpers.TestClock.list(limit=100).auto_paging_iter():
                try:
                    if tc.name and tc.name.startswith('clock_'):
                        try:
                            stripe.test_helpers.TestClock.delete(tc.id)
                            time.sleep(SLEEP_BETWEEN_CALLS)
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            pass

        # Delete product(s) created by previous runs
        try:
            for prod in stripe.Product.list(limit=100).auto_paging_iter():
                try:
                    if prod.name and prod.name.startswith('Test Product - Billing Historical'):
                        # delete prices first
                        for pr in stripe.Price.list(product=prod.id).auto_paging_iter():
                            try:
                                stripe.Price.delete(pr.id)
                                time.sleep(SLEEP_BETWEEN_CALLS)
                            except Exception:
                                pass
                        try:
                            stripe.Product.delete(prod.id)
                            time.sleep(SLEEP_BETWEEN_CALLS)
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            pass

        print('Cleanup complete.')

    if args.cleanup:
        do_cleanup()

    # Basic product + price setup
    # If PRICE_ID is provided in the environment, use that price instead of creating a new product/price.
    env_price_id = os.environ.get('PRICE_ID')
    if env_price_id:
        print(f'Using PRICE_ID from environment: {env_price_id}')
        price = stripe.Price.retrieve(env_price_id)
        time.sleep(SLEEP_BETWEEN_CALLS)

        # Try to locate an annual price on the same product; fall back to creating one if possible
        annual_price = None
        try:
            prod_id = getattr(price, 'product', None) or (price.get('product') if hasattr(price, 'get') else None)
            if prod_id:
                for pr in stripe.Price.list(product=prod_id).auto_paging_iter():
                    try:
                        rec = getattr(pr, 'recurring', None) or (pr.get('recurring') if hasattr(pr, 'get') else None)
                        if rec and rec.get('interval') == 'year':
                            annual_price = pr
                            break
                    except Exception:
                        pass
        except Exception:
            prod_id = None

        if not annual_price:
            # If we can determine a unit_amount and product, create an annual price (12x monthly)
            try:
                unit = getattr(price, 'unit_amount', None) or (price.get('unit_amount') if hasattr(price, 'get') else None)
                currency = getattr(price, 'currency', None) or (price.get('currency') if hasattr(price, 'get') else 'usd')
                if unit and prod_id:
                    annual_price = stripe.Price.create(
                        unit_amount=(int(unit) * 12),
                        currency=currency,
                        recurring={'interval': 'year'},
                        product=prod_id,
                    )
                    time.sleep(SLEEP_BETWEEN_CALLS)
            except Exception:
                annual_price = None
    else:
        print('Creating product and price...')
        product = stripe.Product.create(name='Test Product - Billing Historical')
        time.sleep(SLEEP_BETWEEN_CALLS)
        price = stripe.Price.create(
            unit_amount=1000,
            currency='usd',
            recurring={'interval': 'month'},
            product=product.id,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)

        # Create an annual price (12x monthly) for annual subscriptions
        annual_price = stripe.Price.create(
            unit_amount=1000 * 12,
            currency='usd',
            recurring={'interval': 'year'},
            product=product.id,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)

    # Fixed baseline start time for test clocks (per user request)
    # Only change: set the initial test-clock baseline to 2025-01-01 00:00:00 UTC.
    # All other logic (random creation months, month increments, etc.) remains unchanged.
    start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    start_ts = ts(start)

    # Prepare summary, created list, and MRR tracking per month
    summary = {'created_customers': 0, 'subscriptions': 0, 'invoices_paid': 0, 'invoices_unpaid': 0}
    created_customers = []
    total_customers = args.count

    # Determine exact counts for each status (active and canceled)
    active_count = int(total_customers * args.active_pct / 100.0)
    canceled_count = int(total_customers * args.canceled_pct / 100.0)
    statuses = (['active'] * active_count) + (['canceled'] * canceled_count)
    if len(statuses) < total_customers:
        statuses += ['active'] * (total_customers - len(statuses))

    # Determine who is annual vs monthly
    annual_count = int(total_customers * args.annual_pct / 100.0)
    annual_flags = ([True] * annual_count) + ([False] * (total_customers - annual_count))

    # Shuffle assignment so status/annual aren't correlated with index
    combined = list(zip(statuses, annual_flags))
    random.shuffle(combined)

    # Randomly choose creation month for each customer so new users arrive in random monthly batches
    creation_months = [random.randint(0, args.months - 1) for _ in range(total_customers)]

    print(f'Planned status distribution: active={active_count}, canceled={canceled_count}, annual={annual_count}')

    # (MRR tracking removed — not needed for test data generation)

    # Create customers only in their assigned month and simulate remaining months for each customer
    for month in range(args.months):
        # creation time for customers created this month
        creation_dt = (start + timedelta(days=30 * month)).replace(hour=0, minute=0, second=0, microsecond=0)
        creation_ts = ts(creation_dt)

        # find indexes to create this month
        to_create = [i for i, cm in enumerate(creation_months) if cm == month]

        for i in to_create:
            # Determine assigned status and billing frequency for this index
            chosen_status, is_annual = combined[i]

            # Use 'active' or 'cancel' as local-part prefix and '@actual.com' as domain
            if chosen_status == 'canceled':
                local = f'cancel{i+1}'
            else:
                local = f'active{i+1}'
            email = f'{local}@actual.com'
            cust_name = f'Test User {i+1}'

            # Create a test clock starting at the customer's creation month
            clock_name = f'clock_{i+1}_{int(time.time())}'
            tc = create_test_clock(stripe, frozen_time=creation_ts, name=clock_name)
            time.sleep(SLEEP_BETWEEN_CALLS)

            # Create customer associated with the test clock
            customer = stripe.Customer.create(email=email, name=cust_name, test_clock=tc.id)
            time.sleep(SLEEP_BETWEEN_CALLS)

            # Determine which price to use
            price_id = annual_price.id if is_annual else price.id

            if chosen_status == 'canceled':
                # Canceled flow: keep logic intact, but simulate only remaining months
                try:
                    stripe.Customer.create_source(customer.id, source='tok_visa')
                    time.sleep(SLEEP_BETWEEN_CALLS)
                except Exception:
                    pass

                try:
                    sub = stripe.Subscription.create(customer=customer.id, items=[{'price': price_id}], expand=['latest_invoice'])
                    time.sleep(SLEEP_BETWEEN_CALLS)
                except Exception:
                    sub = stripe.Subscription.create(customer=customer.id, items=[{'price': price_id}], expand=['latest_invoice'])
                    time.sleep(SLEEP_BETWEEN_CALLS)

                summary['created_customers'] += 1
                summary['subscriptions'] += 1
                created_customers.append({'email': email, 'id': customer.id})

                months_remaining = args.months - month
                cancel_after = random.randint(1, max(1, months_remaining))

                for m2 in range(months_remaining):
                    current_dt = (start + timedelta(days=30 * (month + m2))).replace(hour=0, minute=0, second=0, microsecond=0)
                    current_ts = ts(current_dt)
                    try:
                        advance_test_clock(stripe, tc.id, frozen_time=current_ts)
                    except Exception as e:
                        print(f'  Warning: failed to advance test clock to {current_ts} for {email}: {e}')
                    time.sleep(SLEEP_BETWEEN_CALLS)

                    # Give Stripe a moment to generate invoices
                    time.sleep(0.25)

                    try:
                        invoices = stripe.Invoice.list(customer=customer.id)
                        for inv in invoices.auto_paging_iter():
                            if inv.status in ('open', 'draft'):
                                try:
                                    stripe.Invoice.pay(inv.id)
                                    summary['invoices_paid'] += 1
                                except Exception:
                                    pass
                    except Exception:
                        pass

                    if (m2 + 1) >= cancel_after:
                        canceled = cancel_subscription_retry(sub.id)
                        if canceled:
                            pass
                        break

                print(f'Created canceled customer {email} (customer id: {customer.id}), canceled after month {cancel_after} (created in month {month+1})')

                # Auto-advance this customer's test clock by +2 days to help finalize any pending invoices
                try:
                    cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
                    extra = 2 * 24 * 3600  # 2 days in seconds
                    try:
                        advance_test_clock(stripe, tc.id, frozen_time=cur + extra)
                        print(f"[Auto Advance] Advanced test clock {tc.id} by +2 days ({extra} seconds)")
                    except Exception as e:
                        print(f"[Warning] Could not auto-advance test clock {tc.id}: {e}")
                except Exception:
                    pass

                # After auto-advance, attempt to finalize/pay any draft/open invoices (retry a few times)
                try:
                    for attempt in range(3):
                        anything = False
                        try:
                            invoices = stripe.Invoice.list(customer=customer.id)
                        except Exception:
                            invoices = []
                        for inv in invoices.auto_paging_iter():
                            st = getattr(inv, 'status', None) or (inv.get('status') if hasattr(inv, 'get') else None)
                            if st == 'draft':
                                try:
                                    stripe.Invoice.finalize_invoice(inv.id)
                                    anything = True
                                    time.sleep(0.2)
                                except Exception:
                                    pass
                            # Try to pay if open or draft (pay may raise; ignore)
                            st2 = st
                            try:
                                inv2 = stripe.Invoice.retrieve(inv.id)
                                st2 = getattr(inv2, 'status', None) or (inv2.get('status') if hasattr(inv2, 'get') else None)
                            except Exception:
                                pass
                            if st2 in ('open', 'draft'):
                                try:
                                    stripe.Invoice.pay(inv.id)
                                    summary['invoices_paid'] += 1
                                    anything = True
                                except Exception:
                                    pass
                        if not anything:
                            break
                        time.sleep(0.5)
                except Exception:
                    pass

            else:
                # Active/default flow: attach a working token and create subscription, then simulate remaining months
                try:
                    token_str = 'tok_visa'
                    card = stripe.Customer.create_source(customer.id, source=token_str)
                    time.sleep(SLEEP_BETWEEN_CALLS)
                    stripe.Customer.modify(customer.id, default_source=card.id)
                    time.sleep(SLEEP_BETWEEN_CALLS)
                except Exception:
                    pass

                try:
                    sub = stripe.Subscription.create(customer=customer.id, items=[{'price': price_id}], expand=['latest_invoice'])
                    time.sleep(SLEEP_BETWEEN_CALLS)
                except Exception:
                    sub = stripe.Subscription.create(customer=customer.id, items=[{'price': price_id}], expand=['latest_invoice'])
                    time.sleep(SLEEP_BETWEEN_CALLS)

                summary['created_customers'] += 1
                summary['subscriptions'] += 1
                created_customers.append({'email': email, 'id': customer.id})

                months_remaining = args.months - month
                for m2 in range(months_remaining):
                    current_dt = (start + timedelta(days=30 * (month + m2))).replace(hour=0, minute=0, second=0, microsecond=0)
                    current_ts = ts(current_dt)
                    try:
                        advance_test_clock(stripe, tc.id, frozen_time=current_ts)
                    except Exception as e:
                        print(f'  Warning: failed to advance test clock to {current_ts} for {email}: {e}')
                    time.sleep(SLEEP_BETWEEN_CALLS)

                    time.sleep(0.2)

                    try:
                        invoices = stripe.Invoice.list(customer=customer.id)
                        for inv in invoices.auto_paging_iter():
                            if inv.status in ('open', 'draft'):
                                try:
                                    stripe.Invoice.pay(inv.id)
                                    summary['invoices_paid'] += 1
                                except Exception:
                                    summary['invoices_unpaid'] += 1
                    except Exception:
                        pass

                # Auto-advance this customer's test clock by +2 days to help finalize any pending invoices
                try:
                    cur = stripe.test_helpers.TestClock.retrieve(tc.id).frozen_time
                    extra = 2 * 24 * 3600
                    try:
                        advance_test_clock(stripe, tc.id, frozen_time=cur + extra)
                        print(f"[Auto Advance] Advanced test clock {tc.id} by +2 days ({extra} seconds)")
                    except Exception as e:
                        print(f"[Warning] Could not auto-advance test clock {tc.id}: {e}")
                except Exception:
                    pass

                # After auto-advance, attempt to finalize/pay any draft/open invoices (retry a few times)
                try:
                    for attempt in range(3):
                        anything = False
                        try:
                            invoices = stripe.Invoice.list(customer=customer.id)
                        except Exception:
                            invoices = []
                        for inv in invoices.auto_paging_iter():
                            st = getattr(inv, 'status', None) or (inv.get('status') if hasattr(inv, 'get') else None)
                            if st == 'draft':
                                try:
                                    stripe.Invoice.finalize_invoice(inv.id)
                                    anything = True
                                    time.sleep(0.2)
                                except Exception:
                                    pass
                            # Try to pay if open or draft
                            st2 = st
                            try:
                                inv2 = stripe.Invoice.retrieve(inv.id)
                                st2 = getattr(inv2, 'status', None) or (inv2.get('status') if hasattr(inv2, 'get') else None)
                            except Exception:
                                pass
                            if st2 in ('open', 'draft'):
                                try:
                                    stripe.Invoice.pay(inv.id)
                                    summary['invoices_paid'] += 1
                                    anything = True
                                except Exception:
                                    pass
                        if not anything:
                            break
                        time.sleep(0.5)
                except Exception:
                    pass

    print('\nSummary:')
    for k, v in summary.items():
        print(f'- {k}: {v}')
    # Print normalized MRR by month (annual invoices are divided by 12)
    # MRR printing removed — not required for test data generation
    # persist created customer ids to a file for downstream ingestion convenience
    try:
        import json
        with open('generated_customers.json', 'w', encoding='utf-8') as fh:
            json.dump(created_customers, fh, indent=2)
        print(f"Wrote {len(created_customers)} created customers to generated_customers.json")
    except Exception:
        pass
    print('\nDone. Check the Stripe Dashboard (test mode) to inspect customers, subscriptions, invoices, and test clocks.')


if __name__ == '__main__':
    main()
