const { ModuleTile, BtoProvider, icons: { Landmark, Package, PackagePlus, Warehouse } } = Bto;

function Demo() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-3 gap-3">
        <ModuleTile to="/m/inventory" icon={Warehouse} label="Агуулах" />
        <ModuleTile to="/m/catalog" icon={Package} label="Бараа" />
        <ModuleTile to="/inventory/receipts?new=1" icon={PackagePlus} label="Шинэ орлого" variant="action" />
      </div>
      <p className="text-xs text-muted-foreground">Module page: a page · a shortcut. Under the pointer it lifts.</p>
      <div className="grid grid-cols-3 gap-1">
        <ModuleTile to="/m/inventory" icon={Warehouse} label="Агуулах" variant="home" />
        <ModuleTile to="/m/catalog" icon={Package} label="Бараа" variant="home" />
        <ModuleTile to="/m/finance" icon={Landmark} label="Санхүү" variant="home" />
      </div>
      <p className="text-xs text-muted-foreground">Home page: flatter, tinted under the pointer.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
