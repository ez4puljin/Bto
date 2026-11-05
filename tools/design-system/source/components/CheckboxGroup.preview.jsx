const { CheckboxGroup, BtoProvider } = Bto;

const OPTIONS = [
  { value: 'sales', label: 'Борлуулалт' },
  { value: 'inventory', label: 'Агуулах' },
  { value: 'finance', label: 'Санхүү' },
  { value: 'hr', label: 'Хүний нөөц', disabled: true },
];

function Demo() {
  const [value, setValue] = React.useState(['inventory']);
  return (
    <div className="max-w-md p-4">
      <CheckboxGroup name="modules" options={OPTIONS} value={value} onChange={setValue} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
