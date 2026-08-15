// Known Haryana places/institutions that the CARTO Voyager basemap doesn't
// label on its own (verified by inspecting the raw tiles) — rendered as our
// own always-on markers instead of depending on the tile provider.
export const LANDMARKS = [
  {
    id: "mullana-village",
    name: "Mullana",
    type: "village",
    lat: 30.2750178,
    lng: 77.0483955,
  },
  {
    id: "mm-university-mullana",
    name: "Maharishi Markandeshwar University",
    type: "university",
    lat: 30.2509357,
    lng: 77.045446,
  },
];
