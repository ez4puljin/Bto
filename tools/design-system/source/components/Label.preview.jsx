const { Input, Label, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="flex max-w-xs flex-col gap-1.5 p-4">
      <Label htmlFor="supplier">Нийлүүлэгч</Label>
      <Input id="supplier" placeholder="Нийлүүлэгч сонгоно уу" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
