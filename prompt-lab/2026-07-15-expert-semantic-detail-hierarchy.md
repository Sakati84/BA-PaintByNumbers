# Expert: bedeutungsgewichtete Detailhierarchie

## Problem

Der bisherige Expert-Prompt forderte mehr lokale Struktur relativ gleichmaessig im ganzen Bild.
Damit verbrauchte das KI-Zwischenbild viele Zellen fuer homogenen Rasen, Buesche und dichte
Hintergrundblaetter, waehrend kleine identitaetsrelevante Motivteile trotzdem unklar bleiben
konnten. Kritische Beispiele im bestehenden Korpus sind ein in den Boden uebergehender
Fliegenmund/Ruessel, ein farblich im Wald verschwindender Elchkopf und zu stark gruppierte
Feldsteine.

## Zwischenfassung der Prompt-Aenderung

Expert verteilt Detail nun nach Bedeutung:

- hoechste Detaildichte am Hauptmotiv, an Identitaetsmerkmalen und wichtigen
  Vordergrundstrukturen;
- expliziter Schutz fuer Auge, Mund/Ruessel, Schnauze, Kopfgrenze, Fuehler, Geweih, Schnabel und
  charakteristische Markierungen;
- eine lesbare Auswahl grosser repraesentativer Steine bei einer wichtigen Feldsteinmauer;
- starke Gruppierung semantisch unwichtiger homogener Textur wie Rasen, entfernten Bueschen,
  dichter Hintergrundbelaubung, Bodenfuellern und gleichfoermigen Wiederholungen;
- der Hintergrund darf keine Motivsilhouette und keine identitaetsrelevanten Teile absorbieren.

Der Negative Prompt nennt zusaetzlich dichte Rasen-/Busch-/Blattsegmentierung, in Boden oder
Hintergrund verschmolzene Kopf-/Gesichts-/Mundbereiche sowie eine zu einer anonymen Flaeche
kollabierte Feldsteinmauer.

Diese Zwischenfassung erwies sich nach weiteren visuellen Ergebnissen als zu stark: Homogene
Hintergruende wurden teilweise auf nur ein bis zwei Flaechen reduziert. Die am 2026-07-16
korrigierte Produktionsfassung behaelt die semantische Detailhierarchie, fordert fuer Expert aber
wieder substanzielle Struktur im gesamten Bild. Buesche, Belaubung, Rasen und vergleichbare
Hintergrundbereiche muessen mehrere repraesentative Farbwechsel, Tiefenebenen, Silhouettenbrueche
und interne Formgruppen behalten. Vereinfacht werden einzelne Blaetter, Grashalme und andere
fotografische Mikrotexturen, nicht die gesamte sichtbare Binnenstruktur eines Hintergrundbereichs.

## Zusammenspiel mit der lokalen Pipeline

Die lokale Pipeline ist geometrie- und kontrastbewusst, versteht aber keine Objektbedeutung.
Der neue Prompt ist deshalb der primaere semantische Schutz. Der produktive Fresh-Expert-Pfad
nutzt ergaenzend `0.0005` als Merge-Kandidatenschwelle und darf nach dem Cleanup hoechstens sechs
kompakte verlorene Quellformen mit vorhandenen Palettenfarben restaurieren. Dadurch entsteht
keine neue Farbe und kein unbeschraenkter Rueckfall in die alte kleinteilige Fresh-Geometrie.

Die erste Pipeline-Auswertung unter
`pipeline-lab/runs/2026-07-15T21-04-24-347Z_2026-07-15-expert-semantic-detail-restoration/`
verwendet absichtlich die bestehenden, mit dem vorherigen Prompt erzeugten KI-Bilder. Sie misst
damit nur die lokale Pipeline-Aenderung.

## Vollstaendiger End-to-End-Lauf

Danach wurden alle elf Originalfotos mit den damaligen produktiven Prompts jeweils als Easy 8,
Medium 12 und Expert 24 neu posterisiert:

- Suite: `prompt-lab/suites/2026-07-15-all-11-current-prompts-easy-medium-expert.json`
- Run: `prompt-lab/runs/2026-07-15T21-19-40-783Z_2026-07-15-all-11-current-prompts-easy-medium-expert/`
- Ergebnis: 33 von 33 Gemini-Ausgaben erfolgreich, Modell
  `gemini-3.1-flash-lite-image`, Seed `1234`, Temperatur `0.2`

Alle 33 KI-Bilder wurden danach mit dem jeweils passenden damaligen Fresh-Preset verarbeitet;
pro Bild wurden alle neun produktiven Varianten als PNG und SVG erzeugt:

- Suite: `pipeline-lab/suites/2026-07-15-all-33-new-prompts-fresh-final.json`
- Run: `pipeline-lab/runs/2026-07-15T21-22-50-150Z_2026-07-15-all-33-new-prompts-fresh-final/`
- Ergebnis: 33 von 33 Pipelineausgaben erfolgreich; alle 11 Easy-Ausgaben exakt 8 Farben,
  alle 11 Medium-Ausgaben exakt 12 Farben und alle 11 Expert-Ausgaben exakt 24 Farben

Die damalige Promptfassung verbessert die kritischen semantischen Beispiele sichtbar: Die Feldsteinmauer behaelt
grosse lesbare Einzelsteine, der Elchkopf ist klar vom Wald getrennt und die Fliege besitzt ein
eigenstaendigeres Kopf-/Mundgebiet. Der reale Modelllauf zeigt zugleich eine verbleibende Grenze:
Rasen beim Pferd und Buesche/Belaubung beim Specht sind trotz der neuen Anweisung noch
strukturierter als gewuenscht. Fresh konsolidiert diese Eingaben deutlich, kann die vom Modell
bereits gezeichnete semantische Hintergrundstruktur aber nicht vollstaendig als unwichtig
erkennen. Dieser Lauf ist deshalb ein Nachweis der inzwischen abgeloesten, staerker
vereinfachenden Zwischenfassung und noch kein Nachweis der Korrektur vom 2026-07-16.

## Korrekturlauf vom 2026-07-16

Die moderater vereinfachende Produktionsfassung wurde anschliessend auf denselben elf Originalen
mit identischem Modell, 24 Farben, Seed `1234` und Temperatur `0.2` validiert:

- Suite: `prompt-lab/suites/2026-07-16-expert-background-detail-restoration.json`
- Run: `prompt-lab/runs/2026-07-16T06-49-35-428Z_2026-07-16-expert-background-detail-restoration/`
- Ergebnis: 11 von 11 Gemini-Ausgaben erfolgreich
- Fresh-Run: `pipeline-lab/runs/2026-07-16T06-50-36-361Z_2026-07-15-all-33-new-prompts-fresh-final/`
- direkter Alt/Neu-Vergleich: `prompt-lab/comparisons/2026-07-16-expert-background-detail-restoration/comparison.html`
- Messvergleich: `prompt-lab/comparisons/2026-07-16-expert-background-detail-restoration/metrics.md`

Mit derselben Fresh-Expert-Konfiguration steigt die Gesamtzahl der finalen Regionen von 2385 auf
3005 (`+26.0 %`) und der Classic-Grenz-Footprint von `14.03 %` auf `17.06 %`. Gleichzeitig sinken
die niedrig kontrastierenden R5-coreless Regionen von 53 auf 42 und der niedrig kontrastierende
Doppelkontur-Anteil von `4.55 %` auf `4.16 %`. Alle elf Ausgaben nutzen exakt 24 Farben und
besitzen keine Region ohne Cross-Core.

Visuell gewinnen sieben Motive klar Hintergrund- oder Materialstruktur, drei bleiben im
Gesamtniveau stabil und die Fliege wird trotz niedrigerer Regionenzahl sauberer als geschlossenes
Paint-Cell-Motiv aufgebaut. Kein Motiv kollabiert erneut in einen Hintergrund aus nur ein bis zwei
anonymen Grossflaechen. `img-1644` und besonders `img-1704` markieren die obere Expert-Detailgrenze;
weitere Prompt-Aenderungen sollten diese beiden Vorsichtsmotive nicht noch kleinteiliger machen.
