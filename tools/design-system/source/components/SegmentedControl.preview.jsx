const { SegmentedControl, BtoProvider } = Bto;

const STATE = { all: 'Бүгд', late: 'Хоцорсон', waiting: 'Ирээгүй' };
const PAPER = { a4: 'A4', roll: '80 мм' };

function Demo() {
  const [state, setState] = React.useState('all');
  const [paper, setPaper] = React.useState('a4');
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <SegmentedControl
        options={Object.keys(STATE)}
        value={state}
        label={(key) => STATE[key]}
        onChange={setState}
        name="Төлөв"
      />
      <SegmentedControl
        options={Object.keys(PAPER)}
        value={paper}
        label={(key) => PAPER[key]}
        onChange={setPaper}
        name="Цаасны хэмжээ"
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
