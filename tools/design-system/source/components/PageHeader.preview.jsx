const { Badge, Button, PageHeader, BtoProvider, icons: { Plus, Printer } } = Bto;

function Demo() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <BtoProvider route="/inventory/receipts">
        <PageHeader
          title="Орлого"
          description="Нийлүүлэгчээс ирсэн бараа, үнэ, тоо хэмжээ."
          actions={<Button><Plus />Шинэ орлого</Button>}
        />
      </BtoProvider>
      <BtoProvider route="/inventory/receipts/4">
        <PageHeader
          title="Падаан №4"
          meta={<><Badge variant="success">Батлагдсан</Badge><span>2026-11-01</span><span>МСМ ХХК</span></>}
          actions={<><Button variant="outline"><Printer />Хэвлэх</Button><Button>Батлах</Button></>}
        />
      </BtoProvider>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <Demo />,
);
