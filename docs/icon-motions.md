# Icon motions

How every icon in Cassie moves, taken from the reference recording (an icon-animation post: 150 line icons in a 10 x 15 grid, 828x1792 at 60 fps; it plays every icon at once in a loop of about 2.3 s). The recording was read frame by frame: each icon was cropped from one full loop (frames 257 to 396) and its 6-frame strip is in the scratchpad (strips/). Durations are measured from the first to the last frame the icon moves (capped at 1400 ms where the next loop starts).

The mechanism is in app.js (IC_HOST, IA_SIG, IA_EXTRA, icPrep, icGo) and style.css ("every icon moves like the recording"). Hover with a mouse or pen, a press or tap, and keyboard focus play it once. Reduce Motion plays none.

## The recording, icon by icon

| Cell (row-col) | Icon | What moves | Motion | ms | Easing |
|---|---|---|---|---|---|
| 0-0 | arrow-down-circle | arrow | arrow slides down 2px and settles; circle still | 617 | ease-in-out |
| 0-1 | alert-circle | ! stem and dot | stem retracts into the dot, then redraws downward | 1400 | ease-out |
| 0-2 | arrow-left-circle | arrow | arrow slides left 2px and settles | 617 | ease-in-out |
| 0-3 | align-center | 4 lines | lines shrink toward the centre and grow back, top to bottom, 60ms apart | 483 | ease-in-out |
| 0-4 | align-justify | 4 lines | lines erase and redraw left to right, staggered | 750 | ease-out |
| 0-5 | align-right | 4 lines | lines shrink into the right edge and regrow, staggered | 750 | ease-in-out |
| 0-6 | alert-octagon | ! stem and dot | stem collapses to the dot then draws down | 950 | ease-out |
| 0-7 | alert-triangle | ! stem and dot | stem grows down from the dot | 650 | ease-out |
| 0-8 | anchor | whole anchor from the ring | swings like a pendulum from the ring, about 15deg, two swings | 917 | ease-in-out |
| 0-9 | aperture | blades | blades turn about 60deg and close a little, then settle | 1383 | spring |
| 1-0 | airplay | screen and triangle | the screen becomes a play screen (triangle turns into a play sign), then back | 1400 | ease-in-out |
| 1-1 | arrow-right-circle | arrow | arrow slides right 2px and settles | 617 | ease-in-out |
| 1-2 | archive | lid, arrow | lid lifts and tilts, an arrow drops into the box, lid closes | 1400 | ease-in-out |
| 1-3 | arrow-down | arrow | moves down 3px and back | 617 | ease-in-out |
| 1-4 | arrow-left | arrow | moves left 3px and back | 617 | ease-in-out |
| 1-5 | arrow-right | arrow | moves right 3px and back | 617 | ease-in-out |
| 1-6 | arrow-up | arrow | moves up 3px and back | 617 | ease-in-out |
| 1-7 | at-sign | inner a and tail | the inner a spins and the tail redraws around it | 650 | ease-in-out |
| 1-8 | arrow-up-circle | arrow | arrow slides up 2px and settles | 617 | ease-in-out |
| 1-9 | award | ribbon and medal | medal and ribbon swing from the top, about 12deg each way | 1217 | ease-in-out |
| 2-0 | battery | charge | very small change: the cap blinks | 683 | linear |
| 2-1 | battery-charging | bolt | bolt redraws stroke by stroke | 617 | ease-out |
| 2-2 | bell | bell body, clapper | bell swings from its top: +15, -13, +9, -6, +3, 0deg; the clapper lags behind | 950 | ease-in-out |
| 2-3 | bell-off | slash, bell | slash erases, bell rings, slash redraws | 1133 | ease-in-out |
| 2-4 | bluetooth | rune strokes | strokes redraw in path order | 1083 | ease-out |
| 2-5 | bold | letter | stroke thickens to bold and back | 650 | ease-in-out |
| 2-6 | book | cover | closed book opens (cover flips) and closes | 900 | ease-in-out |
| 2-7 | bookmark | ribbon | ribbon flutters (skews one way then the other) | 1233 | ease-in-out |
| 2-8 | book-open | both pages | open book folds shut toward the spine (tilted) and opens again | 683 | ease-in-out |
| 2-9 | box | faces | cube flattens to a front face, then rebuilds | 1400 | ease-in-out |
| 3-0 | briefcase | case, handle | case tips and swings, the handle lifts | 1267 | ease-in-out |
| 3-1 | calendar | rings, header | rings lift, the page header flips down and back | 1067 | ease-in-out |
| 3-2 | camera | lens, flash | lens zooms in and out; a flash dot blinks | 1333 | spring |
| 3-3 | camera-off | slash, lens | slash erases, lens zooms, slash redraws | 1333 | ease-in-out |
| 3-4 | cast | waves | waves redraw one by one from the corner outward | 1400 | ease-out |
| 3-5 | bar-chart | bars | bars regrow from the bottom, one after another | 517 | ease-out |
| 3-6 | bar-chart-2 | bars | bars regrow from the bottom, staggered | 617 | ease-out |
| 3-7 | check | tick | tick redraws from the short arm to the long arm | 750 | ease-out |
| 3-8 | check-circle | circle, tick | circle draws around, then the tick draws | 1000 | ease-out |
| 3-9 | check-square | tick | tick erases, then redraws | 783 | ease-in-out |
| 4-0 | chevron-down | chevron | slides down and out with a fade, comes back in from the top | 750 | ease-in-out |
| 4-1 | chevron-left | chevron | slides out to the left, comes back in from the right | 750 | ease-in-out |
| 4-2 | chevron-right | chevron | slides out to the right, comes back in from the left | 750 | ease-in-out |
| 4-3 | chevrons-down | 2 chevrons | both slide down and out, one after the other, and come back from the top | 983 | ease-in-out |
| 4-4 | chevrons-left | 2 chevrons | slide out left one after the other and come back from the right | 983 | ease-in-out |
| 4-5 | chevrons-up | 2 chevrons | slide up and out, staggered, and come back from below | 983 | ease-in-out |
| 4-6 | chevrons-up (alt) | 2 chevrons | as chevrons-up | 983 | ease-in-out |
| 4-7 | chevron-up | chevron | slides up and out, comes back in from below | 750 | ease-in-out |
| 4-8 | chrome | whole logo | spins a full turn | 1400 | ease-in-out |
| 4-9 | clipboard | clip, lines, board | board squashes, the clip lifts, the lines draw in | 1267 | ease-in-out |
| 5-0 | clock | hands | minute hand sweeps a full turn | 483 | ease-in-out |
| 5-1 | cloud | cloud | drifts right a little and back | 1150 | ease-in-out |
| 5-2 | cloud-off | slash, cloud | slash erases, cloud drifts, slash redraws | 1300 | ease-in-out |
| 5-3 | code | brackets | brackets move apart and back together | 917 | ease-in-out |
| 5-4 | codepen | faces | unfolds into a diamond, then into < >, then back | 1400 | ease-in-out |
| 5-5 | coffee | cup, steam | cup tips as if sipped; steam lines rise and redraw | 1400 | ease-in-out |
| 5-6 | compass | needle | needle spins round and settles | 1217 | spring |
| 5-7 | copy | back sheet | back sheet slides under the front one, then out again | 650 | ease-in-out |
| 5-8 | cpu | core | core spins like a fan | 1400 | ease-in-out |
| 5-9 | credit-card | card | card flips over in 3D and back | 767 | ease-in-out |
| 6-0 | crop | corners | corners close into a square with a cut line, then reopen | 783 | ease-in-out |
| 6-1 | database | discs | discs squash into one and restack | 1100 | ease-in-out |
| 6-2 | delete | key body, x | key shakes left as if rubbing out; the x flickers | 617 | ease-in-out |
| 6-3 | disc | disc | disc flips edge-on and back | 1167 | ease-in-out |
| 6-4 | dollar-sign | S, bar | S redraws along its curve | 983 | ease-out |
| 6-5 | download | arrow, tray | arrow drops into the tray, tray dips | 550 | ease-in-out |
| 6-6 | download-cloud | arrow, cloud | arrow drops, cloud bobs | 1117 | ease-in-out |
| 6-7 | dribbble | ball | ball spins and flattens | 1400 | ease-in-out |
| 6-8 | edit | pencil | pencil lifts out of the box and scribbles, then returns | 900 | ease-in-out |
| 6-9 | edit-2 | pencil, line | pencil tips and writes a line under itself | 1183 | ease-in-out |
| 7-0 | edit-3 | pencil, underline | pencil writes; the underline draws | 1183 | ease-in-out |
| 7-1 | external-link | arrow, box | arrow shoots out up-right, the box shrinks, both settle | 1133 | ease-in-out |
| 7-2 | eye | pupil | pupil looks left and right | 1017 | ease-in-out |
| 7-3 | eye-off | slash, pupil | slash erases, pupil looks around, slash redraws | 1367 | ease-in-out |
| 7-4 | fast-forward | 2 triangles | triangles slide out right and come back in | 517 | ease-in-out |
| 7-5 | figma | shapes | shapes merge into one pill and split again | 1400 | ease-in-out |
| 7-6 | file | sheet, fold | sheet folds and redraws | 900 | ease-out |
| 7-7 | file-minus | sheet, minus | sheet shrinks, minus pulses | 933 | ease-in-out |
| 7-8 | file-plus | sheet, plus | sheet shrinks, plus pulses | 933 | ease-in-out |
| 7-9 | file-text | lines | text lines redraw one by one | 933 | ease-out |
| 8-0 | film | frames | frames scroll through | 1400 | linear |
| 8-1 | filter | funnel | funnel collapses into three shrinking lines and back | 1183 | ease-in-out |
| 8-2 | flag | cloth | flag waves (skews back and forth) | 1400 | ease-in-out |
| 8-3 | folder | front flap | flap opens forward and closes | 1267 | ease-in-out |
| 8-4 | folder-minus | flap | as folder | 1267 | ease-in-out |
| 8-5 | folder-plus | flap | as folder | 1267 | ease-in-out |
| 8-6 | framer | shape | morphs into a Z and back | 1400 | ease-in-out |
| 8-7 | gift | lid, box | box squashes, lid pops | 700 | spring |
| 8-8 | github | tail | tail wags | 1267 | ease-in-out |
| 8-9 | globe | meridian | globe spins (meridian slides across) | 1400 | linear |
| 9-0 | grid | 4 tiles | tiles shrink and shuffle, then spread back | 900 | ease-in-out |
| 9-1 | headphones | band, cups | headphones bob to a beat, cups pulse | 1000 | ease-in-out |
| 9-2 | heart | heart | beats twice: .85, 1.15, .9, 1.1, 1 | 950 | ease-in-out |
| 9-3 | help-circle | question mark, dot | the ? redraws, then the dot appears | 817 | ease-out |
| 9-4 | home | house | an echo of the house lifts up-right and fades | 1033 | ease-out |
| 9-5 | image | sun, mountain | sun moves, mountain redraws | 1400 | ease-in-out |
| 9-6 | inbox | letter, tray | a letter drops into the tray | 1400 | ease-in-out |
| 9-7 | info | i dot, stem | the dot drops and bounces, stem sways | 817 | spring |
| 9-8 | instagram | camera | squishes and springs back | 1100 | spring |
| 9-9 | italic | letter | slant goes upright and back | 517 | ease-in-out |
| 10-0 | key | key | turns about 30deg twice as if unlocking | 983 | ease-in-out |
| 10-1 | layers | layers | layers collapse into one, then spread up | 1400 | ease-in-out |
| 10-2 | layout | dividers | dividers slide to a new layout and back | 917 | ease-in-out |
| 10-3 | life-buoy | ring | spins and bobs | 1267 | ease-in-out |
| 10-4 | link | 2 links | links swing together and apart | 1050 | ease-in-out |
| 10-5 | link-2 | link | turns 45deg and back | 1083 | ease-in-out |
| 10-6 | linkedin | letters | letters redraw | 1050 | ease-out |
| 10-7 | list | lines | lines slide right one after another; bullets stay | 817 | ease-in-out |
| 10-8 | lock | shackle | shackle lifts open, then closes | 1317 | ease-in-out |
| 10-9 | log-in | arrow | arrow slides into the door from the left | 1083 | ease-in-out |
| 11-0 | log-out | arrow | arrow slides out of the door and comes back in | 1083 | ease-in-out |
| 11-1 | mail | flap, letter | envelope opens and a letter peeks out | 1400 | ease-in-out |
| 11-2 | maximize | 4 corners | corners pull in, then push out | 1183 | ease-in-out |
| 11-3 | maximize-2 | 2 arrows | arrows push out diagonally and back | 1183 | ease-in-out |
| 11-4 | menu | 3 lines | lines turn into an x and back | 1283 | ease-in-out |
| 11-5 | message-circle | dots | typing dots appear inside and bounce | 1400 | ease-in-out |
| 11-6 | message-square | text lines | text lines type in | 1133 | ease-out |
| 11-7 | infinity | loop | the loop redraws along its path | 1400 | ease-in-out |
| 11-8 | mic | capsule | capsule fills solid and lifts a little | 1117 | ease-in-out |
| 11-9 | mic-off | slash, capsule | slash erases, capsule fills, slash redraws | 1383 | ease-in-out |
| 12-0 | minimize | 4 corners | corners push in, then out | 950 | ease-in-out |
| 12-1 | minimize-2 | 2 arrows | arrows pull in toward the centre | 783 | ease-in-out |
| 12-2 | minus | second bar | a vertical bar grows: minus becomes plus, then back | 1017 | ease-in-out |
| 12-3 | minus-circle | second bar | as minus, in a circle | 1050 | ease-in-out |
| 12-4 | minus-square | second bar | as minus, in a square | 1200 | ease-in-out |
| 12-5 | moon | moon, rays | moon turns into a sun (rays draw out) and back | 1150 | ease-in-out |
| 12-6 | more-horizontal | 3 dots | dots hop one after another | 550 | ease-in-out |
| 12-7 | more-vertical | 3 dots | dots pulse one after another | 550 | ease-in-out |
| 12-8 | move | 4 arrows | arrows pull in and push out | 1400 | spring |
| 12-9 | music | notes | notes bob and tilt to a beat | 1400 | ease-in-out |
| 13-0 | navigation | arrow | arrow turns, flies off up-right and comes back | 950 | ease-in-out |
| 13-1 | navigation-2 | pointer | pointer turns to point and back | 1400 | ease-in-out |
| 13-2 | package | lid flaps | box opens, flaps rise, closes | 1400 | ease-in-out |
| 13-3 | paperclip | clip | clip bends as it redraws along its length | 1400 | ease-in-out |
| 13-4 | pen-tool | nib | nib dips and draws a line | 1400 | ease-in-out |
| 13-5 | percent | 2 circles | circles swap places around the slash | 1400 | ease-in-out |
| 13-6 | phone | handset | rings: quick shakes | 1117 | ease-in-out |
| 13-7 | phone-call | waves | waves pulse outward | 1267 | ease-out |
| 13-8 | phone-off | slash, handset | slash erases, handset rings, slash redraws | 1400 | ease-in-out |
| 13-9 | map-pin | pin | pin lifts and drops with a squash | 1400 | spring |
| 14-0 | play | triangle, bars | play turns into pause and back | 1400 | ease-in-out |
| 14-1 | play-circle | triangle, bars | play in a circle turns into pause and back | 1400 | ease-in-out |
| 14-2 | plus-circle | plus | plus spins a quarter turn and shrinks to dots, then back | 1400 | spring |
| 14-3 | plus-square | plus | as plus-circle, in a square | 1400 | spring |
| 14-4 | pocket | chevron | chevron turns into a smile and back | 667 | ease-in-out |
| 14-5 | power | stem, ring | stem drops into the ring, ring redraws | 1400 | ease-in-out |
| 14-6 | printer | paper | a sheet slides out of the printer | 1067 | ease-in-out |
| 14-7 | radio | waves | waves pulse outward | 750 | ease-out |
| 14-8 | refresh-cw | 2 arcs | arcs redraw while turning a full turn | 883 | ease-in-out |
| 14-9 | rotate-ccw | arc, head | arc redraws counter-clockwise, head leads | 867 | ease-in-out |

## Cassie's icons: the same motion as the recording

| data-ia | Recording icon | Cassie icons | Motion | ms |
|---|---|---|---|---|
| bell | 2-2 bell | Reminders (top bar, phone Home) | the bell swings from its top +15, -13, +9, -6, +3deg; the clapper lags 60ms behind and swings the other way | 900 |
| chat | 11-5 message-circle | Chats (sidebar), Chat tab, chat boxes | three typing dots appear inside the bubble, bounce one after another and go | 900 |
| ask | 11-6 message-square | Ask a question (Home) | the two text lines type in, one after the other | 650 |
| checkbox | 3-9 check-square | Study plan (sidebar) | the tick erases and redraws | 800 |
| check | 3-7 check | Send your sketch (Board) | the tick redraws | 600 |
| lessons | 2-8 book-open | Lessons | both pages fold to the spine and open again | 800 |
| book | 2-6 book | Book (dashboard) | the cover opens over and closes | 800 |
| calendar | 3-1 calendar | Calendar | the rings lift, the page header flips down and back | 820 |
| trend | 3-5 bar-chart (as a line) | Progress | the progress line redraws from the left; the axis stays | 700 |
| chev-d / chev-l / chev-r | 4-0 / 4-1 / 4-2 chevrons | Menu, sidebar collapse, Back, row arrows | the chevron slides out one side and comes back in from the other | 750 |
| arrow-ur | 7-1 external-link | Open your chats, Open flashcards, See your progress, See your study plan | the arrow shoots out up-right and comes back in from the lower left | 750 |
| board | 3-6 bar-chart-2 (as a sketch line) | Board | the sketch line draws on the board | 700 |
| gear | 0-9 aperture | Settings | turns one tooth (60deg, the gear has 6 teeth) with a spring | 700 |
| help | 9-3 help-circle | Help, Quiz me (Home box) | the ? redraws, then the dot pops in | 850 |
| mic | 11-8 mic | Ask by voice, Say it instead of typing | the capsule fills solid and lifts 1.5px | 800 |
| moon / sun | 12-5 moon | Dark mode switch | moon: rocks and rays draw round it; sun: rays turn 45deg, the core pulses | 800 |
| plus | 14-2 plus-circle | New chat, Ask Cassie, New plan | the plus spins a quarter and shrinks, then back | 600 |
| upload | 6-5 download (the other way) | Add my notes | the arrow rises out of the tray, the tray dips | 600 |
| download | 6-5 download | Save (Board) | the arrow drops into the tray, the tray dips | 700 |
| clock | 5-0 clock | Focus timer | the hand sweeps a full turn, the top button clicks | 900 |
| cards | 5-7 copy | Flashcards, Cards tab, board cards | the back card slides under the front one and out again | 700 |
| play / pause | 14-0 play | Today's lab, timer play and pause, Watch | play turns into pause (and pause into play) and back | 800 |
| bars | 3-6 bar-chart-2 | Talk with Cassie, Voice settings, Teach out loud, Talk box | the bars regrow one after another | 980 |
| lock | 10-8 lock | Privacy | the shackle lifts open and closes | 800 |
| pointer | 13-1 navigation-2 | Take the tour, Move (Board) | the pointer turns to point and back | 700 |
| home | 9-4 home | Home (sidebar, tab) | an echo of the house lifts up-right and fades | 700 |
| heart | 9-2 heart | Talk to Cassie (chip) | beats twice | 900 |
| pencil / pen | 6-9 edit-2 / 13-4 pen-tool | Quiz me (chip), Pen and Highlighter (Board) | the pencil tips and writes a line under itself | 900 |
| list | 10-7 list | Solve step by step | the lines slide right one after another; the bullets stay | 660 |
| doc | 7-9 file-text | Make study notes | the text lines redraw | 800 |
| cube | 13-2 package | Explore in 3D | the top lifts, the front edge draws | 700 |
| clipboard | 4-9 clipboard | Paste (chip) | the board squashes, the clip lifts, the lines draw in | 800 |
| clip | 13-3 paperclip | Attach a file | the clip redraws along its length | 900 |
| send | 13-0 navigation | Send | flies off up-right and comes back in from the lower left | 700 |
| camera | 3-2 camera | Snap a problem | the lens zooms out and in, a flash blinks | 600 |
| headphones | 9-1 headphones | Podcast my notes | the band bobs, the cups pulse to a beat | 700 |
| menu | 11-4 menu | Open menu | the three lines turn into an x and back | 800 |
| eraser | 6-2 delete | Eraser (Board) | the eraser rubs side to side | 700 |
| undo / redo | 14-9 rotate-ccw / 14-8 refresh | Undo, Redo (Board) | the arc redraws, the head leads | 800 |
| trash | 1-2 archive | Clear (Board) | the lid lifts and tilts, then closes | 700 |
| image | 9-5 image | Add a picture (Board) | the sun moves, the mountain redraws | 800 |
| fit | 11-2 maximize | Fit, Full screen (Board) | the corners pull in, then push out | 700 |
| dots | 12-6 more-horizontal | More (Board) | the dots hop one after another | 600 |
| side | 10-2 layout | Dock to the side (Board) | the divider slides and back | 700 |
| draw | 10-6 / 7-9 (lines redraw) | Learn lab icons and any other icon | its lines draw on, one after another | 920 |

## Cassie's icons with no match in the recording: their own motion, in the same style

Each moves one meaningful part or draws its lines, never a whole-icon bounce, wiggle, pop or tilt.

| data-ia | Cassie icons | Motion |
|---|---|---|
| flask | Learn (top bar, tab, Learn: try a simulation) | the liquid sloshes and the rim lifts |
| games | Games | the d-pad presses, then the two buttons blink |
| brain | Memory | the two halves part and meet, the seam draws |
| search | Search, live web sources | the lens draws round |
| research | Research (Home box) | the lens draws round, the plus inside turns |
| stop | Stop the timer | the square turns a quarter and squeezes |
| person | You tab, Account | the head nods up, the shoulders draw |
| cap | Research a topic, Study settings | the cap lifts as if tossed, the tassel swings |
| star | Plans | the star draws round and twinkles |
| sparkle | Ideas to get started | it twinkles a quarter turn and two small sparkles flash |
| tune | Set your study and break times | the two knobs slide opposite ways |
| people | Study room, Study together | the two heads bob one after the other |
| flame | Streak | it draws up and flickers |
| bulb | Explain a topic, Hint | it glows and rays draw out round it |
| close | Close (menu, Board) | each line of the x redraws in turn |
| hand | Hand (Board) | the fingers lift one after another |
| line | Straight line (Board) | the line draws from dot to dot |
| text | Type text (Board) | the T draws: bar, stem, foot |
| laser | Laser (Board) | the beam shoots out, the sparks flash |
| note | Sticky notes (Board) | the folded corner redraws |
| shapes | Quick shapes (Board) | each shape pops in turn |
| snap | Shape snap (Board) | the triangle draws, the corners snap in |
| grid | Paper (Board) | the grid lines draw across |
| zoom | Zoom in and out (Board) | the plus or minus pulses in the lens |

Only four icons move whole, because their recording icon does: send (13-0 navigation), gear (0-9 aperture), heart (9-2) and pointer (13-1 navigation-2).

## Filled icons redrawn as Cassie line icons

A filled shape can't redraw its lines or move one part like the recording's line icons, so these were redrawn on the 24 grid with a 2px round stroke in currentColor (class ic-line). Every other icon rests exactly as it was drawn: its lines are only split into parts while it moves.

- Learn (top bar): filled flask → the line flask the tab bar already uses
- Memory: filled brain → line brain (two halves and a seam)
- Close menu (phone): filled x → line x
- New chat: filled plus → line plus
- Hint, Explain a topic: filled bulb → line bulb
- Quiz me (chip and Home): filled pencil → line pencil
- Research (chip) and Research a topic: filled cap → line cap with tassel
- Live web sources: filled magnifier → line magnifier
- Talk to Cassie: filled heart → line heart
- Paste: filled clipboard → line clipboard
- Snap a problem: filled camera → line camera with a separate lens
- Attach a file: filled paperclip → line paperclip
- Talk with Cassie: filled bars → line bars
- Ask by voice: filled mic → line mic (capsule and stand)
- Solve step by step: filled list → line list
- Make study notes: filled file → line file with text lines
- Explore in 3D: filled cube → line cube
- Learn: try a simulation: filled flask → line flask
- Study together: filled people → the line people Home already uses
- Flashcards (Home example): filled cards → the line cards Home already uses
- Podcast my notes: filled headphones → line headphones
- Teach Cassie out loud: filled bars → line bars
