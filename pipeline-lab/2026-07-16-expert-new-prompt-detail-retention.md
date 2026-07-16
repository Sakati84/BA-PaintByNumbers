# Expert: Detailerhalt vom neuen KI-Bild zum Classic

## Ausgangslage

Der am 2026-07-16 revidierte Expert-KI-Prompt erzeugt die gewuenschte Struktur im Hauptmotiv und in inhaltlich relevanten Hintergrundbereichen. Im anschliessenden Fresh-Classic fasste die produktive Expert-Policy mit einem Merge-Kandidaten-Floor von `0.0005` jedoch weiterhin zu viele dieser KI-Flaechen zusammen.

Der Verlust wurde auf `facetReduce` eingegrenzt. Renderer, Linienbreite und Markerlogik waren nicht der primaere Ausloeser. Easy und Medium sind von dieser Revision nicht betroffen.

## Isolierter Fuenf-Wege-Vergleich

- Quelle: `prompt-lab/runs/2026-07-16T06-49-35-428Z_2026-07-16-expert-background-detail-restoration/`
- Suite: `pipeline-lab/suites/2026-07-16-expert-new-prompt-detail-retention.json`
- Lauf: `pipeline-lab/runs/2026-07-16T19-12-47-549Z_2026-07-16-expert-new-prompt-detail-retention/`
- Umfang: alle 11 neuen Expert-KI-Bilder, jeweils 24 Farben; Varianten `classic`, `cleanColor`, `debugUnlabeled`

Die Kandidaten `0.0004`, `0.00035`, `0.0003` und `0.00025` verwenden dieselbe sichere Expert-Geometrie wie Produktion, aber ohne die nachgelagerte Detailrestaurierung. Dadurch isoliert der Vergleich die Wirkung des Floors.

| Metrik ueber 11 Bilder | vorher Produktion `0.0005` + Rettung | `0.0004` | `0.00035` | `0.0003` | `0.00025` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regionen gesamt | 3005 | 3228 | 3431 | 3698 | 4008 |
| Regionen pro Bild | 273,18 | 293,45 | 311,91 | 336,18 | 364,36 |
| Classic-Grenz-Footprint | `17,06 %` | `17,51 %` | `17,80 %` | `18,18 %` | `18,61 %` |
| schwarzer Ink-Anteil | `8,24 %` | `8,46 %` | `8,61 %` | `8,80 %` | `9,02 %` |
| niedrig kontrastierende Doppelkontur-Laenge | `4,16 %` | `5,12 %` | `5,74 %` | `6,27 %` | `7,02 %` |
| Recall Quellkanten ab `12 LAB` | `78,20 %` | `79,16 %` | `79,95 %` | `81,10 %` | `82,08 %` |
| Recall Quellkanten ab `16 LAB` | `83,47 %` | `84,08 %` | `84,59 %` | `85,44 %` | `86,13 %` |
| RGB-MAE zum KI-Bild | `7,912` | `7,719` | `7,636` | `7,498` | `7,371` |

Visuell gewinnt `0.0003` gegenueber dem alten Default klar erkennbare Laub-, Geaest-, Fell-, Gras-, Stein- und Wolkenstruktur zurueck. Der weitere Schritt auf `0.00025` verbessert die Motivtreue nur noch begrenzt, erhoeht aber Regionen, schwarze Grenzflaeche und niedrig kontrastierende Doppelkonturen merklich. Deshalb ist `0.0003` der ausgewaehlte Mittelweg.

## Finaler Produktionsnachweis

- Suite: `pipeline-lab/suites/2026-07-16-expert-new-prompt-detail-retention-final.json`
- Lauf: `pipeline-lab/runs/2026-07-16T19-18-33-470Z_2026-07-16-expert-new-prompt-detail-retention-final/`
- Produktiv: `classic-production`, Floor `0.0003`, begrenzte Expert-Detailrestaurierung aktiv

| Metrik | vorher `0.0005` | final `0.0003` | Aenderung |
| --- | ---: | ---: | ---: |
| Regionen gesamt | 3005 | 3782 | `+25,9 %` |
| Regionen pro Bild | 273,18 | 343,82 | `+25,9 %` |
| Classic-Grenz-Footprint | `17,06 %` | `18,23 %` | `+1,17 pp` |
| schwarzer Ink-Anteil | `8,24 %` | `8,82 %` | `+0,58 pp` |
| Recall Quellkanten ab `12 LAB` | `78,20 %` | `81,15 %` | `+2,95 pp` |
| Recall Quellkanten ab `16 LAB` | `83,47 %` | `85,47 %` | `+2,00 pp` |
| RGB-MAE zum KI-Bild | `7,912` | `7,510` | `-5,1 %` |

Die reine `0.0003`-Geometrie hatte 3698 Regionen. Die begrenzte Expert-Detailrestaurierung fuegt im finalen Pfad 84 Regionen beziehungsweise `2,3 %` hinzu. Alle elf Ergebnisse verwenden exakt 24 Farben, bleiben unter dem Facet-Budget und enden ohne Region ohne malbaren Cross-Core.

## Validierung

- `npm run typecheck --prefix ./App`
- `npm run pipeline:fresh:regression --prefix ./App`
- `node ./App/scripts/analyze-classic-paintability.mjs <final-manifest> --json <report>`
- `node ./App/scripts/analyze-pipeline-paintability.mjs <final-manifest> --config-id expert-production-300-final --json <report>`
