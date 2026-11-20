import type { ReactNode } from "react";

export const NewTabLink = ({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) => (
  <a
    href={href}
    className={className}
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
    <span className="visually-hidden">, opens in a new tab</span>
  </a>
);
