const {
  Badge,
  Checkbox,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toaster,
  toast,
  TruncateCell,
  BtoProvider,
  icons: { Pencil, Trash2 },
} = Bto;

const COLUMNS = [
  { key: 'check', kind: 'check' },
  { key: 'code', kind: 'number' },
  { key: 'name', kind: 'text', weight: 3 },
  { key: 'supplier', kind: 'text', weight: 2 },
  { key: 'price', kind: 'money' },
  { key: 'status', kind: 'status' },
  { key: 'actions', kind: 'actions', actions: 2 },
];
const ROWS = [
  {
    code: '4006381333931',
    name: 'Тэмдэглэлийн дэвтэр',
    supplier: 'МСМ ХХК',
    price: '12,000₮',
    status: ['success', 'Идэвхтэй'],
  },
  {
    code: '4006381333948',
    name: 'Цаасан хавтас, маш урт нэртэй бараа, мөрөнд багтахгүй бол тасарна',
    supplier: 'Оргил Бөөний төв',
    price: '8,500₮',
    status: ['secondary', 'Ноорог'],
  },
  {
    code: '4006381333955',
    name: 'Харандаа, 12 ширхэг',
    supplier: 'Номин Трейд',
    price: '3,200₮',
    status: ['success', 'Идэвхтэй'],
  },
];

function Demo() {
  const [rows, setRows] = React.useState(ROWS);
  const [ticked, setTicked] = React.useState(new Set([ROWS[0].code]));
  const all =
    rows.length > 0 && ticked.size === rows.length
      ? true
      : ticked.size === 0
        ? false
        : 'indeterminate';
  const tick = (code, next) => {
    const set = new Set(ticked);
    if (next === true) set.add(code);
    else set.delete(code);
    setTicked(set);
  };
  return (
    <div className="p-4">
      <ListCard>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label="Бүгдийг сонгох"
                  checked={all}
                  onCheckedChange={(next) =>
                    setTicked(new Set(next === true ? rows.map((row) => row.code) : []))
                  }
                />
              </TableHead>
              <TableHead>Код</TableHead>
              <TableHead>Нэр</TableHead>
              <TableHead>Нийлүүлэгч</TableHead>
              <TableHead className="text-right">Үнэ</TableHead>
              <TableHead>Төлөв</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.code} data-state={ticked.has(row.code) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={row.name + ' сонгох'}
                    checked={ticked.has(row.code)}
                    onCheckedChange={(next) => tick(row.code, next)}
                  />
                </TableCell>
                <TableCell className="font-mono">{row.code}</TableCell>
                <TruncateCell text={row.name} />
                <TruncateCell text={row.supplier} />
                <TableCell className="text-right font-mono">{row.price}</TableCell>
                <TableCell>
                  <Badge variant={row.status[0]}>{row.status[1]}</Badge>
                </TableCell>
                <RowActions>
                  <RowAction
                    label={'Засах: ' + row.name}
                    icon={Pencil}
                    onClick={() => toast.info(row.name)}
                  />
                  <RowAction
                    label={'Устгах: ' + row.name}
                    icon={Trash2}
                    destructive
                    onClick={() => {
                      setRows(rows.filter((item) => item !== row));
                      tick(row.code, false);
                    }}
                  />
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
      </ListCard>
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
