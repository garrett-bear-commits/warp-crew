// grants contract entry (isomorphic): types + closed enums re-exported from @foundation/contracts.
export type {
  Grant,
  GrantReward,
  GrantClaimBody,
  GrantClaimResult,
  GrantClaimBatchBody,
  GrantClaimBatchResult,
  GrantsPendingResponse,
  CodeRedeemBody,
  CodeRedeemResult,
} from '@foundation/contracts';
export { GRANT_REWARD_KINDS, GRANT_SOURCES } from '@foundation/contracts/enums';
