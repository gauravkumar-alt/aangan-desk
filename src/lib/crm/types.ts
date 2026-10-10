import type { CrmSync, Enquiry } from "../types";

// One interface for every CRM. syncCrm() (index.ts) owns idempotency, skipping and error state; a provider
// only knows how to write one enquiry into its system.
export interface CrmProvider {
  id: string;
  label: string;
  configured(): boolean;
  /**
   * Write the enquiry. `writeNote` is false when nothing changed since the last sync. Record ids go into
   * `out` as soon as they exist, so a failure halfway still keeps them and a retry doesn't duplicate.
   */
  sync(e: Enquiry, prev: CrmSync, writeNote: boolean, out: Partial<CrmSync>): Promise<void>;
}

export class CrmError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}
