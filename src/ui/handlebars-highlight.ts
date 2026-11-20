import {
  Decoration,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

export const handlebarsTokenPattern = /\{\{\{?[^{}]*\}?\}\}/g;

const handlebarsDecorator = new MatchDecorator({
  regexp: handlebarsTokenPattern,
  decoration: Decoration.mark({ class: "cm-handlebars" }),
});

class HandlebarsHighlighter {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = handlebarsDecorator.createDeco(view);
  }

  update(update: ViewUpdate): void {
    this.decorations = handlebarsDecorator.updateDeco(update, this.decorations);
  }
}

export const highlightHandlebars = ViewPlugin.fromClass(HandlebarsHighlighter, {
  decorations: (highlighter) => highlighter.decorations,
});

export const findHandlebarsTokens = (source: string): string[] =>
  [...source.matchAll(handlebarsTokenPattern)].map((match) => match[0]);
