import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { reviewDataStore } from "./data";
import { runStartupRecovery } from "./bootstrap";
import { runBatch, type RunBatchResult } from "./batches";
import {
  reconcileDatabase,
  resolveQuarantineIssue,
} from "./reconciliation";
import { typeDefs } from "./schema";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  Clause,
  DashboardStats,
  FinalizeVersionInput,
  ReviewDatabase,
  ReviewRole,
} from "./types";

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const activeResponses = database.responses.filter(
    (response) => !response.quarantined,
  );
  const opinionsByResponse = activeResponses.map((response) => {
    const decisions = new Set(
      response.reviews
        .filter((review) => review.decision !== "clarification")
        .map((review) => review.decision),
    );
    return decisions.size > 1;
  });
  const proofCounts = activeResponses.reduce<Record<string, number>>(
    (counts, response) => {
      if (response.proofFingerprint) {
        counts[response.proofFingerprint] =
          (counts[response.proofFingerprint] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const activeVersion =
    database.versions.find(
      (version) => version.status === "draft" && !version.quarantined,
    ) ??
    database.versions.find(
      (version) => version.status === "finalized" && !version.quarantined,
    );
  const pendingIssues = database.reconciliation.issues.filter(
    (issue) => !issue.resolved,
  ).length;

  return {
    totalClauses: database.clauses.length,
    mandatoryCount: database.clauses.filter(
      (clause) => clause.type === "mandatory",
    ).length,
    pendingReviews: activeResponses.filter(
      (response) => response.reviews.length < 2,
    ).length,
    differences: opinionsByResponse.filter(Boolean).length,
    overdueClarifications: activeResponses.reduce(
      (count, response) =>
        count +
        response.clarifications.filter(
          (clarification) => clarification.status === "overdue",
        ).length,
      0,
    ),
    reusedProofs: Object.values(proofCounts).filter((count) => count > 1)
      .length,
    activeVersion: activeVersion
      ? `${activeVersion.version} ${activeVersion.label}`
      : "未建立版本",
    quarantinedResponses: database.responses.filter(
      (response) => response.quarantined,
    ).length,
    quarantinedVersions: database.versions.filter(
      (version) => version.quarantined,
    ).length,
    pendingReconciliation: pendingIssues,
    unfinishedBatches:
      database.reconciliation.summary.unfinishedBatches,
  };
};

const requireRole = (role: ReviewRole, allowed: ReviewRole[]): void => {
  if (!allowed.includes(role)) {
    throw new Error("当前角色无权执行此操作。");
  }
};

const store = reviewDataStore;

const toBatchInput = (
  input: AssessmentInput | ClarificationInput | ClarificationResponseInput | FinalizeVersionInput,
) => ({
  batchId: input.batchId,
  expectedRevision: input.expectedRevision,
});

const findEntity = (
  database: ReviewDatabase,
  result: Extract<RunBatchResult, { outcome: "applied" | "recovered" | "duplicate" }>,
) => {
  if (result.entityType === "opinion") {
    const opinion = database.responses
      .flatMap((response) => response.reviews)
      .find((item) => item.id === result.entityId);
    return { opinion };
  }
  if (result.entityType === "clarification") {
    const clarification = database.responses
      .flatMap((response) => response.clarifications)
      .find((item) => item.id === result.entityId);
    return { clarification };
  }
  const version = database.versions.find(
    (item) => item.id === result.entityId,
  );
  return { version };
};

const resolvers = {
  Query: {
    workspace: () => {
      const database = store.snapshot();
      return {
        ...database,
        dashboard: getDashboard(database),
      };
    },
    dashboard: () => getDashboard(store.snapshot()),
    reconciliation: () => store.snapshot().reconciliation,
  },
  Clause: {
    responses: (clause: Clause, _args: unknown, context: { database: ReviewDatabase }) =>
      context.database.responses.filter(
        (response) => response.clauseId === clause.id,
      ),
  },
  SupplierResponse: {
    quarantined: (response: { quarantined?: boolean }) =>
      response.quarantined ?? false,
    issueIds: (response: { issueIds?: string[] }) => response.issueIds ?? [],
  },
  ReviewVersion: {
    quarantined: (version: { quarantined?: boolean }) =>
      version.quarantined ?? false,
    issueIds: (version: { issueIds?: string[] }) => version.issueIds ?? [],
  },
  AuditBatch: {
    replayCount: (batch: { replayCount?: number }) => batch.replayCount ?? 0,
  },
  SubmitAssessmentPayload: {
    __resolveType: (result: { outcome?: string; opinion?: unknown }) =>
      result.opinion
        ? "AssessmentResult"
        : result.outcome === "conflict"
          ? "ConcurrentChange"
          : "QuarantineConflict",
  },
  RequestClarificationPayload: {
    __resolveType: (result: { outcome?: string; clarification?: unknown }) =>
      result.clarification
        ? "ClarificationResult"
        : result.outcome === "conflict"
          ? "ConcurrentChange"
          : "QuarantineConflict",
  },
  RespondClarificationPayload: {
    __resolveType: (result: { outcome?: string; clarification?: unknown }) =>
      result.clarification
        ? "ClarificationResult"
        : result.outcome === "conflict"
          ? "ConcurrentChange"
          : "QuarantineConflict",
  },
  FinalizeVersionPayload: {
    __resolveType: (result: { outcome?: string; version?: unknown }) =>
      result.version
        ? "FinalizeResult"
        : result.outcome === "conflict"
          ? "ConcurrentChange"
          : "QuarantineConflict",
  },
  Mutation: {
    submitAssessment: (
      _parent: unknown,
      { input }: { input: AssessmentInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      const result = runBatch(store, {
        operation: "submit_assessment",
        actor: input.reviewer.trim(),
        role: input.role,
        responseId: input.responseId,
        ...toBatchInput(input),
        payload: {
          responseId: input.responseId,
          decision: input.decision,
          score: input.score,
          comment: input.comment,
          reviewer: input.reviewer,
          role: input.role,
        },
      });
      if (result.outcome === "validation_failed") {
        throw new Error(result.message);
      }
      if (result.outcome === "aborted") {
        throw new Error(result.message);
      }
      if (result.outcome === "conflict" || result.outcome === "quarantined") {
        return result;
      }
      const database = store.snapshot();
      const { opinion } = findEntity(database, result) as {
        opinion: NonNullable<ReturnType<typeof findEntity>["opinion"]>;
      };
      return {
        opinion,
        receipt: {
          batchId: result.batch.id,
          opSeq: result.batch.opSeq,
          revision: result.batch.revision,
          replayed: result.outcome !== "applied",
          auditId: result.auditId,
        },
      };
    },
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) => {
      if (input.role) {
        requireRole(input.role, ["procurement", "chair"]);
      }
      const result = runBatch(store, {
        operation: "request_clarification",
        actor: input.actor,
        role: input.role,
        responseId: input.responseId,
        ...toBatchInput(input),
        payload: {
          responseId: input.responseId,
          requestText: input.requestText,
          dueAt: input.dueAt,
          actor: input.actor,
        },
      });
      if (result.outcome === "validation_failed" || result.outcome === "aborted") {
        throw new Error(result.message);
      }
      if (result.outcome === "conflict" || result.outcome === "quarantined") {
        return result;
      }
      const database = store.snapshot();
      const { clarification } = findEntity(database, result) as {
        clarification: NonNullable<
          ReturnType<typeof findEntity>["clarification"]
        >;
      };
      return {
        clarification,
        receipt: {
          batchId: result.batch.id,
          opSeq: result.batch.opSeq,
          revision: result.batch.revision,
          replayed: result.outcome !== "applied",
          auditId: result.auditId,
        },
      };
    },
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) => {
      if (input.role) {
        requireRole(input.role, ["procurement", "chair"]);
      }
      const responseId = store
        .snapshot()
        .responses.find((response) =>
          response.clarifications.some(
            (clarification) => clarification.id === input.clarificationId,
          ),
        )?.id;
      const result = runBatch(store, {
        operation: "respond_clarification",
        actor: input.actor,
        role: input.role,
        responseId,
        ...toBatchInput(input),
        payload: {
          clarificationId: input.clarificationId,
          responseText: input.responseText,
          actor: input.actor,
        },
      });
      if (result.outcome === "validation_failed" || result.outcome === "aborted") {
        throw new Error(result.message);
      }
      if (result.outcome === "conflict" || result.outcome === "quarantined") {
        return result;
      }
      const database = store.snapshot();
      const { clarification } = findEntity(database, result) as {
        clarification: NonNullable<
          ReturnType<typeof findEntity>["clarification"]
        >;
      };
      return {
        clarification,
        receipt: {
          batchId: result.batch.id,
          opSeq: result.batch.opSeq,
          revision: result.batch.revision,
          replayed: result.outcome !== "applied",
          auditId: result.auditId,
        },
      };
    },
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) => {
      requireRole(input.role, ["chair"]);
      const result = runBatch(store, {
        operation: "finalize_version",
        actor: input.actor,
        role: input.role,
        ...toBatchInput(input),
        payload: {
          label: input.label,
          actor: input.actor,
          role: input.role,
        },
      });
      if (result.outcome === "validation_failed" || result.outcome === "aborted") {
        throw new Error(result.message);
      }
      if (result.outcome === "conflict" || result.outcome === "quarantined") {
        return result;
      }
      const database = store.snapshot();
      const { version } = findEntity(database, result) as {
        version: NonNullable<ReturnType<typeof findEntity>["version"]>;
      };
      return {
        version,
        receipt: {
          batchId: result.batch.id,
          opSeq: result.batch.opSeq,
          revision: result.batch.revision,
          replayed: result.outcome !== "applied",
          auditId: result.auditId,
        },
      };
    },
    resolveQuarantine: (
      _parent: unknown,
      {
        input,
      }: {
        input: {
          issueId: string;
          note: string;
          actor: string;
          role: ReviewRole;
        };
      },
    ) => {
      requireRole(input.role, ["chair"]);
      if (input.note.trim().length < 4) {
        throw new Error("请填写至少 4 个字符的修复确认说明。");
      }
      const issue = store.mutate((database) =>
        resolveQuarantineIssue(database, {
          issueId: input.issueId,
          note: input.note.trim(),
          actor: input.actor,
          role: input.role,
        }),
      );
      const batchId = `BATCH-RESOLVE-${input.issueId}`;
      return {
        issue,
        receipt: {
          batchId,
          opSeq: 1,
          revision: 0,
          replayed: false,
          auditId: `AUD-${batchId}-1`,
        },
      };
    },
    rerunReconciliation: (
      _parent: unknown,
      { role }: { role: ReviewRole },
    ) => {
      requireRole(role, ["chair"]);
      return store.mutate((database) => {
        database.reconciliation = reconcileDatabase(
          database,
          {
            replayedBatches:
              database.reconciliation.summary.replayedBatches,
            backfilledBatches:
              database.reconciliation.summary.backfilledBatches,
          },
          database.reconciliation,
        );
        return database.reconciliation;
      });
    },
    resetReviewData: () => {
      store.reset();
      runStartupRecovery(reviewDataStore);
      return true;
    },
  },
};

// 启动时重放未完成批次并与当前数据对账。
runStartupRecovery(reviewDataStore);

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

async function startServer(): Promise<void> {
  const { url } = await startStandaloneServer(server, {
    listen: { port: 18462, host: "0.0.0.0" },
    context: async () => ({
      database: reviewDataStore.snapshot(),
    }),
  });
  console.log(`GraphQL mock server ready at ${url}`);
}

void startServer();
