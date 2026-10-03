import { Injectable, inject } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap } from "rxjs";
import { ReviewGraphqlService } from "../services/graphql.service";
import type {
  ClarificationMutationResult,
  FinalizeVersionResult,
  SubmitAssessmentResult,
} from "../models/review.models";
import { ReviewActions } from "./review.actions";

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "GraphQL 请求失败，请检查本地 mock server。";
};

type MutationOutcome =
  | SubmitAssessmentResult
  | ClarificationMutationResult
  | FinalizeVersionResult;

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
          switchMap((result) => {
            if ("currentRevision" in result) {
              return of(
                ReviewActions.conflictDetected({
                  conflict: {
                    message: result.message,
                    responseId: result.responseId,
                    latestBy: result.latestBy,
                    latestAt: result.latestAt,
                    latestDetail: result.latestDetail,
                  },
                }),
              );
            }
            if (!("opinion" in result)) {
              return of(
                ReviewActions.loadReviewDataFailure({
                  error: result.message,
                }),
              );
            }
            return this.graphql.loadWorkspace().pipe(
              map(({ workspace }) =>
                ReviewActions.loadReviewDataSuccess({
                  workspace,
                  toast: result.receipt.replayed
                    ? "该批次已提交，已返回原始意见，未重复追加。"
                    : "评审意见已提交并写入审计批次，其他评审员意见保持不变。",
                }),
              ),
            );
          }),
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

  requestClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.requestClarification),
      switchMap(({ input }) =>
        this.graphql.requestClarification(input).pipe(
          switchMap((result) => {
            if ("currentRevision" in result) {
              return of(
                ReviewActions.conflictDetected({
                  conflict: {
                    message: result.message,
                    responseId: result.responseId,
                    latestBy: result.latestBy,
                    latestAt: result.latestAt,
                    latestDetail: result.latestDetail,
                  },
                }),
              );
            }
            if (!("clarification" in result)) {
              return of(
                ReviewActions.loadReviewDataFailure({
                  error: result.message,
                }),
              );
            }
            return this.graphql.loadWorkspace().pipe(
              map(({ workspace }) =>
                ReviewActions.loadReviewDataSuccess({
                  workspace,
                  toast: result.receipt.replayed
                    ? "该批次已提交，已返回原始澄清，未重复追加。"
                    : "澄清要求已发出，并写入审计批次。",
                }),
              ),
            );
          }),
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

  respondClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.respondClarification),
      switchMap(({ input }) =>
        this.graphql.respondClarification(input).pipe(
          switchMap((result) => {
            if ("currentRevision" in result) {
              return of(
                ReviewActions.conflictDetected({
                  conflict: {
                    message: result.message,
                    responseId: result.responseId,
                    latestBy: result.latestBy,
                    latestAt: result.latestAt,
                    latestDetail: result.latestDetail,
                  },
                }),
              );
            }
            if (!("clarification" in result)) {
              return of(
                ReviewActions.loadReviewDataFailure({
                  error: result.message,
                }),
              );
            }
            return this.graphql.loadWorkspace().pipe(
              map(({ workspace }) =>
                ReviewActions.loadReviewDataSuccess({
                  workspace,
                  toast: result.receipt.replayed
                    ? "该批次已提交，已返回原始回复，未重复登记。"
                    : "澄清回复已登记，等待评审员复核。",
                }),
              ),
            );
          }),
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

  finalizeVersion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.finalizeVersion),
      switchMap(({ input }) =>
        this.graphql.finalizeVersion(input).pipe(
          switchMap((result) => {
            if ("currentRevision" in result) {
              return of(
                ReviewActions.conflictDetected({
                  conflict: {
                    message: result.message,
                    latestBy: result.latestBy,
                    latestAt: result.latestAt,
                    latestDetail: result.latestDetail,
                  },
                }),
              );
            }
            if (!("version" in result)) {
              return of(
                ReviewActions.loadReviewDataFailure({
                  error: result.message,
                }),
              );
            }
            return this.graphql.loadWorkspace().pipe(
              map(({ workspace }) =>
                ReviewActions.loadReviewDataSuccess({
                  workspace,
                  toast: result.receipt.replayed
                    ? "定稿批次已提交，已返回原始版本，未重复定稿。"
                    : "评审版本已汇总签字并锁定，内容哈希已复核。",
                }),
              ),
            );
          }),
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
      switchMap(({ issueId, note, actor }) =>
        this.graphql
          .resolveQuarantine({
            issueId,
            note,
            actor,
            role: "chair",
          })
          .pipe(
            switchMap(() => this.graphql.loadWorkspace()),
            map(({ workspace }) =>
              ReviewActions.loadReviewDataSuccess({
                workspace,
                toast: "对账问题已由组长确认修复，隔离已解除。",
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

  rerunReconciliation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.rerunReconciliation),
      switchMap(({ role }) =>
        this.graphql.rerunReconciliation(role).pipe(
          switchMap((reconciliation) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) =>
                ReviewActions.loadReviewDataSuccess({
                  workspace: { ...workspace, reconciliation },
                  toast: "已重新与当前数据对账。",
                }),
              ),
            ),
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
              toast: "评审演示数据已恢复并重新对账。",
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
