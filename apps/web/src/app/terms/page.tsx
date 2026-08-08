import type { Metadata } from "next";
import Link from "next/link";
import { Blank, LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms",
  description: "What Booklet does and does not promise, and what you agree to when you use it.",
};

/**
 * Terms of use (#174).
 *
 * Kept short and specific to what this app actually does. The temptation
 * with a terms page is to paste a template full of clauses about services
 * that do not exist here (payments, user-to-user messaging, uploaded public
 * content) -- those clauses would be noise at best and misleading at worst.
 * The company, jurisdiction and contact details are left as visible blanks
 * for the same reason as in the privacy policy: inventing them would make
 * the document look settled when it is not.
 */
export default function TermsPage() {
  return (
    <LegalShell title="Terms of use" updated={<Blank>DATE THIS WAS PUBLISHED</Blank>}>
      <p className="rounded-sm border border-border bg-surface px-4 py-3">
        <strong>This document is not finished.</strong> The highlighted blanks are the parts that depend on who
        operates this service and under whose law, which has not been decided. The rest describes how the software
        actually behaves.
      </p>

      <section>
        <h2>Who you are agreeing with</h2>
        <p className="mt-2">
          Booklet is operated by <Blank>OPERATOR NAME</Blank>. Using it means accepting what is on this page. If you
          do not, do not create an account — and note that Booklet is fully usable signed out, in which case nothing
          you read or highlight leaves your browser.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>Keep your password to yourself. Anything done through your account is treated as done by you.</li>
          <li>
            Personal API tokens and the podcast feed URL are credentials in their own right: anyone holding one can
            read your whole library. Revoke them in Settings if one gets out.
          </li>
          <li>You can delete your account at any time, from Settings → Account. It takes effect immediately.</li>
        </ul>
      </section>

      <section>
        <h2>What you save</h2>
        <p className="mt-2">
          Your saved articles, uploads, highlights and notes stay yours. Booklet stores and displays them so the app
          can work, and does not claim ownership of them or any other right to use them.
        </p>
        <p className="mt-2">
          Booklet fetches and stores a readable copy of pages you save, and copies of files you upload, for your own
          reading. That is a personal-use copy: whether you are entitled to make it is between you and whoever owns
          the material, and you are responsible for only saving things you are allowed to. Do not use Booklet to
          store or distribute material you have no right to.
        </p>
      </section>

      <section>
        <h2>Sharing</h2>
        <p className="mt-2">
          A shared page is public to anyone holding its link — there is no sign-in on it, and the link can be
          forwarded. Share only what you are willing to have read by strangers, and only quotations you are entitled
          to publish. A shared page deliberately publishes your highlighted passages and notes, not the full text of
          the source. Revoking a share kills the link immediately, but cannot recall a copy someone already made.
        </p>
        <p className="mt-2">
          The operator may remove a shared page that is being used to redistribute material wholesale or that is
          reported as unlawful.
        </p>
      </section>

      <section>
        <h2>Fair use of the service</h2>
        <p className="mt-2">
          Do not attempt to reach other accounts&rsquo; data, guess share links, work around the rate limits, or use
          the extraction, speech or API endpoints as bulk infrastructure for something else. Automated access through
          a personal API token is fine within those limits.
        </p>
      </section>

      <section>
        <h2>No warranty, and what that means concretely</h2>
        <p className="mt-2">
          Booklet is provided as-is, with no guarantee of availability, and no guarantee that your data will survive
          a fault. There is no promised uptime, no support commitment, and — say this plainly —{" "}
          <strong>you should not treat Booklet as the only copy of anything you cannot lose</strong>. Settings →
          Import/Export exists for exactly that; exporting occasionally is a reasonable habit.
        </p>
        <p className="mt-2">
          Extraction is imperfect. Some pages will be captured badly or not at all, scanned PDFs go through OCR and
          will contain recognition errors, and read-aloud will mispronounce things. Text shown in the reader is not
          guaranteed to match the original exactly.
        </p>
      </section>

      <section>
        <h2>Ending it</h2>
        <p className="mt-2">
          You can stop at any time by deleting your account, which removes your data immediately (see the{" "}
          <Link href="/privacy">privacy policy</Link> for exactly what that covers). The operator may suspend or
          close an account that is breaking these terms or putting the service at risk, and will make a reasonable
          effort to give notice first where the circumstances allow it.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p className="mt-2">
          These terms can change. The date at the top changes with them, and material changes will be announced at{" "}
          <Blank>HOW USERS WILL BE NOTIFIED</Blank>.
        </p>
      </section>

      <section>
        <h2>Law and contact</h2>
        <p className="mt-2">
          Governed by the law of <Blank>JURISDICTION</Blank>, with disputes handled in{" "}
          <Blank>COURTS / VENUE</Blank>. Anything about these terms: <Blank>CONTACT EMAIL</Blank>.
        </p>
        <p className="mt-2">
          Limitation of liability is deliberately left blank rather than guessed at:{" "}
          <Blank>LIABILITY CAP — NEEDS A LAWYER, NOT A PLACEHOLDER</Blank>. What enforceably limits liability differs
          by jurisdiction and consumer-protection regime, and a clause copied from elsewhere is as likely to be void
          as to help.
        </p>
      </section>
    </LegalShell>
  );
}
