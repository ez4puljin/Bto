const {
  Button,
  SelectionBar,
  BtoProvider,
  icons: { ChevronDown },
} = Bto;

function Demo() {
  const [count, setCount] = React.useState(3);
  return (
    <div className="p-4">
      {count === 0 ? (
        <Button variant="outline" size="sm" onClick={() => setCount(3)}>
          3 мөр сонгох
        </Button>
      ) : null}
      <SelectionBar count={count} onClear={() => setCount(0)}>
        <Button variant="outline" size="sm">
          Хэвлэх
        </Button>
        <Button variant="outline" size="sm">
          Засах
          <ChevronDown />
        </Button>
      </SelectionBar>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
