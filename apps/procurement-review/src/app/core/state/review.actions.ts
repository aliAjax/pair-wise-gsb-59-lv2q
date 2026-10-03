import { createActionGroup, emptyProps, props } from "@ngrx/store";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  ConflictNotice,
  FinalizeVersionInput,
  ReconciliationState,
  ReviewRole,
  ReviewState,
} from "../models/review.models";

export const ReviewActions = createActionGroup({
  source: "Procurement Review",
  events: {
    "Load Review Data": emptyProps(),
    "Load Review Data Success": props<{
      workspace: Pick<
        ReviewState,
        | "clauses"
        | "versions"
        | "auditLogs"
        | "batches"
        | "reconciliation"
        | "globalRevision"
        | "dashboard"
        | "suppliers"
      >;
      toast?: string;
    }>(),
    "Load Review Data Failure": props<{ error: string }>(),
    "Set Role": props<{ role: ReviewRole }>(),
    "Set Filters": props<{ filters: Partial<ReviewState["filters"]> }>(),
    "Toggle Supplier": props<{ supplierId: string }>(),
    "Clear Toast": emptyProps(),
    "Submit Assessment": props<{ input: AssessmentInput }>(),
    "Request Clarification": props<{ input: ClarificationInput }>(),
    "Respond Clarification": props<{ input: ClarificationResponseInput }>(),
    "Finalize Version": props<{ input: FinalizeVersionInput }>(),
    "Resolve Quarantine": props<{
      issueId: string;
      note: string;
      actor: string;
      role: ReviewRole;
    }>(),
    "Rerun Reconciliation": props<{ role: ReviewRole }>(),
    "Reconciliation Updated": props<{
      reconciliation: ReconciliationState;
      toast?: string;
    }>(),
    "Conflict Detected": props<{ conflict: ConflictNotice }>(),
    "Reset Review Data": emptyProps(),
  },
});
