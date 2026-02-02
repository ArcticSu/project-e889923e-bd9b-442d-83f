#!/usr/bin/env python3
"""
Stripe -> BigQuery ETL (Customer.search entry, full import, FIX invoice.subscription_id)

Your confirmed assumption:
- Each customer has exactly ONE subscription.
- Invoices are manually created => invoice.subscription is often NULL.
Goal:
- Still start from Customer.search
- Import customers, subscriptions
- Import invoices per customer (NOT per subscription)
- Fill invoice.subscription_id in ETL using mapping: customer_id -> subscription_id

Env required:
  STRIPE_SECRET_KEY
  GOOGLE_APPLICATION_CREDENTIALS
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

import stripe
from google.cloud import bigquery


# Be gentle to Stripe API
SLEEP_SECONDS = 0.05
SLEEP_EVERY_N = 80


def iso(ts: Optional[int]) -> Optional[str]:
    if ts is None:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()


def get_stripe_key() -> str:
    k = os.environ.get("STRIPE_SECRET_KEY")
    if not k:
        raise RuntimeError("Set STRIPE_SECRET_KEY environment variable.")
    return k


def safe_get(d: Any, *keys, default=None):
    cur = d
    for k in keys:
        if cur is None:
            return default
        if isinstance(cur, dict):
            cur = cur.get(k)
        else:
            try:
                cur = getattr(cur, k)
            except Exception:
                return default
    return default if cur is None else cur


# -----------------------
# BigQuery helpers
# -----------------------
def ensure_dataset(bq: bigquery.Client, project_id: str, dataset_id: str) -> bigquery.DatasetReference:
    ds_ref = bigquery.DatasetReference(project_id, dataset_id)
    bq.get_dataset(ds_ref)  # raises if missing
    return ds_ref


def ensure_table(bq: bigquery.Client, ds_ref: bigquery.DatasetReference, table_name: str, schema: List[bigquery.SchemaField]):
    table_ref = ds_ref.table(table_name)
    try:
        bq.get_table(table_ref)
    except Exception:
        bq.create_table(bigquery.Table(table_ref, schema=schema), exists_ok=True)


def truncate_table(bq: bigquery.Client, project_id: str, dataset_id: str, table_name: str):
    sql = f"TRUNCATE TABLE `{project_id}.{dataset_id}.{table_name}`"
    bq.query(sql).result()


def load_rows_truncate(
    bq: bigquery.Client,
    project_id: str,
    dataset_id: str,
    table_name: str,
    rows: List[Dict[str, Any]],
):
    """
    BigQuery load_table_from_json([]) can error; handle empty by TRUNCATE only.
    """
    if not rows:
        truncate_table(bq, project_id, dataset_id, table_name)
        return 0

    table_id = f"{project_id}.{dataset_id}.{table_name}"
    job_config = bigquery.LoadJobConfig(write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE)
    job = bq.load_table_from_json(rows, table_id, job_config=job_config)
    job.result()
    return job.output_rows


# -----------------------
# Stripe fetch
# -----------------------
def fetch_customers_via_search(query: str) -> List[Dict[str, Any]]:
    customers: List[Dict[str, Any]] = []
    i = 0
    for c in stripe.Customer.search(query=query, limit=100).auto_paging_iter():
        customers.append(c)
        i += 1
        if i % SLEEP_EVERY_N == 0:
            time.sleep(SLEEP_SECONDS)
    return customers


def fetch_subscriptions_for_customer(customer_id: str) -> List[Dict[str, Any]]:
    # Expand price so we can read unit_amount/interval without extra calls
    subs: List[Dict[str, Any]] = []
    i = 0
    for s in stripe.Subscription.list(
        customer=customer_id,
        status="all",
        limit=100,
        expand=["data.items.data.price"],
    ).auto_paging_iter():
        subs.append(s)
        i += 1
        if i % SLEEP_EVERY_N == 0:
            time.sleep(SLEEP_SECONDS)
    return subs


def fetch_invoices_for_customer(customer_id: str) -> List[Dict[str, Any]]:
    """
    IMPORTANT FIX:
    - Since invoices are manually created, invoice.subscription is often NULL.
    - So we must list invoices by customer, not by subscription.
    """
    invs: List[Dict[str, Any]] = []
    i = 0
    for inv in stripe.Invoice.list(customer=customer_id, limit=100).auto_paging_iter():
        invs.append(inv)
        i += 1
        if i % SLEEP_EVERY_N == 0:
            time.sleep(SLEEP_SECONDS)
    return invs


# -----------------------
# Row extractors
# -----------------------
def customer_row(c: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "customer_id": c.get("id"),
        "email": c.get("email"),
        "created_ts": iso(c.get("created")),
        "delinquent": c.get("delinquent"),
    }


def subscription_item_rows(sub: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Keep it simple but correct:
    - write 1 row per subscription item (usually 1)
    """
    rows: List[Dict[str, Any]] = []
    sid = sub.get("id")
    cid = sub.get("customer")

    items = safe_get(sub, "items", "data", default=[]) or []
    if not items:
        items = [None]

    for it in items:
        price = safe_get(it, "price", default={}) or {}
        recurring = safe_get(price, "recurring", default={}) or {}
        unit_amount = safe_get(price, "unit_amount", default=None)
        interval = safe_get(recurring, "interval", default=None)
        currency = safe_get(price, "currency", default=None)
        qty = safe_get(it, "quantity", default=1)

        rows.append({
            "subscription_id": sid,
            "customer_id": cid,
            "status": sub.get("status"),
            "created_ts": iso(sub.get("created")),
            "current_period_start_ts": iso(sub.get("current_period_start")),
            "current_period_end_ts": iso(sub.get("current_period_end")),
            "canceled_at_ts": iso(sub.get("canceled_at")),
            "cancel_at_period_end": bool(sub.get("cancel_at_period_end") or False),
            "price_amount": int(unit_amount) if unit_amount is not None else None,  # cents
            "price_interval": interval,  # month/year
            "currency": currency,
            "quantity": int(qty) if qty is not None else 1,
        })
    return rows


def invoice_row(inv: Dict[str, Any], filled_subscription_id: Optional[str]) -> Dict[str, Any]:
    """
    Fill subscription_id:
    - If Stripe invoice already has subscription => keep it
    - Else use the customer->subscription mapping (your confirmed 1:1)
    """
    paid_at = safe_get(inv, "status_transitions", "paid_at", default=None)
    raw_sub_id = inv.get("subscription")
    final_sub_id = raw_sub_id if raw_sub_id else filled_subscription_id

    return {
        "invoice_id": inv.get("id"),
        "customer_id": inv.get("customer"),
        "subscription_id": final_sub_id,  # <-- FIXED HERE
        "status": inv.get("status"),
        "amount_paid": int(inv.get("amount_paid") or 0),
        "amount_due": int(inv.get("amount_due") or 0),
        "currency": inv.get("currency"),
        "created_ts": iso(inv.get("created")),
        "paid_ts": iso(paid_at),
        # optional but handy debug field: whether invoice.subscription was originally null
        "subscription_id_filled": bool(raw_sub_id is None),
    }


# -----------------------
# Main
# -----------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project_id", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--customer_search_query", default="created>=0")
    args = parser.parse_args()

    stripe.api_key = get_stripe_key()
    bq = bigquery.Client(project=args.project_id)
    ds_ref = ensure_dataset(bq, args.project_id, args.dataset)

    # Schemas (simple + necessary)
    customers_schema = [
        bigquery.SchemaField("customer_id", "STRING"),
        bigquery.SchemaField("email", "STRING"),
        bigquery.SchemaField("created_ts", "TIMESTAMP"),
        bigquery.SchemaField("delinquent", "BOOL"),
    ]

    subs_schema = [
        bigquery.SchemaField("subscription_id", "STRING"),
        bigquery.SchemaField("customer_id", "STRING"),
        bigquery.SchemaField("status", "STRING"),
        bigquery.SchemaField("created_ts", "TIMESTAMP"),
        bigquery.SchemaField("current_period_start_ts", "TIMESTAMP"),
        bigquery.SchemaField("current_period_end_ts", "TIMESTAMP"),
        bigquery.SchemaField("canceled_at_ts", "TIMESTAMP"),
        bigquery.SchemaField("cancel_at_period_end", "BOOL"),
        bigquery.SchemaField("price_amount", "INTEGER"),
        bigquery.SchemaField("price_interval", "STRING"),
        bigquery.SchemaField("currency", "STRING"),
        bigquery.SchemaField("quantity", "INTEGER"),
    ]

    inv_schema = [
        bigquery.SchemaField("invoice_id", "STRING"),
        bigquery.SchemaField("customer_id", "STRING"),
        bigquery.SchemaField("subscription_id", "STRING"),  # now always filled when mapping exists
        bigquery.SchemaField("status", "STRING"),
        bigquery.SchemaField("amount_paid", "INTEGER"),
        bigquery.SchemaField("amount_due", "INTEGER"),
        bigquery.SchemaField("currency", "STRING"),
        bigquery.SchemaField("created_ts", "TIMESTAMP"),
        bigquery.SchemaField("paid_ts", "TIMESTAMP"),
        bigquery.SchemaField("subscription_id_filled", "BOOL"),
    ]

    ensure_table(bq, ds_ref, "stripe_customers", customers_schema)
    ensure_table(bq, ds_ref, "stripe_subscriptions", subs_schema)
    ensure_table(bq, ds_ref, "stripe_invoices", inv_schema)

    # 1) Customers
    print(f"Customer.search query = {args.customer_search_query}")
    customers = fetch_customers_via_search(args.customer_search_query)
    print(f"Customers found via search: {len(customers)}")

    customer_rows = [customer_row(c) for c in customers]
    customer_ids: List[str] = [c.get("id") for c in customers if c.get("id")]

    # 2) Subscriptions + build customer->subscription mapping (your confirmed 1:1)
    sub_rows: List[Dict[str, Any]] = []
    cust_to_sub: Dict[str, str] = {}  # customer_id -> subscription_id

    for idx, cid in enumerate(customer_ids, start=1):
        subs = fetch_subscriptions_for_customer(cid)

        # Your assumption: exactly 1 subscription per customer.
        # We still code defensively: if 0 => mapping missing; if >1 => take the most recently created.
        if subs:
            subs_sorted = sorted(subs, key=lambda s: int(s.get("created") or 0), reverse=True)
            chosen = subs_sorted[0]
            sid = chosen.get("id")
            if sid:
                cust_to_sub[cid] = sid

            # load all subscription item rows (still fine)
            for s in subs:
                sub_rows.extend(subscription_item_rows(s))

        if idx % SLEEP_EVERY_N == 0:
            time.sleep(SLEEP_SECONDS)

    print(f"Subscription rows prepared: {len(sub_rows)}")
    print(f"Customer->Subscription mappings built: {len(cust_to_sub)}")

    # 3) Invoices by customer (NOT subscription), fill subscription_id using mapping
    inv_rows: List[Dict[str, Any]] = []
    inv_seen: Set[str] = set()

    for j, cid in enumerate(customer_ids, start=1):
        invs = fetch_invoices_for_customer(cid)
        fill_sid = cust_to_sub.get(cid)

        for inv in invs:
            iid = inv.get("id")
            if not iid or iid in inv_seen:
                continue
            inv_seen.add(iid)

            inv_rows.append(invoice_row(inv, filled_subscription_id=fill_sid))

        if j % SLEEP_EVERY_N == 0:
            time.sleep(SLEEP_SECONDS)

    print(f"Invoice rows prepared: {len(inv_rows)}")

    # 4) Load (truncate then replace). Handle empty safely.
    out_c = load_rows_truncate(bq, args.project_id, args.dataset, "stripe_customers", customer_rows)
    out_s = load_rows_truncate(bq, args.project_id, args.dataset, "stripe_subscriptions", sub_rows)
    out_i = load_rows_truncate(bq, args.project_id, args.dataset, "stripe_invoices", inv_rows)

    print(f"Loaded rows -> customers: {out_c}, subscriptions: {out_s}, invoices: {out_i}")
    print("Done.")


if __name__ == "__main__":
    main()
