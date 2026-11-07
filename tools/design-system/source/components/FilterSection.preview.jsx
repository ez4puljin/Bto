const { BtoProvider, FilterChoices, FilterOption, FilterSection, FilterTree, ListCard } = Bto;

const CATEGORIES = [
  {
    id: 1,
    parentId: null,
    code: '910',
    title: 'Шингэн бүтээгдэхүүн',
    name: '910 Шингэн бүтээгдэхүүн',
    count: 64,
  },
  { id: 11, parentId: 1, code: '911', title: 'Дарс, виски', name: '911 Дарс, виски', count: 18 },
  { id: 12, parentId: 1, code: '912', title: 'Пиво', name: '912 Пиво', count: 21 },
  { id: 13, parentId: 1, code: '913', title: 'Жүүс, ундаа', name: '913 Жүүс, ундаа', count: 25 },
  { id: 2, parentId: null, code: '920', title: 'Амттан', name: '920 Амттан', count: 47 },
  {
    id: 21,
    parentId: 2,
    code: '921',
    title: 'Печень, жигнэмэг',
    name: '921 Печень, жигнэмэг',
    count: 29,
  },
  { id: 22, parentId: 2, code: '922', title: 'Шоколад', name: '922 Шоколад', count: 18 },
  {
    id: 3,
    parentId: null,
    code: '930',
    title: 'Гурил, будаа, гоймон',
    name: '930 Гурил, будаа, гоймон',
    count: 36,
  },
  { id: 31, parentId: 3, code: '931', title: 'Гурил', name: '931 Гурил', count: 14 },
  { id: 32, parentId: 3, code: '932', title: 'Гоймон', name: '932 Гоймон', count: 22 },
];
const STATUSES = ['ACTIVE', 'INACTIVE'];
const STATUS_NAMES = { ACTIVE: 'Идэвхтэй', INACTIVE: 'Идэвхгүй' };
const SEGMENTS = [
  { id: 1, name: 'Сегмент А', count: 7 },
  { id: 2, name: 'Сегмент Б', count: 12 },
];

function Demo() {
  const [category, setCategory] = React.useState(12);
  const [status, setStatus] = React.useState(null);
  const [segment, setSegment] = React.useState(undefined);
  const filters = [
    category === undefined ? null : 'category=' + category,
    status === null ? null : 'status=' + status,
    segment === undefined ? null : 'segment=' + segment,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-4 p-4">
      <aside aria-label="Барааны шүүлтүүр" className="w-64 shrink-0">
        <ListCard>
          <div className="px-3 py-2.5 text-sm font-semibold">Шүүлтүүр</div>
          <FilterSection title="Ангилал" defaultOpen active={category !== undefined}>
            <FilterTree
              rows={CATEGORIES}
              selected={category}
              onPick={setCategory}
              allLabel="Бүх бараа"
              searchLabel="Ангилал хайх"
              noMatchLabel="Олдсонгүй"
            />
          </FilterSection>
          <FilterSection title="Төлөв" defaultOpen active={status !== null}>
            <FilterChoices
              options={STATUSES}
              label={(value) => STATUS_NAMES[value]}
              value={status}
              onChange={setStatus}
            />
          </FilterSection>
          <FilterSection title="Сегмент" active={segment !== undefined}>
            {SEGMENTS.map((row) => (
              <FilterOption
                key={row.id}
                label={row.name}
                active={segment === row.id}
                hint={<span className="font-mono text-xs text-muted-foreground">{row.count}</span>}
                onClick={() => setSegment(segment === row.id ? undefined : row.id)}
              />
            ))}
          </FilterSection>
        </ListCard>
      </aside>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-muted-foreground">The list stands here. Its filters live in the URL:</p>
        <p className="mt-1 font-mono text-xs">
          {filters.length > 0 ? '?' + filters.join('&') : '(none)'}
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
