import { useEffect, useRef, useState } from "react";
import { GitHubIcon } from "../icons.js";
import { ModalDialog } from "../modal-dialog.js";
import { AccessibilityStatement } from "./accessibility-statement.js";
import { CookiePolicy } from "./cookie-policy.js";
import { Credits } from "./credits.js";
import { releasesUrl, repositoryUrl } from "./links.js";
import { NewTabLink } from "./new-tab-link.js";
import { PrivacyPolicy } from "./privacy-policy.js";
import { TermsAndConditions } from "./terms-and-conditions.js";

const footerDialogs = {
  credits: { label: "Credits", closeLabel: "Close credits", Body: Credits },
  privacy: {
    label: "Privacy Policy",
    closeLabel: "Close privacy policy",
    Body: PrivacyPolicy,
  },
  terms: {
    label: "Terms and Conditions",
    closeLabel: "Close terms and conditions",
    Body: TermsAndConditions,
  },
  cookies: {
    label: "Cookie Policy",
    closeLabel: "Close cookie policy",
    Body: CookiePolicy,
  },
  accessibility: {
    label: "Accessibility",
    closeLabel: "Close accessibility statement",
    Body: AccessibilityStatement,
  },
} as const;

type FooterDialog = keyof typeof footerDialogs;

const footerDialogKeys: readonly FooterDialog[] = [
  "credits",
  "privacy",
  "terms",
  "cookies",
  "accessibility",
];

const footerHeightProperty = "--site-footer-height";

export const SiteFooter = () => {
  const [openDialog, setOpenDialog] = useState<FooterDialog | null>(null);
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const footer = footerRef.current;
    if (footer === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const rootStyle = document.documentElement.style;
    const observer = new ResizeObserver(() => {
      rootStyle.setProperty(
        footerHeightProperty,
        `${String(footer.offsetHeight)}px`,
      );
    });
    observer.observe(footer);
    return () => {
      observer.disconnect();
      rootStyle.removeProperty(footerHeightProperty);
    };
  }, []);

  return (
    <footer ref={footerRef} className="site-footer">
      <nav aria-label="About Email Platform">
        <ul>
          <li>
            <NewTabLink href={repositoryUrl} className="site-footer-link">
              <GitHubIcon />
              Website design
              <span className="visually-hidden">, source on GitHub</span>
            </NewTabLink>
          </li>
          <li>
            <NewTabLink href={releasesUrl} className="site-footer-link">
              Version: {__APP_VERSION__}
              <span className="visually-hidden">, changelog</span>
            </NewTabLink>
          </li>
          {footerDialogKeys.map((key) => (
            <li key={key}>
              <button
                type="button"
                className="site-footer-link"
                aria-haspopup="dialog"
                onClick={() => {
                  setOpenDialog(key);
                }}
              >
                {footerDialogs[key].label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {footerDialogKeys.map((key) => {
        const { label, closeLabel, Body } = footerDialogs[key];
        return (
          <ModalDialog
            key={key}
            isOpen={openDialog === key}
            onClose={() => {
              setOpenDialog(null);
            }}
            title={label}
            closeLabel={closeLabel}
          >
            <Body />
          </ModalDialog>
        );
      })}
    </footer>
  );
};
