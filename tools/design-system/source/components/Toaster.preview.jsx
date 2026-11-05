const { Button, BtoProvider, pauseToasts, toast, Toaster } = Bto;

function Demo() {
  // Held on screen for the preview; in the app a toast leaves after 4 s, or 4 s after the pointer moves off.
  React.useEffect(() => {
    toast.success('Хадгалагдлаа');
    toast.warning('Төлбөрийн хугацаа хэтэрсэн');
    pauseToasts();
  }, []);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => toast.success('Хадгалагдлаа')}>success</Button>
        <Button variant="outline" size="sm" onClick={() => toast.info('Хуулагдлаа')}>info</Button>
        <Button variant="outline" size="sm" onClick={() => toast.warning('Төлбөрийн хугацаа хэтэрсэн')}>warning</Button>
      </div>
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
