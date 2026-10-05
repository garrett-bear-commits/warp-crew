// saves contract entry (isomorphic): types + closed enums re-exported from @foundation/contracts.
export type {
  SaveWriteBody,
  SaveBeaconBody,
  SaveWriteResult,
  SaveCurrentResponse,
  SaveHistoryResponse,
  SaveBlobResponse,
  SnapshotMeta,
  PendingQuarantine,
  Divergence,
  Summary,
} from '@foundation/contracts';
export {
  SAVE_DISPOSITIONS,
  SAVE_FLAGS,
  SAVE_REASONS,
  SAVE_REFUSAL_REASONS,
  SYNC_VERDICTS,
} from '@foundation/contracts/enums';
export type {
  SaveDisposition,
  SaveFlag,
  SaveReason,
  SaveRefusalReason,
  SyncVerdict,
} from '@foundation/contracts/enums';
