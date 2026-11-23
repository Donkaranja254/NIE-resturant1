# NIE Catering upgrade – setup and deployment

This upgrade keeps the current static GitHub Pages frontend and introduces Supabase as the shared backend. M-Pesa is the only supported payment method; the menu/plate price is KES 50.

## Important security change

The existing app is a browser-only demo. Its current admin login lets a visitor create an administrator profile locally, and its bookings/menus are stored in each browser's localStorage. That is not safe for real customer or payment data.

The production upgrade must use Supabase Auth, PostgreSQL and Row Level Security. Do not use localStorage as the source of truth for orders, payments, roles or menus. Do not put a Supabase service-role key or Safaricom Daraja secret in frontend files.

## 1. Create Supabase project

1. Create a project at https://supabase.com/.
2. In SQL Editor, run the complete script in `supabase/schema.sql`.
3. In Project Settings -> API, copy the Project URL and anon/publishable key.
4. Copy `js/config.example.js` to `js/config.js`, then replace the two placeholders.
5. Keep `js/config.js` out of public commits if it contains environment-specific values. The anon key is not a secret, but RLS is mandatory.

## 2. Create the first administrator

1. Enable phone authentication in Supabase Auth and configure the supported SMS provider.
2. Create the owner's account through the approved signup/invite process.
3. Verify the phone number.
4. In SQL Editor, promote only the verified owner account using the commented bootstrap statement at the bottom of schema.sql, replacing the phone placeholder.
5. Invite kitchen staff through an administrator-controlled process. New signups must remain customers by default.

Never allow a public signup form to choose its own role.

## 3. M-Pesa production integration

M-Pesa STK Push must be initiated by a trusted server-side function (for example, a Supabase Edge Function). Store Daraja consumer key/secret, shortcode, passkey and callback configuration as server-side secrets only. The callback must verify and reconcile the transaction before marking an order paid. The browser must never mark a payment as successful based on a redirect or user screenshot.

You will need:
- Safaricom Daraja app credentials and the correct shortcode/passkey for the account.
- A public HTTPS callback endpoint.
- A Supabase Edge Function deployment and secrets.
- Daraja sandbox testing before live credentials are enabled.

No real M-Pesa transaction is enabled by this foundation alone.

## 4. Publish

1. Review the upgrade branch and merge it only after the database setup and frontend integration are ready.
2. GitHub Pages should publish from the repository's main branch/root as currently configured.
3. Test customer signup, owner admin access, kitchen staff access, menu publishing, order submission, status changes and payment callback in a separate test project before launch.

## Current implementation boundary

This branch contains the database schema and deployment/security setup foundation. It does not yet claim that Supabase login, shared live bookings, kitchen workflow or M-Pesa STK Push are connected. Those require project-specific Supabase configuration and Daraja credentials.
