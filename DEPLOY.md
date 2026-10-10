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

## 1. Create the Supabase project and get the right connection strings

In the Supabase dashboard: open your project, then **Connect** (top bar) or
**Project Settings → Database**. You'll see several connection string
variants. Three of them matter here, and it matters which goes where:

| Which one | Host / port | Used for |
|---|---|---|
| **Direct connection** | `db.<ref>.supabase.co:5432` | Migrations — **but only from a network with IPv6**, see below. |
| **Session pooler** | `<region>.pooler.supabase.com:5432` | Migrations from an IPv4-only network. This is what we actually used. |
| **Transaction pooler** | `<region>.pooler.supabase.com:6543` | The deployed app's runtime queries on Vercel. |

They all look like `postgresql://postgres[.<project-ref>]:<password>@<host>:<port>/postgres`
— mainly the host and port differ.

### The direct (5432) host is IPv6-only — this bit us

`db.<ref>.supabase.co` publishes an **AAAA record and no A record**. Without
Supabase's paid IPv4 add-on, a machine on an IPv4-only network cannot reach
it at all. This machine is one of those: it has only a ULA (`fdf0:…`)
address, no globally routable IPv6, and a TCP probe to the direct host times
out. Check your own network before trusting the direct string:

```bash
dig +short db.<ref>.supabase.co A        # empty output  => IPv6-only host
nc -6 -z -w 8 db.<ref>.supabase.co 5432  # fails         => use session pooler
```

So the migration in step 2 went through the **session pooler** instead:
port `5432` on the *pooler* host. That is the correct substitute, not a
workaround — session mode pins one real Postgres connection for the life of
the client, so `ALTER TABLE` and the rest of the DDL behave exactly as on a
direct connection. (Transaction mode, port `6543`, is the one that can tear
a DDL session out from under you; don't migrate through that.)

### Percent-encode special characters in the password

Anything outside `A-Za-z0-9-._~` must be percent-encoded in the URL. The
common ones: `$`→`%24`, `@`→`%40`, `#`→`%23`, `/`→`%2F`, `:`→`%3A`,
`?`→`%3F`, `&`→`%26`, `%`→`%25`. Both `node-postgres` and Prisma URL-decode
the password, so the encoded form is what they want. Also wrap the whole URL
in **single** quotes in the shell — inside double quotes, a `$` starts a
variable expansion and your password silently loses characters.

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

- **Your shell**, when you run the migration → the **session pooler**
  (`...pooler.supabase.com:5432`) string. The direct string would also be
  correct here if your network had IPv6; it doesn't, see step 1.
- **Vercel's env var**, for the running app → the **transaction pooler**
  (`...pooler.supabase.com:6543`) string.

Don't let that bleed together — your laptop's `.env` currently points at
`docker-compose.yml`'s local container; swap it only for this one step and
put it back (or just use a separate shell export instead of editing `.env`,
so you can't forget to revert it):

```bash
# Session pooler (port 5432 on the POOLER host) — works on IPv4.
# Single quotes matter: the password contains a '$'.
DATABASE_URL='postgresql://postgres.<ref>:<encoded-password>@<region>.pooler.supabase.com:5432/postgres' \
  npx prisma migrate deploy
```

Expected output: a list of migration names applying in order, ending in
`All migrations have been successfully applied.`

**Status: done.** Both migrations applied cleanly on 2026-10-10:
`20261008195806_init` and
`20261008203100_add_income_source_default_and_fallback_warning_types`.
Verified against the real database — not just the exit code — through
*both* pooler ports, which also pre-flights the runtime string Vercel will
use:

```
tables: Category, Expense, ExpenseShare, Household, IncomeRecord, Member,
        RecurringExpense, SavingsContribution, SavingsGoal, Settlement,
        _prisma_migrations
both migrations: finished_at set (not left half-applied)
Household row count: 0   (clean, unseeded)
```

`npx prisma studio` with the same URL is the interactive way to eyeball the
same thing. **Do not run `db:seed` against this database**
— that script is fixture data for local dev, not something you want in a
real deployment (see step 5 for how real households get created instead).

## 3. Push the code

**Status: already done.** `origin/main` is level with local `main`
(`git rev-list --left-right --count origin/main...HEAD` -> `0  0`) and the
tree is clean, so the committed `package.json` already carries the
`postinstall: "prisma generate"` script Vercel's build needs. Nothing to
push before importing.

A local production build was also run against the real Supabase database
(through the 6543 pooled string) as a dry run of what Vercel will do:
TypeScript clean, all 7 app routes compiled, every one of them `f`
(server-rendered on demand) -- so nothing tries to reach the database at
build time, and a bad `DATABASE_URL` can only ever surface as a runtime 500,
never as a failed build.

## 4. Import into Vercel and set env vars

In the Vercel dashboard: **Add New → Project**, pick the GitHub repo you
just pushed. Vercel auto-detects Next.js — leave the framework preset and
build command as default (`next build`, no override needed).

Before the first deploy, go to **Settings → Environment Variables** on the
Vercel project and add exactly one:

| Name | Value | Environments |
|---|---|---|
| `DATABASE_URL` | the Supabase **transaction pooler** string -- `postgresql://postgres.<ref>:<encoded-password>@<region>.pooler.supabase.com:6543/postgres` | Production, Preview, Development (all three, so preview deploys work too) |

Paste the value with the password **percent-encoded** exactly as in step 2's
command. Vercel's env var UI stores it literally -- no shell is involved, so
there is nothing to quote, but the percent-encoding is still required
because the consumer is a URL parser. Use the `6543` port here, not the
`5432` session pooler you migrated with: the app wants transaction-mode
pooling, which is what survives many short-lived serverless invocations.

This string has already been smoke-tested from here: it connects, and it can
read the migrated schema. So if the deploy 500s, the string itself is not the
suspect -- check that you set it for the **Production** environment
specifically.

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

- **Migration hangs, then `connect ETIMEDOUT` / `ENETUNREACH` against
  `db.<ref>.supabase.co`** → that host is IPv6-only and your network is
  IPv4-only. Not a credentials problem, and not a firewall problem on your
  end. Use the session pooler (`<region>.pooler.supabase.com:5432`) instead,
  per step 1. Confirm with `dig +short db.<ref>.supabase.co A` returning
  nothing at all.
- **`password authentication failed` with a password that has symbols in
  it** → percent-encoding, or double quotes eating a `$`. Re-read step 1's
  encoding note before you start suspecting the password itself.
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
