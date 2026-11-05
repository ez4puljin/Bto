const { BrandMark, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <BrandMark className="size-7 rounded-lg text-sm" />
        <BrandMark />
        <span className="flex items-center gap-2 text-[1.0625rem] font-semibold tracking-tight">
          <BrandMark className="size-7 rounded-lg text-sm" />
          Bto
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Top bar size · default (till, sign-in) · with the name</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
