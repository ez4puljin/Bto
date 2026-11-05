const { DateFilter, DateInput, MonthInput, TimeInput, BtoProvider } = Bto;

function Demo() {
  const [date, setDate] = React.useState('2026-11-01');
  const [month, setMonth] = React.useState('2026-11');
  const [time, setTime] = React.useState('08:30');
  const [from, setFrom] = React.useState('2026-11-01');
  const [to, setTo] = React.useState(undefined);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateInput className="w-44" value={date} onChange={setDate} aria-label="Огноо" />
        <MonthInput className="w-36" value={month} onChange={setMonth} aria-label="Сар" />
        <TimeInput className="w-32" value={time} onChange={setTime} aria-label="Цаг" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DateFilter label="Эхлэх" value={from} onChange={setFrom} />
        <DateFilter label="Дуусах" value={to} onChange={setTo} />
      </div>
      <p className="text-xs text-muted-foreground">
        Fields · filter pills, tinted while they narrow the list. Open a calendar with its button;
        try typing 20261101.
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
