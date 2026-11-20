import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { requestJson } from "./api-client.js";
import {
  ChevronDownIcon,
  FooterIcon,
  HeaderIcon,
  CogIcon,
  KeyIcon,
  LogoMark,
  LogsIcon,
  SendIcon,
  SignOutIcon,
  SlidersIcon,
  TemplatesIcon,
  UsersIcon,
} from "./icons.js";
import { navigateTo } from "./router.js";
import { SiteFooter } from "./site-footer/site-footer.js";
import { AppLink } from "./ui-parts.js";

export const siteName = "Email Platform";

/** Every browser tab title starts with this, so the app's tabs group together. */
export const titlePrefix = "Email Template - ";

/** The browser tab title for a page. */
export const pageTitle = (title: string): string => `${titlePrefix}${title}`;

const navigationItems = [
  { label: "Templates", href: "/templates", Icon: TemplatesIcon },
  { label: "Headers", href: "/headers", Icon: HeaderIcon },
  { label: "Footers", href: "/footers", Icon: FooterIcon },
  { label: "Configuration", href: "/configurations", Icon: SlidersIcon },
  { label: "Logs", href: "/logs", Icon: LogsIcon },
  { label: "API keys", href: "/api-keys", Icon: KeyIcon },
  { label: "Users", href: "/users", Icon: UsersIcon },
  { label: "Delivery", href: "/delivery", Icon: SendIcon },
] as const;

const signOut = async () => {
  await requestJson("/auth/sign-out", { method: "POST" });
  window.location.assign("/");
};

const isCurrentSection = (pathname: string, href: string): boolean =>
  pathname.startsWith(href) || (href === "/templates" && pathname === "/");

const initialsOf = (email: string) =>
  (email.split("@")[0] ?? "")
    .split(/[._-]+/u)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

/** The account menu: a menu button that opens Settings and Sign out (WAI-ARIA menu button pattern). */
export const AccountMenu = ({ email }: { email: string }) => {
  const [isOpen, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusWantedRef = useRef<"first" | "last" | undefined>(undefined);

  const items = () => [
    ...(wrapperRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    ) ?? []),
  ];

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const wanted = focusWantedRef.current ?? "first";
    focusWantedRef.current = undefined;
    const list = items();
    (wanted === "first" ? list[0] : list.at(-1))?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        wrapperRef.current?.contains(event.target) !== true
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [isOpen]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = items();
    const index = list.findIndex((item) => item === document.activeElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="account-menu" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => {
          setOpen(!isOpen);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusWantedRef.current =
              event.key === "ArrowDown" ? "first" : "last";
            setOpen(true);
          }
        }}
      >
        <span className="avatar" aria-hidden="true">
          {initialsOf(email)}
        </span>
        <span className="account-email">{email}</span>
        <span className="visually-hidden">, account menu</span>
        <ChevronDownIcon />
      </button>
      <ul
        id={menuId}
        role="menu"
        aria-label="Account"
        className="account-dropdown"
        hidden={!isOpen}
        onKeyDown={onMenuKeyDown}
      >
        <li role="none" className="account-dropdown-email">
          <span className="muted small">Signed in as</span>
          <strong>{email}</strong>
        </li>
        <li role="none">
          <a
            role="menuitem"
            href="/settings"
            tabIndex={-1}
            onClick={(event) => {
              event.preventDefault();
              close(false);
              navigateTo("/settings");
            }}
          >
            <CogIcon />
            Settings
          </a>
        </li>
        <li role="none">
          <button
            role="menuitem"
            type="button"
            tabIndex={-1}
            onClick={() => {
              close(false);
              void signOut();
            }}
          >
            <SignOutIcon />
            Sign out
          </button>
        </li>
      </ul>
    </div>
  );
};

/** Sets the page title, and after moving to a new page puts focus on its main region for screen readers. */
const usePageAnnouncement = (title: string, pathname: string) => {
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRef = useRef(true);
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
  useEffect(() => {
    if (isFirstRef.current) {
      isFirstRef.current = false;
      return;
    }
    const main = mainRef.current;
    const heading = main?.querySelector<HTMLElement>("h1");
    if (heading !== null && heading !== undefined) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } else {
      main?.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return mainRef;
};

export const Layout = ({
  email,
  pathname,
  title,
  children,
}: {
  email: string;
  pathname: string;
  title: string;
  children: ReactNode;
}) => {
  const mainRef = usePageAnnouncement(title, pathname);
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <AppLink href="/" className="brand">
          <LogoMark size={32} />
          <span>{siteName}</span>
        </AppLink>
        <AccountMenu email={email} />
      </header>
      <div className="shell">
        <nav className="side-nav" aria-label="Main">
          <ul>
            {navigationItems.map(({ href, label, Icon }) => (
              <li key={href}>
                <AppLink
                  href={href}
                  isCurrent={isCurrentSection(pathname, href)}
                >
                  <Icon />
                  <span>{label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" ref={mainRef} tabIndex={-1}>
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
};

/** The frame for pages before signing in: brand, content and the same footer. */
export const SignedOutLayout = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    document.title = pageTitle("Sign in");
  }, []);
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" tabIndex={-1} className="signed-out">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
};
