# Design audit, v244

Five checks on every main screen: hierarchy, type, space, color, and "why it looks cheap". Checked at 390x844 (phone, light and dark) and 1280x800 (computer, light), with the iPhone safe areas faked (top 47px, bottom 34px). Every finding names a selector, its value before, and its value now. **Done** means it shipped in v244; the rest are listed under "Needs your decision".

## The whole app

**Why it looked cheap**

1. **Little white streaks** on the top bar, the chips, the ask box, the tab bar and the Home header. The cue: a highlight that never moves where the eye expects light, so it reads as a rendering glitch.
2. **Glass edges cut at the screen's own edges.** The Home header stopped 4px short of each side and had rounded corners under the status bar. Sheets had side rims. A black band showed under the tab bar. The cue: the app doesn't fit the phone.
3. **Things sitting on top of the content:** Cassie's idle lines over an answer, the week strip reading through the tab bar, and the ask box taking about a third of the screen. The cue: decoration ranks above what the student came for.

**Root cause: layout** (layers and edges), then color (glass that is too clear).

**The one fix that changes the most:** let the content own the screen. That means a compact ask box, flat edge-to-edge bars and sheets, and no streaks.

**Keep:** the monochrome palette with one accent, the 8-point spacing, and the 48px taps.

| # | Where | Selector | Before | Now | Status |
|---|---|---|---|---|---|
| 1 | Every glass pane | glass light filter in app.js (`glassStill`, `<feMerge>`) | specular glint, pow(N.H, 120) × 1.6 | rim and soft shading only, no glint | Done |
| 2 | Tab bar (Chromium bends the backdrop) | `html.lg-refract.native .tabbar` | fill .50/.38 alpha, so text read through it | .84/.76 | Done |
| 3 | Page background on iPhone | `html.native`, `html.native body` | height 100%, body-only backdrop | min-height 100lvh; the root paints the same backdrop | Done |
| 4 | Scrolled page after the keyboard | app.js `keepPagePut` (v241) | page left about 50px up | back to the top whenever nobody is typing | Done in v241, kept |

## Home (phone)

- **Hierarchy.** The eye saw the greeting and the white theme switch first, then Ask Cassie, then the tiles. It should see Ask Cassie and the Board exams tile first.
- **Space.** The header was 382px wide inside a 390px screen. The timer's full-width "Edit" button outweighed Start.

| # | Selector | Before | Now | Status |
|---|---|---|---|---|
| 5 | `html.native .hub-hero` | width calc(100% + 40px), radius 0 0 24px 24px, 4px gap each side | width 100vw, radius 0, flush to the top and sides, 1px hairline under it | Done |
| 6 | `html.lgm.native .hub-hero::before` | bevel and rim drawn along the screen edges | none (frosted fill only) | Done |
| 7 | `.ht-edit` | outlined pill, full width in the timer tile | text link, underlined, 40px with a mouse and 48px on touch | Done |

## Chat (phone)

- **Hierarchy.** The eye went to the ask box (130px tall plus a 64px chip row) and to Cassie's line over the answer. It should go to the answer.
- **Measured at rest (390x844).** Composer 130px, chips 64px, answer area 382px (45% of the screen), and a 42px gap under the composer, because the home indicator was counted twice.

| # | Selector | Before | Now | Status |
|---|---|---|---|---|
| 8 | `html.native.tab-chat:not(.typing) #app` padding-bottom | 72px + safe area, plus the composer's own margin of 12px + safe area | 76px + safe area; composer margin 8px | Done |
| 9 | `html.chat-rest` (app.js `chatRest`) | always the full composer and chips | in a chat that has started and while nobody types: one row (box, mic, Send), chips step aside; tapping the box brings everything back | Done |
| 10 | Composer at rest | 130px | 66px | Done |
| 11 | Composer while typing | 130px | 118px | Done |
| 12 | Chips row | 64px | 52px | Done |
| 13 | Answer area at rest | 382px (45%) | 528px (63%) | Done |
| 14 | `cassieChat` | idle lines over an answer | none while a started chat is at rest; a tap still gets a line | Done |
| 15 | Mascot dock (`restMascot` on fold or unfold) | over Send after the fold | above the ask box | Done |

## Onboarding

- **Why it looked cheap.** A small cursor Cassie sat beside the letter and the card, so she was never seen writing. Decoration posing as an action.

| # | Selector | Before | Now | Status |
|---|---|---|---|---|
| 16 | `.fr-guide-bot` (app.js, style.css) | mascot next to the writing | removed; the name and the card draw themselves, and Reduce Motion or Lite shows them finished | Done |

## Board exams sheet and lesson sheets (phone)

- **Hierarchy.** The disclaimer paragraph (5 lines) and two equal pill buttons sat above the topics, so the first topic started below the fold.
- **Space.** The full-screen sheet kept its glass rim and side shadow, which showed as dark vertical edges.

| # | Selector | Before | Now | Status |
|---|---|---|---|---|
| 17 | `.letc-card` (max-width 760px) | 1px rim, side shadow, bevel at the screen edges | border 0, no shadow, no bevel | Done |
| 18 | `.bp-says` | above the topics, .86rem | after the topics, .8rem, line height 1.5 (`.bp-fine`) | Done |

## Learn

- **Why it looked cheap.** The new Board and Licensure exams folder was a large empty dark shape, with no papers.

| # | Selector | Before | Now | Status |
|---|---|---|---|---|
| 19 | `folderGrid` for `level:board` | no papers | 3 papers: LET, CPALE, NCLEX-RN, each with a book icon | Done |
| 20 | `.lf-exams` (v242) | names broke mid-word | one exam per row on phones | Done in v242 |

## Flashcards

| # | Selector | Before | Now | Status |
|---|---|---|---|---|
| 21 | `.fc-decks li` (max-width 430px) | deck text squeezed into 4 short lines by the buttons | text on its own line, buttons under it on the right | Done |

## You / Settings and the Get Pro sheet

| # | Where | Before | Now | Status |
|---|---|---|---|---|
| 22 | You: `#st-questions` label | "1 questions this week" | "1 question this week" | Done |
| 23 | Pro sheet before payments open | "Get the Pasado Pass early" and a Pasado Pass note (a Plus plan) | "Get Pro early" and a Pro note (from ₱349 a month or ₱1,399 a semester) | Done |
| 24 | Sign-in button on the sheet | "I have Plus. Sign in" | "I have a plan. Sign in" | Done |

## Type and color (all screens)

- **Type.** One family (system UI) with the mono face kept for counts only. Scale on phone: greeting 22px/700, section titles 15 to 17px/700, body 16px/1.55 in answers and 13 to 14px elsewhere. Answers run about 38 characters a line on phones, which is right for a phone. No change needed.
- **Color.** Main: the --text and --bg pair. Secondary: --surface. One accent (--primary, which follows the palette the student picks). The contrast tests pass AA in light and dark on every screen checked. The accent sits on the active tab, Send and the primary button only. No change needed.

## Needs your decision

These change what a screen shows or where things live, so nothing here was built.

1. **Home header.** The theme switch (a big white pill in dark mode) competes with the greeting and Ask Cassie. Move it to You > Appearance only, or keep it?
2. **Get Pro sheet.** It has 4 actions (Get early, See the plans, Sign in, Not now). Cut it to 2 (Get Pro, Not now) and move the rest to a link line?
3. **Learn for a board reviewee.** Today's Labs (a science lab) is the first thing they see. Should their Board and Licensure exams folder come before Today's Labs?
4. **Chat top bar.** The first question in a chat scrolls under the frosted top bar, half-read. Make the top bar solid in chat?
