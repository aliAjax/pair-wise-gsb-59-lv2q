import { createReducer, on } from "@ngrx/store";
import type { ReviewState } from "../models/review.models";
import { ReviewActions } from "./review.actions";

export const initialReviewState: ReviewState = {
  clauses: [],
  versions: [],
  auditLogs: [],
  batches: [],
  globalRevision: 1,
  suppliers: [],
  filters: {
    keyword: "",
    category: "",
    type: "all",
    differencesOnly: false,
  },
  role: "reviewer_a",
  selectedSupplierIds: ["SUP-A", "SUP-B", "SUP-C"],
  loading: false,
  saving: false,
};

export const reviewReducer = createReducer(
  initialReviewState,
  on(ReviewActions.loadReviewData, (state) => ({
    ...state,
    loading: true,
    error: undefined,
  })),
  on(
    ReviewActions.loadReviewDataSuccess,
    (state, { workspace, toast }) => ({
      ...state,
      ...workspace,
      loading: false,
      saving: false,
      error: undefined,
      conflict: undefined,
      toast,
    }),
  ),
  on(ReviewActions.loadReviewDataFailure, (state, { error }) => ({
    ...state,
    loading: false,
    saving: false,
    error,
  })),
  on(ReviewActions.setRole, (state, { role }) => ({
    ...state,
    role,
    toast: undefined,
    conflict: undefined,
  })),
  on(ReviewActions.setFilters, (state, { filters }) => ({
    ...state,
    filters: {
      ...state.filters,
      ...filters,
    },
  })),
  on(ReviewActions.toggleSupplier, (state, { supplierId }) => {
    const selected = state.selectedSupplierIds.includes(supplierId);
    const next = selected
      ? state.selectedSupplierIds.filter((id) => id !== supplierId)
      : [...state.selectedSupplierIds, supplierId];
    return {
      ...state,
      selectedSupplierIds: next.length > 0 ? next : state.selectedSupplierIds,
    };
  }),
  on(ReviewActions.clearToast, (state) => ({
    ...state,
    toast: undefined,
    error: undefined,
    conflict: undefined,
  })),
  on(
    ReviewActions.submitAssessment,
    ReviewActions.requestClarification,
    ReviewActions.respondClarification,
    ReviewActions.finalizeVersion,
    ReviewActions.resolveQuarantine,
    ReviewActions.rerunReconciliation,
    ReviewActions.resetReviewData,
    (state) => ({
      ...state,
      saving: true,
      error: undefined,
      toast: undefined,
    }),
  ),
  on(ReviewActions.conflictDetected, (state, { conflict }) => ({
    ...state,
    saving: false,
    conflict,
  })),
  on(
    ReviewActions.reconciliationUpdated,
    (state, { reconciliation, toast }) => ({
      ...state,
      reconciliation,
      saving: false,
      toast,
      conflict: undefined,
    }),
  ),
);
