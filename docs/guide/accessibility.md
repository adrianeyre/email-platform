# Accessibility

The interface is built to meet WCAG 2.2 Level AA.

- **Keyboard and screen readers:**
  - a skip link and labelled landmarks;
  - a title for every page, starting `Email Template - `, with focus moving to each new page's heading;
  - an account menu that follows the WAI-ARIA menu button pattern;
  - native modal dialogs that return focus to the button that opened them;
  - in the designer, buttons and keyboard shortcuts for everything you could drag, including moving and removing a Socials block's networks.
- **Contrast:** checked by `src/ui/appearance.test.ts` for every theme in light and dark: text at least 4.5:1 (body text 7:1), and controls and focus at least 3:1. Social icons on a shape pick white or near-black to keep 3:1 against their colour.
- **Layout and motion:** targets are at least 24px, pages reflow down to 320px, and reduced motion is respected, in the app and on the website, whose animated illustrations show a single still frame instead.

The full statement is in the app's footer, under **Accessibility**.
