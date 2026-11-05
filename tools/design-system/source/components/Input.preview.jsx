const { Input, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid max-w-xl gap-3 grid-cols-2">
        <Input placeholder="Нэр" aria-label="Нэр" />
        <Input defaultValue="Оргил Бөөний төв" aria-label="Нэр" />
        <Input defaultValue="99" aria-invalid aria-label="Утас" />
        <Input defaultValue="Идэвхгүй" disabled aria-label="Идэвхгүй" />
      </div>
      <p className="text-xs text-muted-foreground">
        At rest · filled · in error · disabled. Click a field for its focus ring.
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
