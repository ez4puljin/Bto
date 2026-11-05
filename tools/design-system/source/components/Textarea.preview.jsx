const { Textarea, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="p-4">
      <Textarea className="max-w-md" placeholder="Тэмдэглэл" aria-label="Тэмдэглэл" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
