"""
Generate Stripe upgrade test data.

Behavior:
 - Creates `--count` customers (default 10) at 2025-01-01 (all created in January)
 - Subscribes them to a base price (`BASE_PRICE_ID`) and after a random 1-4 months upgrades
   the subscription to `UPGRADE_PRICE_ID`.
 - Simulates `--months` months total (default 6) by advancing Test Clocks and paying invoices.

Usage:
 - Set `STRIPE_SECRET_KEY` environment variable to your test secret key (sk_test_...)
 - Run: python generate_upgrade.py --count 10 --months 6

Notes:
 - Uses Test Clocks like `generate_date.py` and follows similar creation/advance logic.
 - No cancellations or past-due flows — only create, upgrade, and pay invoices.
"""

import os
import time
import random
import argparse
from datetime import datetime, timedelta, timezone

import stripe

# Config
DEFAULT_CUSTOMER_COUNT = 10
DEFAULT_MONTHS = 6
SLEEP_BETWEEN_CALLS = 0.12

# Provided by user (can be overridden via env)
BASE_PRICE_ID = os.environ.get('BASE_PRICE_ID') or 'price_1Sv8ZRBJL1dlpEW5iWg9KHV0'
UPGRADE_PRICE_ID = os.environ.get('UPGRADE_PRICE_ID') or 'price_1SvplkBJL1dlpEW5Xx6cS9ll'


def ts(dt: datetime) -> int:
    return int(dt.timestamp())


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


def main():
    parser = argparse.ArgumentParser(description="Generate Stripe upgrade test data using Test Clocks")
    parser.add_argument('--count', type=int, default=DEFAULT_CUSTOMER_COUNT, help='Number of customers to create')
    parser.add_argument('--months', type=int, default=DEFAULT_MONTHS, help='Months of history to simulate')
    parser.add_argument('--seed', type=int, default=42, help='Random seed for reproducible results')
    parser.add_argument('--cleanup', action='store_true', help='(Optional) delete previous test data matching pattern')
    args = parser.parse_args()

    _load_dotenv()

    stripe_key = os.environ.get('STRIPE_SECRET_KEY')
    if not stripe_key:
        print('ERROR: Set STRIPE_SECRET_KEY environment variable to your test secret key (sk_test_...)')
        return

    stripe.api_key = stripe_key
    random.seed(args.seed)

    # fixed baseline start time
    start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

    # Validate price ids quickly
    try:
        _ = stripe.Price.retrieve(BASE_PRICE_ID)
        _ = stripe.Price.retrieve(UPGRADE_PRICE_ID)
    except Exception as e:
        print('Warning: could not retrieve provided price ids from Stripe. Proceeding anyway. Error:', e)

    summary = {'created_customers': 0, 'upgrades': 0, 'invoices_paid': 0}
    created = []

    total = args.count

    # Create all customers in January (month 0)
    creation_dt = start
    creation_ts = ts(creation_dt)

    print(f'Creating {total} customers in {creation_dt.isoformat()} and simulating {args.months} months')

    for i in range(total):
        # email = f'upgrade{i+1}@example.com'
        email = f'upgrade{i+1}@actual.com'
        name = f'Upgrade Test {i+1}'

        clock_name = f'clock_{i+1}_{int(time.time())}'
        tc = create_test_clock(stripe, frozen_time=creation_ts, name=clock_name)
        time.sleep(SLEEP_BETWEEN_CALLS)

        customer = stripe.Customer.create(email=email, name=name, test_clock=tc.id)
        time.sleep(SLEEP_BETWEEN_CALLS)

        # attach working payment method
        try:
            card = stripe.Customer.create_source(customer.id, source='tok_visa')
            time.sleep(SLEEP_BETWEEN_CALLS)
            try:
                stripe.Customer.modify(customer.id, default_source=card.id)
                time.sleep(SLEEP_BETWEEN_CALLS)
            except Exception:
                pass
        except Exception:
            pass

        # create subscription on base price
        try:
            sub = stripe.Subscription.create(customer=customer.id, items=[{'price': BASE_PRICE_ID}], expand=['latest_invoice', 'items'])
            time.sleep(SLEEP_BETWEEN_CALLS)
        except Exception:
            sub = stripe.Subscription.create(customer=customer.id, items=[{'price': BASE_PRICE_ID}], expand=['latest_invoice', 'items'])
            time.sleep(SLEEP_BETWEEN_CALLS)

        # try to find subscription item id
        sub_item_id = None
        try:
            items = getattr(sub, 'items', None) or (sub.get('items') if hasattr(sub, 'get') else None)
            if items:
                data = getattr(items, 'data', None) or (items.get('data') if hasattr(items, 'get') else None)
                if data and len(data) > 0:
                    sub_item_id = data[0].id if hasattr(data[0], 'id') else (data[0].get('id') if isinstance(data[0], dict) else None)
        except Exception:
            pass

        # pick upgrade month offset after 1-4 paid months
        upgrade_after = random.randint(1, 4)

        created.append({
            'email': email,
            'customer_id': customer.id,
            'tc_id': tc.id,
            'sub_id': sub.id,
            'sub_item_id': sub_item_id,
            'upgrade_after': upgrade_after,
        })

        summary['created_customers'] += 1

        print(f'  Created {email} (cust={customer.id}) -> will upgrade after {upgrade_after} month(s)')

    # Simulate months 0 .. months-1
    for month in range(args.months):
        current_dt = (start + timedelta(days=30 * month)).replace(hour=0, minute=0, second=0, microsecond=0)
        current_ts = ts(current_dt)
        print(f'--- Simulating month {month+1}/{args.months} ({current_dt.date()}) ---')

        for rec in created:
            # Advance to start-of-month by default; if this customer upgrades this month,
            # advance to mid-month (+15 days) before performing the upgrade to make it more visible.
            try:
                if month == rec['upgrade_after']:
                    mid_dt = current_dt + timedelta(days=15)
                    target_ts = ts(mid_dt)
                else:
                    target_ts = current_ts
                advance_test_clock(stripe, rec['tc_id'], frozen_time=target_ts)
            except Exception as e:
                print(f'  Warning: could not advance clock for {rec["email"]}: {e}')
            time.sleep(SLEEP_BETWEEN_CALLS)

            # perform upgrade on the scheduled month
            if month == rec['upgrade_after']:
                try:
                    # Preferred: update the existing subscription item to the upgrade price (no double billing)
                    if rec.get('sub_item_id'):
                        try:
                            stripe.Subscription.modify(
                                rec['sub_id'],
                                items=[{'id': rec['sub_item_id'], 'price': UPGRADE_PRICE_ID}],
                                proration_behavior='none'
                            )
                        except Exception:
                            # If updating the item fails, try deleting the old item and adding the new price
                            try:
                                stripe.Subscription.modify(
                                    rec['sub_id'],
                                    items=[
                                        {'id': rec['sub_item_id'], 'deleted': True},
                                        {'price': UPGRADE_PRICE_ID}
                                    ],
                                    proration_behavior='none'
                                )
                            except Exception:
                                # Last resort: remove the old subscription (delete if possible) then create a new one
                                try:
                                    stripe.Subscription.delete(rec['sub_id'])
                                except Exception:
                                    try:
                                        stripe.Subscription.modify(rec['sub_id'], cancel_at_period_end=True)
                                    except Exception:
                                        pass
                                try:
                                    stripe.Subscription.create(customer=rec['customer_id'], items=[{'price': UPGRADE_PRICE_ID}])
                                except Exception:
                                    pass
                    else:
                        # No subscription item id: create a fresh subscription with the upgrade price
                        try:
                            # Cancel any existing subscription id to avoid double billing
                            try:
                                stripe.Subscription.delete(rec['sub_id'])
                            except Exception:
                                try:
                                    stripe.Subscription.modify(rec['sub_id'], cancel_at_period_end=True)
                                except Exception:
                                    pass
                            stripe.Subscription.create(customer=rec['customer_id'], items=[{'price': UPGRADE_PRICE_ID}])
                        except Exception:
                            pass

                    summary['upgrades'] += 1
                    print(f'  Upgraded {rec["email"]} to upgrade price at month {month+1}')
                except Exception as e:
                    print(f'  Warning: failed to upgrade {rec["email"]}: {e}')

            # pay any open/draft invoices
            try:
                invs = stripe.Invoice.list(customer=rec['customer_id'])
                for inv in invs.auto_paging_iter():
                    st = getattr(inv, 'status', None) or (inv.get('status') if hasattr(inv, 'get') else None)
                    if st in ('open', 'draft'):
                        try:
                            stripe.Invoice.pay(inv.id)
                            summary['invoices_paid'] += 1
                        except Exception:
                            pass
            except Exception:
                pass

            time.sleep(0.05)

    # summary and persist
    print('\nSummary:')
    for k, v in summary.items():
        print(f'- {k}: {v}')

    try:
        import json
        with open('generated_upgrade_customers.json', 'w', encoding='utf-8') as fh:
            json.dump(created, fh, indent=2)
        print(f"Wrote {len(created)} created customers to generated_upgrade_customers.json")
    except Exception:
        pass

    print('\nDone. Inspect the Stripe Dashboard (test mode) to verify customers, subscriptions, and invoices.')


if __name__ == '__main__':
    main()
