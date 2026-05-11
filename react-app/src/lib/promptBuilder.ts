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
