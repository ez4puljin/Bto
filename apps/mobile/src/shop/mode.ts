/**
 * The shop list's two ways to use a card's cart (owner, 2026-11-17): «Энгийн горим», where the cart
 * opens the product, and «Хялбар горим», where it opens the quantity sheet on the list itself.
 * Kept on the phone (a preference of the phone, not of a user).
 */
export type CartMode = 'normal' | 'easy';

export const CART_MODE_KEY = 'bto.cartMode.v1';

export const DEFAULT_CART_MODE: CartMode = 'normal';

/** A stored value as a mode; anything else is the default. */
export function cartModeFrom(value: unknown): CartMode {
  return value === 'easy' || value === 'normal' ? value : DEFAULT_CART_MODE;
}
