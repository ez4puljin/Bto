const {
  Button,
  BtoProvider,
  icons: { Ellipsis, Pencil, Plus, Search, X },
} = Bto;

function Demo() {
  const [pending, setPending] = React.useState(false);
  const save = () => {
    setPending(true);
    setTimeout(() => setPending(false), 1500);
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button>Хадгалах</Button>
        <Button variant="secondary">
          <Pencil />
          Засах
        </Button>
        <Button variant="outline">Хэвлэх</Button>
        <Button variant="ghost">Болих</Button>
        <Button variant="destructive">Устгах</Button>
        <Button variant="link">Цааш үзэх</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Variants: default, secondary, outline, ghost, destructive, link
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg">Төлбөр (F12)</Button>
        <Button>Хадгалах</Button>
        <Button variant="outline" size="sm">
          <Plus />
          Нэмэх
        </Button>
        <Button variant="outline" size="xs">
          Хасах
        </Button>
        <Button variant="ghost" size="icon" aria-label="Хайх" title="Хайх">
          <Search />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Үйлдэл" title="Үйлдэл">
          <Ellipsis />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Хаах" title="Хаах">
          <X />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sizes: lg, default, sm, xs, icon, icon-sm, icon-xs
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button pending={pending} onClick={save}>
          Хадгалах
        </Button>
        <Button pending>Хадгалж байна</Button>
        <Button disabled>Хадгалах</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Press the first for 1.5 s of pending · pending · disabled. Tab shows the focus ring.
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
