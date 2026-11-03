# The 8 button rules, v247

Checked on every main screen at 390x844 (phone, light and dark, iPhone safe areas faked) and 1280x800 (computer, light): Home, Chat (at rest and while typing), Learn, Flashcards, You and every Settings page, the plan sheet, Podcast, Board exams (exams, a course, a simulation), the onboarding questions and the tour. The scan is `uxRuleIssues` in `tests/ui-checks.cjs`; the smoke test is "v247: the 8 button rules".

**Done** shipped in v247. **Needs your decision** changes what a screen shows, so it was not built.

## Rule 1: labels say what happens

Test: the label still makes sense on its own.

| Where | Selector or function | Before | Now | Status |
|---|---|---|---|---|
| Podcast, after picking notes | `.pod-next` | Next | Use these notes | Done |
| Plan sheet, after the plan comes through | `.plus-ok` (plusSheet) | OK | Close | Done |
| Board exams, simulation in progress | `.bp-cont` | Continue | Continue the simulation | Done |
| Board exams, a simulation question | `.bp-nextq` | Next / Finish | Next question / Finish and see my score | Done |
| Board exams, a note | `.bp-savenote` | Save | Save note | Done |
| Onboarding questions | `.fr-go` | Next | Next question | Done |
| The tour | `.tour-main` | Next | Next step | Done |
| Focus timer | `#pomo-toggle`, `#pomo-reset`, `#pomo-skip` | Start / Pause, Reset, Skip | Start timer / Pause timer, Reset timer, Skip ahead | Done |
| Sequencer game | `button(r, …)` in labs/games2.js | Check | Check my order | Done |
| Magnetic fields lab | `button(ov, …)` in labs/physics2.js | Clear | Clear magnets and wires | Done |
| Every confirm (see Rule 6) | browser `confirm()` | OK | Delete chat, Clear memory, Delete deck… | Done |

Kept: Close, Back, Not now, Cancel and Try again (they say what happens, and they close or repeat).

## Rule 2: one primary action per screen

Test: only the main action has the strongest style (a filled button); the rest are outlined or text.

| Where | Selector | Before | Now | Status |
|---|---|---|---|---|
| Flashcards, no cards yet, with the card form open | `.empty-state .es-go` and `.fc-btn.main` | "Write a card" and "Add card", both filled | "Write a card" steps aside while the form is open; Add card is the one filled button | Done |
| Every confirm | `.sure-sheet` | browser OK/Cancel | Cancel outlined, the action red | Done |
| Plan sheet | `.plus-sheet` | 2 buttons since v246 | unchanged: one filled, Not now outlined | Done in v246 |

Every other sheet checked (Podcast, Board exams, Settings, Plans) already has one filled button.

## Rule 3: easy to tap

Test: 48px on touch (40px with a mouse) and 8px between neighbours.

| Where | Selector | Before | Now | Status |
|---|---|---|---|---|
| Chat top bar on a phone, Board and Memory | `html.native .topbar-actions` | 0px apart | 8px apart | Done |
| Ask box at rest, mic and Send | `html.chat-rest .composer-row` | 4px apart | 8px apart | Done |
| Appearance, the colour swatches (touch) | `.accent-swatches` | 0px apart | 8px apart | Done |
| Computer top bar, theme switch and bell | `.topbar-actions` (computer) | 4px apart | 8px apart | Done |
| Flashcards, Write a card (mouse) | `.fc-btn` | 36px tall | 40px with a mouse, 48px to touch | Done |
| Ask box while typing on a phone | `.composer-row` (max-width 430px) | 4px apart: model, camera, file, talk, mic, Send in 340px | unchanged | Needs your decision (1) |
| Computer sidebar and Settings menu rows | `.side-tool`, the Settings list | 40px rows, 2px apart | unchanged: a mouse list, 40px is the mouse rule | Kept |
| The tab bar | `.tabbar .tab` | tabs touch | unchanged: one control, each tab 60px wide | Kept |

## Rule 4: enough contrast

Test: 4.5:1 for words on their fill (3:1 for large bold), in light and dark, in every state.

| Where | Selector | Before | Now | Status |
|---|---|---|---|---|
| The new red button | `.sure-danger` | (new) | white on `--danger-fill` #b3261e light (6.5:1), #c42b22 dark (5.6:1); hover and pressed darker | Done |
| Confirm buttons in every state | `.sure-yes`, `.sure-no` | (new) | default, hover, pressed, focus and loading all AA, light and dark (tested) | Done |
| Every screen's words | existing AA tests | AA | AA | Kept |

## Rule 5: design every state

Test: default, hover (mouse only), pressed, disabled and loading, all from tokens.

| Where | Selector | Before | Now | Status |
|---|---|---|---|---|
| Red button | `.sure-danger` | (new) | hover `--danger-fill-hover`, pressed `--danger-fill-down`, focus ring, loading spinner | Done |
| Loading, everywhere | `busyButton` | some buttons only went grey with new words | every wait uses the same spinner and "-ing…" words (Rule 8) | Done |
| Design system buttons | `.btn` | 3 sizes; pressed, disabled and loading (v230) | unchanged | Kept |

## Rule 6: destructive actions are obvious

Test: the confirm names the thing, says what goes and whether it comes back, and the button is red and says what it does.

The browser's "OK / Cancel" box is gone everywhere. `askSure()` (app.js) shows a sheet: the title names the thing, the text says what goes and that it can't be undone, Cancel has focus (so Enter on autopilot keeps things), and the action is red.

| Where | Before | Now | Status |
|---|---|---|---|
| Delete a chat (computer Home) | "Delete this chat?" OK | "Delete “Ethics”?" Delete chat | Done |
| Clear a chat (Settings) | "Clear this conversation?" OK | "Clear “Ethics”?" Clear chat | Done |
| Delete an exam plan | "Delete your plan for X?" OK | same title, what goes, Delete plan | Done |
| Clear memory | OK | "Clear everything Cassie remembers about you?" Clear memory | Done |
| Import a backup | OK | "Replace your chats and memory with this backup?" Replace with backup | Done |
| Delete account | OK | "Delete your Cassie account?" Delete account | Done |
| Delete a flashcard deck | "Delete the deck X and all its cards?" OK | "Delete the deck “X”?" with its card count, Delete deck | Done |
| Delete a board exam note | OK | "Delete “title”?" Delete note | Done |
| Start a new simulation over one in progress | OK | "End your CPALE simulation in progress?" with the question you're on, End it and start new | Done |
| Finish with questions unanswered | OK | "3 questions are not answered yet", Keep answering / Finish and see my score (not red: nothing is lost) | Done |
| Board: open a file over a drawing | OK | "Replace your board with this file?" Replace my board | Done |
| Board: clear | OK | "Clear everything you drew?" Clear the board / "Clear what you drew?" Clear my drawings | Done |
| Board: add a file to a study room | OK | "Add 4 drawings, notes and cards to the room?" Add to the room (not red) | Done |
| Argument map: new map, remove a reason | OK | Clear the map, Remove reason | Done |
| Sign out | no confirm | unchanged: nothing on the device is lost | Kept |

## Rule 7: don't make people guess icons

Test: if it needs a tooltip to explain it, it needs a label. Universal ones stay icon-only: close, search, back, menu, send, play, the bell.

| Where | Selector | Now | Status |
|---|---|---|---|
| Phone tab bar | `.tabbar .tab` | the open tab shows its name; the other 5 are icons only | Needs your decision (2) |
| Chat top bar on a phone | `#board-btn`, `#memory-btn` | icons only (drawn thicker in v246) | Needs your decision (3) |
| Ask box | `#camera-btn`, `#attach-btn`, `#voice-btn`, `#mic-btn` | icons only, on phone and computer | Needs your decision (4) |
| Computer sidebar | `#side-toggle` | an arrow, "Make the sidebar small" | Kept (a universal collapse arrow) |
| Cassie | `#mascot-btn` | the character herself | Kept |
| Learn, Today's Lab | `.lp-play` | play | Kept (universal) |
| Computer sidebar, Learn, Games, Board, Settings, Memory | `.side-tool` | icon and name | Done before |

## Rule 8: show that it's working

Test: a wait swaps the label for a spinner and "-ing…" words, blocks repeat taps, and comes back or explains.

| Where | Before | Now | Status |
|---|---|---|---|
| Early list | button went grey, no words | spinner, "Joining the early list…", one request for two taps (tested) | Done |
| Make my exam plan | button went grey | spinner, "Making your plan…" | Done |
| Podcast download | "Getting it ready…" with no spinner | spinner, "Getting the audio ready…" | Done |
| Study room board: Check our board | words only | spinner, "Cassie is looking…" | Done |
| Learn: a lab's "Ask Cassie for a nudge" | grey | spinner, "Asking Cassie…" | Done |
| Learn tools (essay check, cards from text…) | words only | spinner and their own words | Done |
| Study room: Ask Cassie, Make a group quiz | words only | spinner, "Asking Cassie…", "Making the quiz…" | Done |
| Send | spinner since v232 | unchanged; three taps send once (tested) | Kept |
| Sign in, Make my podcast, Make cards, Save to notes, buy | spinner since v232 | unchanged | Kept |
| Board exams: Read the lesson, Quiz me, start a mock | the view changes at once to Cassie writing | unchanged (no button left to tap twice) | Kept |

## Needs your decision

Nothing here was built.

1. **Ask box while typing (phone).** 6 buttons in 340px means 4px between taps. 8px needs one of: the model name as an icon only (it shows a short name such as "OSS 120B" or "Cassie" now), or camera and file in one "Add" button that opens both.
2. **Phone tab bar.** Only the open tab shows its name. Showing all 6 names would make every tab 60px wide with small words under the icons (like iPhone apps), or keep 5 tabs and move one into You.
3. **Chat top bar, Board and Memory.** Small words under each icon ("Board", "Memory") fit if the bar grows 12px taller, or they move into the menu.
4. **Ask box icons.** Camera, file, Talk and mic could show names in a row above the keyboard while typing, or a first-time hint could name each once.
