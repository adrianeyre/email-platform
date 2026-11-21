import { appearanceStorageKey } from "../appearance.js";

const browserStorage = [
  {
    name: "__Host-session",
    kind: "Cookie",
    purpose:
      "Keeps you signed in. HttpOnly and SameSite=Lax, so the page itself can't read it. Over HTTPS it is Secure, and its __Host- prefix means no subdomain and no plain-HTTP service on this host name can set it; over plain HTTP, which can't carry the prefix, it is named session.",
    lasts: "30 days, or until you sign out",
  },
  {
    name: appearanceStorageKey,
    kind: "Local storage",
    purpose:
      "The colour mode and theme chosen in Settings, so every page opens in them.",
    lasts: "Until you clear this site's data",
  },
] as const;

export const CookiePolicy = () => (
  <>
    <p className="policy-updated">Last updated: November 2026</p>

    <h3>Strictly necessary only</h3>
    <p>
      Email Platform sets one cookie, which keeps you signed in, and remembers
      the colour mode and theme you choose in browser storage. Both are needed
      for the app to work or to remember a choice you made, so neither needs
      your consent. Nothing is used for analytics, tracking or advertising, and
      no other site sets anything.
    </p>

    <h3>What is stored</h3>
    <table className="storage-table">
      <caption>Cookies and browser storage Email Platform uses</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Type</th>
          <th scope="col">Purpose</th>
          <th scope="col">How long</th>
        </tr>
      </thead>
      <tbody>
        {browserStorage.map(({ name, kind, purpose, lasts }) => (
          <tr key={name}>
            <th scope="row">
              <code>{name}</code>
            </th>
            <td data-heading="Type">{kind}</td>
            <td data-heading="Purpose">{purpose}</td>
            <td data-heading="How long">{lasts}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <h3>Removing them</h3>
    <p>
      Signing out removes the sign-in cookie. To remove the saved appearance,
      clear this site&apos;s data in your browser; the app then follows your
      device&apos;s light or dark setting with the Sky theme.
    </p>
  </>
);
