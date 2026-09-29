# NOTES

## Why this stack
I chose Next.js with TypeScript so the UI and the API sit in one codebase and deploy to Vercel in one step. The form engine and conditions are a single TypeScript file that runs in the browser to show the form and on the server to score it. The two therefore can't disagree. MySQL + Prisma gives typed queries and real transactions, so every change and its audit row commit together. I used plain CSS instead of a UI kit to keep the first load around 110 kB for budget phones.

## Things that must not break
- **DOB corrected after screening.** Each screening stores every answer the worker gave. Editing DOB or sex re-runs every past screening against the corrected age:
  - Answers that no longer apply move to "set aside". Nothing is deleted.
  - Questions that now apply but were never asked are flagged "not asked, re-screen".
  - The risk is re-scored. If it changed, a reviewed case goes back to the doctor's queue.
  - The old values go into the audit log.
- **Connection drops or the page refreshes.** Every tap saves a draft on the phone. Each draft gets an ID once, when the form opens. Submitting while offline queues the draft and it retries automatically. The server treats a repeated ID as the same screening, so retries can't create duplicates. A small service worker caches the app shell so a refresh with no signal still opens the form. Patient data is never cached there.
- **Same person registered twice.** Phone numbers are stored in one normalised form. A matching phone number triggers a warning that shows the existing record, with near-matching spellings ranked ("Suneeta"/"Sunita"). The worker can open that record, or confirm it's a different person, since families often share a phone. The confirmation is logged. The doctor sees other records with the same phone on each patient.
- **Devanagari names and phone formats.** Names are NFC-normalised, allow Indic combining marks, and are stored in utf8mb4. `+91 98765 43210`, `098765-43210`, `9876543210` and Devanagari digits all become `9876543210`. Search accepts any of these formats.
- **Health worker calls a doctor-only API.** Every route checks the signed session and re-reads the role from the database. Review, AI summary and audit return 403. Another worker's record returns 404, so its existence isn't revealed. These are covered by `tests/api.test.ts`.
- **An answer change removes a follow-up section.** The form hides the section and keeps those answers aside, so switching back restores them. A hidden question's answer can never reveal its own follow-ups. The server scores only visible answers. It stores the set-aside ones separately, and the doctor sees them struck through as "not used for scoring".

## One thing the AI coding tool got wrong
The first AI-summary junk check looked for exactly one of the words low / medium / high in the English text. A correct Medium summary that says "high blood pressure" would have been rejected as junk. I changed the prompt to require an opening "Risk level: X." and validate only that. There is now a test for this case.

## New requirement: SMS the patient on High risk
**Change:**
- Add consent and preferred language fields to the patient record.
- Add a "notifications" table recording one SMS per screening and its status.
- Send only when the final risk becomes High after the doctor's review, not on the raw score. False positives would frighten people.
- A server-only job sends through an Indian provider with DLT-registered templates. It retries on failure and never sends twice.
- The message says "please visit the health centre" in the patient's language, with no diagnosis or health details. It includes an opt-out.
- Log each send in the audit trail and show the delivery status to the doctor.

**Leave alone:** the form config, the risk rules, the review flow and the auth model. SMS is a side-effect of the review decision, not part of scoring.
