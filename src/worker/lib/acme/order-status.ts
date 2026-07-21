export { recheckableOrderStatuses, terminalOrderStatuses } from "@/shared/schemas/certificate";

/** ACME order statuses that are still being prepared or progressed by the scheduler. */
export const activeOrderStatuses: string[] = [
  "preparing",
  "waiting_http",
  "waiting_dns",
  "validating",
  "validated",
  "downloading",
];

/** Order statuses that run the certificate download step (post-validation). */
export const downloadableOrderStatuses: string[] = [
  "validated",
  "downloading",
];

/** Minimum gap after lastPolledAt before manual recheck may advance nextPollAt. */
export const RECHECK_DEBOUNCE_MS = 5_000;
