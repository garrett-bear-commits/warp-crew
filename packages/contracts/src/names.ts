import { Type, type Static } from '@sinclair/typebox';
import { Mutation, Response, StringEnum } from './common.ts';
import { NAME_CHECK_VERDICTS } from './enums.ts';

/** POST /v1/names/check {commandId, name} — screens a name before a game shows or sends it. */
export const NameCheckBody = Mutation(
  { name: Type.String({ minLength: 1, maxLength: 32 }) },
  { $id: 'NameCheckBody' },
);
export type NameCheckBody = Static<typeof NameCheckBody>;

export const NameCheckResult = Response(
  { verdict: StringEnum(NAME_CHECK_VERDICTS) },
  { $id: 'NameCheckResult' },
);
export type NameCheckResult = Static<typeof NameCheckResult>;
