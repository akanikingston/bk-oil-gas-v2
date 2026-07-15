# BK Oil & Gas ERP

A prototype ERP for LPG filling stations — purchases, pump readings, daily
sales, internal usage, expenses, tank closure/reconciliation, reports, tank
archive, and audit logs. Data is now stored in **Supabase**, so Cashier,
Manager and Owner all see the same live data, from any device.

## ⚠️ Important limitations of this build

- **Login is still role-selection only** — no password check yet. Anyone who
  can open the app can pick "Owner" and see everything. Do not put real
  financial data in this until real authentication (Supabase Auth is the
  natural next step) is added.
- **The Supabase "anon" key is public-readable/writable** the way this is
  set up (see the RLS policy below) — treat the app link as something you
  only share with people who should have access, the same as a shared
  spreadsheet link.
- **Exports** are CSV, not formatted PDF/Excel yet.

## Step 1 — Create your Supabase project (free)

1. Go to https://supabase.com and sign up (free tier is enough).
2. Click **"New project"**. Pick any name (e.g. `bk-oil-gas-erp`), set a
   database password (save it somewhere), choose a region close to Nigeria,
   and click **Create new project**. Wait ~2 minutes for it to spin up.

## Step 2 — Create the data table

1. In your new project, open the **SQL Editor** (left sidebar).
2. Paste this in and click **Run**:

```sql
create table erp_store (
  id text primary key,
  value text not null,
  updated_at timestamptz default now()
);

alter table erp_store enable row level security;

-- Prototype-friendly policy: anyone with the anon key can read/write.
-- Tighten this once you add real authentication.
create policy "Allow all access for now"
  on erp_store
  for all
  using (true)
  with check (true);
```

3. Also turn on realtime for the table so live sync works: go to
   **Database → Replication**, find `erp_store`, and toggle it on.

## Step 3 — Get your API keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.

## Step 4 — Add the keys to the project

1. In this project folder, copy `.env.example` to a new file named
   `.env.local`.
2. Paste in your real values:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

`.env.local` is already git-ignored, so it won't get uploaded to GitHub.

## Run it locally to test

Needs [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev
```

Open the printed URL, log in, add a purchase — then open the same URL in
another browser (or your phone) and you should see the same data.

## Deploy it for free (Vercel)

1. Create a GitHub account if needed, make a new repo, and upload every
   file in this project (keep folders intact). **Do not upload `.env.local`**
   — it should already be excluded by `.gitignore`.
2. Create a free Vercel account at https://vercel.com/signup (sign in with
   GitHub).
3. Click **"Add New" → "Project"**, pick your repo, and **before** clicking
   Deploy, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. Click **Deploy**. You'll get a live link like
   `https://bk-oil-gas-erp.vercel.app` that anyone can open, and everyone's
   data will sync through the same Supabase project.

If you ever change the Supabase keys, update them in Vercel under
**Project → Settings → Environment Variables**, then redeploy.

## Next steps worth considering

- Real login with Supabase Auth (real passwords, per-user accounts)
- Row-level security tightened to match roles once Auth is added
- Proper PDF/Excel export formatting
- Multi-branch support, invoice generation, Moniepoint payment API
