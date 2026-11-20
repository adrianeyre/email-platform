import type { ReactNode } from "react";

/** Line icons in the style of Lucide (ISC licence), drawn inline so they follow the text colour. */
const Icon = ({
  children,
  size = 18,
}: {
  children: ReactNode;
  size?: number;
}) => (
  <svg
    className="icon"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

interface IconProps {
  size?: number;
}

export const LogoMark = ({ size = 32 }: IconProps) => (
  <svg
    className="logo-mark"
    viewBox="0 0 64 64"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="64" height="64" rx="16" fill="var(--color-accent)" />
    <path
      d="M14 22.5a4.5 4.5 0 0 1 4.5-4.5h27a4.5 4.5 0 0 1 4.5 4.5v19a4.5 4.5 0 0 1-4.5 4.5h-27A4.5 4.5 0 0 1 14 41.5z"
      fill="none"
      stroke="var(--color-accent-text)"
      strokeWidth="4"
      strokeLinejoin="round"
    />
    <path
      d="m16 21 16 12.5L48 21"
      fill="none"
      stroke="var(--color-accent-text)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const TemplatesIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 21V9" />
  </Icon>
);
export const LogsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </Icon>
);
export const KeyIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
  </Icon>
);
export const UsersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);
export const SendIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </Icon>
);
export const CogIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const SignOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Icon>
);
export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MonitorIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);
export const PhoneIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </Icon>
);
export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Icon>
);
export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
  </Icon>
);
export const UndoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </Icon>
);
export const RedoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
  </Icon>
);
export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);
export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="8" y="8" width="14" height="14" rx="2" />
    <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
  </Icon>
);
export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 12 7-7 7 7M12 19V5" />
  </Icon>
);
export const ArrowDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </Icon>
);
export const GripIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="5" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="19" r="1" />
    <circle cx="15" cy="5" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="19" r="1" />
  </Icon>
);
export const LinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);
export const AlignLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 6H3M15 12H3M17 18H3" />
  </Icon>
);
export const AlignCenterIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 6H3M17 12H7M19 18H5" />
  </Icon>
);
export const AlignRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 6H3M21 12H9M21 18H7" />
  </Icon>
);
export const AlignJustifyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Icon>
);
export const ListIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);
export const ListOrderedIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </Icon>
);
export const QuoteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h1c0 2-1 4-3 4M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h1c0 2-1 4-3 4" />
  </Icon>
);
export const EraserIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21M22 21H7M5 11l9 9" />
  </Icon>
);
export const TextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7V4h16v3M9 20h6M12 4v16" />
  </Icon>
);
export const HeadingIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 12h12M6 20V4M18 20V4" />
  </Icon>
);
export const ButtonIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="7" width="18" height="10" rx="3" />
    <path d="M9 12h6" />
  </Icon>
);
export const ImageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </Icon>
);
export const ColumnsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 3v18" />
  </Icon>
);
export const DividerIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 12h18" />
  </Icon>
);
export const SpacerIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
  </Icon>
);
export const SocialsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
  </Icon>
);
export const CodeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Icon>
);
export const GitHubIcon = ({ size = 18 }: IconProps) => (
  <svg
    className="icon"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.29-.52-1.46.11-3.05 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.59.23 2.76.11 3.05.75.81 1.2 1.84 1.2 3.1 0 4.43-2.7 5.41-5.26 5.69.42.36.8 1.08.8 2.18v3.23c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
  </svg>
);
export const HeaderIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
  </Icon>
);
export const SlidersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </Icon>
);
export const FooterIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 15h18" />
  </Icon>
);
