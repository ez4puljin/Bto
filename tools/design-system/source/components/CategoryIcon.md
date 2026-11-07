A product category's drawing: one of 96 flat, coloured icons on a soft tile.

**Parts:** `CategoryIcon` (the drawing as an image, `size-7` unless `className` says otherwise), `CategoryIconField` (the field of the category's dialog), `suggestCategoryIcon(name)` and `CATEGORY_ICON_KEYS` from `@tugeel/shared/category-icons`.

**Consumer provides:** the category's `name` and its `iconKey` (null follows the name). The field keeps `''` for "follow the name".

**Rules:** the name decides by default, the particular word before the general one («Иштэй чихэр» is a lollipop, «Элсэн чихэр, Давс» salt); a name with no known word gets the bag. A chosen drawing stays until «Автомат болгох». A top category's own picture comes before its icon in the apps. The drawings carry their own colours and their tile: do not tint them, crop them or set them on a coloured ground, and do not use them for anything but product categories. The phones draw the same strings with `SvgXml`.
