const {
  Button,
  DetailCard,
  FieldList,
  FormFooter,
  FormRow,
  FormSection,
  Input,
  toast,
  Toaster,
  BtoProvider,
} = Bto;

// The page's frames refuse a form's submit, so this preview answers the submit button and Enter itself.
const submitted = (save) => ({
  onClickCapture: (event) => {
    if (event.target.closest('button[type="submit"]')) {
      event.preventDefault();
      save();
    }
  },
  onKeyDownCapture: (event) => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      save();
    }
  },
});

function Demo() {
  const [supplier, setSupplier] = React.useState('МСМ ХХК');
  const [draft, setDraft] = React.useState(supplier);
  return (
    <div className="p-4">
      <DetailCard
        title="Падааны мэдээлэл"
        canEdit
        view={
          <FieldList
            columns={1}
            items={[
              { label: 'Нийлүүлэгч', value: supplier },
              {
                label: 'Падаан',
                value: <span className="font-mono">20261015_0003</span>,
                hint: '2026-10-15',
              },
              { label: 'Тэмдэглэл', value: '' },
            ]}
          />
        }
        edit={(close) => (
          <form
            className="flex flex-col gap-4"
            {...submitted(() => {
              setSupplier(draft || supplier);
              close();
              toast.success('Хадгалагдлаа');
            })}
          >
            <FormSection>
              <FormRow label="Нийлүүлэгч" htmlFor="supplier">
                <Input
                  id="supplier"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </FormRow>
            </FormSection>
            <FormFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Болих
              </Button>
              <Button type="submit">Хадгалах</Button>
            </FormFooter>
          </form>
        )}
      />
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
