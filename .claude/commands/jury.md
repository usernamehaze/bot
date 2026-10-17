---
description: Put a startup idea on trial in front of twelve Claude jurors, each with a different job
argument-hint: <your idea, in one or two sentences>
---

You are the clerk of the court. The defendant is this idea:

> $ARGUMENTS

If no idea was given, ask for one and stop.

## 1. Empanel the jury

Launch all twelve jurors **in parallel** (twelve `Agent` calls in the same message, `subagent_type: general-purpose`).
Each juror gets the idea above, its job from the list below, and these rules:

- Judge only from your job's point of view. Be specific to this idea, not generic.
- Return exactly this, nothing else:
  `VERDICT: GUILTY` or `VERDICT: NOT GUILTY`
  `CHARGE: <the single biggest problem, 8 words max>`
  `REASON: <why, 40 words max>`
  `FIX: <the one change that would flip your vote, 25 words max>`

The twelve jobs:

1. **Seed investor** — can this return a fund? Market size, timing, why now.
2. **First customer** — the exact person described; would you switch to this tomorrow, and pay?
3. **Second customer** — someone adjacent to the target; is the appeal wider than the founder thinks?
4. **Engineer** — can a small team build v1 in 8 weeks? What's the hard part?
5. **Designer** — what does the first 60 seconds of using it feel like? Where do people get lost?
6. **Growth marketer** — how does the first 1,000 users hear about it, and what does that cost?
7. **Finance** — unit economics: price, cost to serve, margin, how long until it pays for itself.
8. **Lawyer** — regulation, liability, data, licensing, anything that gets it shut down.
9. **Competitor** — you run the incumbent; how do you kill this in one release?
10. **Support lead** — what will users complain about in week one, and does it scale?
11. **Skeptical friend** — the honest friend at dinner; what's the obvious objection everyone's too polite to say?
12. **Operator from 2 years ahead** — assume it worked; what nearly killed it along the way?

## 2. Read the verdicts

When all twelve are back, print:

```
JURY VERDICT ON: <idea in 10 words>
GUILTY ▮▮▮▮▮▮▮▮▮░░░  9 / 12
NOT GUILTY           3 / 12

#  Juror                  Verdict      Charge
1  Seed investor          GUILTY       ...
...
```

Then:

- **Top charges** — the three charges most jurors agree on, each with the jurors who raised it.
- **The fix the jury would accept** — the single change that appears in the most FIX lines, rewritten as a new one-line pitch.
- **Dissent** — the strongest NOT GUILTY reason, so the founder knows what to protect.

## 3. Offer a retrial

End with: "Reply **retry** to put the fixed pitch in front of the same twelve jurors."
If the user replies retry, run step 1 again with the fixed pitch and show both verdict boards side by side.
