const { Combobox, BtoProvider } = Bto;

const OPTIONS = [
  { value: '1', label: 'МСМ ХХК', hint: '12' },
  { value: '2', label: 'Оргил Бөөний төв', hint: '48' },
  { value: '3', label: 'Боломж бөөний төв', hint: '7' },
  { value: '4', label: 'Номин Трейд', hint: '21' },
  { value: '5', label: 'Хангай Хүнс', hint: '3' },
];

function Demo() {
  const [value, setValue] = React.useState('1');
  return (
    <div className="p-4">
      <Combobox aria-label="Нийлүүлэгч" value={value} options={OPTIONS} emptyLabel="Бүх нийлүүлэгч" onChange={setValue} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
