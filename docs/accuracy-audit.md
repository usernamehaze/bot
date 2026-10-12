# Accuracy audit: Labs and Explore

Checked: October 2026. Scope: every lab in `labs/*.js` (simulations, games, puzzles, study tools, museum, atlas), `explore/*.js` (the 3D cells and body, `body-facts.js`, `cells.js`), the atlas data file, and hard-coded facts in `app.js` (none found: its numbers are code settings, not facts).

How it was checked:
- Every simulation was run in a real browser with known inputs, and its output compared with the textbook formula (results in section 3).
- Pure calculations (planet positions, eclipses, equation balancing) were run in Node against published values.
- Facts were checked against NASA, IAU, IUPAC, NIST/CODATA, PSA, NIDDK, Britannica and peer-reviewed sources. Direct access to some sites (nasa.gov) is blocked from this build machine, so those were confirmed through search results that quote them; the link given is the page the figure comes from.
- "Unverified" means no reliable source was found. Nothing was guessed.

**Result: 11 rows need a change (section 1), 3 are optional wording fixes (section 2). Everything else checked is correct (sections 3 and 4).**

## 1. Needs a change

| # | file:line | current text | correct value | source | confidence |
|---|---|---|---|---|---|
| 1 | labs/space.js:14 | Jupiter: 95 known moons | 101 (4 more confirmed by the IAU Minor Planet Center, March 2026). Suggest showing "101 (as of 2026)", because the count keeps changing. | [IAU: MPC confirms new moons of Saturn and Jupiter (2026)](https://www.iau.org/IAU/IAU/News/Ann2026/MPC-New-Moons-Saturn-Jupiter.aspx); [EarthSky totals](https://earthsky.org/space/more-moons-for-jupiter-and-saturn-total-satellite-discoveries/) | medium (some sites already say 115, counting moons not yet numbered) |
| 2 | labs/space.js:15 | Saturn: 274 known moons | 285 (IAU MPC, March 2026). Some July 2026 sources say 293. Suggest "about 285 (as of 2026)". | same as row 1 | medium |
| 3 | labs/space.js:16 | Uranus: 28 known moons | 29 (S/2025 U1, found by the James Webb Space Telescope, announced August 2025) | [EarthSky totals](https://earthsky.org/space/more-moons-for-jupiter-and-saturn-total-satellite-discoveries/) | high |
| 4 | labs/space3d.js:41 | Milky Way: "Everything you can see in the night sky without a telescope is in it." | Not true: the Andromeda Galaxy and the Large and Small Magellanic Clouds are other galaxies you can see with your eyes (the same file says so for Andromeda). Suggest: "Almost every star you can see without a telescope is in it." | [Britannica: Andromeda Galaxy](https://www.britannica.com/place/Andromeda-Galaxy) | high |
| 5 | labs/space3d.js:42 | Andromeda "will merge with the Milky Way in about 4–5 billion years" | No longer certain: a 2025 study (Sawala et al., *Nature Astronomy*, Hubble + Gaia data) gives about a 50% chance of a merger within 10 billion years, and under 2% within 5 billion. Suggest: "It is coming towards us; the two may merge in several billion years (a 2025 study puts the chance at about 50% within 10 billion years)." | [University of Western Australia news (study co-author)](https://www.uwa.edu.au/news/article/2025/june/astronomers-thought-the-milky-way-was-doomed-to-crash-into-andromeda) | high |
| 6 | labs/space3d.js:23 | Neptune: "It was found by maths (1846) before anyone had seen it." | Galileo saw it in 1612–13 but took it for a star. It was the first planet found by mathematical prediction (Le Verrier, Adams), and Galle spotted it in 1846. Suggest: "It was the first planet found by maths: its position was predicted, and it was spotted there in 1846." | [Britannica: Neptune](https://www.britannica.com/place/Neptune-planet) | high |
| 7 | labs/space3d.js:31 | Sagittarius A*: "Its picture was taken in 2022 by the Event Horizon Telescope." | The image was released in May 2022, made from observations taken in 2017. | [Event Horizon Telescope press release](https://eventhorizontelescope.org/blog/astronomers-reveal-first-image-black-hole-heart-our-galaxy) | high |
| 8 | explore/body-facts.js:132 | Clavicle: "It is the most commonly broken bone." | In large population studies the wrist (distal radius) is broken most often; the collarbone is one of the most common (the most common in young children). Suggest: "It is one of the most commonly broken bones." | [US 8-state fracture study (distal radius/ulna 16.2 vs clavicle 5.8 per 10,000)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5659318/); [BMC Musculoskeletal Disorders 2021](https://doaj.org/article/d3c3c645c99445218e0c72c00e6c9f6e) | high |
| 9 | explore/body-facts.js:27 | Lung: "Air reaches about 300 million tiny sacs (alveoli)" | About 480 million in both lungs (range 274 to 790 million; Ochs et al. 2004), about 240 million per lung. 300 million is an older textbook figure, and this card is about one lung. | [BioNumbers (Harvard)](https://bionumbers.hms.harvard.edu/bionumber.aspx?id=101476) | medium-high |
| 10 | labs/museum.js:41 | The Creation of Adam: "the ceiling Michelangelo painted lying on scaffolding" | A popular myth: he painted standing on the scaffolding, bending his head back. | [History.com: 7 things you may not know about the Sistine Chapel](https://www.history.com/news/7-things-you-may-not-know-about-the-sistine-chapel) (Vasari's account; Michelangelo designed wall-bracket platforms so painters could stand) | high |
| 11 | labs/atlas/countries.json (all countries, `pop`) | Offline populations are World Bank estimates for 2020, e.g. Philippines 109,581,085 (2020) | The figures are labelled "2020", so they are not wrong, but they are 6 years old. The Philippines' official count is **112,729,484 (PSA 2024 Census of Population, as of 1 July 2024)**. Suggest: update the Philippines to the PSA 2024 count and the rest to the newest World Bank year. (When online the app already fetches the newest World Bank figure.) | [PCO: 2024 POPCEN declared official](https://mirror.pco.gov.ph/?p=211602); [2024 Philippine census](https://en.wikipedia.org/wiki/2024_Philippine_census) | high (Philippines); refreshing all 250 countries needs access to the World Bank API, which this build machine can't reach |

## 2. Optional wording (simplified, not wrong)

| # | file:line | current text | suggestion | source | confidence |
|---|---|---|---|---|---|
| 12 | labs/atlas/countries.json (PHL `area`) | Philippines area 342,353 km² | Official figure: about 300,000 km² (NAMRIA, used by the UN). Another government figure, 343,448 km² (NSCB), also exists; 342,353 matches neither. Suggest 300,000 km². | [Geography of the Philippines](https://en.wikipedia.org/wiki/Geography_of_the_Philippines); [UN regional cartographic conference country report](https://unstats.un.org/unsd/geoinfo/RCC/docs/rccap18/CRP/18th_UNRCCAP_econf.100_crp%2017.pdf) | medium (sources disagree) |
| 13 | explore/body-facts.js:47 | Appendix: "The appendix holds helpful gut bacteria" | A leading idea, not yet proven. Suggest "may hold helpful gut bacteria". | [Britannica: appendix](https://www.britannica.com/science/appendix) | medium |
| 14 | explore/cells.js:14 | Lysosomes marked as found only in animal cells | Plant cells use lysosome-like vacuoles; most school textbooks say "mainly in animal cells". (labs/biology.js already says this.) Fine to keep for school level. | [Britannica: lysosome](https://www.britannica.com/science/lysosome) | low priority |

## 3. Calculations run with known inputs (all correct)

| lab (file) | input | app's answer | textbook answer |
|---|---|---|---|
| Launch lab (labs/physics.js) | 45°, 20 m/s, from the ground, g 9.81 | range 40.8 m, top 10.2 m, 2.88 s | v²/g = 40.77 m; v²sin²θ/2g = 10.19 m; 2v·sinθ/g = 2.883 s |
| Launch lab | 30°, 15 m/s | 19.9 m, 2.87 m | 19.86 m, 2.87 m |
| Pendulum (labs/physics.js) | 1 m, let go from 5° | measured 2.01 s | exact 2.007 s (2π√(L/g) = 2.006) |
| Pendulum | 1.2 m, 35° | 2.25 s | exact large-swing period 2.250 s |
| Pendulum | 1 m, 60° | 2.15 s | exact 2.153 s |
| Bending light (labs/physics.js) | air to water, 40° | 28.9°, 2.42% reflected | Snell 28.90°; Fresnel 2.42% |
| Bending light | air to water, 30° | 22.1° | 22.08° |
| Wave string (labs/physics2.js) | v 27.1 m/s, 10 m, fixed end | 1.36, 2.71, 4.07 Hz; λ 18.1 m at 1.5 Hz | f = nv/2L: 1.355, 2.71, 4.07 Hz; λ = v/f = 18.07 m |
| Lenses (labs/physics2.js) | convex, f 10 cm, object 20 / 30 / 5 cm | 20 cm (×−1) / 15 cm (×−0.5) / virtual 10 cm (×2) | 1/f = 1/u + 1/v: 20, 15, −10 cm |
| Rocket (labs/physics2.js) | 100 kN, 10 t fuel, 1 t payload, kerosene | 12 t, thrust ÷ weight 0.85, Δv 5.46 km/s | 117.7 kN weight → 0.85; 311 × 9.80665 × ln 6 = 5.465 km/s |
| Colour (labs/physics2.js) | RGB 255, 160, 40 | CMYK 0/37/84/0, HSV 33°/84%/100% | same |
| Equation balancer (labs/chemistry.js) | 10 equations incl. KMnO₄ + HCl | 2,16,2,2,8,5 and all others correct | same |
| pH mixer (labs/chemistry.js) | 10 mL 0.1 M HCl in 50 mL water; then +10 mL NaOH; then +1 mL | 1.78; 7.00; 11.15 | 1.778; 7.00; 11.149 |
| Ice to steam (labs/chemistry2.js) | heating curve | q = mcΔT and q = mL at each stage | same |
| Planets (labs/space.js) | orbit periods (from JPL's orbital elements) | 87.97, 224.70, 365.26, 686.98, 4332.8, 10755.9, 30687, 60190 days | sidereal periods 87.97, 224.70, 365.26, 686.98, 4332.6, 10759, 30688, 60195 days (the small gaps for Saturn to Neptune come from JPL's averaged rates and are under 0.1%) |
| Planets | Earth's distance from the Sun, 4 Jan / 3 Jul 2025 | 0.98329 / 1.01671 AU | perihelion 0.98329, aphelion 1.01664 AU |
| Moon (labs/space.js) | full and new moons, Jan to Apr 2025 | right dates, within about 20 minutes | published times |
| Eclipses (labs/space.js) | every solar and lunar eclipse 2025 to 2027 | 29 Mar 2025, 21 Sep 2025, 17 Feb 2026, 12 Aug 2026, 6 Feb 2027, 2 Aug 2027 (solar); 14 Mar 2025, 7 Sep 2025, 3 Mar 2026, 28 Aug 2026, 20 Feb 2027, 18 Jul 2027 (lunar) | all correct (NASA eclipse lists) |
| Money grows (labs/math.js) | ₱10,000, 6%, 20 years, monthly | ₱33,102; simple ₱22,000; doubles in 11.6 years | 10,000 × 1.005²⁴⁰ = 33,102.04; ln 2 ÷ (12 ln 1.005) = 11.58 |
| Function lab (labs/math.js) | f(x) = sin x + x/3 at x = 1 | 1.17, slope 0.874, bend −0.841 | 1.1748, 0.8736, −0.8415 |
| Vectors (labs/math2.js) | (4, 2) and (1, 4) | dot 12, angle 49.4°, cross 14 | same |
| Units (labs/math.js) | 1 km in miles | 0.621371 | 0.621371 |
| Punnett (labs/biology.js) | Yy × Yy | 3 : 1 | 3 : 1 |
| Tower of Hanoi, Fibonacci, fractions, picture proofs (labs/math.js, math2.js) | defaults | correct | correct |

Tests for these go in during step 2.

## 4. Facts checked and correct (no change needed)

- **Space (labs/space.js, space3d.js):**
  - JPL orbital elements; NASA diameters, rotation periods and mean temperatures.
  - Gravity, mass and tilt per planet. Uranus 8.69 m/s² is the equatorial value; NASA's fact sheet gives 8.87 under a different definition.
  - Sun, Moon and Pluto cards (sizes, distances, 4.6 billion years, 12 Moon walkers 1969–1972, New Horizons 2015).
  - Galaxy distances: Orion Nebula 1,344 ly, Pleiades 444 ly, Crab Nebula (1054 supernova), Omega Centauri, Andromeda 2.5 Mly, Magellanic Clouds, Virgo 54 Mly, Coma 321 Mly (dark matter, 1933), Laniakea 2014.
  - Observable universe 46.5 billion ly; age 13.8 billion years.
- **Physics:**
  - Gravity: Earth 9.81, Moon 1.62, Mars 3.71, Jupiter 24.79 m/s².
  - Refractive indices: water 1.33, glass 1.50, diamond 2.42.
  - Rocket fuel figures (Isp) 260, 311 and 450 s.
  - Kármán line 100 km; orbit about 7.8 km/s, about 9.4 km/s with losses; air density halves about every 6 km.
  - The lens equation and sign rule; B = μ₀I/2πr; logic gates.
- **Chemistry:**
  - Stable isotopes and common neutron numbers for hydrogen to calcium; Ca-48 half-life about 6 × 10¹⁹ years; shells 2, 8, 8, 2.
  - Water: specific heats 2.09, 4.18 and 2.01 kJ/kg·K; latent heats 334 and 2,257 kJ/kg.
  - Metal densities, reactions, flame colours and the reactivity series.
  - Everyday pH values; indicator ranges (phenolphthalein 8.2, litmus 4.5 to 8.3).
  - IUPAC atomic masses and compound names in the games.
- **Body (body-facts.js):**
  - Heart about 100,000 beats a day; lungs with 3 and 2 lobes; the liver is the largest internal organ.
  - Small intestine about 6 m; kidneys filter blood about 30 times a day (NIDDK: about 150 quarts a day).
  - Bladder 400 to 600 mL; urethra 4 and 20 cm; uterus 7.5 cm; uterine tube 10 cm; 15 to 20 milk lobes.
  - Brain 1.4 kg with 86 billion neurons; optic nerve about 1 million fibres; skull 22 bones; femur about a quarter of your height.
  - 12 pairs of ribs; carpals 8, metacarpals 5, tarsals 7, metatarsals 5.
  - The stapes is the smallest bone and the gluteus maximus the largest muscle; enamel is the hardest substance.
  - The new eye and hair cards.
- **Cells (cells.js, biology.js):** what each organelle does. In Mendel's peas, yellow, round and purple are the dominant traits.
- **Math:**
  - Every unit factor matches its exact international definition.
  - All 15 shape formulas.
  - The Philippines' 20% final tax on bank interest.
  - The Collatz problem is still unsolved.
- **Museum:**
  - Spoliarium: 1884 gold medal in Madrid, 4.22 × 7.68 m.
  - Hidalgo's silver medal and Rizal's toast; the Blood Compact of 1565.
  - GSIS bought *Parisian Life* in 2002 for about ₱46 million.
  - Damián Domingo's art school (1821); National Artists Amorsolo (1972), Ocampo (1991) and BenCab (2006).
  - The world works: artist, year, medium and museum for each.
- **Timelines (tools.js):**
  - Philippine history 1521 to 1986.
  - Rizal's life: born 19 June 1861 in Calamba; Noli Me Tángere 1887 in Berlin; El Filibusterismo 1891 in Ghent; La Liga Filipina and Dapitan 1892; executed 30 December 1896.
  - World War II dates; the space age from Sputnik (1957) to Webb (2021).
- **Geography (puzzles.js):** every capital, including Astana, Naypyidaw, Dodoma and Abuja; the haversine distance uses Earth's 6,371 km radius.
- **Vocabulary and colours:** the literary devices, tayutay, medical, legal and tech terms; CSS colour names.

## 5. Notes for step 2

- Rows 1 to 3 will change the "95 known" moons that a smoke test checks for; that test is updated with the fix.
- Row 11 (all 250 countries) needs the World Bank API, which this build machine can't reach. The Philippines row can be fixed from the PSA figure above.
- The tests for section 3 (for example, gravity 9.81 m/s² at Earth's surface, and the launch range matching v²sin2θ/g) are added in step 2.
