import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, ...props };
}

export function IconLibrary(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 3.5h9a1 1 0 0 1 1 1V16l-2-1-2 1-2-1-2 1-2-1V3.5Z" strokeLinejoin="round" />
      <path d="M7 7h4M7 10h4" strokeLinecap="round" />
    </svg>
  );
}

export function IconHighlights(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 14 8-8 2 2-8 8H6v-2Z" strokeLinejoin="round" />
      <path d="M4 17h5" strokeLinecap="round" />
    </svg>
  );
}

export function IconResurface(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4 10a6 6 0 0 1 10.2-4.2M16 10a6 6 0 0 1-10.2 4.2"
        strokeLinecap="round"
      />
      <path d="M14.5 3v3h-3M5.5 17v-3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconStar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M10 3.2 12.1 7.5l4.7.7-3.4 3.3.8 4.7L10 14l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7 2.1-4.3Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="2.6" />
      <path
        d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3 5.2 5.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 17H4.8a.8.8 0 0 1-.8-.8V3.8a.8.8 0 0 1 .8-.8H8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13.5 16.5 10 13 6.5M7.5 10h9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m16 16-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v1.2a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8V14" strokeLinecap="round" />
    </svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M8.5 11.5 11.5 8.5M8 5.5 9.6 3.9a2.6 2.6 0 0 1 3.7 3.7L11.7 9M12 14.5l-1.6 1.6a2.6 2.6 0 0 1-3.7-3.7L8.3 11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12.5 4.5-5 5.5 5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFileText(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 2.5h6l3 3v12H6v-15Z" strokeLinejoin="round" />
      <path d="M8 9h5M8 12h5M8 6h2" strokeLinecap="round" />
    </svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4 4.5c1.8-.7 4-.7 6 .5 2-1.2 4.2-1.2 6-.5v11c-1.8-.7-4-.7-6 .5-2-1.2-4.2-1.2-6-.5v-11Z"
        strokeLinejoin="round"
      />
      <path d="M10 5v11" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3a11 11 0 0 1 0 14 11 11 0 0 1 0-14Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 6h11M8 6V4.5h4V6M8.5 9v5M11.5 9v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 6 6 16h8l.5-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 4.5h13a1 1 0 0 1 1 1V7h-15V5.5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M4 7h12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" strokeLinejoin="round" />
      <path d="M8 10h4" strokeLinecap="round" />
    </svg>
  );
}

export function IconInbox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4 4.5h12l1.5 6.5v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V11L4 4.5Z"
        strokeLinejoin="round"
      />
      <path d="M2.5 11h4l1 2h5l1-2h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M3 5.5a1 1 0 0 1 1-1h3.8l1.4 1.6H16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 4.5h2v11h-2zM11.5 4.5h2v11h-2z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="m13 4 3 3-8.5 8.5L4 16l.5-3.5L13 4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
