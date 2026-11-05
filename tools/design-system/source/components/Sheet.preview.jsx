const {
  Badge,
  Button,
  ButtonRow,
  ChevronHead,
  FactChips,
  ListCard,
  ListTable,
  PanelSection,
  RecordSheet,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TotalsGrid,
  BtoProvider,
  icons: { Printer },
} = Bto;

const COLUMNS = [
  { key: 'number', kind: 'number' },
  { key: 'customer', kind: 'text' },
  { key: 'total', kind: 'money' },
  { key: 'status', kind: 'status' },
  { key: 'chevron', kind: 'chevron' },
];

function Demo() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-3 p-4">
      <ListCard>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>Дугаар</TableHead>
              <TableHead>Харилцагч</TableHead>
              <TableHead className="text-right">Нийт</TableHead>
              <TableHead>Төлөв</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <ButtonRow onOpen={() => setOpen(true)}>
              <TableCell className="font-mono">
                <button
                  type="button"
                  className="text-link hover:underline"
                  onClick={() => setOpen(true)}
                >
                  20261015_0003
                </button>
              </TableCell>
              <TableCell>Оргил Бөөний төв</TableCell>
              <TableCell className="text-right font-mono">1,240,500₮</TableCell>
              <TableCell>
                <Badge variant="success">Батлагдсан</Badge>
              </TableCell>
            </ButtonRow>
          </TableBody>
        </ListTable>
      </ListCard>
      <p className="text-xs text-muted-foreground">Open the row: a record panel from the right.</p>
      <RecordSheet
        open={open}
        onClose={() => setOpen(false)}
        title="20261015_0003"
        description="Оргил Бөөний төв · Агуулахын борлуулалт"
        badges={
          <>
            <Badge variant="success">Батлагдсан</Badge>
            <Badge variant="warning">Зээл</Badge>
          </>
        }
        actions={
          <Button variant="outline" size="sm">
            <Printer />
            Хэвлэх
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <FactChips
            facts={[
              { label: 'Огноо', value: '2026-10-15' },
              { label: 'Агуулах', value: 'Заал' },
            ]}
          />
          <PanelSection title="Дүн">
            <TotalsGrid
              items={[
                ['Нийт', '1,240,500₮'],
                ['НӨАТ', '112,773₮'],
                ['Төлсөн', '500,000₮'],
                ['Үлдэгдэл', '740,500₮'],
              ]}
            />
          </PanelSection>
        </div>
      </RecordSheet>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
