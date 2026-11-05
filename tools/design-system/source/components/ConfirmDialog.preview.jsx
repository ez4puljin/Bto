const { Button, ConfirmDialog, Toaster, toast, BtoProvider, icons: { Trash2 } } = Bto;

function Demo() {
  const [post, setPost] = React.useState(false);
  const [remove, setRemove] = React.useState(false);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setPost(true)}>Падаан батлах</Button>
        <Button variant="destructive" onClick={() => setRemove(true)}><Trash2 />Падаан устгах</Button>
      </div>
      <p className="text-xs text-muted-foreground">Open each: posting focuses its main button, so Enter confirms; a destructive one keeps «Болих» first in line.</p>
      <ConfirmDialog
        open={post}
        variant="default"
        title="Падааныг батлах уу?"
        description="Батласны дараа засах боломжгүй."
        confirmLabel="Батлах"
        onConfirm={() => { setPost(false); toast.success('Батлагдлаа'); }}
        onClose={() => setPost(false)}
      />
      <ConfirmDialog
        open={remove}
        title="Падааныг устгах уу?"
        description="Устгасны дараа буцаах боломжгүй."
        confirmLabel="Устгах"
        onConfirm={() => { setRemove(false); toast.info('Устгагдлаа'); }}
        onClose={() => setRemove(false)}
      />
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
