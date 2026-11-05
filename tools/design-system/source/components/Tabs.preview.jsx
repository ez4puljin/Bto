const { Tabs, TabsContent, TabsList, TabsTrigger, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="p-4">
      <Tabs defaultValue="general">
        <TabsList aria-label="Захиалгын хэсгүүд">
          <TabsTrigger value="general">Ерөнхий</TabsTrigger>
          <TabsTrigger value="lines">Бараа</TabsTrigger>
          <TabsTrigger value="history">Түүх</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="pt-2 text-[0.8125rem] text-muted-foreground">
          Харилцагч, огноо, төлбөрийн нөхцөл.
        </TabsContent>
        <TabsContent value="lines" className="pt-2 text-[0.8125rem] text-muted-foreground">
          12 мөр бараа, нийт 1,240,500₮.
        </TabsContent>
        <TabsContent value="history" className="pt-2 text-[0.8125rem] text-muted-foreground">
          2026-11-01 Батлагдсан.
        </TabsContent>
      </Tabs>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
