const {
  EmptyState,
  ListCard,
  ListTable,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  BtoProvider,
} = Bto;

const COLUMNS = [
  { key: 'code', kind: 'number' },
  { key: 'name', kind: 'text' },
  { key: 'stock', kind: 'qty' },
];
const ROWS = [
  ['4006381333931', 'Тэмдэглэлийн дэвтэр', '120'],
  ['4006381333948', 'Цаасан хавтас', '48'],
  ['4006381333955', 'Харандаа, 12 ширхэг', '310'],
  ['4006381333962', 'Баллон үзэг', '75'],
  ['4006381333979', 'Хавчаар', '940'],
];
const STATES = { rows: 'Мөрүүд', loading: 'Ачаалж байна', empty: 'Хоосон' };

function Demo() {
  const [state, setState] = React.useState('rows');
  const [count, setCount] = React.useState(2);
  const [fetching, setFetching] = React.useState(false);
  const query = {
    hasNextPage: count < ROWS.length,
    isFetchingNextPage: fetching,
    fetchNextPage: () => {
      setFetching(true);
      setTimeout(() => {
        setCount((value) => value + 2);
        setFetching(false);
      }, 700);
    },
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <SegmentedControl
          options={Object.keys(STATES)}
          value={state}
          label={(key) => STATES[key]}
          onChange={setState}
          name="Төлөв"
        />
      </div>
      <ListCard>
        {state === 'empty' ? (
          <EmptyState title="Илэрц алга" onClearFilters={() => setState('rows')} />
        ) : (
          <>
            <ListTable columns={COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>Код</TableHead>
                  <TableHead>Нэр</TableHead>
                  <TableHead className="text-right">Үлдэгдэл</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state === 'loading' ? (
                  <SkeletonRows columns={3} rows={2} />
                ) : (
                  ROWS.slice(0, count).map((row) => (
                    <TableRow key={row[0]}>
                      <TableCell className="font-mono">{row[0]}</TableCell>
                      <TableCell>{row[1]}</TableCell>
                      <TableCell className="text-right font-mono">{row[2]}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </ListTable>
            {state === 'rows' ? <LoadMore query={query} /> : null}
          </>
        )}
      </ListCard>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
