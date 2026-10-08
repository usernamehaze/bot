# Labs — credits

- **World map** (`world-110m.json`, used by the Geography puzzle): [Natural Earth](https://www.naturalearthdata.com/) 1:110m Admin 0 countries, version 4.1.0 — public domain. Packaged as TopoJSON by the [world-atlas](https://github.com/topojson/world-atlas) project (ISC licence, © 2013-2019 Michael Bostock). Borders are shown as they are in Natural Earth and are not a statement about any disputed territory.
- **Planet data** (Solar system lab): NASA Planetary Fact Sheet; approximate orbital elements from JPL ("Keplerian Elements for Approximate Positions of the Major Planets", E. M. Standish).
- **Moon and eclipses**: simplified lunar theory (mean elements plus the largest periodic terms), after Jean Meeus, *Astronomical Algorithms*.
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
