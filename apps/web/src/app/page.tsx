import { HealthCheck } from "@/components/health-check";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Booklet
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Web app + API scaffolding is wired up.
      </p>
      <HealthCheck />
    </div>
  );
}
