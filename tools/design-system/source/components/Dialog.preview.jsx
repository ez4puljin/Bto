const {
  Button, Dialog, DialogContent, DialogDescription, DialogFormFooter, DialogHeader, DialogTitle,
  FormField, Input, Toaster, toast, BtoProvider,
} = Bto;

// The page's frames refuse a form's submit, so this preview answers the submit button and Enter itself.
const submitted = (save) => ({
  onClickCapture: (event) => {
    if (event.target.closest('button[type="submit"]')) {
      event.preventDefault();
      save();
    }
  },
  onKeyDownCapture: (event) => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      save();
    }
  },
});

function Demo() {
  // The first view shows open without taking the focus or the page's scroll. Reopened, it is the real modal.
  const [open, setOpen] = React.useState(true);
  const [firstView, setFirstView] = React.useState(true);
  const close = () => {
    setOpen(false);
    setFirstView(false);
  };
  return (
    <div className="p-4">
      <Button variant="outline" onClick={() => setOpen(true)}>Шинэ утга оруулах</Button>
      {open && firstView ? <div className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]" onClick={close} /> : null}
      <Dialog modal={!firstView} open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent
          onOpenAutoFocus={(event) => { if (firstView) event.preventDefault(); }}
          onInteractOutside={(event) => { if (firstView) event.preventDefault(); }}
        >
          <form className="grid gap-4" {...submitted(() => { close(); toast.success('Хадгалагдлаа'); })}>
            <DialogHeader>
              <DialogTitle>Шинэ утга оруулах</DialogTitle>
              <DialogDescription>Хүчинтэй болох огноогоо заана уу.</DialogDescription>
            </DialogHeader>
            <FormField label="Утга" htmlFor="value"><Input id="value" defaultValue="10" /></FormField>
            <DialogFormFooter pending={false} onCancel={close} />
          </form>
        </DialogContent>
      </Dialog>
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
