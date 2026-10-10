# Deploying to Vercel + Supabase

This app has no native Prisma query engine binary at runtime — Prisma 7 with
a driver adapter (`@prisma/adapter-pg`, see `src/lib/db.ts`) uses a WASM
query compiler plus plain `pg`/`node-postgres` instead. That means none of
the classic Prisma-on-Vercel pain (`binaryTargets`, platform mismatches,
missing `.so` files) applies here. The only thing that needs real care is
connection management: serverless functions open a new connection per
invocation, and a raw Postgres connection is too expensive to open/close at
that rate — hence the pooled vs. direct split below.

## 0. Prerequisite: this project isn't in git yet

Vercel's dashboard import wants a GitHub/GitLab/Bitbucket repo. From the
project root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create an empty repo on GitHub and:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

(Alternative without git: `npx vercel` from this directory deploys the local
folder directly, no GitHub repo needed. The git+GitHub path is recommended
anyway since it gives you auto-deploys on every push — this runbook assumes
that path from here on.)

## 1. Create the Supabase project and get BOTH connection strings

In the Supabase dashboard: open your project, then **Connect** (top bar) or
**Project Settings → Database**. You'll see several connection string
variants — you need two specific ones, and it matters which goes where:

| Which one | Where in Supabase's UI | Port | Used for |
|---|---|---|---|
| **Direct connection** | Tab labeled "Direct connection" | `5432` | Running `prisma migrate deploy` — DDL (`ALTER TABLE`, etc.) needs a real, unpooled session. |
| **Transaction pooler** | Tab labeled "Transaction pooler" (this is Supavisor, their PgBouncer-compatible pooler, in **transaction** mode) | `6543` | The deployed app's runtime queries on Vercel. |

Both look like `postgresql://postgres.<project-ref>:<password>@<host>:<port>/postgres`
— only the host/port differ between the two tabs. Copy both now; you'll use
the direct one in step 2 and the pooled one in step 4.

Do **not** use the direct (5432) string for the deployed app's `DATABASE_URL`
— Supabase's direct connection limit is small (tens of connections), and a
handful of concurrent Vercel invocations will exhaust it. Do not use the
pooled (6543) string for migrations — transaction-mode pooling can drop a
DDL session mid-statement.

One thing you don't need to worry about: the classic Prisma+PgBouncer
`?pgbouncer=true` flag and "prepared statement already exists" errors. That
problem comes from Prisma's Rust engine caching *named* prepared statements
across pooled connections. `@prisma/adapter-pg` instead delegates straight to
`node-postgres`, which only uses unnamed statements for ordinary queries —
it's already safe against Supavisor's transaction mode with no flag needed.
If you ever do see a "prepared statement ... already exists" error in
production logs, that's the symptom to search for, but it shouldn't happen
with this setup.

## 2. Run the migration locally against the real database

This project's `prisma.config.ts` reads the **same** env var name,
`DATABASE_URL`, that the app uses at runtime (`src/lib/db.ts`) — there is no
separate `DIRECT_URL` concept in this codebase. (Prisma 7's config file only
supports a single `datasource.url`; the schema-level `directUrl` field from
older Prisma versions doesn't exist anymore.) So the direct/pooled split
isn't encoded in the code — it's just "which value you put in which
`DATABASE_URL`, in which place," and that place differs for you locally vs.
Vercel:

- **Your local `.env`**, when you run the migration → the **direct**
  (5432) string.
- **Vercel's env var**, for the running app → the **pooled** (6543) string.

Don't let that bleed together — your laptop's `.env` currently points at
`docker-compose.yml`'s local container; swap it only for this one step and
put it back (or just use a separate shell export instead of editing `.env`,
so you can't forget to revert it):

```bash
DATABASE_URL="<the Supabase DIRECT 5432 string>" npx prisma migrate deploy
```

Expected output: a list of migration names applying in order, ending in
`All migrations have been successfully applied.` Confirm it against the real
Supabase DB, not just the exit code:

```bash
DATABASE_URL="<same direct string>" npx prisma studio
```

and check the tables exist (Household, Member, Expense, Settlement, etc.) —
or query however you prefer. **Do not run `db:seed` against this database**
— that script is fixture data for local dev, not something you want in a
real deployment (see step 5 for how real households get created instead).

## 3. Push the code

```bash
git add -A
git commit -m "Add deploy tooling"
git push
```

(This picks up the `postinstall: "prisma generate"` script I just added to
`package.json` — see step 4 note.)

## 4. Import into Vercel and set env vars

In the Vercel dashboard: **Add New → Project**, pick the GitHub repo you
just pushed. Vercel auto-detects Next.js — leave the framework preset and
build command as default (`next build`, no override needed).

Before the first deploy, go to **Settings → Environment Variables** on the
Vercel project and add exactly one:

| Name | Value | Environments |
|---|---|---|
| `DATABASE_URL` | the Supabase **pooled** (6543, transaction mode) string from step 1 | Production, Preview, Development (all three, so preview deploys work too) |

That's the only env var this app currently reads (confirm: `grep -rn "process.env" src/` only turns up `DATABASE_URL` in `src/lib/db.ts`). There is no `DIRECT_URL` to set on Vercel — Vercel never runs migrations, only the already-migrated app.

On `prisma generate` in the build: **yes, it's required, and I've added it.**
`package.json` now has:

```json
"postinstall": "prisma generate"
```

Vercel's build runs `npm install` (which triggers `postinstall`) before
`npm run build`, so the generated client exists before `next build` traces
and bundles it. Without this, the build either fails outright (client
missing) or silently uses a stale generated client checked into
`node_modules` from your last local `npm install` — this removes that
footgun for every future deploy, not just the first one.

Click **Deploy**.

## 5. First deploy — verify it boots

Once deployed, open the Vercel URL. You should land on the home page with
"No households yet — create one below to get started." If instead you get a
500, check **Deployments → [latest] → Functions logs** on Vercel — the most
likely cause at this stage is `DATABASE_URL` being wrong/missing (typo'd
host, forgot to add it for the Production environment specifically).

## 6. Creating your first household and members

**Correction to the premise in your question: this already has a UI, it's
not seed-only.** Two places, both already live on the deployed site, no
database access required:

- **Home page** (`/`): "Create a household" form — name in, redirects
  straight into the new household.
- **Dashboard** (`/h/[id]`, the page you land on after creating one):
  "Household members" section at the bottom has an inline "Add member" form
  (name + optional email).

So once deployed: open the Vercel URL → create your household → you're
redirected into it → add each member from the Dashboard → go set up income
records, categories, etc. No Prisma Studio, no manual SQL, nothing seed-only
about it.

(One caveat I want to flag now rather than let you discover it live: there
is currently **no login of any kind** — anyone with the URL and a
household's id can view and edit everything in it. That's the gap item 2
of your original ask closes; until that's built, treat the deployed URL as
"security through obscurity" only, same as it's been in local dev.)

## Troubleshooting quick reference

- **Build fails with Prisma client errors** → check `postinstall` ran; look
  at the build log for a `prisma generate` line before `next build` starts.
- **500s on every page, logs mention connection refused/timeout** → almost
  always `DATABASE_URL` wrong or not set for the Production environment
  specifically (Vercel scopes env vars per-environment).
- **"too many connections" under load** → confirms you accidentally put the
  direct (5432) string in Vercel's `DATABASE_URL` instead of the pooled one;
  swap it for the 6543 transaction-pooler string.
- **"prepared statement ... already exists"** → shouldn't happen with
  `@prisma/adapter-pg`, see step 1's note; if it ever does, it means
  something in the stack started using named prepared statements against
  the pooled connection — report the exact error text before trying fixes.
