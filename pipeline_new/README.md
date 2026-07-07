# pipeline_new

Experimenteller TypeScript-Port der Region-First-Paint-by-Numbers-Pipeline.

Dieser Ordner ist absichtlich getrennt vom bisherigen Generator unter `App/src/features/generator/`.
`App/App.tsx` importiert auf diesem Branch den neuen Generator direkt aus:

```text
pipeline_new/src/generatePaintByNumbersNew.ts
```

Damit Expo/Metro den externen Ordner beim App-Bundling sieht, erweitert `App/metro.config.js`
den Watch-Scope auf das Repository-Root.

Der Port ist eine app-taugliche Annäherung an den Python-Prototyp:

1. Bild auf maximal 1400 px Kantenlaenge vorbereiten.
2. Kantenbewusst lokal glaetten.
3. 64 Farb-Token aus RGB-Bins bauen.
4. Zusammenhaengende Token-Regionen erkennen.
5. Eine gewichtete Zielpalette auf Regionsebene lernen.
6. Kleine Restregionen mergen und kontrastreiche Details schuetzen.
7. Speckles bereinigen.
8. `cleanColor` und `classic` rendern.

Nummern, Labelplatzierung und die vollstaendige alte Variantenliste sind in diesem Port noch nicht
implementiert. Fuer App-Kompatibilitaet liefert der Port `classic`, `cleanColor` und einen
`brightColorCircles`-Default-Alias.
