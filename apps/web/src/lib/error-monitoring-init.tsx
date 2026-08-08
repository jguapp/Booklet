"use client";

import { useEffect } from "react";
import { initErrorMonitoring } from "./error-monitoring";
import { initRum } from "./rum";

/** Mounted once in the root layout. Both of these no-op without their own env
 * configured -- see lib/error-monitoring.ts and lib/rum.ts. They are separate
 * products answering separate questions (errors vs. latency), started
 * together only because this is the one place that runs once per page load. */
export function ErrorMonitoringInit() {
  useEffect(() => {
    void initErrorMonitoring();
    void initRum();
  }, []);
  return null;
}
