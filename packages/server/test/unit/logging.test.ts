import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { redactionPaths } from '../../src/logging.ts';

describe('structured log redaction', () => {
  it('removes signed purchase receipts from root, body, request-body, and nested event fields', () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const log = pino({ redact: { paths: redactionPaths(), censor: '[redacted]' } }, destination);
    const directSecret = 'direct-secret-jws';
    const batchSecret = 'batch-secret-jws';

    log.info({
      purchaseSigned: directSecret,
      purchasesSigned: batchSecret,
      body: { purchaseSigned: directSecret, purchasesSigned: batchSecret },
      req: { body: { purchaseSigned: directSecret, purchasesSigned: batchSecret } },
      extra: { purchaseSigned: directSecret, purchasesSigned: batchSecret },
      safe: 'visible',
    });

    const output = chunks.join('');
    expect(output).not.toContain(directSecret);
    expect(output).not.toContain(batchSecret);
    expect(output).toContain('visible');
    expect(output.match(/\[redacted\]/g)?.length).toBe(8);
  });
});
