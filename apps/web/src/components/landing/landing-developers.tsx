import { IconCheck } from "@/components/ui/icons";
import { IconBox, IconBrowser, IconCode, IconLock, IconPhone, IconWebhook } from "./landing-icons";
import { Section, SectionHeading } from "./section";

const API_POINTS = [
  {
    Icon: IconCode,
    title: "A versioned surface",
    body: "/api/v1 covers articles, highlights, and collections, with cursor pagination. It's kept deliberately separate from the routes the web app uses, so a frontend refactor can't quietly break your script.",
  },
  {
    Icon: IconLock,
    title: "Personal access tokens",
    body: "Scoped read or read-and-write, shown once at creation, revocable any time. Its own rate-limit budget too, so a busy integration can't eat into the app's.",
  },
  {
    Icon: IconWebhook,
    title: "Signed webhooks",
    body: "article.created and highlight.created, delivered with an HMAC-SHA256 signature you can verify — and a delivery log you can actually look at when something doesn't arrive.",
  },
];

const PLATFORMS = [
  {
    Icon: IconBrowser,
    title: "Browser extension",
    body: "A Manifest V3 extension for Chrome and Firefox — one manifest, both browsers. Save the page you're on from the toolbar or the right-click menu, without switching tabs.",
  },
  {
    Icon: IconPhone,
    title: "Mobile app",
    body: "A React Native app on the same local-first core, with highlighting, collections, and the same SM-2 Daily Review — storing to the device rather than to a server by default.",
  },
  {
    Icon: IconBox,
    title: "Yours to run",
    body: "Dockerfiles for both services and a Compose file, rebuilt and smoke-tested against a real Postgres on every push. Point it at your own database and keep the whole library on your own box.",
  },
];

/** Tiny syntax colouring by hand -- three token colours is not worth a highlighter dependency. */
function Punct({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-faint">{children}</span>;
}
function Key({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-muted">{children}</span>;
}
function Str({ children }: { children: React.ReactNode }) {
  return <span className="text-accent">{children}</span>;
}

function CodePanel() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-4 py-2.5">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Read your own library
        </span>
        <span className="font-sans text-[11px] font-medium text-ink-faint">GET /api/v1/articles</span>
      </div>
      {/* overflow-x-auto, not wrapping: a wrapped curl invocation reads as a
          different command than the one you'd paste. */}
      <div className="overflow-x-auto px-4 py-4">
        <pre className="font-mono text-[12.5px] leading-relaxed text-ink">
          <code>
            <Punct>$ </Punct>curl <Str>$BOOKLET_URL/api/v1/articles</Str> {"\\"}
            {"\n"}
            {"    "}-H <Str>&quot;Authorization: Bearer $BOOKLET_TOKEN&quot;</Str>
            {"\n\n"}
            <Punct>{"{"}</Punct>
            {"\n"}
            {"  "}
            <Key>&quot;articles&quot;</Key>
            <Punct>: [{"{"}</Punct>
            {"\n"}
            {"    "}
            <Key>&quot;title&quot;</Key>
            <Punct>: </Punct>
            <Str>&quot;How to Do Great Work&quot;</Str>
            <Punct>,</Punct>
            {"\n"}
            {"    "}
            <Key>&quot;siteName&quot;</Key>
            <Punct>: </Punct>
            <Str>&quot;paulgraham.com&quot;</Str>
            <Punct>,</Punct>
            {"\n"}
            {"    "}
            <Key>&quot;readingProgress&quot;</Key>
            <Punct>: </Punct>
            <span className="text-ink">0.62</span>
            {"\n"}
            {"  "}
            <Punct>{"}"}],</Punct>
            {"\n"}
            {"  "}
            <Key>&quot;nextCursor&quot;</Key>
            <Punct>: </Punct>
            <span className="text-ink-muted">null</span>
            {"\n"}
            <Punct>{"}"}</Punct>
          </code>
        </pre>
      </div>
      <div className="border-t border-border px-4 py-3.5">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Save something from a script
        </p>
        <pre className="mt-2.5 overflow-x-auto font-mono text-[12.5px] leading-relaxed text-ink">
          <code>
            <Punct>$ </Punct>curl -X <Key>POST</Key> <Str>$BOOKLET_URL/api/v1/articles</Str> {"\\"}
            {"\n"}
            {"    "}-H <Str>&quot;Authorization: Bearer $BOOKLET_TOKEN&quot;</Str> {"\\"}
            {"\n"}
            {"    "}-d <Str>&apos;{"{"}&quot;url&quot;: &quot;https://example.com/essay&quot;{"}"}&apos;</Str>
          </code>
        </pre>
      </div>

      <div className="border-t border-border px-4 py-3.5">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          And when something changes
        </p>
        <pre className="mt-2.5 overflow-x-auto font-mono text-[12.5px] leading-relaxed text-ink">
          <code>
            <Key>POST</Key> /your-endpoint{"\n"}
            <Key>X-Booklet-Event:</Key> <Str>highlight.created</Str>
            {"\n"}
            <Key>X-Booklet-Signature:</Key> <Str>sha256=a3f1…</Str>
          </code>
        </pre>
      </div>
    </div>
  );
}

export function LandingDevelopers() {
  return (
    <Section id="developers">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
        <div className="flex flex-col gap-8 lg:col-span-6">
          <SectionHeading
            eyebrow="For tinkerers"
            title="A real API, not a data hostage situation"
            lead="Your reading is your data, so there's a documented way to get at it — the same integration surface a much larger product would ship, and none of it bolted on after the fact."
          />
          <ul className="flex flex-col gap-6">
            {API_POINTS.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-accent">
                  <Icon aria-hidden className="h-4.5 w-4.5" />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-sans text-[15px] font-semibold text-ink">{title}</h3>
                  <p className="text-pretty font-sans text-sm leading-relaxed text-ink-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-6">
          <CodePanel />
        </div>
      </div>

      <div className="landing-rule mt-20" />

      <div className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {PLATFORMS.map(({ Icon, title, body }) => (
          <div key={title} className="flex flex-col gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-accent">
              <Icon aria-hidden className="h-5 w-5" />
            </span>
            <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
            <p className="text-pretty font-sans text-sm leading-relaxed text-ink-muted">{body}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 flex items-start gap-2.5 font-sans text-xs leading-relaxed text-ink-faint">
        <IconCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <span>
          Every push runs typecheck and lint, unit and integration tests, two end-to-end Playwright
          suites — including real PDF and EPUB rendering and a genuine speech model download — and a
          Docker build with an API smoke test.
        </span>
      </p>
    </Section>
  );
}
