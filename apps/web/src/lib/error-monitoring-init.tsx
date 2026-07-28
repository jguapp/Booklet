"use client";

import { useEffect } from "react";
import { initErrorMonitoring } from "./error-monitoring";

/** Mounted once in the root layout -- see lib/error-monitoring.ts for the no-DSN no-op behavior. */
export function ErrorMonitoringInit() {
  useEffect(() => {
    initErrorMonitoring();
  }, []);
  return null;
}
