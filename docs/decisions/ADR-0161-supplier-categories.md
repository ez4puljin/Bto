# ADR-0161: Supplier categories are a tree

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («ангилал гэсэн багана нэм. Ангилалын тохиргоо хийж өг. Ангилал дотроо дэд гэж болно»), Claude (Claude Code session) |

## Context

The owner wants the supplier list to show each supplier's category, a screen to keep the categories, and sub-categories inside a category. Customers already have a flat category list (ADR-0107); suppliers had none.

## Decision

1. **`supplier_categories`** in `partners`: a name, `parent_id` (NULL at the top), an order and `active`, to any depth. A name is unique among its siblings (`supplier_categories_parent_name_key`, NULLs equal), so «Бяслаг» may sit under two parents. Not shared with customers' categories, which stay flat (ADR-0107).
2. **One category per supplier**, optional (`suppliers.category_id`).
3. **Never deleted, like customers' categories.** A retired category stays on its suppliers and leaves the pickers. It retires only once nothing active sits below it (`SUPPLIER_CATEGORY_HAS_CHILDREN`), and a category cannot be moved under, made under or brought back under a retired one (`SUPPLIER_CATEGORY_INACTIVE`).
4. **No circles.** A category cannot be moved below itself. The service locks the table for a change, so two moves at once cannot close one; the database has no such check.
5. **Rights.** Every signed-in user reads them, as they read suppliers. `partners.suppliers.manage` keeps them and sets a supplier's category.
6. **Screens.** `/partners/supplier-categories` shows the tree with a count of suppliers in each branch. The supplier list has an «Ангилал» column showing the path and a filter that takes a category with everything below it. The supplier form has a choice of active categories, and keeps a retired one the supplier already has.
7. **By a product's category.** The owner also asked to filter suppliers by what they sell («Гурил» shows the suppliers with flour). `GET /suppliers?productCategoryId` keeps those linked to a product of that category or below it. This is the product catalog's own tree, apart from the suppliers' categories above. With it on, «Барааны тоо» counts that category's products. A click on the count shows the products in brief without leaving the list (picture, name, code, category, warehouse price, main supplier), read only once opened, with a link to the product list in a new tab.
8. **The left side.** From `lg` up the supplier list's filters stand on the left like the product list's: the product categories with a box that finds one by name, the suppliers' own categories, status and segments. The bar keeps them for a narrow window. The TIN joins the columns hidden by default below 1600px to make the room.

Not built, because they were not asked for: changing many suppliers' category at once, a category column in the supplier import, segment conditions on it and the assistant's view of it.

## Consequences

- Each page of the supplier list reads the categories once to name them. They are few, so this costs nothing that matters.
- The 380 suppliers on the dev database start without a category, one by one through the form until a bulk way is asked for.
