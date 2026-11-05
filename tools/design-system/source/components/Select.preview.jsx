const { NativeSelect, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, BtoProvider } =
  Bto;

function Demo() {
  const [warehouse, setWarehouse] = React.useState('');
  const [filter, setFilter] = React.useState('hall');
  const [view, setView] = React.useState('board');
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          className="max-w-60"
          aria-label="Агуулах"
          value={warehouse}
          onChange={(event) => setWarehouse(event.target.value)}
        >
          <option value="">Агуулах сонгоно уу</option>
          <option value="hall">Заал</option>
          <option value="main">Төв агуулах</option>
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label="Агуулах"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="">Бүх агуулах</option>
          <option value="hall">Заал</option>
          <option value="main">Төв агуулах</option>
        </NativeSelect>
      </div>
      <p className="text-xs text-muted-foreground">
        NativeSelect: default · filter pill, tinted while it narrows the list (choose «Бүх агуулах»)
      </p>
      <div>
        <Select value={view} onValueChange={setView}>
          <SelectTrigger aria-label="Харуулах">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="board">Самбараар</SelectItem>
            <SelectItem value="list">Жагсаалтаар</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Select (Radix), where an item needs more than text
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
