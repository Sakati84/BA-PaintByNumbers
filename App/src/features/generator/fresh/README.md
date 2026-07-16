# Fresh Generator

App-integrierter, plattformneutral testbarer TypeScript-Port der Region-First-Paint-by-Numbers-Pipeline.

Dieser Ordner gehoert zum aktuellen Expo-Runtime-Code unter `App/`. `App/App.tsx`
waehlt `generatePaintByNumbersFreshNative.ts` standardmaessig fuer `runPaintByNumbers`.
Die native Huelle bereitet das Bild vor und ruft danach den plattformneutralen Kern in
`generatePaintByNumbersFresh.ts` auf. Der alte
Generator bleibt parallel unter `App/src/features/generator/generatePaintByNumbers.ts`
erhalten und kann mit `EXPO_PUBLIC_GENERATOR_PIPELINE=legacy` aktiviert werden.

Der Port ist eine app-taugliche, source-aware Weiterentwicklung der Python-Referenz in
`reference/python-pipeline/paint_by_numbers.py`. Easy und Medium verwenden weiterhin die
bisherige `current`-Policy; ab 18 Farben wird standardmaessig das Expert-Profil
`classic-production` aufgeloest:

1. Bild auf maximal 1400 px Kantenlaenge vorbereiten.
2. Kantenbewusst lokal glaetten.
3. Eine farbanzahlabhaengige Helligkeits-/Chroma-Tokenkarte (`10 x 5 x 5`, `14 x 7 x 7` oder `18 x 9 x 9`) als Uebersegmentierung bauen.
4. Zusammenhaengende Token-Regionen erkennen und eine gewichtete Zielpalette auf Regionsebene lernen.
5. Zwei feste source-aware Majority-Durchlaeufe anwenden. `narrowPixelStripCleanupRuns` kann weitere Durchlaeufe addieren.
6. Expert fuehrt im `borderSegment` genau ein fruehes, geometrisch `unrestricted`, aber weiterhin source-aware gefuelltes Cross-Opening aus. `nrOfTimesToHalveBorderSegments` addiert optionale Runs; der UI-Default bleibt `0`. Easy/Medium aktivieren ohne expliziten Zusatz keinen fruehen Run.
7. Fuer jede Farbregion Perimeter, 4-Nachbar-Cross-Core, Bounding-Box-Dicke und hydraulischen Durchmesser `4A/P` bestimmen. Hard-unpaintable Regionen ohne Cross-Core und mit (Bounding-Box-Dicke `<= 2.5` oder `4A/P <= 5`) werden unabhaengig von Flaeche und Kontrast in eine benachbarte Farbe gemerged. Kleine soft-thin Regionen folgen dem source-aware LAB-Guard; ausgenommen bleibt der bestehende Force-Merge fuer echte Speckles unter `48 px`.
8. Expert hebt die Merge-Kandidatenschwelle auf `0.0003` der Arbeitsflaeche an, verwendet fuer soft-thin aber weiter den niedrigeren Fresh-Basiswert `0.00012`. Zusaetzlich erkennt die Pipeline lange niedrig kontrastierende Gradienten-Zwischenbaender anhand skalierter Geometrie, realer Komponenten-Quellfarbe und zwei gegenueberliegenden Boundary-Kontakten. Zwei getrennte Phasen duerfen jeweils nur einen Band-Pass ausfuehren; eine kontrastreiche semantische Linie bleibt durch Source-Fit-Guards geschuetzt. Die frueheren `0.0005`-, `0.0006`- und `0.0008`-Staende bleiben als ruhigere Vergleichsreferenzen dokumentiert.
9. Geometriekandidaten immer wirklich in ein benachbartes Label mergen. Verletzt das beste Nachbarziel einen Guard, die weiteren sortierten Nachbarn pruefen. Nur kompakte Detailkandidaten duerfen auf eine nicht benachbarte globale Palettenfarbe wechseln.
10. Nach Cleanup und Facet-Budget prueft `classic-production` die urspruenglichen Token-Komponenten auf verlorene kompakte Expert-Details. Hoechstens sechs ausreichend umschlossene, kompakte und kontrastreiche Quellformen werden mit einer bereits gelernten, lokal noch nicht angrenzenden Palettenfarbe restauriert. Der Schritt fuegt keine Farbe hinzu, ist auf `1.5 %` der Bildflaeche begrenzt und fuehrt danach einen reinen hard-unpaintable-Reparaturmerge aus. Easy behält seine separate Landmark-Regel.
11. Leere Palettencluster neu initialisieren. Nach allen Geometrieaenderungen fehlende Zielpalettenfarben zuerst streng LAB-plausibel und, falls noetig, deterministisch kapazitaetsbewusst wiederherstellen. Dabei wird immer eine vollstaendige malbare Komponente umgelabelt; Grenzen und Regionenzahl bleiben unveraendert. Expert endet im normalen Korpus exakt bei 24 genutzten Farben.
12. Ein konfiguriertes Flaechenbudget mit kontrastbewerteten Least-Cost-Merges hart einhalten und abschliessend null hard-unpaintable Regionen sowie die erforderliche Palettennutzung assertieren. Expert deaktiviert bewusst Post-Merge- und terminale Openings, weil aggressiv kaskadierende Varianten relevante Quellkanten entfernten. Easy/Medium behalten das bisherige attached Post-/Terminal-Opening mit Isthmus-Schutz und Fixpunktpruefung.
13. Marker per Distance Transform sicher innerhalb finaler Regionen platzieren und ihre Groesse mit der bewaehrten Flaechen-, Innenabstands- und Zahlenlaengenlogik der bisherigen Pipeline begrenzen.
14. Die neun produktiven Ausgabevarianten als PNG und echtes Vektor-SVG rendern. Die PNG-Boundary-Maske testet horizontale und vertikale Nachbarschaften unabhaengig, damit keine orthogonalen Ghost-Linien entstehen. `cleanColor` bleibt marker- und nummernfrei; die Variante `numbers` schreibt eine Farbnummer nur dann, wenn sie sicher in die Region passt, und nutzt sonst einen kleinen Punkt in der Palettenfarbe.

Der Port verwendet die Fresh-Segmentierung und die source-aware Merge-Logik, uebernimmt aber die
vollstaendige produktive Variantenbelegung der bisherigen Pipeline. Der normale Flow liefert
`brightColorCircles`, `colorCircles`, `cleanColor`, `coloredEdges`, `coloredEdgesWithDots`,
`circlesOnly`, `numbers`, `classic` und `debugUnlabeled`; `brightColorCircles` ist die
Default-Variante. Die Fresh-Pfade sind echte Vektoren, folgen aktuell aber noch dem zeilenweisen
Regionenraster und nicht den geglaetteten Traces der bisherigen Pipeline.

`classic` ist das primaere visuelle Paintability-Ziel, weil erst die schwarzen Grenzen kleine,
duenne oder doppelt konturierte Facets sichtbar machen. `cleanColor` dient weiterhin als
Diagnose fuer Motivnaehe und Palette, ist aber allein kein Freigabekriterium.

Validierung:

- `npm run pipeline:fresh:regression --prefix ./App`
- `npm run pipeline:lab --prefix ./App -- --suite ../pipeline-lab/suites/current-fresh-presets.json`
- `node ./App/scripts/analyze-pipeline-paintability.mjs <manifest.json> --config-id fresh-easy-8 --config-id fresh-medium-12 --config-id fresh-expert-24 --json <report.json>`
- `npm run pipeline:lab --prefix ./App -- --suite ../pipeline-lab/suites/2026-07-15-expert-semantic-detail-restoration.json`
- `npm run pipeline:lab --prefix ./App -- --suite ../pipeline-lab/suites/2026-07-16-expert-new-prompt-detail-retention-final.json`
- `node ./App/scripts/analyze-classic-paintability.mjs <manifest.json> --json <report.json>`
- [Historischer Expert-Classic-Vergleich: 0.0006, 0.0005 ohne Rettung und damaliger 0.0005-Default](../../../../../pipeline-lab/runs/2026-07-15T21-04-24-347Z_2026-07-15-expert-semantic-detail-restoration/index.html)
- [Aktueller Expert-KI-zu-Classic-Nachweis mit produktivem 0.0003-Default](../../../../../pipeline-lab/runs/2026-07-16T19-18-33-470Z_2026-07-16-expert-new-prompt-detail-retention-final/index.html)
- [Iterations- und Metrikprotokoll](../../../../../pipeline-lab/2026-07-15-expert-classic-paintability.md)
- [Detailerhalt-Revision fuer den neuen Expert-KI-Prompt](../../../../../pipeline-lab/2026-07-16-expert-new-prompt-detail-retention.md)
