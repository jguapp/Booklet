/**
 * The allowlist for rendered article HTML.
 *
 * This module holds no sanitizer -- DOMPurify needs a DOM, and the two
 * places that need one get it differently (a real `window` in the browser,
 * jsdom on the server). What it holds is the *policy*, so those two cannot
 * drift into disagreeing about what is safe. A server that stores more than
 * the client will render is merely wasteful; a client that renders more than
 * the server checked is a hole.
 *
 * ## Why this exists at all
 *
 * `article-content.tsx` renders extracted article HTML with
 * `dangerouslySetInnerHTML`, and until this was added, nothing anywhere
 * sanitized it.
 *
 * The tempting assumption is that Readability already handles it. It does
 * not, and it does not claim to -- it is a *readability* extractor, not a
 * sanitizer. Verified by running this repo's own installed
 * @mozilla/readability over a crafted page: it strips `<script>`,
 * `<iframe>` and `javascript:` hrefs, and passes these straight through:
 *
 *     <img src="x" onerror="...">      SURVIVES
 *     <svg onload="...">               SURVIVES
 *     <details ontoggle="...">         SURVIVES
 *
 * So saving a link -- the single thing this product exists to do -- ran the
 * sender's JavaScript on the reader's origin. With the access token in
 * localStorage (see apps/web/src/lib/auth/session.ts), that is not a defaced
 * paragraph, it is account takeover: the payload can mint a personal access
 * token or a podcast feed URL, both of which outlive a password change.
 *
 * ## Why an allowlist and not a denylist
 *
 * Enumerating dangerous things is a losing game -- the list above was found
 * in one afternoon and is certainly incomplete, because HTML keeps growing
 * new attributes that execute. Enumerating the small set of tags an
 * *article* legitimately needs is a bounded problem, and anything invented
 * later fails closed.
 */

/**
 * Everything a extracted article legitimately needs to render, and nothing
 * else. No <form>, no <input>, no <object>, no <embed>, no <style> (which
 * can exfiltrate via attribute selectors and background: url()), and no
 * <link>.
 */
export const ARTICLE_ALLOWED_TAGS = [
  "p", "br", "hr", "span", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup", "mark", "small",
  "blockquote", "q", "cite",
  "ul", "ol", "li", "dl", "dt", "dd",
  "a", "img", "figure", "figcaption", "picture", "source",
  "code", "pre", "kbd", "samp", "var",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "abbr", "time", "article", "section", "aside", "header", "footer", "main", "nav",
] as const;

/**
 * No `style` attribute: it is a script vector in older engines and an
 * exfiltration vector in current ones, and the reader deliberately imposes
 * its own typography anyway (see the Tailwind classes on the container in
 * article-content.tsx), so publisher styling is unwanted even when benign.
 *
 * No `id`, because a duplicate id from article content can hijack the app's
 * own label/aria wiring. No `class` either -- extraction output is styled by
 * descendant selectors from the container, never by the publisher's classes.
 *
 * `srcset`/`sizes` are allowed so responsive images keep working; DOMPurify
 * validates their URLs with the same scheme rules as `src`.
 */
export const ARTICLE_ALLOWED_ATTRS = [
  "href", "src", "srcset", "sizes", "alt", "title",
  "width", "height", "loading", "decoding",
  "colspan", "rowspan", "scope", "headers",
  "datetime", "cite", "lang", "dir",
  "type", "media",
] as const;

/**
 * The DOMPurify configuration both call sites pass.
 *
 * `ALLOW_DATA_ATTR: false` matters more than it looks: extraction inlines
 * images as `data:` URIs, so `data:` has to remain a valid *scheme* for
 * `src` -- but `data-*` *attributes* are a different thing entirely and are
 * a common way to smuggle payloads to a script that reads them later.
 *
 * `FORBID_TAGS`/`FORBID_ATTR` are redundant against the allowlist and are
 * listed anyway, so that a future well-meaning addition to
 * ARTICLE_ALLOWED_TAGS cannot quietly re-admit them.
 *
 * Deliberately NOT `as const`, unlike the two lists above. DOMPurify's
 * `Config` types these fields as mutable `string[]`, and a readonly tuple is
 * not assignable to one -- so freezing this object for tidiness makes it
 * unusable by the only two callers it exists for.
 */
export const ARTICLE_SANITIZE_CONFIG: {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  ALLOW_DATA_ATTR: boolean;
  ALLOW_ARIA_ATTR: boolean;
  ALLOW_UNKNOWN_PROTOCOLS: boolean;
  FORBID_TAGS: string[];
  FORBID_ATTR: string[];
  KEEP_CONTENT: boolean;
  RETURN_DOM: false;
  RETURN_DOM_FRAGMENT: false;
} = {
  ALLOWED_TAGS: [...ARTICLE_ALLOWED_TAGS],
  ALLOWED_ATTR: [...ARTICLE_ALLOWED_ATTRS],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "base"],
  FORBID_ATTR: ["style", "id", "class", "srcdoc", "formaction", "xlink:href", "ping"],
  // Keep the content of a stripped tag where it is text worth reading; drop
  // the tag itself. A <font> wrapper losing its tag should not lose the
  // sentence inside it.
  KEEP_CONTENT: true,
  // Return a string, matching what the callers store and render.
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
};

/**
 * Vectors that must never survive sanitization, shared so the api and web
 * test suites assert the identical set. Adding one here fails both until
 * both are fixed, which is the point.
 *
 * Every entry is a real thing that reached the reader before this existed,
 * or a near neighbour of one.
 */
export const XSS_PROBES: { name: string; html: string; mustNotContain: string }[] = [
  { name: "img onerror", html: '<img src="x" onerror="alert(1)">', mustNotContain: "onerror" },
  { name: "svg onload", html: '<svg onload="alert(1)"></svg>', mustNotContain: "onload" },
  { name: "details ontoggle", html: '<details open ontoggle="alert(1)"></details>', mustNotContain: "ontoggle" },
  { name: "body onload", html: '<body onload="alert(1)">', mustNotContain: "onload" },
  { name: "script tag", html: "<script>alert(1)</script>", mustNotContain: "<script" },
  { name: "iframe", html: '<iframe src="https://evil.example"></iframe>', mustNotContain: "<iframe" },
  { name: "javascript: href", html: '<a href="javascript:alert(1)">x</a>', mustNotContain: "javascript:" },
  { name: "form action", html: '<form action="https://evil.example"><input name="p"></form>', mustNotContain: "<form" },
  { name: "style tag", html: "<style>body{background:url(https://evil.example)}</style>", mustNotContain: "<style" },
  { name: "style attribute", html: '<p style="background:url(https://evil.example)">x</p>', mustNotContain: "style=" },
  { name: "object", html: '<object data="https://evil.example"></object>', mustNotContain: "<object" },
  { name: "embed", html: '<embed src="https://evil.example">', mustNotContain: "<embed" },
  { name: "base href", html: '<base href="https://evil.example/">', mustNotContain: "<base" },
  { name: "meta refresh", html: '<meta http-equiv="refresh" content="0;url=https://evil.example">', mustNotContain: "<meta" },
  { name: "srcdoc", html: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>', mustNotContain: "srcdoc" },
  { name: "formaction", html: '<button formaction="javascript:alert(1)">x</button>', mustNotContain: "formaction" },
  { name: "input autofocus onfocus", html: '<input autofocus onfocus="alert(1)">', mustNotContain: "onfocus" },
  { name: "a ping", html: '<a href="https://ok.example" ping="https://evil.example">x</a>', mustNotContain: "ping=" },
  { name: "data attribute", html: '<p data-payload="alert(1)">x</p>', mustNotContain: "data-payload" },
  { name: "marquee onstart", html: '<marquee onstart="alert(1)">x</marquee>', mustNotContain: "onstart" },
];

/**
 * What must survive. A sanitizer that passes every probe above by returning
 * the empty string is not a fix, and this is what stops that being how the
 * tests go green.
 */
export const SANITIZE_MUST_KEEP: { name: string; html: string; mustContain: string }[] = [
  { name: "paragraph text", html: "<p>Hello world</p>", mustContain: "Hello world" },
  { name: "link href", html: '<a href="https://example.com/x">link</a>', mustContain: "https://example.com/x" },
  { name: "image src", html: '<img src="https://example.com/a.png" alt="a">', mustContain: "https://example.com/a.png" },
  { name: "inlined data: image", html: '<img src="data:image/png;base64,iVBORw0KGgo=" alt="a">', mustContain: "data:image/png;base64" },
  { name: "heading", html: "<h2>A heading</h2>", mustContain: "<h2>" },
  { name: "blockquote", html: "<blockquote><p>quoted</p></blockquote>", mustContain: "<blockquote>" },
  { name: "code block", html: "<pre><code>const x = 1;</code></pre>", mustContain: "const x = 1;" },
  { name: "table cell", html: "<table><tr><td>cell</td></tr></table>", mustContain: "cell" },
  { name: "figure caption", html: "<figure><figcaption>cap</figcaption></figure>", mustContain: "cap" },
  { name: "emphasis", html: "<p><em>emphasis</em> and <strong>strong</strong></p>", mustContain: "<em>" },
];
