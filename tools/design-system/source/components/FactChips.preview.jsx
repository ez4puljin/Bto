const { Badge, FactChips, PanelSection, TotalsGrid, BtoProvider } = Bto;

function Demo() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <FactChips
        facts={[
          { label: 'Харилцагч', value: 'Оргил Бөөний төв' },
          { label: 'Огноо', value: '2026-11-01' },
          { label: 'Төлбөр', value: <Badge variant="warning">Зээл</Badge> },
        ]}
      />
      <PanelSection title="Дүн">
        <TotalsGrid
          items={[
            ['Нийт', '1,240,500₮'],
            ['НӨАТ', '112,773₮'],
            ['Төлсөн', '500,000₮'],
            ['Үлдэгдэл', '740,500₮'],
          ]}
        />
      </PanelSection>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
