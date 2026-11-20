export const PrivacyPolicy = () => (
  <>
    <p className="policy-updated">Last updated: November 2026</p>

    <h3>Who looks after your data</h3>
    <p>
      Email Platform is self-hosted: whoever runs this copy of it, on their own
      server, decides what it holds and who can sign in, and is responsible for
      it. There is no analytics, no tracking and no advertising, and the app
      itself loads nothing from other sites.
    </p>

    <h3>Who has an account</h3>
    <p>
      Nobody can sign up. The first User is made on the server, and every User
      can add others. Applications send email with an API key instead of an
      account.
    </p>

    <h3>What it keeps about Users</h3>
    <ul>
      <li>Your email address, and when your account was made.</li>
      <li>
        Your password, as a one-way scrypt hash, never the password itself.
      </li>
      <li>Each sign-in, by a SHA-256 hash of its token, and when it ends.</li>
    </ul>

    <h3>What it keeps about email</h3>
    <ul>
      <li>
        Templates: their names, subjects, bodies, variables, sample variables
        and designs.
      </li>
      <li>
        A log row for every email: the sender, the recipients (to, cc, bcc and
        reply-to), the rendered subject and bodies, its status, the
        provider&apos;s message ID and any error. Attachments are kept only
        until the email is sent or has failed.
      </li>
      <li>
        API keys, by name and a SHA-256 hash of the key, and Settings: the SMTP
        provider, with its password encrypted with AES-256-GCM, the default from
        address and the log retention.
      </li>
    </ul>

    <h3>Who else sees it</h3>
    <ul>
      <li>
        <strong>The SMTP provider</strong> chosen in Settings delivers each
        email, so it sees the addresses and content of every email sent.
      </li>
      <li>
        <strong>The backup storage</strong> chosen by whoever runs the app holds
        a nightly copy of the database, encrypted with age before it leaves the
        server, so the storage provider cannot read it.
      </li>
      <li>
        <strong>Sites a template links to.</strong> When a template uses a web
        font or an image from another site, such as a logo, the preview and the
        designer load it from that site, which sees your IP address. So do the
        mail apps of the people the email is sent to.
      </li>
    </ul>
    <p>Nothing is sold or shared with anyone else.</p>

    <h3>How long it is kept</h3>
    <ul>
      <li>
        A sign-in lasts 30 days, or until you sign out or change your password.
      </li>
      <li>
        Log rows are deleted after the retention period in Settings, 90 days
        unless it is changed.
      </li>
      <li>
        Everything else is kept until it is deleted. Deleted data stays in the
        encrypted backups until they expire, 14 days unless the server is set
        otherwise.
      </li>
    </ul>

    <h3>Your rights</h3>
    <p>
      To see, correct or delete anything this app holds about you, ask whoever
      runs it. Under UK data protection law you can also complain to the
      Information Commissioner&apos;s Office.
    </p>
  </>
);
