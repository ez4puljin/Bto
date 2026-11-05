A short list of a record's other actions, opened from a «⋯» button or a named outline button.

**When:** a sub-item with several actions keeps the frequent one as an icon button and the rest here. A view chooser uses radio items («Самбараар», «Жагсаалтаар»).

**Consumer provides:** the trigger (named «{item}: үйлдэл»), the items and their icons. Pass `modal={false}` in a row of a list.

**Rules:** destructive items come last, after a separator. A dialog opened from the menu gives the focus back to the menu button. A highlighted item is tinted `secondary`. Width runs from `menu-min` to `menu-max`.
