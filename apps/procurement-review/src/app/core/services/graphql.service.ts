import { Injectable, inject } from "@angular/core";
import { Apollo, gql } from "apollo-angular";
import { Observable, map } from "rxjs";
import type {
  AssessmentInput,
  AssessmentPayload,
  ClarificationInput,
  ClarificationPayload,
  ClarificationResponseInput,
  FinalizePayload,
  FinalizeVersionInput,
  ResolveQuarantineInput,
  ResolveQuarantinePayload,
  WorkspaceQueryResult,
} from "../models/review.models";

const WORKSPACE_QUERY = gql`
  query ProcurementReviewWorkspace {
    workspace {
      clauses {
        id
        code
        title
        category
        requirement
        type
        weight
        parentId
        evidenceRequired
        order
        responses {
          id
          clauseId
          supplierId
          supplierName
          status
          responseText
          claimedScore
          attachmentName
          proofFingerprint
          submittedBy
          submittedAt
          reviewRound
          revision
          reviews {
            id
            responseId
            reviewer
            role
            decision
            score
            comment
            createdAt
            batchId
          }
          clarifications {
            id
            responseId
            clauseId
            round
            requestText
            supplierResponse
            requestedAt
            dueAt
            respondedAt
            status
            batchId
          }
        }
      }
      versions {
        id
        version
        label
        status
        createdAt
        createdBy
        signedBy
        clauseCount
        responseCount
        contentHash
        batchId
      }
      auditLogs {
        id
        at
        actor
        action
        entity
        detail
        batchId
      }
      dashboard {
        totalClauses
        mandatoryCount
        pendingReviews
        differences
        overdueClarifications
        reusedProofs
        activeVersion
      }
      suppliers {
        id
        name
      }
      reconciliation {
        lastRunAt
        batchCount
        replayedBatches
        backfilledBatches
        pendingQuarantine
        quarantine {
          id
          kind
          entityType
          entityId
          reason
          detail
          detectedAt
          status
          resolution
          resolvedBy
          resolvedAt
        }
      }
      batches {
        id
        opId
        action
        actor
        role
        baseRevision
        status
        entityId
        resultRevision
        createdAt
        appliedAt
      }
    }
  }
`;

const SUBMIT_ASSESSMENT = gql`
  mutation SubmitAssessment($input: AssessmentInput!) {
    submitAssessment(input: $input) {
      opinion {
        id
        responseId
        reviewer
        role
        decision
        score
        comment
        createdAt
        batchId
      }
      batchId
      revision
      replayed
    }
  }
`;

const REQUEST_CLARIFICATION = gql`
  mutation RequestClarification($input: ClarificationInput!) {
    requestClarification(input: $input) {
      clarification {
        id
        responseId
        clauseId
        round
        requestText
        supplierResponse
        requestedAt
        dueAt
        respondedAt
        status
        batchId
      }
      batchId
      revision
      replayed
    }
  }
`;

const RESPOND_CLARIFICATION = gql`
  mutation RespondClarification($input: ClarificationResponseInput!) {
    respondClarification(input: $input) {
      clarification {
        id
        responseId
        clauseId
        round
        requestText
        supplierResponse
        requestedAt
        dueAt
        respondedAt
        status
        batchId
      }
      batchId
      revision
      replayed
    }
  }
`;

const FINALIZE_VERSION = gql`
  mutation FinalizeVersion($input: FinalizeVersionInput!) {
    finalizeVersion(input: $input) {
      version {
        id
        version
        label
        status
        createdAt
        createdBy
        signedBy
        clauseCount
        responseCount
        contentHash
        batchId
      }
      batchId
      replayed
    }
  }
`;

const RESOLVE_QUARANTINE = gql`
  mutation ResolveQuarantine($input: ResolveQuarantineInput!) {
    resolveQuarantine(input: $input) {
      item {
        id
        kind
        entityType
        entityId
        reason
        detail
        detectedAt
        status
        resolution
        resolvedBy
        resolvedAt
      }
      batchId
      replayed
    }
  }
`;

const RESET_REVIEW_DATA = gql`
  mutation ResetReviewData {
    resetReviewData
  }
`;

@Injectable({ providedIn: "root" })
export class ReviewGraphqlService {
  private readonly apollo = inject(Apollo);

  loadWorkspace(): Observable<WorkspaceQueryResult> {
    return this.apollo
      .query<WorkspaceQueryResult>({
        query: WORKSPACE_QUERY,
        fetchPolicy: "network-only",
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审工作区。");
          }
          return result.data as WorkspaceQueryResult;
        }),
      );
  }

  submitAssessment(input: AssessmentInput): Observable<AssessmentPayload> {
    return this.apollo
      .mutate<{ submitAssessment: AssessmentPayload }>({
        mutation: SUBMIT_ASSESSMENT,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审意见。");
          }
          return result.data.submitAssessment;
        }),
      );
  }

  requestClarification(
    input: ClarificationInput,
  ): Observable<ClarificationPayload> {
    return this.apollo
      .mutate<{ requestClarification: ClarificationPayload }>({
        mutation: REQUEST_CLARIFICATION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清记录。");
          }
          return result.data.requestClarification;
        }),
      );
  }

  respondClarification(
    input: ClarificationResponseInput,
  ): Observable<ClarificationPayload> {
    return this.apollo
      .mutate<{ respondClarification: ClarificationPayload }>({
        mutation: RESPOND_CLARIFICATION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清回复。");
          }
          return result.data.respondClarification;
        }),
      );
  }

  finalizeVersion(input: FinalizeVersionInput): Observable<FinalizePayload> {
    return this.apollo
      .mutate<{ finalizeVersion: FinalizePayload }>({
        mutation: FINALIZE_VERSION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回版本信息。");
          }
          return result.data.finalizeVersion;
        }),
      );
  }

  resolveQuarantine(
    input: ResolveQuarantineInput,
  ): Observable<ResolveQuarantinePayload> {
    return this.apollo
      .mutate<{ resolveQuarantine: ResolveQuarantinePayload }>({
        mutation: RESOLVE_QUARANTINE,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回隔离处理结果。");
          }
          return result.data.resolveQuarantine;
        }),
      );
  }

  resetReviewData(): Observable<boolean> {
    return this.apollo
      .mutate<{ resetReviewData: boolean }>({
        mutation: RESET_REVIEW_DATA,
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回重置结果。");
          }
          return result.data.resetReviewData;
        }),
      );
  }
}
