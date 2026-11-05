const { Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, BtoProvider, icons: { Printer } } = Bto;

function Demo() {
  return (
    <div className="p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Падааны нийт</CardTitle>
          <CardDescription>Нийлүүлэгчид төлөх дүн</CardDescription>
          <CardAction><Button variant="ghost" size="icon-sm" aria-label="Хэвлэх" title="Хэвлэх"><Printer /></Button></CardAction>
        </CardHeader>
        <CardContent><div className="font-mono text-[1.75rem] leading-tight font-semibold tracking-tight">1,240,500₮</div></CardContent>
        <CardFooter><span className="text-[0.8125rem] text-muted-foreground">12 мөр</span></CardFooter>
      </Card>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
