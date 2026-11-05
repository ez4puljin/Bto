const {
  Button, BtoProvider, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuTrigger, icons: { ChevronDown, Ellipsis, Pencil, Printer, Trash2 },
} = Bto;

function Demo() {
  const [view, setView] = React.useState('board');
  return (
    <div className="flex items-start gap-3 p-4">
      <DropdownMenu modal={false} defaultOpen>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Падаан: үйлдэл" title="Падаан: үйлдэл"><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuLabel>Падаан</DropdownMenuLabel>
          <DropdownMenuItem><Pencil />Засах</DropdownMenuItem>
          <DropdownMenuItem><Printer />Хэвлэх<DropdownMenuShortcut>Ctrl P</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive"><Trash2 />Устгах</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">{view === 'board' ? 'Самбараар' : 'Жагсаалтаар'}<ChevronDown /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={view} onValueChange={setView}>
              <DropdownMenuRadioItem value="board">Самбараар</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">Жагсаалтаар</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
