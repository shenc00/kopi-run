# Kopi Run ☕

Order kopi together. Create a run, share the link, everyone picks their drink from the
Singapore kopitiam menu, and the consolidated order updates live for the whole group.
The organizer can close the order to lock it in.

**Stack:** React + Vite (frontend) · Supabase (Postgres + Realtime) · Netlify (hosting).

---

## What you need (you said you have these ✅)
- A **Supabase** account + project
- A **Netlify** account
- A **GitHub** account linked to Netlify

You'll do the account clicks; the code is all here.

---

## Step 1 — Put this project on GitHub
On a computer (easiest), unzip this folder, then from inside it:

```bash
git init
git add .
git commit -m "Kopi Run"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/kopi-run.git
git push -u origin main
```

(Create the empty `kopi-run` repo on github.com first, then copy its URL into the
`git remote add` line.)

---

## Step 2 — Set up the database in Supabase
1. Open your project at https://app.supabase.com
2. Left sidebar → **SQL Editor** → **New query**
3. Open `supabase/schema.sql` from this project, copy everything, paste it in, click **Run**.
   You should see "Success." This creates the `orders` and `items` tables, security rules,
   the live-update (Realtime) feeds, and the organizer "close order" function.
4. Left sidebar → **Project Settings** → **API**. Copy these two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

> The `anon` key is safe to use in a frontend — that's its purpose. Never use the
> `service_role` key in this app.

---

## Step 3 — Deploy on Netlify
1. https://app.netlify.com → **Add new site** → **Import an existing project** → **GitHub** → pick your `kopi-run` repo.
2. Build settings (Netlify usually auto-detects these from `netlify.toml`):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
3. Before the first deploy, open **Site settings → Environment variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL from Step 2
   - `VITE_SUPABASE_ANON_KEY` = your anon public key from Step 2
4. Trigger a deploy (Deploys → **Trigger deploy** if it didn't run automatically).

When it finishes you'll get a URL like `https://kopi-run-xyz.netlify.app`.

---

## Step 4 — Use it
1. Open your site, type a run name, **Create order**.
2. Tap **Copy link** and send it to your friends (it looks like `…/order/ABCDE`).
3. Everyone opens the link, builds a drink, adds their name, taps **Add to the order**.
4. The consolidated list updates live for everyone.
5. When done, the organizer taps **Close order** to lock it.

---

## Run it locally first (optional)
Needs Node.js 18+ installed.
```bash
cp .env.example .env      # then fill in your two Supabase values
npm install
npm run dev               # opens http://localhost:5173
```

---

## Good-to-know limits of this MVP
- **No login.** Anyone with a code/link can view and add to that order — perfect for friends,
  not meant as a locked-down public product.
- **Organizer = whoever created the run on that device.** A private token is stored in your
  browser so the **Close order** button survives refreshes. Clearing site data or using a
  different device means you'd no longer be recognised as organizer for that run.
- **Want real accounts, private orders, or admin controls?** Add Supabase Auth and tighten the
  row-level security policies in `schema.sql`. Happy to help with that next.

---

## Project layout
```
kopi-run/
├─ index.html
├─ package.json
├─ vite.config.js
├─ netlify.toml          # build + SPA redirect for /order/:code links
├─ .env.example
├─ src/
│  ├─ main.jsx           # app entry + router
│  ├─ App.jsx            # all screens, Supabase calls, realtime, UI
│  ├─ menu.js            # kopitiam menu + Singlish name builder
│  └─ supabaseClient.js  # reads your env vars
└─ supabase/
   └─ schema.sql         # paste into Supabase SQL editor
```
