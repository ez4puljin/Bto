const {
  Button,
  ColumnChooser,
  Combobox,
  DateFilter,
  FilterBar,
  FilterChip,
  FilterToggle,
  NativeSelect,
  SearchField,
  BtoProvider,
} = Bto;

const SUPPLIERS = [
  { value: '1', label: 'МСМ ХХК' },
  { value: '2', label: 'Номин Трейд' },
  { value: '3', label: 'Хангай Хүнс' },
];
const COLUMNS = { code: 'Код', name: 'Нэр', supplier: 'Нийлүүлэгч', price: 'Үнэ' };

function Demo() {
  const [search, setSearch] = React.useState('');
  const [warehouse, setWarehouse] = React.useState('');
  const [active, setActive] = React.useState(true);
  const [date, setDate] = React.useState(undefined);
  const [supplier, setSupplier] = React.useState('');
  const [chip, setChip] = React.useState(true);
  const [hidden, setHidden] = React.useState(new Set());
  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
  };
  return (
    <div className="p-4">
      <FilterBar
        className="mb-0"
        end={
          <ColumnChooser
            keys={Object.keys(COLUMNS)}
            locked={['code']}
            label={(key) => COLUMNS[key]}
            hidden={hidden}
            toggle={toggle}
            showAll={() => setHidden(new Set())}
          />
        }
      >
        <SearchField
          placeholder="Бараа хайх"
          aria-label="Бараа хайх"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <NativeSelect
          variant="filter"
          aria-label="Агуулах"
          value={warehouse}
          onChange={(event) => setWarehouse(event.target.value)}
        >
          <option value="">Бүх агуулах</option>
          <option value="hall">Заал</option>
        </NativeSelect>
        <FilterToggle label="Идэвхтэй" checked={active} onCheckedChange={setActive} />
        <DateFilter label="Огноо" value={date} onChange={setDate} />
        <Combobox
          aria-label="Нийлүүлэгч"
          value={supplier}
          options={SUPPLIERS}
          emptyLabel="Бүх нийлүүлэгч"
          onChange={setSupplier}
        />
        {chip ? (
          <FilterChip clearLabel="Арилгах" onClear={() => setChip(false)}>
            Ангилал: Хүнс
          </FilterChip>
        ) : null}
      </FilterBar>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
