# Expert Classic Paintability - Produktionsentscheidung 2026-07-15

## Ziel

Die Optimierung richtet sich nicht mehr primaer auf ein moeglichst quellnahes `cleanColor`,
sondern auf ein praktisch ausmalbares `classic`: farbige Flaechen mit schwarzen gemeinsamen
Grenzen. Im Classic-Render muessen Zugehoerigkeit und Trennung jeder Region klar sein. Kleine
Texturinseln, sehr duenne Regionen und Gradienten-Zwischenbaender, die als doppelte Kontur
erscheinen, sind Fehler, auch wenn sie Fresh Clean naeher an das KI-Bild bringen.

Erste Zielstufe war das Expert-24-Bild `img-1644`; die Freigabe erfolgte danach auf allen elf
kuratierten Expert-Bildern. Easy und Medium bleiben bewusst auf der vorherigen `current`-Policy.

## Referenzen und reproduzierbare Artefakte

- Nachmittagsstand vom 14. Juli als historische Richtungsreferenz:
  [Run](runs/2026-07-14T20-30-19-659Z_2026-07-14-fresh-vs-legacy-final/index.html)
- Breiter Vergleich aus vorherigem Fresh, Nachmittags-Opening und aggressiven Kandidaten:
  [HTML](runs/2026-07-15T19-32-10-689Z_2026-07-15-expert-classic-candidates/index.html) ·
  [Classic-Analyse](runs/2026-07-15T19-32-10-689Z_2026-07-15-expert-classic-candidates/classic-paintability-current-vs-floor-250.json)
- Sichere Finalisten `0.0006`, `0.0008`, `0.0010`, alle elf Bilder:
  [HTML](runs/2026-07-15T20-04-37-992Z_2026-07-15-expert-classic-safe-finalists/index.html) ·
  [Kontaktbogen](runs/2026-07-15T20-04-37-992Z_2026-07-15-expert-classic-safe-finalists/contact-sheet.html)
- Erster sicherer Produktionsstand `0.0008`, inzwischen als ruhigere historische Referenz:
  [HTML](runs/2026-07-15T20-07-45-167Z_2026-07-15-expert-classic-safe-finalists/index.html) ·
  [Kontaktbogen](runs/2026-07-15T20-07-45-167Z_2026-07-15-expert-classic-safe-finalists/contact-sheet.html) ·
  [Classic-Uebersicht](runs/2026-07-15T20-07-45-167Z_2026-07-15-expert-classic-safe-finalists/overview-classic.png) ·
  [Metriken](runs/2026-07-15T20-07-45-167Z_2026-07-15-expert-classic-safe-finalists/classic-paintability.json)
- Direkter Vergleich des bisherigen `0.0008`-Stands gegen den detailreicheren neuen
  `0.0006`-Produktionsdefault, alle elf Bilder:
  [HTML](runs/2026-07-15T20-30-15-842Z_2026-07-15-expert-more-detail-vs-current/index.html) ·
  [Kontaktbogen](runs/2026-07-15T20-30-15-842Z_2026-07-15-expert-more-detail-vs-current/contact-sheet.html) ·
  [Classic-Uebersicht](runs/2026-07-15T20-30-15-842Z_2026-07-15-expert-more-detail-vs-current/overview-classic.png) ·
  [Metriken](runs/2026-07-15T20-30-15-842Z_2026-07-15-expert-more-detail-vs-current/classic-paintability.json)
- Reproduzierbare Suites:
  [`suites/2026-07-15-expert-classic-safe-finalists.json`](suites/2026-07-15-expert-classic-safe-finalists.json)
  und
  [`suites/2026-07-15-expert-more-detail-vs-current.json`](suites/2026-07-15-expert-more-detail-vs-current.json)
- Finaler semantischer Detailvergleich `0.0006`, `0.0005` ohne Restaurierung und produktiver
  `0.0005`-Default mit begrenzter Expert-Detailrestaurierung, alle elf Bilder:
  [HTML](runs/2026-07-15T21-04-24-347Z_2026-07-15-expert-semantic-detail-restoration/index.html) ·
  [Kontaktbogen](runs/2026-07-15T21-04-24-347Z_2026-07-15-expert-semantic-detail-restoration/contact-sheet.html) ·
  [Classic-Uebersicht](runs/2026-07-15T21-04-24-347Z_2026-07-15-expert-semantic-detail-restoration/overview-classic.png) ·
  [Metriken](runs/2026-07-15T21-04-24-347Z_2026-07-15-expert-semantic-detail-restoration/classic-paintability.json) ·
  [Suite](suites/2026-07-15-expert-semantic-detail-restoration.json)

## Was aus der alten Pipeline uebernommen wurde

Die Python-/Legacy-Idee eines echten morphologischen Openings ist richtig: schmale Auslaeufer
und Gradientenkanten duerfen nicht automatisch selbst zu Paint-Facets werden. Eine woertliche
Uebernahme des alten globalen Palette-Mask-Protrusion-Prunings war jedoch zu aggressiv. Es kann
duenne semantische Strukturen vollstaendig entfernen, weil es weder die reale Quellfarbe einer
Komponente noch die Anordnung ihrer Nachbarn beruecksichtigt.

Produktiv adaptiert wurden deshalb nur die sicheren Prinzipien:

- ein einzelnes fruehes Cross-Opening vor `facetBuild`, geometrisch `unrestricted`, aber mit
  source-aware Refill und ohne erzwungene Paintability gegen den Source-Fit;
- Whole-Region-Merges fuer wirklich unmalbare Komponenten;
- Praeferenz fuer Nachbarn mit langer gemeinsamer Grenze;
- getrennte Erkennung duenner Gradienten-Zwischenbaender anhand der realen Komponentenfarbe und
  zweier gegenueberliegender Boundary-Kontakte;
- harte Obergrenzen fuer Passzahl, Source-Fit-Verschlechterung und Flaechenanteil.

Nicht uebernommen wurden das globale ungeschuetzte Palette-Mask-Opening, der alte Endpoint-Peel
und ein aggressiver terminaler Fixpunkt.

## Verworfene Iterationen

Die erste `classic-strong`-Richtung wirkte visuell sehr ruhig und reduzierte die elf Bilder bei
einem Floor von `0.00025` auf insgesamt 2374 Regionen. Sie war dennoch nicht sicher:

- das Opening durfte source-aware Guards fuer Paintability erzwingen;
- der erste Gradientenband-Detektor akzeptierte dominante Nachbarn zu schnell und pruefte keine
  echte Gegenueber-Geometrie;
- mehrere Paesse konnten kaskadieren;
- der angehobene Floor vergroesserte zugleich den Bereich der Soft-thin-Zwangsmerges.

Der starke Quellkanten-Recall fiel aggregiert auf `62,65 %` ab `12 LAB` und `68,33 %` ab
`16 LAB`. Fuer `img-1644` lag der Recall ab `12 LAB` nur noch bei `48,63 %`. Diese Richtung wurde
nicht produktiv gesetzt.

## Aktuelle Produktionspolicy

Ohne explizites Lab-Profil loest Fresh ab 18 Farben jetzt `classic-production` auf:

- Expert-Merge-Kandidatenschwelle: `0.0005` der vorbereiteten Bildflaeche;
- Soft-thin-Referenz bleibt auf dem Fresh-Basiswert `0.00012` und ist damit vom hoeheren Floor
  entkoppelt;
- genau ein frueher source-aware Cross-Opening-Run;
- kein Post-Merge- und kein terminales Opening;
- Source-Fit-Guard fuer Soft-thin bleibt aktiv;
- Gradientenband-Grenzen skalieren relativ zur Referenzkante von 1400 px;
- Bandkandidaten benoetigen ausreichende Laenge/Elongation, geringe effektive Breite, kleinen
  Flaechenanteil und entweder reale Quellnaehe zum dominanten Nachbarn oder zwei geometrisch
  gegenueberliegende Boundary-Kontakte mit LAB-Zwischenlage;
- zwei getrennte Bandphasen, jeweils hoechstens ein Pass;
- nach Cleanup und Budget eine begrenzte Expert-Detailrestauration aus der urspruenglichen
  Tokenkarte: hoechstens sechs kompakte, umschlossene, kontrastreiche Whole-Source-Components,
  insgesamt hoechstens `1.5 %` der Bildflaeche und ausschliesslich mit vorhandenen
  Palettenfarben;
- nach einer Restaurierung ein Flaechenfloor-freier Reparaturmerge, der nur neu entstandene
  hard-unpaintable Reste entfernt, plus erneute Budgetpruefung;
- nach aller Geometriearbeit exakte Palettennutzung durch Whole-Component-Reassignment;
- abschliessende Assertions fuer null hard-unpaintable Regionen, Facet-Budget und erforderliche
  Palettennutzung.

Der finale Drei-Spalten-Lauf isoliert den Effekt sauber: Spalte 1 ist der bisherige
`0.0006`-Stand, Spalte 2 senkt nur auf `0.0005`, Spalte 3 ist der echte produktive Default mit
`0.0005` und Detailrestaurierung.

## Finaler Detailgewinn gegen `0.0006`

| Classic-Metrik, 11 Expert-Bilder | `0.0006` vorher | `0.0005` ohne Rettung | Produktion `0.0005` + Rettung |
| --- | ---: | ---: | ---: |
| Regionen gesamt | 3157 | 3403 | 3492 |
| mittlere Regionen pro Bild | 287,00 | 309,36 | 317,45 |
| Boundary-Dichte | `5,50 %` | `5,66 %` | `5,69 %` |
| sichtbarer Classic-Grenz-Footprint | `18,12 %` | `18,59 %` | `18,66 %` |
| gewichteter schwarzer Ink-Anteil | `8,77 %` | `9,00 %` | `9,04 %` |
| niedrig kontrastierende Doppelkontur-Laenge | `5,04 %` | `5,73 %` | `5,90 %` |
| Recall starker Quellkanten ab `12 LAB` | `73,62 %` | `74,85 %` | `74,90 %` |
| Recall starker Quellkanten ab `16 LAB` | `79,51 %` | `80,50 %` | `80,55 %` |
| genutzte Farben | 24 in 11/11 | 24 in 11/11 | 24 in 11/11 |

Der produktive Stand behaelt gegenueber `0.0006` `10,6 %` mehr Regionen, waehrend
Grenz-Footprint und Ink nur um `0,54` beziehungsweise `0,27` Prozentpunkte steigen. Der
Detail-Recall gewinnt `1,28` beziehungsweise `1,04` Prozentpunkte. Davon kommt der groesste
Teil bereits aus dem niedrigeren Floor; die begrenzte Restaurierung fuegt nur 89 Regionen
beziehungsweise `2,6 %` gegenueber dem reinen `0.0005`-Kontrolllauf hinzu. Sie ist absichtlich
kein allgemeiner Textur-Rueckbau, sondern eine kleine Sicherheitsreserve fuer verlorene kompakte
Quellformen wie Mund-/Gesichtsteile und repraesentative Steine.

Die lokale Pipeline versteht weiterhin keine Objektsemantik. Der neue Expert-KI-Prompt verteilt
deshalb Detail bedeutungsgewichtet: Kopf, Gesicht, Mund/Ruessel und wichtige Vordergrundobjekte
werden explizit geschuetzt; homogener Rasen, entfernte Buesche und dichte Hintergrundblaetter
duerfen stark gruppiert werden. Dieser Prompt wirkt erst auf neu posterisierte Bilder; der
finale Pipeline-Vergleich verwendet bewusst den unveraenderten bestehenden KI-Korpus.

## Ergebnis auf dem Fokusbild `img-1644`

| Metrik | vorheriger Fresh-Stand | Produktion | Aenderung |
| --- | ---: | ---: | ---: |
| Regionen | 1789 | 399 | `-77,7 %` |
| Boundary-Dichte | `15,84 %` | `8,04 %` | `-49,2 %` |
| sichtbarer Classic-Grenz-Footprint | `49,64 %` | `26,73 %` | `-46,1 %` |
| gewichteter schwarzer Ink-Anteil | `24,59 %` | `12,86 %` | `-47,7 %` |
| Regionen mit weniger als 50 % Farbfuellung | 1371 | 129 | `-90,6 %` |
| R5-coreless | 473 | 77 | `-83,7 %` |
| R5-coreless, niedrig kontrastierend | 315 | 4 | `-98,7 %` |
| niedrig kontrastierende Doppelkontur-Laenge | `32,53 %` | `8,67 %` | `-73,3 %` |
| Output-Grenzen ohne Quellunterstuetzung unter `8 LAB` | `52,28 %` | `42,11 %` | besser |
| Recall starker Quellkanten ab `12 LAB` | `86,86 %` | `65,99 %` | `-20,87 pp` |
| Recall starker Quellkanten ab `16 LAB` | `90,68 %` | `75,20 %` | `-15,48 pp` |
| genutzte Farben | 24 | 24 | stabil |

## Ergebnis ueber alle elf Expert-Bilder

| Metrik | vorheriger Fresh-Stand | Produktion | Aenderung |
| --- | ---: | ---: | ---: |
| Regionen gesamt | 8950 | 3157 | `-64,7 %` |
| mittlere Regionen pro Bild | 813,64 | 287,00 | `-64,7 %` |
| Boundary-Dichte | `8,61 %` | `5,50 %` | `-36,1 %` |
| sichtbarer Classic-Grenz-Footprint | `27,19 %` | `18,12 %` | `-33,4 %` |
| gewichteter schwarzer Ink-Anteil | `13,46 %` | `8,77 %` | `-34,8 %` |
| Regionen mit weniger als 50 % Farbfuellung | 5573 | 859 | `-84,6 %` |
| R5-coreless | 2194 | 574 | `-73,8 %` |
| R5-coreless, niedrig kontrastierend | 1015 | 22 | `-97,8 %` |
| niedrig kontrastierende Doppelkontur-Laenge | `20,76 %` | `5,04 %` | `-75,7 %` |
| Output-Grenzen ohne Quellunterstuetzung unter `8 LAB` | `49,07 %` | `41,19 %` | besser |
| Recall starker Quellkanten ab `12 LAB` | `84,37 %` | `73,62 %` | `-10,75 pp` |
| Recall starker Quellkanten ab `16 LAB` | `86,71 %` | `79,51 %` | `-7,20 pp` |
| genutzte Farben | 24 in 11/11 | 24 in 11/11 | stabil |

Finale Facet-Zahlen: `255, 353, 253, 399, 289, 538, 202, 308, 259, 203, 98`.
Gegenueber dem zwischenzeitlichen `0.0008`-Default erzeugt `0.0006` insgesamt `14,0 %` mehr
Regionen und gewinnt `1,79` beziehungsweise `1,41` Prozentpunkte Recall starker Quellkanten.
Der Doppelkontur-Proxy steigt moderat von `3,68 %` auf `5,04 %`, bleibt aber weit unter dem alten
Fresh-Stand von `20,76 %`. Der visuelle Direktvergleich zeigt bei etwa sieben bis acht Motiven
sinnvolles Motiv- oder Schattierungsdetail. `img-1681` gewinnt vor allem Grasstruktur und
`img-1852` mehr schmale Fellbaender; diese zwei bleiben die bewusst dokumentierten
Vorsichtsmotive. Der niedrigere Recall gegenueber dem alten komplexen Fresh-Stand bleibt ein
bewusster Textur-vs.-Paintability-Tausch.

## Renderer- und Palettenkorrekturen

Unabhaengig von der Segmentierung wurde ein echter Classic-PNG-Fehler beseitigt. Die fruehere
Boundary-Maske koppelte „rechts verschieden“ und „unten verschieden“ in einer gemeinsamen
Bedingung und markierte danach beide Nachbarn. So entstanden orthogonale Ghost-Pixel. Rechts-
und Unten-Kontakte werden jetzt unabhaengig behandelt; SVG war von diesem Fehler nicht betroffen.

Die Palettenrestauration besitzt jetzt einen zweistufigen Fallback. Wenn die strenge LAB-Regel
eine gelernte Farbe nicht reaktivieren kann, wird deterministisch eine vollstaendige spendbare
Komponente gewaehlt. Es werden keine Pixel gesplittet und damit keine neuen Grenzen erzeugt.
Gefordert werden `min(learnedPaletteCount, finalComponentCount)` Farben; alle elf Expert-Ausgaben
verwenden exakt 24 sichtbare RGB-Farben.

## Reproduktion

```sh
npm run pipeline:lab --prefix ./App -- \
  --suite ../pipeline-lab/suites/2026-07-15-expert-semantic-detail-restoration.json

node ./App/scripts/analyze-classic-paintability.mjs \
  pipeline-lab/runs/<run>/manifest.json \
  --json pipeline-lab/runs/<run>/classic-paintability.json

npm run pipeline:fresh:regression --prefix ./App
npm run typecheck --prefix ./App
```

Die Freigabe gilt fuer die aktuelle elf Bilder umfassende Expert-Suite. Weitere neue KI-Motive
sollten weiterhin im Classic-Render und nicht nur ueber Fresh Clean geprueft werden.
