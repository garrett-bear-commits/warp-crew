import { wallClockProgress, makeTimedJob, regenAmount, MS_PER_HOUR } from '../src/shared/timer.js';

const job = makeTimedJob({ id: 't', kind: 'test', minutes: 60, startedAt: 0 });
const p = wallClockProgress(job, 30 * 60 * 1000);
if (Math.abs(p.progress - 0.5) > 0.001) throw new Error('progress expected 0.5');
if (!wallClockProgress(job, 60 * 60 * 1000).complete) throw new Error('should complete');

const reg = regenAmount({ lastClaimAt: 0, ratePerHour: 1, max: 10, current: 0, now: MS_PER_HOUR * 3 });
if (Math.floor(reg.gained) !== 3) throw new Error('regen 3 expected, got ' + reg.gained);

console.log('timer.test.mjs OK');
