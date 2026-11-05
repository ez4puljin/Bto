const { Badge, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Хүлээгдэж буй</Badge>
        <Badge variant="secondary">Ноорог</Badge>
        <Badge variant="success">Батлагдсан</Badge>
        <Badge variant="warning">Татвар дутуу</Badge>
        <Badge variant="destructive">Зээл хаалттай</Badge>
        <Badge variant="outline">Цуцлагдсан</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        default in progress · secondary draft · success done · warning attention · destructive
        refused · outline cancelled
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
