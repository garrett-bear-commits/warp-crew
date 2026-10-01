// Live ops workspace: publish a flag, publish content, compensate a cohort (reward fields as in
// Mint grant, rewards.ts).
import type { AppCtx } from './context.ts';
import { bindRewardFields, REWARD_SPEC, withRewards } from './rewards.ts';
import { qs } from './ui.ts';
import { bindWriteForm, type FieldSpec } from './writes.ts';

const DEFAULT_PREDICATE = '{"fact":"registered","op":"eq","value":true}';
const DEFAULT_DOCUMENT = '{"version":1}';

const S = (name: string, label: string, kind: FieldSpec['kind'] = 'string'): FieldSpec => ({
  name,
  label,
  kind,
});

function setDefault(form: HTMLFormElement, name: string, value: string): void {
  (form.elements.namedItem(name) as HTMLTextAreaElement).defaultValue = value;
}

export function mountLiveops(ctx: AppCtx): void {
  const view = qs(ctx.root, '[data-view-panel="liveops"]');

  const flag = view.querySelector<HTMLFormElement>('#form-publish-flag');
  if (flag)
    bindWriteForm(ctx.writes, flag, {
      kind: 'publishFlag',
      path: '/admin/v1/liveops/flags',
      spec: [
        S('key', 'Key'),
        S('enabled', 'Enabled', 'bool'),
        S('value', 'Value', 'flag-value'),
        S('rolloutPercent', 'Rollout %', 'int'),
        S('segmentId', 'Segment', 'optional-string'),
        S('shadow', 'Shadow', 'optional-bool'),
        S('reason', 'Reason'),
      ],
    });

  const content = view.querySelector<HTMLFormElement>('#form-publish-content');
  if (content) {
    setDefault(content, 'document', DEFAULT_DOCUMENT);
    bindWriteForm(ctx.writes, content, {
      kind: 'publishContent',
      path: '/admin/v1/liveops/content',
      spec: [
        S('kind', 'Kind'),
        S('env', 'Environment'),
        S('document', 'Document', 'json'),
        S('minBuildVersion', 'Min build', 'optional-string'),
        S('reason', 'Reason'),
      ],
    });
  }

  const cohort = view.querySelector<HTMLFormElement>('#form-cohort');
  if (cohort) {
    setDefault(cohort, 'predicate', DEFAULT_PREDICATE);
    bindRewardFields(cohort);
    const dryRun = cohort.elements.namedItem('dryRun') as HTMLInputElement;
    const submit = qs<HTMLButtonElement>(cohort, 'button[type="submit"]');
    const sync = (): void => {
      submit.textContent = dryRun.checked ? 'Review dry run' : 'Review cohort grant';
      submit.className = `btn ${dryRun.checked ? 'btn-primary' : 'btn-danger'}`;
    };
    dryRun.addEventListener('change', sync);
    cohort.addEventListener('reset', () => globalThis.setTimeout(sync, 0));
    sync();
    bindWriteForm(ctx.writes, cohort, {
      kind: 'cohortGrant',
      path: '/admin/v1/grants/cohort',
      spec: [
        S('grantKeyPrefix', 'Grant key prefix'),
        S('predicate', 'Segment', 'json'),
        ...REWARD_SPEC,
        S('reason', 'Reason'),
        S('ticketRef', 'Ticket', 'optional-string'),
        S('dryRun', 'Dry run', 'bool'),
        S('title', 'Title', 'optional-string'),
        S('body', 'Body', 'optional-string'),
      ],
      build: withRewards,
    });
  }
}
