# BA Paint By Numbers

Dieses Repository enthaelt die aktuelle Happy-Numbers-App, die eingebettete React-WebView-UI,
Generatoren, Prompt-/Pipeline-Labs und Referenzartefakte.

## Wichtige Ordner

- `App/` - aktuelle Expo-App fuer installierte iOS/Android-Builds. Enthalten sind die native Shell, WebView-Bridge, KI-Aufruf und lokale Generatoren.
- `react-app/` - React + TypeScript UI, die als lokales WebView-Bundle in `App/` geladen wird.
- `App/src/features/generator/` - produktiver Generatorbereich der App. Der neue Fresh-Port liegt unter `fresh/`, der alte Pipeline-Fallback in `generatePaintByNumbers.ts`.
- `docs/` - zentrale Projektdokumentation. Einstiegspunkt ist `docs/technische-architektur-happy-numbers-de.md`.
- `test-assets/` - kuratierte Testbilder und KI-Zwischenbilder.
- `prompt-lab/` - Prompt-Experimente, Suites, Vergleichslaeufe und Ergebnisartefakte.
- `pipeline-lab/` - Pipeline-Analysen, Vergleichslaeufe und Fresh-Pipeline-Prototypen.
- `reference/python-pipeline/` - Python-Referenzpipeline und ihre Referenzoutputs.
- `design-references/` - UI-/Designreferenzen aus Stitch und aehnlichen Quellen.
- `external/` - externe Referenzquellen, die nicht der aktuelle App-Runtime-Pfad sind.

## Haefige Checks

```sh
npm run typecheck --prefix ./App
npm run typecheck --prefix ./react-app
npm run build:webview-local --prefix ./react-app
npm run sync:webview-local --prefix ./App
```

Nicht im Repository-Root `npm install` ausfuehren. `App/` und `react-app/` haben getrennte
Package-Setups.
