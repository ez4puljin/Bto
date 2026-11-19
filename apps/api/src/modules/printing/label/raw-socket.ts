import { connect } from 'node:net';

/** Why a network printer did not take the bytes. */
export class RawSendError extends Error {
  constructor(
    readonly reason: 'UNREACHABLE' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'RawSendError';
  }
}

/**
 * Writes bytes to a LAN printer's raw port (9100, «JetDirect»), waits for them to leave and
 * closes (ADR-0226 #4). Never called inside a database transaction.
 */
export function sendRaw(
  host: string,
  port: number,
  bytes: Buffer,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new RawSendError('TIMEOUT', `no answer from ${host}:${port}`)),
      timeoutMs,
    );
    socket.once('error', (error) =>
      finish(new RawSendError('UNREACHABLE', `${host}:${port}: ${error.message}`)),
    );
    socket.once('connect', () => {
      socket.end(bytes, () => finish());
    });
  });
}
