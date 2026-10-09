import { JOB_NAME_PATTERN, JOB_QUEUES } from './job-registry';

describe('job registry', () => {
  it('names every queue <module>.<verb>', () => {
    for (const name of Object.keys(JOB_QUEUES)) expect(name).toMatch(JOB_NAME_PATTERN);
  });

  it('gives every queue explicit retry, expiry and retention settings', () => {
    for (const options of Object.values(JOB_QUEUES)) {
      expect(options.retryLimit).toBeGreaterThanOrEqual(0);
      expect(options.expireInSeconds).toBeGreaterThan(0);
      expect(options.retentionSeconds).toBeGreaterThan(0);
    }
  });
});
