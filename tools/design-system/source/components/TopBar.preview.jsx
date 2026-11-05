const { TopBar, Toaster, toast, BtoProvider } = Bto;

function Demo() {
  const menuButton = React.useRef(null);
  return (
    <div>
      <TopBar
        menuOpen={false}
        menuButtonRef={menuButton}
        onMenu={() => toast.info('Бүх цэс')}
        onSearch={() => toast.info('Хайх')}
      />
      <Toaster />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BtoProvider route="/inventory/receipts">
    <Demo />
  </BtoProvider>,
);
