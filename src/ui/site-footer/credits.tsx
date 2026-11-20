import { repositoryUrl } from "./links.js";
import { NewTabLink } from "./new-tab-link.js";

export interface Credit {
  name: string;
  what: string;
  licence: string;
  href: string;
}

export interface CreditGroup {
  title: string;
  credits: readonly Credit[];
}

/** Who made Email Platform: shown first, on its own card. */
export const creator = {
  name: "Adrian Eyre",
  initials: "AE",
  what: "Created, designed and built Email Platform",
  href: repositoryUrl,
};

/** Everything Email Platform is built with, grouped by the part of it each one does. */
export const creditGroups: readonly CreditGroup[] = [
  {
    title: "Interface",
    credits: [
      {
        name: "React",
        what: "The user interface",
        licence: "MIT",
        href: "https://react.dev",
      },
      {
        name: "Tiptap and ProseMirror",
        what: "Rich text in the template designer",
        licence: "MIT",
        href: "https://tiptap.dev",
      },
      {
        name: "CodeMirror",
        what: "The HTML code editor",
        licence: "MIT",
        href: "https://codemirror.net",
      },
      {
        name: "Lucide",
        what: "The icons the app's own are drawn after",
        licence: "ISC",
        href: "https://lucide.dev",
      },
    ],
  },
  {
    title: "Email",
    credits: [
      {
        name: "Handlebars",
        what: "Fills templates with their variables",
        licence: "MIT",
        href: "https://handlebarsjs.com",
      },
      {
        name: "Simple Icons",
        what: "The brand icons in the Socials block",
        licence: "CC0-1.0",
        href: "https://simpleicons.org",
      },
      {
        name: "html-to-text",
        what: "Writes the plain-text part of each email",
        licence: "MIT",
        href: "https://github.com/html-to-text/node-html-to-text",
      },
      {
        name: "Nodemailer",
        what: "Hands email to the SMTP provider",
        licence: "MIT-0",
        href: "https://nodemailer.com",
      },
    ],
  },
  {
    title: "Server and data",
    credits: [
      {
        name: "Fastify",
        what: "The server and its API",
        licence: "MIT",
        href: "https://fastify.dev",
      },
      {
        name: "TypeBox",
        what: "Checks every API request",
        licence: "MIT",
        href: "https://github.com/sinclairzx81/typebox",
      },
      {
        name: "pg-boss",
        what: "Queues and retries each send",
        licence: "MIT",
        href: "https://github.com/timgit/pg-boss",
      },
      {
        name: "Drizzle ORM",
        what: "Talks to the database",
        licence: "Apache-2.0",
        href: "https://orm.drizzle.team",
      },
      {
        name: "node-postgres",
        what: "Connects to PostgreSQL",
        licence: "MIT",
        href: "https://node-postgres.com",
      },
      {
        name: "PostgreSQL",
        what: "The database",
        licence: "PostgreSQL",
        href: "https://www.postgresql.org",
      },
    ],
  },
  {
    title: "Build",
    credits: [
      {
        name: "TypeScript",
        what: "The language it is written in",
        licence: "Apache-2.0",
        href: "https://www.typescriptlang.org",
      },
      {
        name: "Vite",
        what: "Builds the user interface",
        licence: "MIT",
        href: "https://vite.dev",
      },
    ],
  },
  {
    title: "Project website",
    credits: [
      {
        name: "Stageshow",
        what: "The product illustrations, by Benji Taylor",
        licence: "MIT",
        href: "https://github.com/benjitaylor/skills/tree/main/stageshow",
      },
    ],
  },
];

/** Every credit, in one list. */
export const softwareCredits: readonly Credit[] = creditGroups.flatMap(
  (group) => group.credits,
);

export const Credits = () => (
  <div className="credits">
    <section className="credits-creator" aria-labelledby="credits-creator">
      <span className="credits-monogram" aria-hidden="true">
        {creator.initials}
      </span>
      <div>
        <h3 id="credits-creator" className="credits-creator-name">
          {creator.name}
        </h3>
        <p>{creator.what}.</p>
        <p className="credits-meta">
          Version {__APP_VERSION__} ·{" "}
          <NewTabLink href={creator.href}>Source code on GitHub</NewTabLink>
        </p>
      </div>
    </section>

    <p className="credits-intro">
      Email Platform is built on open-source software. Thank you to everyone who
      makes it.
    </p>

    {creditGroups.map((group) => (
      <section
        key={group.title}
        className="credits-group"
        aria-label={group.title}
      >
        <h3>{group.title}</h3>
        <ul className="credits-list">
          {group.credits.map((credit) => (
            <li key={credit.name}>
              <span className="credits-text">
                <NewTabLink href={credit.href} className="credits-name">
                  {credit.name}
                </NewTabLink>
                <span className="credits-what">{credit.what}</span>
              </span>
              <span className="credits-licence">
                <span className="visually-hidden">Licence: </span>
                {credit.licence}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ))}

    <p className="credits-note">
      Text is set in your device&apos;s own system fonts, so nothing is
      downloaded to show it.
    </p>
  </div>
);
