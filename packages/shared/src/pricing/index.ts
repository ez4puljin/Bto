/**
 * Pricing (ADR-0041, ADR-0048): one warehouse price per product and a price profile that derives
 * the loose, supermarket and supermarket bulk prices, and discount programs that all stack in a
 * fixed order. The resolver is pure: the api fetches what is in force on a date and passes it in;
 * the web shows its explanation and previews prices with the same functions.
 */
export * from './discounts';
export * from './profile';
export * from './cart';
export * from './deals';
