import { ButtonLink } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-balance font-serif text-4xl font-semibold text-ink">Booklet</h1>
        <p className="max-w-sm text-balance font-sans text-base text-ink-muted">
          Save articles, read them clean, and keep what you highlight — instead of losing it in a
          list you never reopen.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <ButtonLink href="/signup" variant="primary">
          Sign up
        </ButtonLink>
        <ButtonLink href="/login" variant="secondary">
          Log in
        </ButtonLink>
      </div>

      <ButtonLink href="/library" variant="ghost" className="-mt-2">
        Continue without an account
      </ButtonLink>
    </div>
  );
}
