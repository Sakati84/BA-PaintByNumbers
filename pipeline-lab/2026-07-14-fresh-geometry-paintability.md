# Fresh Geometry Paintability Hardening, 2026-07-14

> Historischer Zwischenstand. Die hier beschriebene Clean-/Cross-Core-Policy bleibt fuer Easy
> und Medium relevant, ist fuer Expert aber seit 2026-07-15 durch die Classic-first-Policy in
> [`2026-07-15-expert-classic-paintability.md`](2026-07-15-expert-classic-paintability.md)
> ersetzt. Insbesondere sind das attached Post-Merge-Opening und der terminale Opening-Fixpunkt
> im produktiven Expert-Profil deaktiviert.

## Ziel

Die Fresh-Region-First-Pipeline soll die bereits guten Hauptfacets und Zielpaletten erhalten, aber keine eigenstaendigen 1-2-Pixel-Linien, unmalbaren Mikroregionen oder schwach angebundenen Auslaeufer als Produktflaechen ausgeben. Der am selben Tag getestete Expert-Floor von `18 px` wurde verworfen; er erzeugte im 11-Bilder-Korpus durchschnittlich `1504.7` statt `864.1` Expert-Regionen.

Akzeptanzkriterien:

- angeforderte Zielpaletten im realen Korpus exakt `8 / 12 / 24`
- null finale Regionen ohne 4-Nachbar-Cross-Core
- deutlich weniger duenne Regionen und schwach angebundene Pixel
- ganze relevante KI-Facets nur mit source-aware Guard mergen
- Geometrie-Merge muss die Region wirklich entfernen; kein reines Recoloring auf ein nicht benachbartes Label
- `cleanColor` bleibt ohne Grenzen, Marker oder Zahlen
- alle neun Produktvarianten bleiben als PNG und echtes SVG exportierbar

## Verwendete Konzepte

Die Umsetzung ist keine direkte Kopie des Legacy-Cleanups. Sie kombiniert:

- fixed-palette, shared-boundary-normalisierte Merge-Kosten nach der Scale-Set-/Mumford-Shah-Idee: [Scale-Sets Image Analysis](https://hal.science/hal-00705364)
- geometrische Attributfilter statt rein lokaler Pixelregeln: [Breen/Jones, Attribute Openings](https://people.cmm.minesparis.psl.eu/users/marcoteg/cv/publi_pdf/MM_refs/vincent/Breen_96.pdf)
- stabile regionsbasierte Nachbarschaftsentscheidungen statt unabhaengiger Pixelwechsel: [Felzenszwalb/Huttenlocher, Efficient Graph-Based Image Segmentation](https://www.cs.cornell.edu/dph/papers/seg-ijcv.pdf)

Aus Legacy/Python uebernommen wurden die nuetzlichen Ideen, ganze duenne Regionen geometrisch zu bewerten, viel gemeinsame Grenze zu bevorzugen und ein echtes Opening fuer attached protrusions zu besitzen. Nicht uebernommen wurde das unbeschraenkte Endpoint-Peeling.

## Finale Policy

Der Connected-Component-Aufbau berechnet Flaeche, Bounding Box, Perimeter und Cross-Core in einem Durchlauf. Das vermeidet einen zusaetzlichen Vollbildscan pro Merge-Pass.

Hard-unpaintable:

```text
kein Cross-Core
AND (
  area / max(bboxWidth, bboxHeight) <= 2.5
  OR 4 * area / perimeter <= 5
)
```

Diese Regionen werden unabhaengig von Flaeche und Detailschutz in ein wirklich benachbartes Ziellabel gemerged.

Soft-thin:

```text
area <= 2 * minRegionArea
AND bboxAverageThickness <= 5.5
AND 4 * area / perimeter <= 11
```

Ein Soft-thin-Kandidat darf nur zu einem Nachbarlabel wechseln, dessen LAB-Fit zur lokalen KI-Quellfarbe hoechstens `34` betraegt und maximal `14 LAB` schlechter als der bisherige Source-Fit ist. Ausgenommen bleibt der bestehende Force-Merge fuer echte Speckles unter `48 px`.

Fuer Geometriekandidaten werden gemeinsame Grenzpixel pro Ziellabel aggregiert. Der zentrale Score ist:

```text
area * (targetSourceDistance^2 - currentSourceDistance^2)
----------------------------------------------------------
                 2 * sharedBoundary
```

Grenzanteil und Zielgroesse dienen als kleine stabile Nebenfaktoren im Score. Globale, nicht benachbarte Palette-Reassignments bleiben kompakten Detailkandidaten vorbehalten.

Nach dem ersten Region-Merge laeuft ein fester source-aware Cross-Opening-Durchlauf. Er bearbeitet nur mindestens vier Pixel lange Kandidatenteilformen einer Region, die selbst einen Cross-Core besitzt und deren Kandidatendicke hoechstens `2.5` beziehungsweise deren hydraulischer Durchmesser hoechstens `5` ist. Dadurch werden lange 1-2-Pixel-Arme entfernt, ohne ganze duenne Quellfacets oder einzelne kompakte Ecken pauschal zu erodieren. `nrOfTimesToHalveBorderSegments > 0` kann im Debug zusaetzliche fruehe Durchlaeufe aktivieren; der UI-Default bleibt `0`.

Nach Paletten- und Easy-Landmark-Restaurierung konvergieren ein fuer Paintability zwingender, aber gleich eng gefilterter Opening-Durchlauf und der hard-only Whole-Region-Merge in hoechstens sechs veraendernden Terminalrunden. Darauf folgt eine nur lesende Opening-Pruefung, sodass auch ein erst durch die sechste Mutation stabiler Zustand akzeptiert wird. Eine Kandidatengruppe, die zwei getrennte erhaltene Core-Sektionen beruehrt, gilt als Isthmus und wird nicht getrennt. Erst nach dem Fixpunkt werden fehlende Palettenfarben geometrieneutral auf vollstaendige vorhandene Komponenten reaktiviert. Der Generator akzeptiert nur `0` hard-unpaintable Restregionen und `0` weiter entfernbare attached protrusions.

## Verworfene Varianten

- Expert-Floor `18 px`: `+74 %` Regionen gegenueber der 72-Pixel-Baseline bei nur rund `3.1 %` MAE-Gewinn.
- unguarded Whole-Region-Geometrie: Expert-MAE etwa `+3.3 %`, Edge-F1 etwa `-3.2 pp`.
- unbeschraenktes always-on Opening vor `facetBuild`: Expert-MAE etwa `+8 %`, in einem Fall ging eine Zielfarbe verloren.
- guarded oder post-merge Opening ohne Kandidatenteilform-Begrenzung: weniger duenne Pixel, aber schlechterer MAE/Edge-Trade-off und teilweise mehr Facets.
- Salience-Widening: fuegte in Easy/Medium Facets hinzu und verschlechterte MAE/Edge leicht.
- alter Legacy-Endpoint-Peel: verschlechterte im Fresh-A/B Facetzahl und Edge-F1; deshalb nicht transplantiert.

## Finaler Vergleich: 33 Faelle aus 11 Motiven und 3 Presets

Baseline: `pipeline-lab/runs/2026-07-14T20-13-11-265Z_2026-07-14-fresh-vs-legacy-final/`

Finaler `cleanColor`-Nachweis: `pipeline-lab/runs/2026-07-14T21-51-52-494Z_2026-07-14-fresh-vs-legacy-final/`

[Finaler Kontaktbogen mit 33 Easy-/Medium-/Expert-Faellen und allen neun Varianten](runs/2026-07-14T22-07-09-834Z_2026-07-14-fresh-vs-legacy-final/contact-sheet.html)

Die Paintability-Werte stammen aus exakten 4-zusammenhaengenden RGB-Regionen im `cleanColor`-PNG; der Tabellen-MAE vergleicht dieses PNG pixelweise mit dem fuer den Generator vorbereiteten KI-Quellbild.

| Preset | Regionen vorher -> final | ohne Cross-Core | `2A/P <= 2.5` | `2A/P <= 5.5` | weak pixels | RGB-MAE vorher -> final | Palette |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Easy 8 | 66.64 -> 62.91 | 11 -> 0 | 64 -> 49 | 153 -> 135 | 1353 -> 1155 | 4.1601 -> 4.1752 | exakt 8 |
| Medium 12 | 184.64 -> 170.36 | 13 -> 0 | 173 -> 86 | 636 -> 492 | 3567 -> 3100 | 4.6412 -> 4.6846 | exakt 12 |
| Expert 24 | 864.09 -> 813.64 | 31 -> 0 | 493 -> 308 | 5448 -> 4580 | 17676 -> 15046 | 7.4758 -> 7.6357 | exakt 24 |

Expert reduziert ausserdem Regionen mit Bounding-Box-Dicke `<= 5.5` von `1095` auf `647`. Gegenueber dem verworfenen 18-Pixel-Lauf sinkt die mittlere Expert-Facetzahl von `1504.7` auf `813.6` (`-45.9 %`). Der Expert-MAE-Preis gegenueber der wiederhergestellten 72-Pixel-Baseline betraegt `+2.1 %`; Easy steigt um `0.36 %`, Medium um `0.93 %`.

Der pixelidentische `cleanColor`-Timing-Wiederholungslauf `pipeline-lab/runs/2026-07-14T21-56-14-540Z_2026-07-14-fresh-vs-legacy-final/` benoetigt durchschnittlich `870/902/1230 ms` fuer Easy/Medium/Expert. Gegenueber Legacy `713/784/1158 ms` ist die terminale Fixpunktfassung damit rund `22/15/6 %` langsamer. Legacy behaelt diesen Laufzeitvorteil und die geglaettete/supersampelte Kantenwiedergabe; Fresh gewinnt bei KI-Naehe, exakter Zielpalette, Expert-Facetzahl und den harten Paintability-Postconditions.

## Render-/Nummernentscheidung

Fresh liefert `brightColorCircles`, `colorCircles`, `cleanColor`, `coloredEdges`, `coloredEdgesWithDots`, `circlesOnly`, `numbers`, `classic` und `debugUnlabeled`.

- `cleanColor` enthaelt nie Grenzen, Marker oder Zahlen.
- `numbers` schreibt Text nur dann, wenn er sicher in die Region passt; andernfalls nutzt diese Variante einen kleinen Punkt in der Palettenfarbe.
- `brightColorCircles` und `colorCircles` behalten immer ihren normal skalierten Farbkreis und lassen nur den Text weg, wenn die Glyphe nicht sicher hineinpasst.

## Reproduktion

```bash
npm run typecheck --prefix ./App
npm run pipeline:fresh:regression --prefix ./App
npm run pipeline:lab --prefix ./App -- --suite ../pipeline-lab/suites/2026-07-14-fresh-vs-legacy-final.json --config-id fresh-easy-8 --config-id fresh-medium-12 --config-id fresh-expert-24 --variant cleanColor
node ./App/scripts/analyze-pipeline-paintability.mjs ./pipeline-lab/runs/<run>/manifest.json
```

Die Regression enthaelt isolierte lange 1-/2-Pixel-Streifen, ein direkt getestetes 2-Pixel-Protrusion-Opening mit erhaltenem Haupt-Core, einen duennen Isthmus zwischen zwei Cores, terminale Opening-Idempotenz, Landmark-/Palette-/Budget-Checks, Determinismus/Cache und die Postcondition, dass `numbers` jede Region entweder mit passender Zahl oder mit einem kleinen Punkt in der Palettenfarbe abdeckt.
