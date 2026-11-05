const { Checkbox, Label, BtoProvider } = Bto;

const ROWS = ['Заал', 'Төв агуулах', 'Заалны архи'];

function Demo() {
  const [ticked, setTicked] = React.useState(['Заал']);
  const all = ticked.length === ROWS.length ? true : ticked.length === 0 ? false : 'indeterminate';
  return (
    <div className="flex flex-wrap items-start gap-10 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="all"
            checked={all}
            onCheckedChange={(next) => setTicked(next === true ? ROWS : [])}
          />
          <Label htmlFor="all">Бүгдийг сонгох</Label>
        </div>
        {ROWS.map((row) => (
          <div key={row} className="flex items-center gap-2 pl-5">
            <Checkbox
              id={row}
              checked={ticked.includes(row)}
              onCheckedChange={(next) =>
                setTicked(next === true ? [...ticked, row] : ticked.filter((item) => item !== row))
              }
            />
            <Label htmlFor={row} className="font-normal">
              {row}
            </Label>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox disabled aria-label="Идэвхгүй" />
        <Checkbox disabled checked aria-label="Идэвхгүй, сонгосон" />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
