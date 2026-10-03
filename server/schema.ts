import { parse } from "graphql";

export const typeDefs = parse(`
  enum ClauseType {
    mandatory
    scoring
    evidence
  }

  enum ComplianceStatus {
    compliant
    deviation
    clarification
    pending
  }

  enum ReviewRole {
    procurement
    reviewer_a
    reviewer_b
    chair
  }

  enum ClarificationStatus {
    open
    responded
    overdue
  }

  enum VersionStatus {
    draft
    finalized
  }

  enum BatchStatus {
    pending
    applied
    backfilled
  }

  enum QuarantineKind {
    isolated
    pending_review
  }

  enum QuarantineStatus {
    pending
    resolved
  }

  type Clause {
    id: ID!
    code: String!
    title: String!
    category: String!
    requirement: String!
    type: ClauseType!
    weight: Int!
    parentId: String
    evidenceRequired: Boolean!
    order: Int!
    responses: [SupplierResponse!]!
  }

  type ReviewerOpinion {
    id: ID!
    responseId: String!
    reviewer: String!
    role: ReviewRole!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    createdAt: String!
    batchId: String
  }

  type Clarification {
    id: ID!
    responseId: String!
    clauseId: String!
    round: Int!
    requestText: String!
    supplierResponse: String
    requestedAt: String!
    dueAt: String!
    respondedAt: String
    status: ClarificationStatus!
    batchId: String
  }

  type SupplierResponse {
    id: ID!
    clauseId: String!
    supplierId: String!
    supplierName: String!
    status: ComplianceStatus!
    responseText: String!
    claimedScore: Int!
    attachmentName: String!
    proofFingerprint: String!
    submittedBy: String!
    submittedAt: String!
    reviewRound: Int!
    revision: Int!
    reviews: [ReviewerOpinion!]!
    clarifications: [Clarification!]!
  }

  type ReviewVersion {
    id: ID!
    version: String!
    label: String!
    status: VersionStatus!
    createdAt: String!
    createdBy: String!
    signedBy: [String!]!
    clauseCount: Int!
    responseCount: Int!
    contentHash: String!
    batchId: String
  }

  type AuditLog {
    id: ID!
    at: String!
    actor: String!
    action: String!
    entity: String!
    detail: String!
    batchId: String
  }

  type AuditBatch {
    id: ID!
    opId: String!
    action: String!
    actor: String!
    role: ReviewRole!
    baseRevision: Int!
    status: BatchStatus!
    entityId: String!
    resultRevision: Int
    createdAt: String!
    appliedAt: String
  }

  type QuarantineItem {
    id: ID!
    kind: QuarantineKind!
    entityType: String!
    entityId: String!
    reason: String!
    detail: String!
    detectedAt: String!
    status: QuarantineStatus!
    resolution: String
    resolvedBy: String
    resolvedAt: String
  }

  type ReconciliationReport {
    lastRunAt: String!
    batchCount: Int!
    replayedBatches: Int!
    backfilledBatches: Int!
    pendingQuarantine: Int!
    quarantine: [QuarantineItem!]!
  }

  type DashboardStats {
    totalClauses: Int!
    mandatoryCount: Int!
    pendingReviews: Int!
    differences: Int!
    overdueClarifications: Int!
    reusedProofs: Int!
    activeVersion: String!
  }

  type Supplier {
    id: ID!
    name: String!
  }

  type WorkspaceData {
    clauses: [Clause!]!
    versions: [ReviewVersion!]!
    auditLogs: [AuditLog!]!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
    reconciliation: ReconciliationReport!
    batches: [AuditBatch!]!
  }

  input AssessmentInput {
    responseId: ID!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    reviewer: String!
    role: ReviewRole!
    baseRevision: Int!
    opId: String!
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
    role: ReviewRole!
    baseRevision: Int!
    opId: String!
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
    role: ReviewRole!
    baseRevision: Int!
    opId: String!
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
    opId: String!
  }

  input ResolveQuarantineInput {
    quarantineId: ID!
    resolution: String!
    actor: String!
    role: ReviewRole!
    opId: String!
  }

  type AssessmentPayload {
    opinion: ReviewerOpinion!
    batchId: String!
    revision: Int!
    replayed: Boolean!
  }

  type ClarificationPayload {
    clarification: Clarification!
    batchId: String!
    revision: Int!
    replayed: Boolean!
  }

  type FinalizePayload {
    version: ReviewVersion!
    batchId: String!
    replayed: Boolean!
  }

  type ResolveQuarantinePayload {
    item: QuarantineItem!
    batchId: String!
    replayed: Boolean!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
    reconciliation: ReconciliationReport!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): AssessmentPayload!
    requestClarification(input: ClarificationInput!): ClarificationPayload!
    respondClarification(input: ClarificationResponseInput!): ClarificationPayload!
    finalizeVersion(input: FinalizeVersionInput!): FinalizePayload!
    resolveQuarantine(input: ResolveQuarantineInput!): ResolveQuarantinePayload!
    resetReviewData: Boolean!
  }
`);
