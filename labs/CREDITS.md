# Labs — credits

- **World map** (`world-110m.json`, used by the Geography puzzle): [Natural Earth](https://www.naturalearthdata.com/) 1:110m Admin 0 countries, version 4.1.0 — public domain. Packaged as TopoJSON by the [world-atlas](https://github.com/topojson/world-atlas) project (ISC licence, © 2013-2019 Michael Bostock). Borders are shown as they are in Natural Earth and are not a statement about any disputed territory.
- **Planet data** (Solar system lab): NASA Planetary Fact Sheet; approximate orbital elements from JPL ("Keplerian Elements for Approximate Positions of the Major Planets", E. M. Standish).
- **Moon and eclipses**: simplified lunar theory (mean elements plus the largest periodic terms), after Jean Meeus, *Astronomical Algorithms*.
- **Planet maps** (`tex/`, Solar system & beyond 3D): Mars, Jupiter, Saturn, Neptune and Pluto, and the Hipparcos star map (the stars in the sky), from [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) — free and without copyright (NASA media guidelines). Earth (day, night lights, clouds, oceans) and the Moon from the examples of [three.js](https://github.com/mrdoob/three.js) (MIT). Saturn's colours toned down to match photos. Made for Cassie: Mercury, Venus's cloud tops, Uranus and Saturn's rings (from their measured layout). `promo/space/textures.py` rebuilds them. The World atlas's globe uses the same Earth maps, with the Natural Earth borders drawn on top.
- Everything else in Labs is drawn and computed in code written for Cassie.

## World atlas (`atlas/`)

- `atlas/countries.json` — made from **world-countries** 5.1.0 by Mohammed Le Doze
  (https://github.com/mledoze/countries), licensed under the **Open Database License (ODbL) 1.0**
  (`atlas/LICENSE-world-countries-ODbL.txt`). This derived database is shared under the same
  licence. Population figures (the latest year in the file, 2020) are from the **World Bank**
  (indicator SP.POP.TOTL, CC BY 4.0), via the world-countries-population-data package (MIT).
- `atlas/flags/` — **flag-icons** 7.5.0 by Lipis (https://github.com/lipis/flag-icons), MIT
  (`atlas/LICENSE-flag-icons-MIT.txt`), unchanged.
- Live, when online: the newest population from the World Bank API, and history and place
  summaries from Wikipedia (CC BY-SA), always shown with a link to the article.

## Museum of Famous Arts (museum.js)
Pictures of the paintings are loaded from Wikipedia (the lead image of each artwork's article, hosted on Wikimedia Commons) and are only shown for works whose artists died long ago and that are free to show. Works still under copyright show a description and a link instead. The facts on each card (artist, year, medium, where it is now) are written for Cassie.

## History dress-up (games2.js, `dressup/`)
Photos from Wikimedia Commons, each public domain or CC0 (checked on its Commons file page), resized to WebP for Cassie:
- Damián Domingo, *Indio de Iloco: A Native Ilocana of Ilocos*, about 1820s, watercolour from *Tipos del País*. Public domain. File: Indio de Iloco – A Native Ilocana of Ilocos (Ilocano).jpg
- Helmet, Philippine (Moro), 18th to 19th century. The Metropolitan Museum of Art, CC0. File: Helmet MET 36.25.98 001mar2015.jpg
- Armor (Gusoku), Japanese, 18th century. The Metropolitan Museum of Art, CC0. File: Armor (Gusoku) MET DP299994.jpg
- Bronze helmet of Corinthian type, Greek, early 6th century BC. The Metropolitan Museum of Art, CC0. File: Bronze helmet of Corinthian type MET DP105637.jpg
- Broad collar of Senebtisi, Egyptian, Middle Kingdom, about 1850 to 1775 BC. The Metropolitan Museum of Art, CC0. File: Broad collar of Senebtisi MET DP303025.jpg
- Armor garniture of George Clifford, Third Earl of Cumberland, British (Greenwich), 1586. The Metropolitan Museum of Art, CC0. File: Armor Garniture of George Clifford (1558–1605), Third Earl of Cumberland MET DP295743.jpg

Animal emoji in Animal habitats are the device's own emoji font. Landform pictures and shapes are drawn in code for Cassie.

