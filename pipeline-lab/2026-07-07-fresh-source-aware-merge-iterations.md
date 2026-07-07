# Fresh Pipeline Source-Aware Merge Iterationen

Datum: 2026-07-07

Ziel: Die neue Region-First-Pipeline soll naeher am KI-posterisierten Bild bleiben, die Ziel-Farbanzahl einhalten und kleine relevante Details nicht pauschal in falsche Nachbarn mergen.

Primaere Referenz ist das KI-posterisierte Bild. Verglichen wurde gegen vorhandene Fresh-Referenzen und neue Lab-Laeufe:

- Bisheriger Fresh-Referenzlauf: `pipeline-lab/runs/2026-07-07T13-36-53-088Z_fresh-region-first-24c-smoothed-final/`
- Source-aware, zu kleinteilig: `pipeline-lab/runs/2026-07-07T19-07-39-102Z_fresh-region-first-24c-source-aware/`
- Source-aware mit gated global fallback: `pipeline-lab/runs/2026-07-07T19-14-57-223Z_fresh-region-first-24c-source-aware-gated-global/`
- Gewaehlte Expert-Kalibrierung: `pipeline-lab/runs/2026-07-07T19-17-58-275Z_fresh-region-first-24c-source-aware-ratio-00012/`

## Kurzbefund

Die behaltene Richtung ist source-aware Cleanup: Majority-Filter und Region-Merge vergleichen Kandidaten gegen die lokale KI-Quellfarbe, nicht nur gegen die aktuelle Palettenfarbe. Wenn kein farblich plausibler Nachbar existiert, darf eine kleine relevante Region auf die naechstpassende globale Zielpalettenfarbe wechseln. Dieser globale Fallback ist begrenzt, damit Hintergrundtextur nicht als tausende Mikrokonturen erhalten bleibt.

Finale Lab-Kennzahlen fuer die gewaehlte 24-Farb-Kalibrierung:

| Bild | Farben | Regionen | MAE zu KI, alt | MAE zu KI, neu |
| --- | ---: | ---: | ---: | ---: |
| `img-1394` | 24/24 | 2058 | 6.85 | 6.41 |
| `img-1681` | 24/24 | 2375 | 8.99 | 8.04 |
| `img-1704` | 24/24 | 2868 | 15.28 | 14.50 |
| `img-1998` | 24/24 | 1514 | 6.10 | 5.89 |

Der Specht-Fall (`img-1704`) war vorher im Fresh-Referenzlauf bei 23/24 Farben. Die neue Paletten-Reaktivierung bringt ihn im Lab wieder auf 24/24. Im App-Port greift zusaetzlich `maximumNumberOfFacets`, sodass Expert-Ausreisser wie dieser nach dem source-aware Merge noch ein kontrastgeschuetztes Flaechenbudget bekommen.

## 20 Iterationen

| Nr. | Hypothese | Aenderung | Pruefung | Entscheidung |
| ---: | --- | --- | --- | --- |
| 1 | Detailverlust entsteht, weil kleine Regionen nur anhand Nachbarpalette bewertet werden. | Merge-Kandidaten gegen lokale KI-Quellfarbe im LAB-Raum bewerten. | Code-Review `mergeTinyRegions`, Lab-Lauf source-aware. | Behalten. Reduziert Fehlfarben sichtbar. |
| 2 | Majority-Filter faerbt harte Details falsch um. | Majority darf Label nur wechseln, wenn Zielpalette fuer das Quellpixel nicht deutlich schlechter passt. | App-Typecheck, Lab-Laeufe gegen KI-Bild. | Behalten. |
| 3 | Alle kleinen Regionen global zu retten erhaelt Hintergrundrauschen. | Globaler Nächstfarben-Fallback zunaechst ungegrenzt. | `source-aware`: 24/24 Farben, aber 1500-3000 Regionen und Median teils 4 px. | Zurueckgenommen bzw. eingegrenzt. |
| 4 | Globaler Fallback soll nur fuer relevante Details gelten. | Fallback nur ab Detailschutzgroesse oder kontrastreichem Speckle ab 18 px. | `source-aware-gated`: globale Reassignments fallen von hunderten auf wenige Dutzend. | Behalten. |
| 5 | Expert-Minimum `0.000075` ist zu detailreich fuer Edge/Classic. | Expert-Mindestflaeche auf `0.00012`, min 72 px. | `ratio-00012`: MAE bleibt besser als alt, Regionen sinken moderat. | Behalten. |
| 6 | Finaler Majority-Pass erzeugt nach Speckle-Merge neue Inseln. | Reihenfolge gedreht: finaler Majority vor finalem Speckle-Merge. | `final-speckle-last`: keine relevante Verschlechterung, semantisch richtiger. | Behalten. |
| 7 | Mehr finale Speckle-Pässe loesen Mikroregionen. | 18 statt 8 finale Speckle-Pässe getestet. | Keine Regions-/MAE-Verbesserung, laengere Laufzeit. | Verworfen, 8 bleibt. |
| 8 | Leere Palettenslots verursachen weniger als Ziel-Farbanzahl. | `ensureTargetPaletteUsage()` reaktiviert fehlende Labels ueber hohe Quellfarb-Abweichung. | `img-1704` im Lab von 23/24 auf 24/24. | Behalten. |
| 9 | Reaktivierung darf keine andere Farbe leeren. | Nur Komponenten verwenden, wenn ihr aktuelles Label danach noch Pixel hat. | Code-Review und Lab-Farbenzaehlung. | Behalten. |
| 10 | Riesige Flaechen duerfen nicht fuer fehlende Palettenslots umgefaerbt werden. | Flaechen-Penalty fuer sehr grosse Kandidaten in Paletten-Reaktivierung. | Code-Review, keine grossflaechigen Farbspruenge im Overview. | Behalten. |
| 11 | Easy/Medium/Expert verhalten sich im Fresh-Port zu aehnlich. | Farbanzahlabhaengige Region-Policy: Easy groesser, Medium mittel, Expert feiner. | Code-Review gegen UI-Farbgrenzen. | Behalten. |
| 12 | Expert braucht trotzdem ein Flaechenbudget. | `settings.maximumNumberOfFacets` im Fresh-Port respektieren. | App-Typecheck; Budget nutzt source-aware Merge. | Behalten. |
| 13 | Speckles unter 48 px sollten nie hart falsch umgefaerbt werden, wenn eine nahe Palette existiert. | Finaler Speckle-Merge darf kontrastreiche Speckles ab 18 px schuetzen. | Overviews behalten Blütenzentrum und Vogelkopfdetails. | Behalten, aber durch gated fallback begrenzt. |
| 14 | Palette-Neuberechnung nach Reassignments muss auf KI-Bild basieren. | Palette nach Cleanup aus geglaetteter KI-Quelle neu berechnen. | Bestehender Fresh-Flow, weiterhin 24 Farben. | Behalten. |
| 15 | Palette-Reassignment zu nicht-benachbartem Label koennte Regionen nicht mergen, aber Farbe retten. | Nicht-benachbarte globale Zielpalette erlaubt, wenn Nachbarn farblich schlecht passen. | Lab MAE verbessert bei allen vier Referenzen. | Behalten. |
| 16 | Nicht-tiny Regionen sollten nie in farblich schlechten Nachbarn fallen. | Fallback auf schlechten Nachbarn nur fuer echte Forced-Tiny-Regionen. | Code-Review; verhindert harte Fehlzuweisungen. | Behalten. |
| 17 | Detailschutz allein ueber Palette-Palette-Distanz ist zu grob. | Detailschutz nutzt Quellregion gegen Nachbarziel im LAB-Raum. | Lab und visuelle Overviews. | Behalten. |
| 18 | Mehr Initial-Tokenfarben koennten Details retten. | Nicht umgesetzt, weil App-Port bewusst 64 RGB-Bins fuer Laufzeit nutzt. | Abgewogen gegen iPhone-Laufzeit. | Verworfen fuer diesen Change. |
| 19 | React/UI-Settings muessen fuer diese Aenderung angepasst werden. | Keine UI-Aenderung; Fresh-Port leitet interne Policy aus Farbanzahl ab. | Bridge/UI unveraendert, App-Typecheck. | Keine UI-Aenderung. |
| 20 | Vergleichsvarianten helfen bei manueller KI-Paritaetspruefung. | Bestehende App-Aenderung behaelt `inputImage` und `aiPosterizedImage` im normalen Resultat. | Architektur-Diff und App-Typecheck. | Behalten. |

## Verbleibende Risiken

- Die Python-Lab-Pipeline ist nicht bytegleich mit dem TypeScript-App-Port, weil sie OpenCV-Mean-Shift nutzt. Sie bleibt Vergleichs- und Diagnosewerkzeug, nicht Runtime.
- `cleanColor` profitiert am staerksten. Edge-/Classic-Varianten koennen bei sehr texturierten Naturmotiven weiterhin viele kleine Konturen zeigen.
- Ohne semantisches Modell kann die lokale Pipeline Hintergrundtextur nicht perfekt von Motivdetails unterscheiden. Der neue source-aware Schutz reduziert Fehlfarben, ersetzt aber keine semantische Segmentierung.
