import { issuesUrl } from "./links.js";
import { NewTabLink } from "./new-tab-link.js";

export const AccessibilityStatement = () => (
  <>
    <p className="policy-updated">Last reviewed: November 2026</p>

    <p>
      <strong>Conformance status:</strong> Email Platform is built to meet the
      Web Content Accessibility Guidelines (WCAG) 2.2 at{" "}
      <strong>Level AA</strong>.
    </p>

    <h3>What we have done</h3>
    <ul>
      <li>
        <strong>Keyboard access</strong>: every page, menu, dialog and the
        template designer work with a keyboard alone, with a clear focus outline
        that is never hidden behind the footer or the save bar. After moving to
        a new page, focus goes to its heading.
      </li>
      <li>
        <strong>The template designer</strong>: dragging is never needed. Blocks
        are added with a click, moved with the Move up and Move down buttons or
        Alt and the arrow keys, and every setting is a labelled field.
      </li>
      <li>
        <strong>Screen readers</strong>: every page has its own title, one main
        heading and labelled landmarks; every control has a name, icons are
        hidden from screen readers, and errors and saved changes are announced
        as they happen.
      </li>
      <li>
        <strong>Colour and contrast</strong>: in each of the six themes, in
        light and dark, text has at least 4.5:1 contrast with its background
        (body text at least 7:1), and form fields, focus outlines and other
        controls at least 3:1. These ratios are checked by the app&apos;s tests.
        Nothing is shown by colour alone.
      </li>
      <li>
        <strong>Motion</strong>: animations are short, and are switched off when
        your device asks for reduced motion.
      </li>
      <li>
        <strong>Zoom and reflow</strong>: pages reflow on narrow screens and
        when zoomed to 400%, and wide tables scroll on their own.
      </li>
      <li>
        <strong>Target sizes</strong>: every control is at least 24 by 24
        pixels, and most are 40 or more.
      </li>
      <li>
        <strong>Signing in</strong>: the password field accepts pasting and
        password managers, and no puzzle is ever asked.
      </li>
    </ul>

    <h3>Known limitations</h3>
    <ul>
      <li>
        The accessibility of an email depends on its template. The designer asks
        for alt text on images and uses real headings and lists, but HTML
        written by hand is sent as it is.
      </li>
      <li>
        Previews show the email inside a frame as a mail app would, so its
        colours follow the template, not the theme you chose.
      </li>
    </ul>

    <h3>Feedback</h3>
    <p>
      If something is hard to use, please{" "}
      <NewTabLink href={issuesUrl}>open an issue on GitHub</NewTabLink> saying
      what you were trying to do, and with which browser and assistive
      technology.
    </p>
  </>
);
