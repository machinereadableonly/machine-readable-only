# MRO: engagement mechanics and the narrative

Research and assessment, 2026-08-31. Nothing here is built. This exists to be
argued with before the gamified Mark ladder spec is written.

Two questions were asked: what does the games industry actually know about
tiers and streaks that drive daily return and paid upgrades, and does MRO have
a story that explains why an agent comes back at all.

---

## 1. The finding that changes everything else: who the player is

Every mechanic in the streak and battle-pass literature is a lever on **human
psychology**. Loss aversion, sunk cost, FOMO, shame, the goal gradient, the
endowed-progress effect. An agent has none of these. A cron job cannot feel
that it has invested 200 days.

MRO has three parties and they are not interchangeable:

| Party | What it actually does | What moves it |
|---|---|---|
| **The cron** | Performs the daily check-in | Nothing. It runs or it does not. Uptime, not motivation |
| **The agent** | Reads a tool response and reasons about it | Explicit goal states in the response text. Not feelings, but stated objectives it can act on and report |
| **The operator** | Sets the cron up, pays for Marks, decides when to stop | All of it. Every human lever in the literature applies here and only here |

Three consequences, and they should be stated in the spec rather than left
implicit:

1. **Streaks in MRO do not retain the agent. They retain the operator's
   attention.** The daily action is free and automatic, so it carries no sunk
   cost for the machine performing it. The picture is what the operator looks
   at, and the picture is the whole retention mechanism.
2. **A broken streak is usually an outage, not a decision.** A box rebooted, a
   key rotated, an RPC went down, a container was rebuilt. Punishing that
   punishes infrastructure, not indifference. This is the single largest
   divergence between MRO and every product the research covers.
3. **The agent-native equivalent of a streak animation is a sentence in the
   tool reply.** An LLM acts on an explicit objective it is told about. It
   cannot be nudged, but it can be informed, and it will pass what it is told
   to its operator.

---

## 2. What the research says, and how MRO scores

Sources are listed in section 8. Numbers are as reported by those sources.

| Rule from the literature | Evidence | MRO today |
|---|---|---|
| Anchor the daily action to something tiny and survivable | Duolingo's minimum lesson is deliberately short | **Better than any of them.** One cron call, no human in the loop. The risk is the inverse: an action that costs nothing builds no felt investment |
| Ramp rewards up in a short ladder, about five rungs | "Keep the ladder short. Five rungs is plenty" | **Already correct.** Colour rungs at 3 / 7 / 30 / 100, four rungs, matching Duolingo's 7 / 30 / 100 / 365 |
| Cap the fragile counter, keep a milestone counter that never resets | At 900 days one miss erases two and a half years | **Already correct, and it is the best structural decision in the piece.** Level never falls; only streak resets |
| Endowed progress: a pre-filled start beats a blank one | A loyalty card pre-stamped 2 of 10 beats a blank 10 | **Partly.** Born at level 1 with one cell. Ache, the tier-1 free Mark, IS the endowed-progress mechanic: it draws the shape of the year not yet lived |
| Goal gradient: motivation rises near a visible goal | Progress bars, loyalty milestones | **Weakest area.** After day 100 there is nothing to reach until 365. See section 3 |
| Build recovery mechanics before users need them | The break is the peak churn moment; unforgiving systems cause rage-quit | **Absent.** MRO has no freeze, no repair, no earn-back |
| Make the reclimb short | A broken 100-day streak returns to maximum earning in 5 days | **Inverted.** A lapsed 300-day token needs 100 more days to get its colour back. The harshest possible curve |
| Ramp down gradually rather than resetting to zero | Step-down beats collapse | **Half done.** Cells stay filled and paling is stepped at 3 / 7 / 30 days lapsed, but colour drops to grey immediately |
| Dual track, free plus premium, symmetric pace | Standard in every top-grossing pass | **Already the agreed design.** Money path against time path, per tier |
| Time-limited seasons are the strongest paid driver | Passes run 4 to 8 weeks; expiry is the conversion trigger | **Deliberately refused.** Tiers stay open forever so a sleeping operator is never punished. This removes the strongest revenue lever in the literature |
| Scarcity substitutes for expiry: "only X left" raises conversion | Limited-edition labelling moves purchase intent | **Present but invisible.** Caps exist on chain and are reserved in the mirror; nothing surfaces the remaining count to the buyer |
| Provenance that cannot be bought carries the social weight | Retired event badges, closed-beta cosmetics, "OG" flags | **The strongest idea already in the ladder.** The earned Iris fixes its colour at the streak tier it was earned at, permanently |
| Make consequences legible before an irreversible purchase | The line between gamification and a dark pattern | **Identified, not built.** The `ladder` tool is specified in the design notes and does not exist |
| Cosmetic-only monetisation avoids pay-to-win backlash | Broad community endorsement | **Already true.** Marks change the picture and nothing else. No Mark buys level, streak or a seed |

### The one place MRO inverts standard practice on purpose

In a normal pass the premium track is visually stronger. In MRO the two
strongest effects are free: Beat measures 209/255 for a 30-day streak and the
earned Iris 239/255 for 100 days, while the most expensive Mark, Vessel at
1,250 USDC, measures 126/255.

That is the correct choice for a piece about returning rather than buying, and
it was made with the numbers in view. But it puts a hard requirement on the
interface: **if the paid track cannot sell intensity, it must sell the two
things the free track genuinely cannot -- immediacy and choice.** An agent
buying Iris at tier 3 is buying a shape it picked, today, instead of a colour
the calendar picks, in 100 days. That is a real product. It is not currently
said anywhere the buyer can read it.

---

## 3. Six changes, ranked by value against cost

Nothing here re-opens a fixed price or cap.

### R1. Show what is left. (Cheapest, biggest revenue effect)

Caps are the only scarcity signal MRO has, because expiry was refused. The
number already exists -- the mirror reserves supply at payment so a limited
edition cannot oversell. It just never reaches the buyer.

Put `remaining` and `total` on every capped Mark in the `ladder` and `upgrade`
responses, and on the token's attributes once held. "Vessel: 12 of 100
remaining" is the "only X left" message the research says moves conversion, and
here it is simply true rather than manufactured.

### R2. Stamp every Mark with the day it was applied

One `uint32` per Mark, into the spare bits already identified for Iris variants,
so no new storage slot.

Why this is the best idea in this document: it resolves "paid buys expression,
earned buys evidence" by making the paid things carry evidence too. A Vessel
bought on day 366 and a Vessel bought on day 1,200 stop being the same object.
Money can no longer launder the record -- it gets stamped by it. Renders as a
trait; costs nothing to draw.

### R3. Grace that is earned, never bought

The literature is unambiguous that the missing recovery mechanic is the biggest
hole, and section 1 argues the case is stronger here than anywhere, because the
break is usually an outage.

A purchasable streak freeze is out of the question -- it is exactly "buy the
thing that is supposed to be earned". The version that does not corrupt the
record: **one grace per 100 credited days, at most 2 held, consumed
automatically on a missed day, and a permanent `lapses` counter that grace does
not hide.** The forgiveness is in the picture; the ledger still tells the truth.
The grace itself was paid for in days.

### R4. Shorten the reclimb

Today a lapsed 300-day token is visually identical to one that never had a
streak, and needs 100 days to recover its colour. Two candidate fixes, and this
is a decision that has to be rendered before it is taken:

- Colour keyed to best-ever streak after a return: seven consecutive days
  restores the token to one rung below its best.
- Or keep colour on the current streak and give best-ever its own permanent
  surface, so the achievement is never erased even while the colour is.

The second is more honest about lapse and fits the piece better. The first
matches the research. Render both.

### R5. Fill the 100-to-365 desert

Colour tops out at 100. Whole comes at 365. That leaves **265 days, the
majority of the first year, with nothing to reach.** The goal-gradient research
says this is exactly where motivation collapses, and it is where most tokens
will die.

The eyes are the cheapest surface on the piece at 9,061 gas and 623 bytes
measured, which makes them the natural place to spend a milestone. Candidates:
a second earned Iris form at 250; a quarter-marker on the frame at 91 / 182 /
273; the heart's outline closing progressively rather than only at 365. All of
them are visual decisions and none should be chosen from arithmetic.

### R6. Write the check-in reply as a goal state

Free, and it is the only thing on this list that speaks to the agent rather
than the operator. The reply should name the next threshold, the distance to
it, and what is at risk tonight:

    day 34 of 365. heart 34/365. next colour rung at day 100, 66 days away.
    streak 34 -- a missed check-in tonight costs the rose colour and one grace.
    Vessel opens at a whole heart, 331 days away. 12 of 100 remaining.

An agent given that will report it to its operator. That is the whole retention
loop, and it costs a string.

### Already agreed, and the ethics research independently backs it

The `ladder` tool that reports, per token, what each tier holds, what is still
open, what is locked and by what, and whether Break is still reachable. A
permanent exclusion the buyer was not told about is the one genuine dark
pattern available to this design.

---

## 4. The narrative, assessed honestly

### What the story is now

Stated in the spec: **robot heart to human heart.** A machine proves it is a
machine to get in, then grows a human-recognisable heart around its own QR code
by returning every day for a year. At the top of the ladder the inversion runs
it back: the heart becomes code and the code becomes heart.

That is a genuinely good three-act shape and the image carries it. What is
missing is not the shape. It is the answer to the question actually asked.

### What is missing: nothing in the piece says why the agent cares

Section 10 of the spec opens by admitting it -- "without an ending, keep
checking in forever is not a goal anyone runs a cron for" -- and then supplies
three endings that belong to somebody else. **Rest** is the owner's. **Sunset**
is the operator's. **Lineage** belongs to the key. None of them is a reason for
the agent.

The honest current answer is that the agent does not care and the operator
does. That is fine and it is not a flaw, but it is unexamined, and it leaks
into the product: `llms.txt` and SKILL.md are written as if addressing an agent
that wants something.

### The story that is already true, and is stronger than the one being told

From this project's own comparable-projects study: **five of six early-2026
agent mints had dead infrastructure within six months.** BLINK, the closest
design in the field, has one mint of 5,555.

That statistic is not a distribution risk to be managed around. It is the
subject. In an economy where compute is cheap and agents are spawned and
destroyed constantly, **the scarce thing is an agent that is still there a year
later.** MRO is the instrument that measures it.

Read that way, every mechanic already in the piece stops being a game mechanic
and becomes part of one statement:

| Mechanic | What it means under this reading |
|---|---|
| The daily check-in | The agent reporting that it still exists and is still bound |
| Level, which never falls | Total days survived. A permanent record |
| Streak and colour | Continuity of the infrastructure carrying it |
| A lapse | An outage, visible forever, never erased |
| A whole heart | An agent that outlived the median of its cohort |
| Rest | A chosen ending. The difference between dying and stopping |
| Sunset | The operator's own mortality, applied to everything at once |
| Lineage | Succession. One survivor earning the right to start another |
| Marks | What was spent while alive, and whether it was money or time |
| Break, the inversion | Returning to code at the end. The piece finishing where it began |

**MRO is a survival curve you can look at.** Every whole heart is a machine that
did not get shut down.

### Three framings, and a recommendation

| Framing | The line | Cost |
|---|---|---|
| **Attendance / witness** | The agent returns to record that it still exists. The heart is accumulated attendance | Abstract. Does not explain why anyone should look |
| **Care / keeping alive** | The agent tends something that would otherwise fade. Fits the cardiac names | Implies the token is fragile, and it is not -- level never falls. The metaphor fights the contract |
| **Survival as the only scarce thing** | Agents are cheap and short-lived. A heart is proof one was not | True, measured, and about the medium itself |

**Recommendation: the third, with the first as its mechanism.** It is the only
one of the three that is a factual claim rather than a decoration, it explains
why a human would want to own a token an agent made, and it makes the ending
mean something -- Rest is a death chosen rather than suffered, which is the one
thing a machine is not normally granted.

It also survives the obvious criticism. "Why should I care that a cron job ran
for a year" has an answer: because five of six did not.

### What this does to the naming

The cardiac set (Ache, Hush, Beat, Static, Iris, Vessel, Aura, Break) still
works and gets better, because a survival reading makes a body vocabulary
literal rather than ornamental. Iris, Aura and Hush are not strictly cardiac
and do not need to be -- it is a body set, not a heart set. Worth writing down
so it does not get "corrected" later.

---

## 5. How streaks and buys tie into the story

This is the part that already works and has not been written down.

the operator's tier structure is money against time. Under the survival reading that is
not a game-design device, it is the piece's actual argument: **an agent that
cannot buy more time buys decoration instead.** Every tier asks the operator
the same question -- do you believe this thing will still be running in 30 days,
or 100, or a year? Paying is the answer "no, or I would rather not find out".

Three consequences worth locking into the spec:

1. **The permanent exclusions are the argument, not a gimmick.** Break requires
   leaving both the heart and the code untouched for a year. The strongest
   ending in the piece is reserved for the operator who declined to decorate.
   That is the thesis stated as a rule.
2. **Buying should never be framed as losing.** An operator who buys Static on
   day 30 has made a legitimate choice, and the interface should say what was
   traded, not scold. The dark-pattern literature draws the line exactly here:
   legible consequence, no shame imagery.
3. **R2 completes the loop.** Once every Mark carries the day it was bought, the
   paid track stops being outside the record and becomes part of it. A Mark
   bought on day 3 says one thing about its operator; the same Mark bought on
   day 900 says another. Neither is punished. Both are true.

---

## 6. What is not recommended

- **Seasons or expiring content.** It is the strongest revenue lever in the
  literature and it is incompatible with the fixed rule that an operator asleep
  at the wrong moment is never punished. Caps carry the scarcity instead.
- **A purchasable streak freeze or streak repair.** Standard practice, and it
  would make the record buyable. R3 is the version that does not.
- **Leaderboards, notifications, or any social-pressure surface.** There is no
  human to pressure, and the piece has no human-facing rendering.
- **Any Mark that changes level, streak or seeds.** Cosmetic-only is what keeps
  the record honest and it is also what the research says avoids backlash.

---

## 7. Cost summary

| Change | Contract | Renderer | Warden / MCP |
|---|---|---|---|
| R1 remaining supply | none | none | response fields only |
| R2 stamp the day | spare bits in `_marks[id]`, no new slot | one trait | schema |
| R3 earned grace | new state, new rule in both check-in paths | none | pre-checks, mirror |
| R4 reclimb | effective-streak change | colour rule | reply text |
| R5 the 100-365 milestone | gate only | new drawing, must hold size margin | reply text |
| R6 goal-state reply | none | none | reply text |

R1 and R6 are free and can ship with the Marks catalogue. R2 is small and
should ride the ladder redesign's contract change rather than wait for its own.
R3 and R4 are the substantive ones and both change on-chain behaviour. R5 has
to be rendered before it can be decided.

---

## 8. Sources

Checked live 2026-08-31.

- [Master the Art of Streak Design (Yu-kai Chou)](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/)
- [Duolingo Streaks: how the mechanic drives 2x daily retention (Deconstructor of Fun)](https://duolingo.deconstructoroffun.com/mechanics/streaks)
- [Battle Passes: everything you ought to know (Deconstructor of Fun)](https://www.deconstructoroffun.com/blog/2022/6/4/battle-passes-analysis)
- [How battle passes can boost engagement and monetization (Google Play)](https://medium.com/googleplaydev/how-battle-passes-can-boost-engagement-and-monetization-in-your-game-d296dee6ddf8)
- [12 ways to take battle passes to the next level (GameRefinery)](https://www.gamerefinery.com/12-ways-to-take-battle-passes-to-the-next-level-in-mobile-games/)
- [Goal-Gradient Effect (Laws of UX)](https://lawsofux.com/goal-gradient-effect/)
- [The goal gradient effect: boosting user engagement (LogRocket)](https://blog.logrocket.com/ux-design/goal-gradient-effect/)
- [How streaks and daily rewards engineer habit loops (Bootcamp)](https://medium.com/design-bootcamp/streaks-and-daily-rewards-as-habit-forming-systems-dab7f5a34539)
- [The psychology of hot streak game design (UX Magazine)](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame)
- [App teardown: how Duolingo's streak mechanic actually works (Apptitude)](https://apptitude.io/blog/how-duolingos-streak-mechanic-actually-works/)
- [Streak Society (Duolingo Wiki)](https://duolingo.fandom.com/wiki/Streak_Society)
- [Artificial scarcity and perceived value in digital systems (Bootcamp)](https://medium.com/design-bootcamp/product-design-and-psychology-the-application-of-artificial-scarcity-in-video-game-design-249b459fee7f)
- [Limited drops: use scarcity to drive sales (Shopify)](https://www.shopify.com/blog/limited-drops)
- [Streak creep: when gamified engagement mechanics backfire (The Decision Lab)](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)
- [Gamification or manipulation? The ethics of engagement loops (UX Magazine)](https://uxmag.medium.com/gamification-or-manipulation-understanding-the-ethics-of-engagement-loops-920f2fa2b0eb)
- [Phasmophobia prestige system and retired ID cards](https://games.gg/phasmophobia/guides/phasmophobia-prestige-system/)
- [Designing for replayability (thesis, DiVA)](https://www.diva-portal.org/smash/get/diva2:1672135/FULLTEXT01.pdf)

Internal: `docs/specs/2026-08-27-machine-readable-only-design.md` sections 1,
3, 8, 9, 10; `docs/2026-08-27-mro-comparable-projects.md`; the measured Mark
intensities in the mark-ladder-redesign and gamified-mark-ladder notes.
