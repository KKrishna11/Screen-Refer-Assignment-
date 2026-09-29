# 3-minute recording script (speak to a doctor, not a developer)

Target: about 420 spoken words, roughly 2:50. Record on a phone-sized browser window (DevTools → device toolbar → a small Android preset). Rehearse once with a timer.

**Before recording:**
- Log in once as `doctor` and once as `worker1` so both sessions are fresh.
- Use sample patient "सुनीता देवी" (worker1).
- Have a second tab ready with DevTools → Network → "Offline" toggle.

---

### 0:00–0:15 · What this is
> "This is Screen & Refer. Health workers in the field use it on basic Android phones to check people for health risks. You, the doctor, see the cases that need attention. I'll show one screening, what you see, and one thing that normally goes wrong but doesn't here."

### 0:15–1:15 · A health worker screens a patient (logged in as worker1)
*Open Patients → सुनीता देवी → Start new screening.*
> "The worker opens the patient. Every question is in English and Hindi. The form only asks what fits this person. She's 38 and female, so women's health questions appear. A 6-year-old or a man would never see them."

*Answer: cough → Yes. Point at the two new questions.*
> "When she says there's a cough, it asks how long and whether there's blood."

*Pick "2 weeks or more", blood → No. Then Pregnant → Yes → months 6 → danger sign "Swelling". Answer the remaining questions quickly (No / None) without narrating each.*

*Turn Network → Offline. Tap Submit.*
> "The signal drops here, which happens all the time. Nothing is lost. The phone keeps the answers and says it will send them when the network is back."

*Turn Network back online. The screening sends by itself and the result opens.*
> "Back online, it sends by itself. The risk comes back High, with the reasons: a pregnancy danger sign and a cough for over two weeks. Every result says clearly: screening aid only, not a diagnosis."

### 1:15–2:15 · What the doctor sees (switch to the doctor tab)
*Open Review queue.*
> "Doctor, your queue shows waiting cases first, highest risk at the top."

*Open the case.*
> "You see the patient, the risk, and exactly why. At the top is a short AI summary in English and Hindi. If the AI service is down or gives a bad answer, the page just says the summary isn't available. The risk level never depends on the AI; it comes from fixed rules."

*Choose "Change the risk level" → Medium. Try to save with an empty reason; point out the button is disabled. Type a reason: "Swelling reviewed on video call, BP normal at PHC". Save.*
> "You can accept the level or change it, but a change needs a reason. Open History and you can see who changed what, when, and what it was before."

### 2:15–2:50 · Something that should break but doesn't
*As worker1, open सुनीता's record → Edit → change the birth year so she becomes 7 → Save.*
> "Say the worker typed the wrong birth year and she's actually a child. Normally the old answers would be wrong, or get deleted. Here, the app re-checks the past screening. The pregnancy answers are set aside, not deleted, and not counted. The risk is recalculated. Because it changed, the case goes back to your queue with a note explaining exactly what happened."

*Show the note on the screening, then undo the DOB if time allows.*

### 2:50–3:00 · Close
> "So: simple for the worker, safe when the network fails, and you always see why a case was flagged, and every change to it. Thank you."

---

**Backup lines if you have spare seconds:**
- *(worker trying the doctor's review button via direct call)* "Even if a worker tries to call your review function directly, the server refuses."
- *(duplicate)* "Registering the same phone number again warns the worker and shows the existing record."
