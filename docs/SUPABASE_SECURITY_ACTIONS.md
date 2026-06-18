# Supabase security actions

Status checked through the Supabase MCP for project `sjzdvlqnhhgbqdsvwiqt` on 2026-06-18.

## Applied in code

- Added a migration to revoke generated Data API privileges from `anon` and `authenticated` for application tables, sequences, and functions.
- Added fixed `search_path` values to public RPC/functions flagged by the Supabase security advisor.
- Revoked direct RPC execution for internal auth trigger helpers.

## Still required before production

Supabase reported Row Level Security disabled on all public application tables. RLS should be enabled after confirming the production backend connects with a privileged server-side Postgres role, or after adding explicit policies for any direct Data API access that must remain.

Current public tables reported without RLS:

```sql
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
```

Do not run this blindly from the dashboard if any browser code still uses `supabase.from(...)` directly. Enabling RLS without matching policies blocks Data API reads/writes for publishable-key clients.
