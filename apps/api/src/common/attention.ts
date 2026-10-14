/**
 * The home page's attention counts stop here; the web shows «99+» (ADR-0047 #7). A count of the
 * work waiting for someone never needs to be exact beyond that, and the cap keeps it cheap.
 */
export const ATTENTION_CAP = 100;
