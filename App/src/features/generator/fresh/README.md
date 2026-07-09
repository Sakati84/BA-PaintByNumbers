# Fresh Generator

App-integrierter, plattformneutral testbarer TypeScript-Port der Region-First-Paint-by-Numbers-Pipeline.

Dieser Ordner gehoert zum aktuellen Expo-Runtime-Code unter `App/`. `App/App.tsx`
waehlt `generatePaintByNumbersFreshNative.ts` standardmaessig fuer `runPaintByNumbers`.
Die native Huelle bereitet das Bild vor und ruft danach den plattformneutralen Kern in
`generatePaintByNumbersFresh.ts` auf. Der alte
Generator bleibt parallel unter `App/src/features/generator/generatePaintByNumbers.ts`
erhalten und kann mit `EXPO_PUBLIC_GENERATOR_PIPELINE=legacy` aktiviert werden.

Der Port ist eine app-taugliche Annaeherung an die Python-Referenz in
`reference/python-pipeline/paint_by_numbers.py`:

1. Bild auf maximal 1400 px Kantenlaenge vorbereiten.
2. Kantenbewusst lokal glaetten.
3. 64 Farb-Token aus RGB-Bins bauen.
4. Zusammenhaengende Token-Regionen erkennen.
5. Eine gewichtete Zielpalette auf Regionsebene lernen.
6. Source-aware Majority- und Merge-Entscheidungen gegen die lokale KI-Quellfarbe treffen.
7. Kleine relevante Details schuetzen oder ueber stabile, nicht oszillierende Merge-Batches auf passende Nachbarfarben legen.
8. Leere Palettencluster neu initialisieren und fehlende Zielpalettenfarben nur bei messbar besserem LAB-Fit reaktivieren.
9. Ein konfiguriertes Flaechenbudget mit kontrastbewerteten Least-Cost-Merges hart einhalten.
10. Marker per Distance Transform sicher innerhalb finaler Regionen platzieren.
11. `cleanColor`, `coloredEdges` und `coloredEdgesWithDots` als PNG und echtes Vektor-SVG rendern.

Nummern, Labelplatzierung und die vollstaendige alte Variantenliste sind in diesem Port noch nicht
implementiert. Fuer App-Kompatibilitaet liefert der Port im normalen Flow `cleanColor`,
`coloredEdges` und `coloredEdgesWithDots`; `classic` bleibt fuer gezielte Debug-Renders verfuegbar.

Validierung:

- `npm run pipeline:fresh:regression --prefix ./App`
- `npm run pipeline:lab --prefix ./App -- --suite ../pipeline-lab/suites/current-fresh-presets.json`
