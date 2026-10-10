import { AppError } from '../../../common/errors/app-error';
import { LoginLimiter } from './login-limiter.service';

describe('LoginLimiter', () => {
  const minute = 60_000;
  const limiter = () => new LoginLimiter({ perUser: 3, perIp: 5, windowMs: 15 * minute });

  it('blocks an IP + username after the limit and lifts the block after the window', () => {
    const subject = limiter();
    for (let i = 0; i < 3; i += 1) subject.recordFailure('203.0.113.1', 'bat', i * minute);
    expect(() => subject.assertAllowed('203.0.113.1', 'bat', 3 * minute)).toThrow(AppError);
    try {
      subject.assertAllowed('203.0.113.1', 'bat', 3 * minute);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        params: { retryAfterSeconds: 12 * 60 },
      });
    }
    expect(() => subject.assertAllowed('203.0.113.2', 'bat', 3 * minute)).not.toThrow();
    expect(() => subject.assertAllowed('203.0.113.1', 'dorj', 3 * minute)).not.toThrow();
    expect(() => subject.assertAllowed('203.0.113.1', 'bat', 15 * minute)).not.toThrow();
  });

  it('limits one IP across usernames and forgets a user after a success', () => {
    const subject = limiter();
    for (const name of ['a', 'b', 'c', 'd', 'e']) subject.recordFailure('198.51.100.7', name, 0);
    expect(() => subject.assertAllowed('198.51.100.7', 'f', minute)).toThrow(AppError);
    const other = limiter();
    other.recordFailure('192.0.2.1', 'bat', 0);
    other.recordFailure('192.0.2.1', 'bat', 0);
    other.recordSuccess('192.0.2.1', 'bat');
    other.recordFailure('192.0.2.1', 'bat', 0);
    expect(() => other.assertAllowed('192.0.2.1', 'bat', minute)).not.toThrow();
  });
});
