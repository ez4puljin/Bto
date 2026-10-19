import { assertNoStaticCaller, STATIC_CALLER_MARK } from './static-caller-guard';

const marks = globalThis as Record<symbol, unknown>;

describe('the StaticCaller boot guard (ADR-0084 #4)', () => {
  afterEach(() => {
    delete marks[STATIC_CALLER_MARK];
  });

  it('lets a production process start when no StaticCaller was loaded', () => {
    expect(() => assertNoStaticCaller('production')).not.toThrow();
  });

  it('refuses a production process in which the StaticCaller was loaded', () => {
    marks[STATIC_CALLER_MARK] = true;
    expect(() => assertNoStaticCaller('production')).toThrow(/StaticCaller/);
  });

  it('lets tests and development run with it', () => {
    marks[STATIC_CALLER_MARK] = true;
    expect(() => assertNoStaticCaller('test')).not.toThrow();
    expect(() => assertNoStaticCaller('development')).not.toThrow();
    expect(() => assertNoStaticCaller(undefined)).not.toThrow();
  });
});
