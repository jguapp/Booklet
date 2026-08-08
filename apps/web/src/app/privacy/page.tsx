import type { Metadata } from "next";
import Link from "next/link";
import { Blank, LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Booklet stores, what sharing exposes, and how to delete an account.",
};

/**
 * The privacy policy (#174).
 *
 * Written against `apps/api/prisma/schema.prisma` rather than from a
 * template, because a policy that lists categories ("usage data", "device
 * information") tells a reader nothing they could check. Everything below
 * names the actual thing stored, and anything the project has not decided --
 * who operates it, where, how to reach them -- is left as a visible blank
 * instead of being invented.
 */
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy" updated={<Blank>DATE THIS WAS PUBLISHED</Blank>}>
      <p className="rounded-sm border border-border bg-surface px-4 py-3">
        <strong>This document is not finished.</strong> The highlighted blanks below are the parts that depend on who
        operates this service, which has not been decided. Everything else describes what the software actually does
        today, and was written from the database schema rather than from a template.
      </p>

      <section>
        <h2>Who this is about</h2>
        <p className="mt-2">
          Booklet is a reading app: it saves articles and files, shows them without the surrounding page, and keeps
          the passages you highlight. It is operated by <Blank>OPERATOR NAME</Blank>, at{" "}
          <Blank>OPERATOR ADDRESS</Blank>. Questions about anything here go to <Blank>CONTACT EMAIL</Blank>.
        </p>
      </section>

      <section>
        <h2>You can use Booklet without an account</h2>
        <p className="mt-2">
          Signed out, everything — saved articles, highlights, notes, collections, reading position — is stored in
          your browser&rsquo;s IndexedDB on that device, and none of it is sent to the server. An account exists to
          sync across devices; creating one uploads the local library to the server so the other devices can see it.
        </p>
      </section>

      <section>
        <h2>What an account stores</h2>
        <p className="mt-2">This is the full list, by what it is for.</p>
        <ul>
          <li>
            <strong>The account itself:</strong> your email address, a scrypt hash of your password (never the
            password), your display name if you set one, when your email was verified, and your Kindle address if you
            entered one. Also two counters used to slow down password guessing: how many sign-ins have failed
            recently and when the last one was.
          </li>
          <li>
            <strong>Sessions:</strong> for each signed-in device, a hash of the refresh token, the browser&rsquo;s
            user-agent string, the IP address the session was created from, and its expiry. These are what the
            &ldquo;signed-in devices&rdquo; list in Settings shows.
          </li>
          <li>
            <strong>Saved articles:</strong> the URL, a normalized copy of it used to spot duplicates, title, author,
            site name, excerpt, a cover thumbnail, and{" "}
            <strong>the extracted text and HTML of the page itself</strong> — the readable article, stored in full so
            it stays readable if the original moves or disappears. For a PDF or EPUB you upload, the file is kept on
            the server as well.
          </li>
          <li>
            <strong>Reading behaviour:</strong> how far through each article you are, how many seconds you have
            actively spent reading it, and a per-day total of reading seconds. The last one is what draws the
            activity heatmap on the stats page.
          </li>
          <li>
            <strong>Highlights and notes:</strong> the passage text, where it sits in the document, its colour, any
            note you attached, any recall prompt you wrote, and the spaced-repetition state behind Daily Review
            (when it was last shown, whether you marked it remembered or forgotten, and when it is next due).
          </li>
          <li>
            <strong>Organisation:</strong> collections (name, colour, nesting, and the saved-search filter for smart
            collections) and free-form tags on articles.
          </li>
          <li>
            <strong>Things you connect:</strong> RSS subscriptions (feed URL and title), personal API tokens (a name,
            a hash of the token, its scopes, when it was last used), webhooks (endpoint URL, which events, a signing
            secret) and a short log of recent webhook deliveries.
          </li>
          <li>
            <strong>Generated audio:</strong> if you use read-aloud or the podcast feed, the synthesized audio for an
            article is stored on the server as a file, with the voice and speed it was generated at.
          </li>
          <li>
            <strong>Sign-in links:</strong> hashes of password-reset and email-verification tokens, with their
            expiry. Only hashes — a copy of the database is not enough to reset your password.
          </li>
          <li>
            <strong>OAuth:</strong> if you sign in with Google or GitHub, the provider name and your account id at
            that provider. Booklet never receives your password for those accounts.
          </li>
        </ul>
      </section>

      <section>
        <h2>What a shared page exposes</h2>
        <p className="mt-2">
          Sharing an article or a collection creates a page at <code>/s/&lt;slug&gt;</code> that anyone with the link
          can open, with no account and no sign-in. The slug is long and random, so the page is unlisted rather than
          secret: it is not linked from anywhere and is marked no-index, but the link is the only thing protecting it,
          so anyone you send it to can send it on.
        </p>
        <p className="mt-2">That page shows:</p>
        <ul>
          <li>your highlighted passages and the notes attached to them;</li>
          <li>the source article&rsquo;s title, author, site name and URL.</li>
        </ul>
        <p className="mt-2">
          It does not show your email address, your name, your account id, the rest of your library, the
          article&rsquo;s extracted body text, your tags, your reading progress, or when you saved it. Booklet counts
          how many times each shared page has been viewed; that count is visible only to you.
        </p>
        <p className="mt-2">
          Revoking a share deletes the record entirely rather than flipping a flag, so the old link stops working and
          cannot be turned back on. Re-sharing produces a different link.
        </p>
      </section>

      <section>
        <h2>The community highlights opt-in</h2>
        <p className="mt-2">
          Booklet can show new readers passages that several people have highlighted. Your highlights are only
          eligible if <strong>both</strong> of these are true: the highlight is on a page you have already shared
          publicly, and you have separately turned on the &ldquo;contribute to community highlights&rdquo; setting,
          which is off by default. Publishing one page for a friend is not treated as agreement to the second, and
          the second does not reach anything private.
        </p>
        <p className="mt-2">
          What that aggregate stores is a normalized copy of the passage text, a hash of it, the source
          title/author/URL, and a count of how many distinct accounts highlighted it. It stores no user ids and no
          highlight ids — there is no way to get from a row in it back to a person, by construction rather than by
          policy. Nothing appears there until at least three separate accounts have highlighted the same passage.
        </p>
        <p className="mt-2">
          The aggregate is rebuilt from scratch rather than counted up incrementally, which is what makes withdrawal
          work: turning the setting off, unsharing the page, deleting the highlight or deleting your account all
          remove your contribution at the next rebuild.
        </p>
      </section>

      <section>
        <h2>Other services your data can touch</h2>
        <ul>
          <li>
            <strong>The sites you save.</strong> Saving a URL makes Booklet&rsquo;s server fetch that page, so the
            publisher sees a request from the server (not from you). Images that are too large to inline stay
            pointing at the original site, so opening that article later loads them from there.
          </li>
          <li>
            <strong>Open Library</strong> — queried for book metadata and cover images when you save a book.
          </li>
          <li>
            <strong>dictionaryapi.dev</strong> — looking up a word in the reader sends that single word from your
            browser to that public API.
          </li>
          <li>
            <strong>Amazon</strong> — only if you set a Kindle address and use &ldquo;Send to Kindle&rdquo;, which
            emails the article to it.
          </li>
          <li>
            <strong>Google or GitHub</strong> — only if you choose to sign in with them.
          </li>
          <li>
            <strong>Email delivery, error monitoring and performance monitoring.</strong> Verification, password
            reset and digest emails are sent through Resend. Crashes may be reported to Sentry, and read-aloud
            latency to Datadog RUM. Each of those is off unless the operator has configured it; whether they are on
            for this deployment is <Blank>WHICH OF THESE ARE ENABLED HERE</Blank>.
          </li>
        </ul>
        <p className="mt-2">
          Read-aloud audio is generated on Booklet&rsquo;s own server; the text of your articles is not sent to a
          third-party speech service.
        </p>
        <p className="mt-2">There is no advertising here, and no data is sold or shared for advertising.</p>
      </section>

      <section>
        <h2>How long things are kept</h2>
        <ul>
          <li>Deleting an article moves it to Trash, where it stays recoverable for 30 days and is then purged.</li>
          <li>Sessions expire 30 days after they are created, or immediately when you log the device out.</li>
          <li>Password-reset links last one hour; email-verification links last 24 hours.</li>
          <li>Everything else is kept until you delete it or delete your account.</li>
        </ul>
      </section>

      <section>
        <h2>Deleting your account</h2>
        <p className="mt-2">
          Settings → Account → <strong>Delete my account</strong>. You will be asked to re-enter your password, or,
          if you signed up through Google or GitHub and never set one, to type your email address.
        </p>
        <p className="mt-2">
          It takes effect immediately — there is no grace period and no undo. It removes your account row and
          everything listed above that hangs off it, deletes your uploaded files and generated audio from the
          server, makes every page you shared return &ldquo;not found&rdquo; at once, signs out every device, and
          triggers a rebuild of the community-highlights aggregate so your contribution stops being counted.
        </p>
        <p className="mt-2">
          If you want a copy first, <Link href="/settings/import-export">Export</Link> produces a zip with one
          Markdown file per article, including your highlights and notes. Do that before deleting; afterwards there
          is nothing left to export from.
        </p>
      </section>

      <section>
        <h2>What this policy does not claim</h2>
        <p className="mt-2">
          Booklet holds no privacy certification and has not been audited against any framework. Nothing here is a
          claim of GDPR, CCPA, SOC 2 or ISO 27001 compliance; the deletion and export features exist because they are
          the right thing for a reading app to have. Which laws actually apply, and what rights they give you, depend
          on where this ends up being operated: <Blank>GOVERNING LAW / SUPERVISORY AUTHORITY</Blank>.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p className="mt-2">
          If this policy changes in a way that affects what is stored or who can see it, the date at the top changes
          and signed-in accounts will be told at <Blank>HOW USERS WILL BE NOTIFIED</Blank>.
        </p>
      </section>
    </LegalShell>
  );
}
