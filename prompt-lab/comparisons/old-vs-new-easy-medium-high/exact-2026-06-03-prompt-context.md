# Exakter Prompt-Kontext um 2026-06-03

Commit: `170b236a1289715bd18ffc9c94158c363ed94222`

Zu diesem Zeitpunkt gab es im Repo noch keinen getrennten Foto-Posterize-Prompt für Easy/Medium/High. Vorhanden war ein Idea-/Illustrationsprompt mit Detaillevel `low | medium | high`.

## react-app/src/lib/promptBuilder.ts

```ts
import { IDEA_BASE_PROMPT } from '../prompts/basePrompt';
import { IDEA_NEGATIVE_PROMPT } from '../prompts/negativePrompt';
import { IDEA_STYLE_PROMPT } from '../prompts/stylePrompt';

export type IdeaPromptInput = {
  ideaText: string;
  detailLevel: 'low' | 'medium' | 'high';
};

function detailInstruction(detailLevel: IdeaPromptInput['detailLevel']): string {
  switch (detailLevel) {
    case 'low':
      return 'Halte das Motiv bewusst einfach, mit wenigen grossen Flaechen und sehr wenig kleinteiligen Details.';
    case 'high':
      return 'Nutze etwas mehr dekorative Details, aber nur so weit, dass das Motiv fuer eine Paint-by-Numbers-Umwandlung sauber lesbar bleibt.';
    case 'medium':
    default:
      return 'Nutze ein ausgewogenes Mass an Details mit klaren Hauptformen und gut trennbaren Farbsegmenten.';
  }
}

export function buildIdeaPrompt(input: IdeaPromptInput): string {
  return [
    IDEA_BASE_PROMPT,
    IDEA_STYLE_PROMPT,
    `Motividee des Nutzers: ${input.ideaText.trim()}`,
    detailInstruction(input.detailLevel),
    IDEA_NEGATIVE_PROMPT,
    'Erzeuge genau ein stimmiges Bild als finale Ausgabe.',
  ].join('\n\n');
}

```

## react-app/src/prompts/basePrompt.ts

```ts
export const IDEA_BASE_PROMPT = `
Du erstellst eine freundliche, klare und gut weiterverarbeitbare Illustration fuer eine Malen-nach-Zahlen-App.

Das Bild muss:
- ein einzelnes, klares Hauptmotiv haben
- gut lesbare Formen und grosse, erkennbare Farbflächen besitzen
- helle, freundliche Farben nutzen
- keine fotografische Koernung, keine feinen Mikrotexturen und kein unruhiges Rauschen enthalten
- keine Schrift, keine Logos, keine Wasserzeichen und keinen Rahmen enthalten
- auf weissem oder sehr ruhigem, cleanem Hintergrund stehen
- kindgerecht, positiv und kreativ wirken

Wichtig fuer die Weiterverarbeitung:
- klare Kanten zwischen wichtigen Formen
- moeglichst wenig winzige Details
- gut getrennte Bildelemente
- keine extrem dunklen Schattenflaechen
- keine verwischten oder abstrakten Strukturen, die spaeter zu chaotischen Miniregionen werden
`.trim();

```

## react-app/src/prompts/stylePrompt.ts

```ts
export const IDEA_STYLE_PROMPT = `
Visuelle Richtung:
- moderne, sanfte Sketch-&-Bloom-Aesthetik
- weiche Illustration mit klarer Formensprache
- freundliche Pastell- und Naturtoene
- ausgewogene Komposition mit genug Luft um das Motiv
- sauber, hochwertig, ruhig und warm

Bildsprache:
- eher illustriert als fotorealistisch
- klare Vordergrundformen
- gut erkennbare Farbsegmente
- harmonisch, verspielt und hochwertig
`.trim();

```

## react-app/src/prompts/negativePrompt.ts

```ts
export const IDEA_NEGATIVE_PROMPT = `
Vermeide:
- Text, Zahlen, Buchstaben, Logos, Wasserzeichen
- fotorealistischen Hautporen-Look
- komplexe Stadtmassen, Menschenmengen oder chaotische Hintergrundmuster
- extreme Tiefenschaerfe, Bewegungsunschaerfe, Filmgrain oder starke JPEG-Artefakte
- zu viele Mini-Objekte
- harte Neonkontraste oder fast schwarze Flaechen
- abgeschnittene Hauptmotive
`.trim();

```
