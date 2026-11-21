# Subscriptions, phase 1 (approved by the owner on 21 Nov 2026)

Prepaid subscription plans join the existing lifetime license. The plans are sold through Midtrans and do not auto-renew. Lifetime sales end on 30 Nov 2026 at 23:59 WITA (`2026-12-01T00:00:00+08:00`). Existing lifetime accounts stay lifetime.

No plugin release is needed. Panels since 2.3.11.11 grant access whenever the signed entitlement says `allowed`.

## Plans (all prices in IDR, one price for every country)

| product_code | Price | Access | Notes |
|---|---|---|---|
| `monthly_v1` | Rp99.000 | 30 days | **Founder price Rp59.000**: see the founder rule below |
| `annual_v1` | Rp799.000 | 365 days | Shown against Rp1.188.000 (12 × 99.000), "save 33%" |
| `lifetime_v1` | Rp2.000.000 | lifetime | Sold until the cutoff above; after that the server refuses it |

**Shared rules**
- The 7-day free trial is unchanged.
- **Stacking.** Paying while a plan is still active adds the days on top: the new end is the later of now and the current end, plus the plan's days.
- **Founder rule.** The founder price applies to `monthly_v1` only:
  - Accounts already holding the founder price keep it while their subscription is active, or ended less than 7 days ago.
  - Otherwise, the first 100 accounts to pay a founder-priced monthly order get it. `founder_slots_left = 100 - count(profiles with founder_price_locked)`.
- **Promo codes.** Approved affiliate codes give 10% off and a 20% commission on any plan, as today.
  - A code cannot be combined with the founder price. The server answers 400 with code `PROMO_NOT_WITH_FOUNDER`.
  - The commission is recorded per paid order by the existing trigger.
- A lifetime account cannot buy a plan; the server answers 409 "Your lifetime license is already active.".

## Database (migration `20261121_subscriptions_phase1.sql`)

**`plugin_profiles` gains:**
- `subscription_expires_at timestamptz`;
- `subscription_plan text` (`monthly_v1` or `annual_v1`);
- `founder_price_locked boolean not null default false`.

`license_status` also accepts `subscription`.

**`plugin_payment_orders`:**
- gains `founder_price boolean not null default false`;
- `product_code` is limited to `lifetime_v1`, `monthly_v1` and `annual_v1`;
- `lifetime_activated_at` now means "access granted from this order" for every product. It drives the affiliate commission trigger and the owner dashboard revenue, as before.

**`public.grant_subscription_order(order_id)`**
- Service role only, idempotent, and runs in one transaction.
- It applies a paid, not yet granted, not refunded monthly or annual order: it extends the access, sets `license_status='subscription'`, and stamps the order.
- Its reasons are `ORDER_NOT_FOUND`, `NOT_SUBSCRIPTION`, `NOT_PAID`, `REFUNDED`, `PROFILE_NOT_FOUND`, `BLOCKED` and `ALREADY_LIFETIME`. When the order was granted before, it returns `already: true`.

**`public.subscription_pricing()`**
- Callable by anon. It returns `{founder_limit, founder_slots_left, lifetime_sales_end, monthly_idr, monthly_founder_idr, annual_idr, lifetime_idr}`.

**`public.plugin_entitlement(...)`**
- `allowed` also covers `subscription` with `subscription_expires_at > now()`. A lapsed subscription turns into `expired`.
- For a subscription, `trial_expires_at` and `remaining_seconds` carry the subscription end, so current panels show a correct countdown. They label it "TRIAL" until a later plugin release.
- New fields: `subscription_expires_at` and `subscription_plan`.

## API contract (website)

**`POST /functions/v1/create-lifetime-checkout`.** The name is legacy; old panels still call it. It uses the user's bearer token.
- Body: `{ "product_code": "monthly_v1" | "annual_v1" | "lifetime_v1", "promo_code": "" }`.
  - The website always sends both fields.
  - Without `product_code`, the server assumes `lifetime_v1`; this is what old panels and cached pages send.
- 200 reply:
  `{ order_id, checkout_url (https://app.midtrans.com/...), reused, product_code, period_days (30 | 365 | null), founder_price (bool), display_price_idr (list price), gross_amount_idr (charged), discount_percent, net_price_idr, promo_code, charge_currency: "IDR", environment }`.
- Errors carry `{error, message, code?}`:
  - 400: invalid promo code, or `PROMO_NOT_WITH_FOUNDER`;
  - 403: blocked account or email not confirmed;
  - 409: lifetime already active, `PREVIOUS_CHECKOUT_OPEN`, or `{activated: true}` when a payment was already received and access was granted;
  - 410: `LIFETIME_CLOSED`, a lifetime purchase after the cutoff.

**`POST /functions/v1/check-lifetime-payment`.** Unchanged. A paid plan order is applied, and the reply also carries `product_code` and `subscription_expires_at`.

**`POST /rest/v1/rpc/subscription_pricing`.** Takes the anon key and an empty body. It returns the founder slots and the cutoff.

**Account page.** It reads the user's own `plugin_profiles` row (RLS). It shows:
- an active plan: the plan, the end date, a founder badge, and Renew buttons;
- a lapsed plan: the plan cards.

## Website copy rules

- Every price or claim must stay true both before and after 30 Nov. The lifetime card says "Available until 30 November 2026"; the page JS hides it once `lifetime_sales_end` has passed.
- There is no fake urgency. The founder counter is real, read from `subscription_pricing()`.
- Selling points: "no automatic charge", "renew only when you need it", "cancel anytime = simply don't renew".
- Legal pages (terms, refund policy, license) describe:
  - prepaid periods;
  - no automatic renewal;
  - stacking;
  - founder conditions;
  - the end of lifetime sales;
  - that existing lifetime licenses stay valid.

  The refund stance is unchanged.
