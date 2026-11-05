const { Alert, AlertDescription, AlertTitle, BtoProvider, ProblemAlert, toast, Toaster, icons: { Info } } = Bto;

const refused = {
  status: 422,
  code: 'CREDIT_BLOCKED',
  params: { reason: 'LIMIT', exposure: '5240000.00', limit: '5000000.00', excess: '240000.00' },
};

function Demo() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <ProblemAlert problem={refused} onRetry={() => toast.info('Дахин оролдлоо')} />
      <Alert>
        <Info />
        <AlertTitle>Өөр хэрэглэгч энэ захиалгыг шинэчиллээ</AlertTitle>
        <AlertDescription>Хадгалахаас өмнө дахин ачаална уу.</AlertDescription>
      </Alert>
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider>
    <Demo />
  </BtoProvider>,
);
