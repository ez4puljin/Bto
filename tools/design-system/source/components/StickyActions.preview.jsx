const { Button, StickyActions, Toaster, toast, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="p-4">
      <StickyActions summary="12 мөр · 2 зөрүү · нийт 1,240,500₮">
        <Button variant="outline" onClick={() => toast.success('Хадгалагдлаа')}>
          Хадгалах
        </Button>
        <Button onClick={() => toast.success('Батлагдлаа')}>Батлах</Button>
      </StickyActions>
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
