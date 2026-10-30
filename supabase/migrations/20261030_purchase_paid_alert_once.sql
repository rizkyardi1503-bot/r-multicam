-- One purchase_paid owner alert per order (2026-10-30). Written for the release; apply with the release step.
-- The alert is now sent by whichever path activates the order first: midtrans-lifetime-webhook, check-lifetime-payment
-- or the create-lifetime-checkout reconcile of a missed payment. Each path sends it only when it read the order as not
-- yet activated; this index makes a race between two paths store one row (the second insert gets 409 and is ignored).
-- At writing time there were no purchase_paid rows, so the index builds without conflicts.

create unique index if not exists website_analytics_events_purchase_paid_once
  on public.website_analytics_events ((metadata->>'order_id'))
  where event_name = 'purchase_paid';
