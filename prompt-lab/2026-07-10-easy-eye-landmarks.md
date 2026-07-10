# Easy-Augen und Landmark-Schutz

## Problem

In mehreren alten Easy-8-Ausgaben fehlten Tieraugen. Die Stufenpruefung zeigte zwei unterschiedliche Ursachen:

1. Beim Hirsch und beim braunen Pferd fehlte das Auge bereits im KI-posterisierten Easy-Bild. Die lokale Pipeline konnte dort keine nicht vorhandene Form retten.
2. Sehr kleine, vorhandene Hochkontrastfacets koennen unterhalb der normalen Easy-Mindestflaeche im Majority-/Speckle-Cleanup verschwinden.

## Aenderung

Der Easy-Prompt in `react-app/src/prompts/paintByNumbersPosterizePrompt.ts` verlangt jetzt fuer jedes sichtbare Tier- oder Vogelauge:

- genau eine kompakte geschlossene Landmark-Flaeche,
- die dunkelste passende Farbe aus der bereits erlaubten 8er-Palette,
- keine neunte Farbe,
- kein Weglassen oder Verschmelzen mit Fell oder Federn.

Der Fresh-Kern ergaenzt eine lokale Absicherung am Ende von `facetReduce`. Er betrachtet hoechstens zwoelf kompakte, umschlossene Hochkontrast-Tokenregionen und restauriert verlorene Kandidaten mit der naechsten bereits vorhandenen Easy-Palettenfarbe. Landschafts- oder Hintergrundrauschen wird durch Flaechen-, Form-, Enclosure-, LAB- und Kandidatenlimits begrenzt.

## Reproduzierbare Laeufe

- Prompt-Suite: `prompt-lab/suites/2026-07-10-ki-testbilder-easy8-eye-landmarks.json`
- Prompt-Lauf: `prompt-lab/runs/2026-07-10T05-18-48-179Z_2026-07-10-ki-testbilder-easy8-eye-landmarks/`
- Pipeline-Suite: `pipeline-lab/suites/2026-07-10-easy8-eye-landmarks.json`
- Finaler Fresh-Lauf: `pipeline-lab/runs/2026-07-10T05-22-58-901Z_2026-07-10-easy8-eye-landmarks/`

Alle elf KI-Aufrufe und alle elf Fresh-Laeufe waren erfolgreich. Jede finale Ausgabe nutzt exakt acht Farben. Die Regionenzahl liegt zwischen 22 und 131, im Mittel bei 56.7 Facets.

## Visuelle Pruefung

- `img-1644`: Das sichtbare Hirschauge bleibt als dunkle Gesichts-Landmark erhalten.
- `img-1681`: Das braune Pferd behaelt ein klar getrenntes schwarzes Auge.
- `img-1704`: Der Specht behaelt das dunkle Auge im hellen Gesichtsfeld.
- `img-1841`: Das weisse Pferd behaelt das dunkelblaue Auge.
- `img-1852`: Das sichtbare Elchauge bleibt im finalen Clean-Bild erkennbar.
- `img-1706`: Das KI-Bild zeichnet keine separate Pupillenfarbe; die grossen braunen Facetten bilden weiterhin die vereinfachten Facettenaugen der Fliege.

Die Stufendiagnose der vier Tierfaelle `img-1644`, `img-1681`, `img-1841` und `img-1852` zeigt, dass die groesser angelegten Prompt-Augen der ersten drei Motive bereits den normalen Cleanup ueberstehen. Bei `img-1852` greift die lokale Absicherung tatsaechlich ein: ein Landmark-Kandidat mit sieben verlorenen Pixeln wird am Ende von `facetReduce` restauriert. Damit bleibt der Schutz in den realen Bildern eng begrenzt, statt Easy allgemein mit Mikrofacets anzureichern.

## Regression

`npm run pipeline:fresh:regression --prefix ./App` enthaelt jetzt ein synthetisches Easy-Auge von nur `3 x 3 px`. Es muss nach dem normalen Cleanup wieder als geschlossene Kontrastflaeche erscheinen, waehrend die Ausgabe exakt acht Farben behaelt.
