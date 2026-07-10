# Fresh-Detailerhalt durch wahrnehmungsnahe Token

## Ziel

Niedrig kontrastierende, aber im KI-Bild klar angelegte Facets sollen bis zur Fresh-Ausgabe erhalten bleiben, ohne die angeforderte Farbanzahl zu erhoehen. Ausloeser war `img-0106` in Expert: Die Braun-/Olivfacets des hinteren Bergs waren bereits in `colorMap` zu einer einzigen Flaeche kollabiert, obwohl die 24er-Palette passende Farben enthielt.

## Ursache und Aenderung

Das alte feste `4 x 4 x 4`-RGB-Tokenraster verband viele Farben zwischen RGB 64 und 127 zu derselben zusammenhaengenden Startregion. Nach dieser Vereinigung konnte weder das Palettenlernen noch das source-aware Region-Merge die urspruengliche Grenze rekonstruieren.

Die neue Tokenisierung trennt Helligkeit und zwei Chroma-Achsen und skaliert mit dem Zielpreset:

| Preset | Tokenraster | moegliche Token | Zielfarben |
| --- | ---: | ---: | ---: |
| Easy | `10 x 5 x 5` | 250 | 8 |
| Medium | `14 x 7 x 7` | 686 | 12 |
| Expert | `18 x 9 x 9` | 1458 | 24 |

Die hoehere Tokenzahl erzeugt nur bessere Startregionen. Die Ausgabe bleibt durch das anschliessende K-Means unveraendert auf 8, 12 oder 24 vorhandene Palettenfarben begrenzt.

## Vergleichslaeufe

- Vorher: `pipeline-lab/runs/2026-07-09T21-00-33-903Z_current-fresh-typescript-presets/index.html`
- Nachher: `pipeline-lab/runs/2026-07-09T21-11-26-123Z_current-fresh-typescript-presets/index.html`
- Neuer Overview: `pipeline-lab/runs/2026-07-09T21-11-26-123Z_current-fresh-typescript-presets/overview-cleanColor.png`
- `img-0106` Stufendiagnose vorher: `pipeline-lab/runs/2026-07-09T21-00-33-903Z_current-fresh-typescript-presets/img-0106__expert-24-current/fresh-expert-24/stage-diagnostic-baseline/`
- `img-0106` Stufendiagnose nachher: `pipeline-lab/runs/2026-07-09T21-00-33-903Z_current-fresh-typescript-presets/img-0106__expert-24-current/fresh-expert-24/stage-diagnostic-perceptual-v1/`

Beide Korpuslaeufe verwenden dieselben 33 KI-Quellen: elf Motive in Easy, Medium und Expert, jeweils nur mit dem passenden 8-/12-/24-Preset.

## Ergebnis

Alle 33 neuen Laeufe waren erfolgreich und nutzen exakt die angeforderte Farbanzahl. Der mittlere absolute RGB-Abstand wurde pixelweise zwischen vorbereitetem KI-Bild und `cleanColor` gemessen.

| Preset | RGB-Abstand vorher | RGB-Abstand nachher | Aenderung | Facets vorher | Facets nachher |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy | 5.38 | 4.16 | -22.6 % | 61.1 | 66.4 |
| Medium | 5.86 | 4.64 | -20.8 % | 159.2 | 184.6 |
| Expert | 8.81 | 7.48 | -15.1 % | 596.1 | 864.1 |

Bei Expert verbessert sich der Abstand bei allen elf Motiven:

| Motiv | RGB-Abstand vorher | RGB-Abstand nachher | Facets vorher | Facets nachher |
| --- | ---: | ---: | ---: | ---: |
| `img-0106` | 7.99 | 4.67 | 345 | 596 |
| `img-1394` | 7.47 | 6.55 | 631 | 881 |
| `img-1618` | 6.03 | 5.51 | 296 | 375 |
| `img-1644` | 11.25 | 10.08 | 1146 | 1866 |
| `img-1681` | 10.41 | 8.90 | 764 | 1247 |
| `img-1704` | 14.01 | 13.39 | 1228 | 1666 |
| `img-1706` | 7.03 | 5.94 | 291 | 384 |
| `img-1841` | 7.47 | 6.96 | 754 | 868 |
| `img-1852` | 10.67 | 8.66 | 678 | 1066 |
| `img-1998` | 8.08 | 6.18 | 270 | 325 |
| `img-2051` | 6.49 | 5.38 | 154 | 231 |

Fuer den beanstandeten Bergbereich von `img-0106` sinkt der RGB-Abstand in der festgelegten ROI (`x=520..1389`, `y=170..469`) von `10.06` auf `5.77`. Die grossen dunklen, mittleren und hellen Bergfacets bleiben im finalen `cleanColor` sichtbar und verwenden Farben aus derselben 24er-Palette.

## Kosten und Schutz

- Expert erzeugt im Mittel 45 % mehr Regionen, weil zuvor verlorene KI-Struktur wieder vorhanden ist.
- Der langsamste Expert-Lauf im Korpus bleibt unter einer Sekunde; der Expert-Mittelwert steigt von 648 ms auf 760 ms.
- Kein Expert-Lauf erreicht das harte Budget von 2600 Facets; der groesste neue Lauf hat 1866.
- Die Regression `npm run pipeline:fresh:regression --prefix ./App` enthaelt einen synthetischen Low-Contrast-Fall. Vier grossflaechige Facets, die im alten RGB-Raster kollidierten, muessen getrennt bleiben, waehrend die Ausgabe exakt 24 Farben behaelt.
