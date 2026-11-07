const {
  BtoProvider,
  CATEGORY_ICON_KEYS,
  CategoryIcon,
  CategoryIconField,
  Input,
  Label,
  suggestCategoryIcon,
} = Bto;

const EXAMPLES = [
  '911 Дарс виски',
  '941 Сүү',
  'Гурил, будаа, гоймон',
  '942 Иштэй чихэр',
  '943 Памперс',
  'Электрон тамхи',
  'Шинэ ангилал',
];

function Demo() {
  const [name, setName] = React.useState('912 Пиво');
  const [chosen, setChosen] = React.useState('');
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_ICON_KEYS.map((key) => (
          <span key={key} title={key}>
            <CategoryIcon category={{ iconKey: key, name: '' }} className="size-9" />
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {CATEGORY_ICON_KEYS.length} drawings on a 64 px canvas; the tile is part of the drawing
      </p>
      <div className="grid max-w-xl gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-name">Ангиллын нэр</Label>
          <Input
            id="category-name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="flex items-center gap-1.5 rounded-md bg-fill px-2 py-1 text-xs hover:bg-accent"
                onClick={() => setName(example)}
              >
                <CategoryIcon category={{ iconKey: null, name: example }} className="size-5" />
                {example}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-icon">Дүрс</Label>
          <CategoryIconField id="category-icon" name={name} value={chosen} onChange={setChosen} />
        </div>
        <p className="text-xs text-muted-foreground">
          {chosen === '' ? 'follows the name: ' + suggestCategoryIcon(name) : 'chosen: ' + chosen}
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
