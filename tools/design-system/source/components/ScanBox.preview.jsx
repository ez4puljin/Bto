const { Badge, ScanBox, BtoProvider } = Bto;

function Demo() {
  const [codes, setCodes] = React.useState([]);
  return (
    <div className="flex flex-col gap-2 p-4">
      <ScanBox onScan={(code) => setCodes((list) => [code, ...list].slice(0, 4))} />
      <div className="flex min-h-5.5 flex-wrap items-center gap-2">
        {codes.map((code, index) => <Badge key={index} variant="secondary" className="font-mono">{code}</Badge>)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
