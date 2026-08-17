// admin contract entry (isomorphic): types + closed enums re-exported from @foundation/contracts.
export type {
  PlayerOverview,
  TimelineResponse,
  TimelineItem,
  AdminGrantBody,
  AdminCohortGrantBody,
  AdminRestoreBody,
  AdminSaveReviewBody,
  AdminEraseBody,
  AdminPlayerFlagBody,
  AdminAdjustmentBody,
  AdminCodeCampaignBody,
  AdminOutboxReplayBody,
  AdminRebuildProjectionBody,
  AdminActionsResponse,
  OutboxDeadLettersResponse,
} from '@foundation/contracts';
export { ADMIN_SCOPES, HEADERS, type AdminScope } from '@foundation/contracts/enums';
