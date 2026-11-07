# Authentication and database privilege: what is missing

Written while adding the Telegram bot. **Nothing here is implemented.**
This is the note that stops the current state being mistaken for a
finished one.

## Where things stand

This app has **no authentication**. There is no user table, no login, no
session. A household is reachable by anyone who has its URL:

```
https://household-ebon.vercel.app/h/<householdId>
```

That URL grants full read and write: see every expense, income figure
and balance; create, edit and delete expenses; change budget limits;
export every record as CSV. The `householdId` is a cuid, so it will not
be guessed — but it is not a credential. It is in browser history, in
any shared link, in a screenshot, and in the referer header of anything
the page links out to.

The app also connects to Postgres as **`postgres`**, the Supabase
superuser. Every table has RLS disabled and the schema contains zero
policies. Adding policies today would change nothing, because a
superuser bypasses them.

### What the Telegram bot assumes

The bot is tighter than the web app, not looser:

- A Telegram account must be linked to a member before the bot responds
  at all; unlinked users get one instruction and no data.
- Link codes are single-use, 15 minutes, 8 characters from a 30-symbol
  alphabet (~6.5 × 10¹¹ combinations), generated with `crypto.randomInt`.
- Failed `/link` attempts are capped at 5 per hour per Telegram account,
  checked *before* the code is examined, so guessing is futile rather
  than merely slow.
- The webhook rejects anything without the right secret header,
  compared with `timingSafeEqual`.

But the weak point is inherited: **anyone who can open the household
page can mint a link code for any member of it.** The bot's door is
solid; the key is kept in an unlocked room. Short expiry and single use
limit the blast radius, they do not remove it.

## What real auth would involve

### 1. Identity

Add a `User` (email + credential) and a `HouseholdMembership` joining
users to households with a role. Today's `Member` stays what it is — a
person money is split between, who may or may not have a login. A
housemate who never signs in must still be splittable.

Options, cheapest first:

- **Auth.js (NextAuth) with an email magic link.** No passwords to
  store or reset. Fits a two-person household; needs an email sender,
  which this project does not have yet.
- **Supabase Auth.** Already part of the hosting, gives a JWT that an
  eventual RLS policy can read. Means adding `@supabase/supabase-js`
  alongside Prisma, and two libraries owning auth state is its own cost.
- **Passwords.** Only with a vetted hashing library, and the reset flow
  needs email anyway. Hardest to get right, least to gain here.

### 2. Authorization at the boundary

Every page under `/h/[householdId]` and every server action in
`src/lib/actions.ts` would need the same check: *is the current user a
member of this household?* Roughly 25 call sites. The right shape is one
helper — `requireHouseholdAccess(householdId)` — that throws, called at
the top of each page and action, so a new action cannot silently skip
it. A middleware matcher on `/h/:path*` catches page loads but **not**
server actions, which are POSTs to the same route; both need covering.

The CSV export route and `/api/telegram` need their own treatment: the
export is a plain GET that currently checks nothing, and the webhook
authenticates Telegram rather than a person.

### 3. A non-superuser database role, then RLS

Only worth doing after 1 and 2, and it is the largest piece:

1. Create a role that is **not** superuser and owns nothing:
   `CREATE ROLE app_user NOLOGIN; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`
2. Point the app's `DATABASE_URL` at it. Migrations keep using the
   privileged role — `prisma migrate deploy` needs DDL rights.
3. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on all 15 tables, plus
   `FORCE ROW LEVEL SECURITY` so even a table owner is subject to it.
4. Write policies keyed on the current household. With Prisma there is
   no JWT for Postgres to read, so the request's identity has to be set
   per transaction — `SET LOCAL app.household_id = '...'` inside an
   interactive transaction, with policies reading
   `current_setting('app.household_id', true)`. This is the invasive
   part: **every query would have to run inside such a transaction**,
   which Prisma's normal client does not do. Expect a wrapper around
   `prisma.$transaction` and a rule that nothing calls `prisma.*`
   directly.
5. Policies for the join tables (`ExpenseShare`, `SavingsContribution`)
   have to reach through their parent, since they carry no
   `householdId` of their own.

Honest assessment: steps 1-3 are an afternoon. Step 4 is a change to how
every query in the app is issued, and it buys defence-in-depth against a
bug in step 2 rather than new capability. **Do 1 and 2 first.** They
close the actual hole. RLS without them protects nothing.

### 4. Then revisit the bot

Once users exist, link codes should be mintable only by a signed-in user
who is a member of that household — which is a one-line change to
`generateTelegramLinkCode`, and the reason that function already
re-checks household ownership rather than trusting its arguments.

## Smaller things worth doing before any of that

These are cheap and reduce exposure without a login:

- **Rotate the household URL.** A "regenerate link" that changes the
  `householdId` would at least make a leaked URL revocable. Currently a
  shared link is permanent.
- **`noindex`.** Nothing stops a crawler that finds the URL. One meta
  tag.
- **Referrer policy.** `Referrer-Policy: no-referrer` so the household
  id does not leak to any site linked from the page.
- **Rate-limit the export route.** It hands over the entire financial
  history in four requests.
