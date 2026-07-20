import { BusinessError } from "./errors";

export type RuntimeIssue = {
  code: string;
  message: string;
};

export type RuntimeState = {
  status: "checking" | "healthy" | "degraded";
  checkedAt: number | null;
  activeRevision: string | null;
  issues: RuntimeIssue[];
};

let runtimeState: RuntimeState = {
  status: "checking",
  checkedAt: null,
  activeRevision: null,
  issues: [],
};

export function getRuntimeState() {
  return runtimeState;
}

export function setRuntimeState(next: RuntimeState) {
  runtimeState = next;
}

export function setRuntimeHealthy(activeRevision: string | null) {
  setRuntimeState({ status: "healthy", checkedAt: Date.now(), activeRevision, issues: [] });
}

export function setRuntimeDegraded(issues: RuntimeIssue[], activeRevision: string | null = null) {
  setRuntimeState({ status: "degraded", checkedAt: Date.now(), activeRevision, issues });
}

export function assertRuntimeMutable() {
  if (runtimeState.status !== "healthy") {
    throw new BusinessError(
      runtimeState.status === "degraded" ? "errors:runtimeDegraded" : "errors:runtimeChecking",
      409,
      runtimeState.status === "degraded" ? "RUNTIME_DEGRADED" : "RUNTIME_CHECKING",
    );
  }
}
