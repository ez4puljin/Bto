/** `fetch` as e-Barimt's client uses it; tests give one, never the network's real hosts. */
export const EBARIMT_FETCH = Symbol('EBARIMT_FETCH');
/** The hosts of each environment; tests point both at a fake server. */
export const EBARIMT_HOSTS = Symbol('EBARIMT_HOSTS');
