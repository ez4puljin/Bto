const { ColumnChooser, BtoProvider } = Bto;

const COLUMNS = {
  code: 'Код',
  name: 'Нэр',
  supplier: 'Нийлүүлэгч',
  price: 'Үнэ',
  stock: 'Үлдэгдэл',
};

function Demo() {
  const [hidden, setHidden] = React.useState(new Set(['stock']));
  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
  };
  return (
    <div className="flex items-center gap-3 p-4">
      <ColumnChooser
        keys={Object.keys(COLUMNS)}
        locked={['code', 'name']}
        label={(key) => COLUMNS[key]}
        hidden={hidden}
        toggle={toggle}
        showAll={() => setHidden(new Set())}
      />
      <span className="text-[0.8125rem] text-muted-foreground">
        {Object.keys(COLUMNS)
          .filter((key) => !hidden.has(key))
          .map((key) => COLUMNS[key])
          .join(' · ')}
      </span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
