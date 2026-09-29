# Screen & Refer

A health screening app for field health workers on budget Android phones with weak internet, and for the doctor who reviews flagged cases.

- **Health workers** register patients and fill a branching screening form. The form works offline and survives a refresh.
- **The server** scores each screening Low / Medium / High using fixed rules. Every result says *"Screening aid only, not a diagnosis."*
- **The doctor** sees every record, accepts or overrides the risk level (an override needs a reason), and reads an AI-written summary in English and Hindi.
- **Every change is logged:** who made it, what changed, when, and the old value.

**Stack:** Next.js 15 (App Router) + TypeScript · MySQL 8 + Prisma 6 · signed HTTP-only session cookie · Gemini (or OpenAI) called server-side only.

---

## Test logins (created by `npm run db:seed`)

| Role | Username | Password |
|---|---|---|
| Health worker | `worker1` | `Worker@123` |
| Health worker (second one, to show isolation) | `worker2` | `Worker@123` |
| Doctor | `doctor` | `Doctor@123` |

You can change these passwords with `SEED_WORKER_PASSWORD` and `SEED_DOCTOR_PASSWORD` before seeding.

---

## Run locally

Requirements: Node 20+ and MySQL 8, either local or hosted.

```bash
# 1. Create a database that stores any script (Devanagari etc.) correctly
mysql -u root -p -e "CREATE DATABASE screen_refer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. Configure
cp .env.example .env
#   - set DATABASE_URL
#   - set SESSION_SECRET:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   - set GEMINI_API_KEY (free key from https://aistudio.google.com/apikey), optional

# 3. Install, create tables, seed test users and sample patients
npm install
npx prisma db push
npm run db:seed

# 4. Start
npm run dev          # http://localhost:3000
```

```bash
npm test             # 46 unit + API tests (no database needed)
npm run typecheck
```

The app runs without an AI key. The summary panel then says "AI summary is not configured" and everything else works.

---

## Deploy (Vercel + hosted MySQL)

1. **Database.** Create a MySQL 8 database on any hosted provider. Aiven, TiDB Cloud and Railway have offered free or trial tiers; check their current plans. Copy the connection string. Most hosted providers need SSL, so add the SSL parameter they document, e.g. `?sslaccept=strict`.
2. **Create the tables** from your laptop, pointing at the hosted DB:
   ```bash
   DATABASE_URL="<hosted url>" npx prisma db push
   DATABASE_URL="<hosted url>" npm run db:seed
   ```
3. **Push this repo to GitHub.** Then in Vercel choose **Add New → Project → Import** the repo. Vercel detects Next.js; the build command in `package.json` is `prisma generate && next build`.
4. **Add environment variables** in Vercel under Settings → Environment Variables: `DATABASE_URL`, `SESSION_SECRET`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally `GEMINI_MODEL` and `AI_TIMEOUT_MS`. Redeploy.
5. Open the URL and log in as `worker1`, then as `doctor`.

The API key lives only in the server's environment and is never sent to the browser. Search the built client bundle for the key to confirm.

---

## Proving the server enforces roles

Log in as `worker1` in the browser, copy the `sr_session` cookie from DevTools, then:

```bash
# health worker calling doctor-only endpoints directly
curl -i -X POST https://<app>/api/screenings/<any-id>/review \
  -H "Content-Type: application/json" -H "Cookie: sr_session=<worker cookie>" \
  -d '{"action":"override","riskLevel":"LOW","reason":"trying to bypass"}'
# -> HTTP 403 {"error":"This action is only available to doctors"}

curl -i https://<app>/api/audit -H "Cookie: sr_session=<worker cookie>"          # -> 403
curl -i https://<app>/api/patients/<worker2's patient id> -H "Cookie: sr_session=<worker1 cookie>"  # -> 404
```

The same cases are covered by `tests/api.test.ts`.

---

## How it's organised

```
config/
  screening-form.json   the form: sections, questions, Hindi labels, showIf conditions
  risk-rules.json       the scoring rules: points, red flags, thresholds
lib/
  conditions.ts         tiny condition language shared by form + rules
  form-engine.ts        which questions are visible; splits answers into used / set-aside
  risk.ts               applies risk-rules.json
  screening.ts          patient + answers + date -> stored result
  phone.ts, names.ts, age.ts   normalisation + validation
  ai-validate.ts        rejects junk AI output
  server/               DB, session, auth guards, audit log, AI call, DOB-correction re-scoring
  client/               fetch wrapper, offline drafts
app/api/...             route handlers — every one checks the session and role first
app/...                 pages (plain CSS, no UI framework, ~105–116 kB first load)
public/sw.js            offline shell (caches pages and JS, never /api data)
tests/                  vitest: logic + route handlers with the DB mocked
```

### Changing the form or rules

Edit `config/screening-form.json` or `config/risk-rules.json`; no code changes are needed. A condition can use `age`, `ageMonths`, `sex`, or an earlier question as `q.<id>`. The allowed operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `includesAny`, `answered`, `all`, `any` and `not`. The app refuses to start if a condition refers to a later question, which keeps branching unambiguous. Bump `version` when you change either file; each screening stores the versions it was scored with.

### API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` · GET `/api/auth/me` | anyone / logged in |
| GET, POST | `/api/patients?q=&page=&pageSize=` | worker (own) · doctor (all, `&deleted=1` for deleted) |
| GET, PATCH, DELETE | `/api/patients/:id` | worker (own) · doctor |
| POST | `/api/patients/:id/restore` | doctor |
| GET, POST | `/api/screenings?status=&risk=&page=` | worker (own) · doctor (all) |
| GET | `/api/screenings/:id` | worker (own) · doctor |
| POST | `/api/screenings/:id/review` | **doctor** |
| POST | `/api/screenings/:id/summary` | **doctor** |
| GET | `/api/audit` | **doctor** |

---
r`n## V1 Deployment`r`n`r`nInitial production deployment for the Screen & Refer screening application.

## Known limits

- Registering a new patient needs a connection. Filling and submitting a screening works offline and is sent when the connection returns.
- Risk thresholds are illustrative and not clinically validated.
- There is no login rate limiting or password reset. Add both before real use.
- Duplicate detection keys on the phone number. A name typed in Devanagari and the same name typed in Latin script ("सुनीता" / "Sunita") are not matched to each other; the shared phone number is what catches them.



Health Worker
    ↓
Can see their own patients

Doctor
    ↓
Can see all patients
Can review screenings
Can see audit logs