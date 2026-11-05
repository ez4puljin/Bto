const { Button, FormFooter, FormRow, FormSection, Input, Switch, Toaster, toast, BtoProvider } =
  Bto;

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
  const [name, setName] = React.useState('Тэмдэглэлийн дэвтэр');
  const [code, setCode] = React.useState('');
  const [tried, setTried] = React.useState(true);
  const [active, setActive] = React.useState(true);
  const save = () => {
    setTried(true);
    if (name && code) toast.success('Хадгалагдлаа');
  };
  return (
    <form {...submitted(save)} className="flex flex-col gap-4 p-4">
      <FormSection title="Ерөнхий" description="Барааны үндсэн мэдээлэл." step={1}>
        <FormRow
          label="Нэр"
          htmlFor="name"
          hint="Баримт дээр ингэж хэвлэгдэнэ."
          error={tried && !name ? 'validation.required' : undefined}
        >
          <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
        </FormRow>
        <FormRow
          label="Код"
          htmlFor="code"
          error={tried && !code ? 'validation.required' : undefined}
        >
          <Input
            id="code"
            className="sm:w-44"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormRow>
        <FormRow label="Идэвхтэй" htmlFor="active" align="center">
          <Switch id="active" checked={active} onCheckedChange={setActive} />
        </FormRow>
      </FormSection>
      <FormFooter>
        <Button type="button" variant="ghost">
          Болих
        </Button>
        <Button type="submit">Хадгалах</Button>
      </FormFooter>
      <Toaster />
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
