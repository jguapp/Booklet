import type { IconProps } from "@/components/ui/icons";

/**
 * Icons the landing page needs that the app itself never did -- the app's
 * own set (components/ui/icons.tsx) grew out of navigation and toolbar
 * needs, so it has no "webhook", "offline", or "browser extension" glyph
 * because nothing in the product UI ever labels those concepts with one.
 *
 * Same 20x20 / 1.5-stroke / currentColor contract as that file, so the two
 * sets are visually interchangeable and the landing page can mix them in a
 * single feature grid without the seam showing. Import the app's icon where
 * one already exists; only add here what genuinely doesn't.
 */
// aria-hidden by default, unlike the app's set: every icon on the landing
// page sits next to its own visible text label, so announcing an unnamed
// graphic before each one adds nothing but noise.
function base(props: IconProps) {
  return {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true,
    ...props,
  };
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 10h13M11.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCode(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m7 6-4 4 4 4M13 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWebhook(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="4.8" r="2.3" />
      <circle cx="4.8" cy="15" r="2.3" />
      <circle cx="15.2" cy="15" r="2.3" />
      <path d="M8.9 6.9 6 12.4M11.1 6.9 14 12.4M7.1 15h5.8" strokeLinecap="round" />
    </svg>
  );
}

/** Cloud with a slash through it -- "works with the network switched off". */
export function IconOffline(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M6.6 15.3h7a3.2 3.2 0 0 0 .5-6.4A4.6 4.6 0 0 0 5.7 7.4a3.9 3.9 0 0 0 .9 7.9Z"
        strokeLinejoin="round"
      />
      <path d="M3 3l14 14" strokeLinecap="round" />
    </svg>
  );
}

/** Browser window, for the extension. */
export function IconBrowser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="4" width="15" height="12" rx="1.6" />
      <path d="M2.5 7.6h15" />
      <path d="M5.2 5.8h.01M7.2 5.8h.01" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="2.5" width="8" height="15" rx="1.8" />
      <path d="M8.8 15.3h2.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconTag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.2 3.5H9l7.8 7.8-5.5 5.5L3.5 9V3.8Z" strokeLinejoin="round" />
      <circle cx="6.3" cy="6.6" r="1.15" />
    </svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="4.8" width="15" height="10.4" rx="1.6" />
      <path d="m3.6 6.2 6.4 5 6.4-5" strokeLinejoin="round" />
    </svg>
  );
}

/** Half-filled circle -- the universal "theme / contrast" mark. */
export function IconSwatch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 0 0 14Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Scanner frame, for OCR. */
export function IconScan(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M3.5 7V5A1.5 1.5 0 0 1 5 3.5h2M16.5 7V5A1.5 1.5 0 0 0 15 3.5h-2M3.5 13v2A1.5 1.5 0 0 0 5 16.5h2M16.5 13v2a1.5 1.5 0 0 1-1.5 1.5h-2"
        strokeLinecap="round"
      />
      <path d="M3 10h14" strokeLinecap="round" />
    </svg>
  );
}

export function IconExport(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3v8.5M6.6 8.1 10 11.5l3.4-3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12.8v2.2a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-2.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4.3" y="8.5" width="11.4" height="8.2" rx="1.6" />
      <path d="M7 8.5V6.6a3 3 0 0 1 6 0v1.9" strokeLinecap="round" />
    </svg>
  );
}

/** Stacked sheets, for nested collections. */
export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3 3 6.4 10 9.8l7-3.4L10 3Z" strokeLinejoin="round" />
      <path d="m3 10.6 7 3.4 7-3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 14.2 7 3.4 7-3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Sparkle, for the filter-defined ("smart") collections. */
export function IconSparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M10 2.8v3.1M10 14.1v3.1M2.8 10h3.1M14.1 10h3.1M5.2 5.2l2.2 2.2M12.6 12.6l2.2 2.2M14.8 5.2l-2.2 2.2M7.4 12.6l-2.2 2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Shipping crate, for "run it yourself" -- container-shaped without being a Docker logo. */
export function IconBox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6.6 10 3l7 3.6v6.8L10 17l-7-3.6V6.6Z" strokeLinejoin="round" />
      <path d="m3 6.6 7 3.6 7-3.6M10 10.2V17" strokeLinejoin="round" />
    </svg>
  );
}

export function IconHeadphones(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12.2V10a6 6 0 0 1 12 0v2.2" strokeLinecap="round" />
      <rect x="2.4" y="11.6" width="3.6" height="5.2" rx="1.5" />
      <rect x="14" y="11.6" width="3.6" height="5.2" rx="1.5" />
    </svg>
  );
}
