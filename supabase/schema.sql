-- NIE Catering production database foundation
-- Run in Supabase SQL Editor. Review SETUP.md before exposing the site.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('customer', 'kitchen', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.order_status as enum ('pending_payment', 'confirmed', 'preparing', 'ready', 'collected', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'failed', 'reversed');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  phone text not null unique,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_days (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  kitchen_note text not null default '',
  is_published boolean not null default false,
  bookings_closed boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_day_id uuid not null references public.menu_days(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(menu_day_id, name)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  service_date date not null,
  customer_name_snapshot text not null,
  customer_phone_snapshot text not null,
  selected_items jsonb not null check (jsonb_typeof(selected_items) = 'array' and jsonb_array_length(selected_items) > 0),
  kitchen_note text not null default '',
  unit_price_kes integer not null default 50 check (unit_price_kes = 50),
  quantity integer not null default 1 check (quantity = 1),
  total_kes integer generated always as (unit_price_kes * quantity) stored,
  status public.order_status not null default 'pending_payment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, service_date)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  method text not null default 'mpesa' check (method = 'mpesa'),
  amount_kes integer not null check (amount_kes = 50),
  status public.payment_status not null default 'pending',
  mpesa_checkout_request_id text unique,
  mpesa_merchant_request_id text,
  mpesa_receipt_number text unique,
  mpesa_phone text,
  result_description text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_service_date_idx on public.orders(service_date);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists payments_status_idx on public.payments(status);
create index if not exists menu_items_menu_day_idx on public.menu_items(menu_day_id, sort_order);

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('kitchen', 'admin'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'New customer'),
    coalesce(nullif(trim(new.phone), ''), 'pending-' || new.id::text),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_nie on auth.users;
create trigger on_auth_user_created_nie
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.menu_days enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;

drop policy if exists "profile owner or admin reads profiles" on public.profiles;
create policy "profile owner or admin reads profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profile owner updates own contact" on public.profiles;
create policy "profile owner updates own contact"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));

drop policy if exists "published menus are visible" on public.menu_days;
create policy "published menus are visible"
on public.menu_days for select to anon, authenticated
using (is_published = true or public.is_staff());

drop policy if exists "admins manage menu days" on public.menu_days;
create policy "admins manage menu days"
on public.menu_days for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "published menu items are visible" on public.menu_items;
create policy "published menu items are visible"
on public.menu_items for select to anon, authenticated
using (
  exists (
    select 1 from public.menu_days d
    where d.id = menu_day_id and (d.is_published = true or public.is_staff())
  )
);

drop policy if exists "admins manage menu items" on public.menu_items;
create policy "admins manage menu items"
on public.menu_items for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customers read own orders and staff read all" on public.orders;
create policy "customers read own orders and staff read all"
on public.orders for select to authenticated
using (customer_id = auth.uid() or public.is_staff());

drop policy if exists "customers create own orders" on public.orders;
create policy "customers create own orders"
on public.orders for insert to authenticated
with check (
  customer_id = auth.uid()
  and status = 'pending_payment'
  and unit_price_kes = 50
  and quantity = 1
  and exists (
    select 1 from public.menu_days d
    where d.service_date = service_date
      and d.is_published = true
      and d.bookings_closed = false
  )
);

drop policy if exists "customers update own pending orders" on public.orders;
create policy "customers update own pending orders"
on public.orders for update to authenticated
using (customer_id = auth.uid() and status = 'pending_payment')
with check (customer_id = auth.uid() and status = 'pending_payment' and unit_price_kes = 50 and quantity = 1);

drop policy if exists "staff update order workflow" on public.orders;
create policy "staff update order workflow"
on public.orders for update to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "customers read own payments and staff read all" on public.payments;
create policy "customers read own payments and staff read all"
on public.payments for select to authenticated
using (customer_id = auth.uid() or public.is_staff());

-- Payment rows are written by trusted server-side Edge Functions only.
-- No client insert/update/delete policy is intentionally provided.
drop policy if exists "admins read all payment details" on public.payments;
create policy "admins read all payment details"
on public.payments for select to authenticated
using (public.is_admin());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();
drop trigger if exists menu_days_updated_at on public.menu_days;
create trigger menu_days_updated_at before update on public.menu_days
for each row execute procedure public.set_updated_at();
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
for each row execute procedure public.set_updated_at();
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
for each row execute procedure public.set_updated_at();

-- Bootstrap: after creating your own Supabase Auth account, promote ONLY that account:
-- update public.profiles set role = 'admin' where phone = '+2547XXXXXXXX';
-- Never expose the service_role key in browser JavaScript.
