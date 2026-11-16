import { APP } from '../config/app';

/**
 * The staff app's look of 2026-11-16 (the owner's «шинэчилсэн загвар» boards): shared pieces draw
 * their staff form when this is true, and «Bto300» keeps its E-mart look (ADR-0095) when it is not.
 */
export const STAFF_LOOK = APP.variant === 'staff';
