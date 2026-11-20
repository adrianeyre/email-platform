import { useState } from "react";
import { requestJson } from "./api-client.js";
import { LogoMark } from "./icons.js";
import { SignedOutLayout, siteName } from "./layout.js";
import {
  FailureNotice,
  submitForm,
  TextField,
  useActionRunner,
} from "./ui-parts.js";

export const SignInPage = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, isBusy, runAction } = useActionRunner();
  return (
    <SignedOutLayout>
      <div className="sign-in-card">
        <LogoMark size={56} />
        <h1>Sign in to {siteName}</h1>
        <p className="muted">
          Design email templates, send them from your apps and see every email
          sent.
        </p>
        <form
          className="stack-form"
          onSubmit={submitForm(() => {
            runAction(
              () =>
                requestJson("/auth/sign-in", {
                  method: "POST",
                  body: { email, password },
                }),
              onSignedIn,
            );
          })}
        >
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
            isRequired
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            isRequired
          />
          <FailureNotice error={error} />
          <button
            type="submit"
            className="button button-primary"
            disabled={isBusy}
          >
            Sign in
          </button>
        </form>
      </div>
    </SignedOutLayout>
  );
};
