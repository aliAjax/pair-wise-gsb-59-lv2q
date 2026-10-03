import { Injectable, inject } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap } from "rxjs";
import type { RevisionConflict } from "../models/review.models";
import { ReviewGraphqlService } from "../services/graphql.service";
import { ReviewActions } from "./review.actions";

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "GraphQL 请求失败，请检查本地 mock server。";
};

interface GraphQLErrorLike {
  message?: string;
  extensions?: Record<string, unknown>;
}

const graphQLErrorsOf = (error: unknown): GraphQLErrorLike[] => {
  const candidate = error as {
    graphQLErrors?: unknown;
    errors?: unknown;
  } | null;
  const list = candidate?.graphQLErrors ?? candidate?.errors;
  return Array.isArray(list) ? (list as GraphQLErrorLike[]) : [];
};

const conflictFrom = (error: unknown): RevisionConflict | undefined => {
  for (const graphQLError of graphQLErrorsOf(error)) {
    const extensions = graphQLError.extensions;
    if (extensions?.["code"] === "REVISION_CONFLICT") {
      return extensions["conflict"] as RevisionConflict;
    }
  }
  return undefined;
};

@Injectable()
export class ReviewEffects {
  private readonly actions$ = inject(Actions);
  private readonly graphql = inject(ReviewGraphqlService);

  loadReviewData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.loadReviewData),
      switchMap(() =>
        this.graphql.loadWorkspace().pipe(
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({ workspace }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  submitAssessment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.submitAssessment),
      switchMap(({ input }) =>
        this.graphql.submitAssessment(input).pipe(
          switchMap((payload) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) => ({ workspace, payload })),
            ),
          ),
          map(({ workspace, payload }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: payload.replayed
                ? `该意见已提交过，重试返回原结果（批次 ${payload.batchId}），未重复追加。`
                : `评审意见已入库（批次 ${payload.batchId}，修订 r${payload.revision}），其他评审员意见保持不变。`,
            }),
          ),
          catchError((error: unknown) => {
            const conflict = conflictFrom(error);
            if (conflict) {
              return of(ReviewActions.revisionConflict({ conflict }));
            }
            return of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            );
          }),
        ),
      ),
    ),
  );

  requestClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.requestClarification),
      switchMap(({ input }) =>
        this.graphql.requestClarification(input).pipe(
          switchMap((payload) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) => ({ workspace, payload })),
            ),
          ),
          map(({ workspace, payload }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: payload.replayed
                ? `该澄清已发起过，重试返回原结果（批次 ${payload.batchId}），未重复追加。`
                : `澄清要求已发出（批次 ${payload.batchId}，修订 r${payload.revision}），并写入审计日志。`,
            }),
          ),
          catchError((error: unknown) => {
            const conflict = conflictFrom(error);
            if (conflict) {
              return of(ReviewActions.revisionConflict({ conflict }));
            }
            return of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            );
          }),
        ),
      ),
    ),
  );

  respondClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.respondClarification),
      switchMap(({ input }) =>
        this.graphql.respondClarification(input).pipe(
          switchMap((payload) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) => ({ workspace, payload })),
            ),
          ),
          map(({ workspace, payload }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: payload.replayed
                ? `该回复已登记过，重试返回原结果（批次 ${payload.batchId}），未重复追加。`
                : `澄清回复已登记（批次 ${payload.batchId}，修订 r${payload.revision}），等待评审员复核。`,
            }),
          ),
          catchError((error: unknown) => {
            const conflict = conflictFrom(error);
            if (conflict) {
              return of(ReviewActions.revisionConflict({ conflict }));
            }
            return of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            );
          }),
        ),
      ),
    ),
  );

  finalizeVersion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.finalizeVersion),
      switchMap(({ input }) =>
        this.graphql.finalizeVersion(input).pipe(
          switchMap((payload) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) => ({ workspace, payload })),
            ),
          ),
          map(({ workspace, payload }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: payload.replayed
                ? `该定稿请求已处理过，重试返回原结果（批次 ${payload.batchId}）。`
                : `评审版本已汇总签字并锁定（批次 ${payload.batchId}），内容哈希可复核。`,
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  resolveQuarantine$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.resolveQuarantine),
      switchMap(({ input }) =>
        this.graphql.resolveQuarantine(input).pipe(
          switchMap((payload) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) => ({ workspace, payload })),
            ),
          ),
          map(({ workspace, payload }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: payload.replayed
                ? `该隔离项已处理过，重试返回原结果（批次 ${payload.batchId}）。`
                : `隔离待核项已确认修复并补登审计（批次 ${payload.batchId}）。`,
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  resetReviewData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.resetReviewData),
      switchMap(() =>
        this.graphql.resetReviewData().pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "评审演示数据已恢复，旧数据已重新回填并对账。",
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}
