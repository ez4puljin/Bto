const { Label, Switch, BtoProvider } = Bto;

function Demo() {
  const [on, setOn] = React.useState(true);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Switch id="active" checked={on} onCheckedChange={setOn} />
        <Label htmlFor="active">Идэвхтэй</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch disabled aria-label="Идэвхгүй" />
        <Switch disabled checked aria-label="Идэвхгүй, асаалттай" />
        <span className="text-xs text-muted-foreground">Disabled</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
