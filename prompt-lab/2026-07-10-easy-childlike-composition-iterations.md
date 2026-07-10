# Easy: kindliche Neuinterpretation statt Foto-Nachzeichnung

## Ziel

Der produktive Easy-Prompt vereinfacht Farben und Flaechen bereits stark, bindet das Modell aber noch zu eng an Crop, Objektplatzierung, Konturen und Hintergrundbaender des Fotos. Dadurch kann eine komplexe Baumwand beispielsweise als grosse gruene Flaeche oder als stark vereinfachte Kopie derselben Kante enden, statt als neu entworfene, kindlich lesbare Gruppe von Baeumen.

Der Versuch testet deshalb fuenf generische Prompt-Richtungen. Allen gemeinsam ist:

- Das Foto ist eine semantische Szenenreferenz, keine Linienvorlage.
- Hauptmotiv, grobe Pose, Blickrichtung, Tiefenreihenfolge und wichtige Kontakte bleiben erhalten.
- Exakte Konturen, Kantenrhythmen, Objektzahlen und Nebenstrukturen duerfen neu entworfen werden.
- Komplexe Massen werden zu wenigen erkennbaren, kindgerechten Szenenobjekten.
- Kleine passende Ergaenzungen sind in den spaeteren Iterationen erlaubt, muessen aber sekundaer und mit der vorhandenen Palette malbar bleiben.
- Augen und andere identitaetskritische Gesichtsmerkmale bleiben als kompakte geschlossene Landmark-Flaechen erhalten.

Die fuenf Kandidaten blieben waehrend der Vergleichsphase getrennt vom produktiven Prompt. Nach der gemeinsamen Auswahl wurde eine Synthese aus Iteration 3, 4 und 5 in `react-app/src/prompts/paintByNumbersPosterizePrompt.ts` uebernommen.

## Testaufbau

Die drei Motive decken unterschiedliche Fehlermodi ab:

- `IMG_1394.JPG`: See mit dichter Baumwand, also der konkrete Ausgangsfall.
- `IMG_1644.jpeg`: einzelnes Tier mit Auge, Pose und Silhouette als Bedeutungstraeger.
- `IMG_0106.JPG`: Friesenwall und Dorf mit vielen perspektivischen, baulichen und steinigen Details.

Alle 15 Aufrufe nutzten dieselben Bedingungen:

- Modell: `gemini-3.1-flash-lite-image`
- Seed: `1234`
- Temperatur: `0.2`
- Zielkante: `1024 px`
- Easy-Farbplan: `8`
- Zielgruppe: `a young child around 4 years old`

Prompt-Suite:

- `prompt-lab/suites/2026-07-10-easy-childlike-composition-iterations.json`

KI-Lauf:

- `prompt-lab/runs/2026-07-10T06-40-40-151Z_2026-07-10-easy-childlike-composition-iterations/`

Anschliessend wurde jedes KI-Bild unveraendert durch die reale Fresh-Easy-8-Pipeline geschickt:

- Suite: `pipeline-lab/suites/2026-07-10-easy-childlike-composition-iterations.json`
- Lauf: `pipeline-lab/runs/2026-07-10T06-44-41-606Z_2026-07-10-easy-childlike-composition-iterations/`
- Vergleich: `comparison-5-iterations.png`
- Vollstaendiger Report: `index.html`

Alle 15 KI-Aufrufe und alle 15 Fresh-Laeufe waren erfolgreich. Keine Ausgabe ueberschreitet acht Farben. 14 Ausgaben verwenden acht Farben; der Hirsch aus Iteration 5 verwendet sieben, weil die qualitaetsbewusste Fresh-Palette keine unpassende achte Farbe erfindet.

## Die fuenf Iterationen

### Iteration 1: semantisches Neuzeichnen

Datei: `prompt-lab/prompts/easy-childlike-composition-v1.md`

Die konservativste Variante trennt Szene und Linienvorlage, erlaubt aber keine neuen Dekorationen. Sie bleibt bei allen drei Motiven noch zu nah am Foto. Beim Friesenwall entstehen 100 Flaechen und eine detaillierte Steinstruktur; beim Hirsch wirkt das Ergebnis noch fotografisch gedaempft.

### Iteration 2: aus Erinnerung rekonstruieren

Datei: `prompt-lab/prompts/easy-childlike-composition-v2.md`

Das Modell soll Szenenkategorie, Hauptmotiv und Tiefenzonen behalten, aber Konturgeometrie und Nebenstruktur vergessen. Eine kleine passende Ergaenzung ist erlaubt. Die Richtung loest sich sichtbar vom Foto und behaelt das Hirschauge, erzeugt am See aber viele duenne Birkenaeste. Die 89 See-Flaechen sind fuer Easy vergleichsweise hoch.

### Iteration 3: Bilderbuch-Neuinterpretation

Datei: `prompt-lab/prompts/easy-childlike-composition-v3.md`

Das Foto wird als Beschreibung der visuellen Geschichte behandelt. Konturen, Abstaende und Nebenformen duerfen frei neu gestaltet werden; null bis zwei passende, einfache Details sind erlaubt. Diese Iteration liefert ueber alle drei Testmotive den staerksten Kompromiss:

- Der See wird zu einer klaren Bilderbuchlandschaft; Ente und wenige Uferdetails ueberstehen die Fresh-Pipeline.
- Der Hirsch ist freundlich, eindeutig und behaelt sein Auge; der Schmetterling bleibt lesbar.
- Das Dorf bleibt als dieselbe Szene erkennbar, wirkt aber neu illustriert statt nur nachgezeichnet.

Die finalen Bilder besitzen 46, 53 und 74 Flaechen. Einzelne kleine Sprenkel am Hirsch und die zusaetzlichen Objekte beim Dorf zeigen, wo eine spaetere Produktionsfassung noch enger werden sollte.

### Iteration 4: spielerisches Redesign

Datei: `prompt-lab/prompts/easy-childlike-composition-v4.md`

Diese Variante bewahrt nur die wichtigsten Szenenanker und fordert die staerkste bewusste Abweichung von Fotokonturen. Beim See trifft sie das Ziel besonders gut: Baeume und Ufer werden deutlich neu gestaltet und kindlich lesbar. Beim Hirsch geht jedoch zu viel Umgebung verloren. Beim Friesenwall steigt die Ausgabe auf 109 Flaechen, weil Steine und Pflaster wieder viele Einzelzellen bilden. Sie ist die kreativste, aber nicht die robusteste Variante.

### Iteration 5: ausbalancierte kreative Synthese

Datei: `prompt-lab/prompts/easy-childlike-composition-v5.md`

Die letzte Variante versucht, Wiedererkennbarkeit, neue Konturen und ruhige Malflaechen gleichzeitig explizit abzusichern. In der Praxis zieht die lange Qualitaetspruefung das Modell wieder naeher zur Fotogeometrie. Der See enthaelt eine unnatuerliche helle Spiegelungsflaeche; Hirsch und Dorf sind zwar einfach, aber weniger kinderfreundlich erzaehlt. Der Hirsch nutzt nur sieben sinnvolle Farben.

## Vergleich und Empfehlung

| Iteration | See | Hirsch | Friesenwall | Gesamturteil |
| --- | ---: | ---: | ---: | --- |
| 1 | 37 | 45 | 100 | zu literal und teils zu detailliert |
| 2 | 89 | 54 | 46 | deutlicher Fortschritt, aber duenne Details am See |
| 3 | 46 | 53 | 74 | bester stabiler Bilderbuch-Kompromiss |
| 4 | 85 | 29 | 109 | kreativste Richtung, aber motivabhaengig zu extrem |
| 5 | 34 | 27 | 77 | ruhig, faellt aber wieder in Fototreue zurueck |

Die Zahlen sind finale zusammenhaengende Fresh-Flaechen, nicht die Zahl der KI-Farbflecken.

Iteration 3 ist die beste Basis fuer den produktiven Easy-Prompt. Sie sollte die deutliche Formfreiheit aus Iteration 4 uebernehmen, zugleich aber Ergaenzungen auf hoechstens ein grosses, einfaches Nebendetail begrenzen und duenne Zweige, Steinmuster sowie kleine Bodensprenkel noch expliziter vermeiden.

## Ausgewaehlte Produktionsfassung: Synthese 3/4/5

Gemeinsam ausgewaehlt wurde eine Kombination aus:

- Iteration 3 als warme Bilderbuch-Basis und semantische Szenenerzaehlung,
- Iteration 4 fuer bewusst neu entworfene Konturen, Gruppen und komplexe Massen,
- Iteration 5 fuer stabile Kompositionsanker, eine ruhige Formensprache und einen abschliessenden Qualitaetscheck.

Die Produktionsfassung ist gegenueber den Kandidaten enger abgesichert:

- null oder hoechstens ein einfaches, grosses, szenenpassendes Nebendetail,
- keine motivspezifische Liste fuer Landschaft, Architektur, Pflanzen oder Tiere,
- keine harte Bindung an exakte Fotokonturen, Nebenobjektzahlen oder Hintergrundkanten,
- Szenen ohne klares Einzelmotiv werden nur ueber Szenenkategorie, Blickrichtung, Tiefenordnung und drei bis fuenf grosse visuelle Anker gebunden; uebrige Nebenstrukturen duerfen frei reduziert oder ersetzt werden,
- Augen bleiben als einzige ausdruecklich kleine Landmark-Ausnahme erhalten,
- die gesamte Szene erhaelt ein Zielbudget von ungefaehr 20 bis 35 grossen KI-Farbformen vor den Augen-Landmarks,
- semantische Anker schuetzen nur Rolle und grobe Lage, nicht die fotografische Innenkonstruktion,
- wiederholte Gruppen werden semantisch getrennt: eigenstaendige Szenenobjekte werden zu zwei bis fuenf grossen Symbolobjekten, reine Konstruktions- oder Oberflaecheneinheiten gehen dagegen vollstaendig in einer glatten Gesamtform auf,
- wiederholte Oberflaechenmuster, einzelne Wiederholungselemente, farbige Konturstriche und haarfeine Unterdetails werden generisch ausgeschlossen.

Die reproduzierbare Validierung des tatsaechlichen Produktionsprompts nutzt `prompt-lab/suites/2026-07-10-easy-childlike-selected-345.json`.

## Erste Produktionsvalidierung der 3/4/5-Basis

- Prompt-Lauf: `prompt-lab/runs/2026-07-10T07-03-31-879Z_2026-07-10-easy-childlike-selected-345/`
- Pipeline-Suite: `pipeline-lab/suites/2026-07-10-easy-childlike-selected-345.json`
- Fresh-Lauf: `pipeline-lab/runs/2026-07-10T07-04-06-852Z_2026-07-10-easy-childlike-selected-345/`
- Vergleich: `overview-cleanColor.png`
- Vollstaendiger Report: `index.html`

Alle drei KI-Aufrufe und alle drei Fresh-Laeufe waren erfolgreich. Jede finale Ausgabe nutzt acht Farben.

| Motiv | Fresh-Flaechen | Ergebnis |
| --- | ---: | --- |
| See | 48 | klare, neu illustrierte Baumsymbole, breite Wasser-/Uferflaechen und kindliche Blumenformen |
| Hirsch | 42 | freundliche, stark vereinfachte Tierform mit kleiner proportionaler Augen-Landmark |
| Friesenwall | 129 | Komposition bleibt lesbar, die KI bildet die prominenten Konstruktions- und Oberflaecheneinheiten trotz Vorrangregel weiterhin zu detailliert ab |

Der See- und Tierfall bestaetigen die ausgewaehlte Richtung. Der Friesenwall dokumentiert zugleich eine verbleibende Modellgrenze: Der Prompt unterscheidet generisch zwischen stellvertretenden eigenstaendigen Szenenobjekten und Einheiten, die nur eine groessere Konstruktion oder Oberflaeche bilden. `gemini-3.1-flash-lite-image` befolgt diese Unterscheidung bei stark prominenten Wiederholungsmustern nicht verlaesslich. Die Fresh-Pipeline haelt Farben und Mindestflaechen ein, kann aber grosse, bereits von der KI gezeichnete Einheiten nicht ohne einen staerkeren Easy-Flaechen-Cap semantisch zusammenfassen. Diese Grenze bleibt sichtbar dokumentiert, statt den erfolgreichen See-Fall durch ein motivspezifisches Prompt-Beispiel zu ueberfitten.

## Spielerische Nachschaerfung Richtung Iteration 4

Auf Nutzerwunsch wurde die ausgewaehlte 3/4/5-Synthese anschliessend einen Tick weiter Richtung Iteration 4 verschoben, ohne deren fruehere Clutter- und Extremrisiken vollstaendig zu uebernehmen:

- mutiger Einstieg als Werk eines ausgezeichneten Kinderbuch-Illustrators,
- freundlichere Uebertreibung von ein bis zwei definierenden Grossformen,
- rundere, schwungvollere und leicht asymmetrische Silhouetten,
- lebendigere Bildrhythmik bei weiterhin grosszuegigem Freiraum,
- hellere, optimistische, aber quellbezogene Farbbeziehungen,
- bevorzugt ein einziges grosses, szenenpassendes Nebendetail statt nur einer optionalen Erlaubnis.

Das Zielbudget von 20 bis 35 KI-Grossformen, die Acht-Farben-Grenze, die proportionale Augen-Landmark und die generischen Regeln gegen Clutter, Mikrodetails und fotografische Wiederholungsmuster bleiben unveraendert.

Ein erster Gegencheck der spielerischen Fassung machte den See und das Dorf sichtbar kinderbuchhafter, deutete beim Hirsch das offene Auge aber als geschlossenen Laechel-Lidstrich um. Die produktive Augenregel sichert deshalb zusaetzlich den Offen-/Geschlossen-Zustand aus der Quelle: Ein offenes Auge muss eine kleine gefuellte ovale oder runde Landmark-Flaeche bleiben und darf nicht durch eine Cartoon-Lidlinie ersetzt werden.

## Finale spielerische Produktionsvalidierung

- Prompt-Suite: `prompt-lab/suites/2026-07-10-easy-childlike-selected-345-playful.json`
- Prompt-Lauf: `prompt-lab/runs/2026-07-10T07-12-16-721Z_2026-07-10-easy-childlike-selected-345-playful/`
- Pipeline-Suite: `pipeline-lab/suites/2026-07-10-easy-childlike-selected-345-playful.json`
- Fresh-Lauf: `pipeline-lab/runs/2026-07-10T07-13-29-155Z_2026-07-10-easy-childlike-selected-345-playful/`
- Vergleich: `overview-cleanColor.png`
- Vollstaendiger Report: `index.html`

Alle drei KI-Aufrufe und Fresh-Laeufe waren erfolgreich; jede finale Ausgabe nutzt acht Farben.

| Motiv | Fresh-Flaechen | Veraenderung gegenueber 3/4/5-Basis | Ergebnis |
| --- | ---: | ---: | --- |
| See | 60 | +12 | klarere ikonische Baumformen und staerkerer Kinderbuchcharakter; weiterhin breit malbare Hauptflaechen |
| Hirsch | 38 | -4 | freundlichere Formensprache; das offene Auge bleibt als geschlossene Landmark erhalten und wird sichtbar verspielter interpretiert |
| Friesenwall | 120 | -9 | etwas weniger Flaechen und spielerische Pflanzenformen, aber die bekannte Detailgrenze der prominenten Wiederholungsstruktur bleibt |

Die Verschiebung Richtung Iteration 4 erhoeht beim See die Zahl der Formen moderat, senkt sie bei Hirsch und Friesenwall und macht die Bildsprache insgesamt mutiger. Die Acht-Farben-, Clutter- und Malbarkeitsgrenzen bleiben erhalten. Das Hirschauge ist nun verlaesslich offen, wirkt im Modelloutput aber groesser und illustrativer als in der ruhigeren Basisfassung; das ist der sichtbarste Trade-off der spielerischeren Richtung.
