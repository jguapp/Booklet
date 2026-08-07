export interface HealthResponse {
  status: "ok";
  timestamp: string;
  /**
   * Read-aloud readiness, reported but deliberately NOT part of `status`.
   *
   * The API is genuinely healthy without working TTS -- everything except
   * read-aloud keeps working -- so folding this into `status` would take the
   * whole service out of a load balancer over a degraded optional feature.
   * It is surfaced because the pool previously had no notion of readiness at
   * all: health returned ok while every worker had failed to load a corrupt
   * model and TTS was completely dead, which is how #161 went unnoticed for
   * an entire CI run.
   *
   * `loaded < workers` during the first seconds after boot is normal -- the
   * pool stages its cold start on purpose (see tts-pool.ts).
   */
  tts: {
    started: boolean;
    workers: number;
    loaded: number;
  };
}
