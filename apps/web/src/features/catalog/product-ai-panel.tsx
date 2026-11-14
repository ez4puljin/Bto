import { LoaderCircle, Sparkles } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { pictureFailureOf } from './product-ai';
import type { ProductAiOutcome, ProductAiPhase, ProductAiStatus } from './use-product-ai';

const ACCEPT = 'image/jpeg,image/png,image/webp';

const FIELDS = [
  'category',
  'name',
  'unit',
  'box',
  'weight',
  'barcode',
  'units',
  'supplier',
] as const;
type Field = (typeof FIELDS)[number];

/** Which of the form's fields a proposal filled in, for the line that says so. */
function filledOf(outcome: ProductAiOutcome): Field[] {
  const proposal = outcome.proposal;
  if (!proposal) return [];
  const taken = new Set(proposal.existing.map((entry) => entry.code));
  const free = (codes: readonly string[]) => codes.some((code) => !taken.has(code));
  const has: Record<Field, boolean> = {
    category: proposal.categoryId !== null,
    name: proposal.name !== null,
    unit: proposal.baseUomId !== null,
    box: proposal.boxFactor !== null,
    weight: proposal.weightKg !== null,
    barcode: free(proposal.baseBarcodes) || free(proposal.boxBarcodes),
    units: proposal.units.length > 0,
    supplier: proposal.supplier !== null,
  };
  return FIELDS.filter((field) => has[field]);
}

/**
 * «AI ашиглах» on the registration form (ADR-0198): the button opens the file chooser for photos
 * of one product, a line says what is happening, and afterwards the card tells what was filled
 * in, what the model was unsure of, which barcodes a product already carries and how the
 * catalogue picture came out. Whatever is not set or fails is said in words, and the form below
 * works by hand as before.
 */
export function ProductAiPanel(props: {
  status: ProductAiStatus | undefined;
  phase: ProductAiPhase;
  outcome: ProductAiOutcome | null;
  problem: Parameters<typeof ProblemAlert>[0]['problem'];
  onFiles: (files: File[]) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { status, phase, outcome } = props;
  const busy = phase !== 'idle';
  const off = status !== undefined && !status.read && !status.picture;
  const filled = outcome ? filledOf(outcome) : [];
  const pictureFailure = outcome?.pictureProblem ? pictureFailureOf(outcome.pictureProblem) : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t('catalog.registration.ai.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('catalog.registration.ai.hint')}</p>
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            aria-label={t('catalog.registration.ai.choose')}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) props.onFiles(files);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || off || status === undefined}
            onClick={() => input.current?.click()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {t('catalog.registration.ai.button')}
          </Button>
        </div>

        {phase !== 'idle' ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t(`catalog.registration.ai.phase.${phase}`)}
          </p>
        ) : null}
        {off ? (
          <p className="text-sm text-muted-foreground">{t('catalog.registration.ai.off')}</p>
        ) : status && !status.read ? (
          <p className="text-sm text-muted-foreground">{t('catalog.registration.ai.readOff')}</p>
        ) : status && !status.picture ? (
          <p className="text-sm text-muted-foreground">{t('catalog.registration.ai.pictureOff')}</p>
        ) : null}

        <ProblemAlert problem={props.problem} />
        {outcome ? (
          <div className="flex flex-col gap-2">
            {outcome.proposal ? (
              <Alert className="border-transparent bg-success-soft">
                <Sparkles aria-hidden className="text-success" />
                <AlertDescription className="flex flex-col gap-1 text-foreground">
                  <span>
                    {filled.length > 0
                      ? t('catalog.registration.ai.filled', {
                          fields: filled
                            .map((field) => t(`catalog.registration.ai.field.${field}`))
                            .join(', '),
                        })
                      : t('catalog.registration.ai.nothing')}
                  </span>
                  {outcome.proposal.note ? (
                    <span className="text-muted-foreground">
                      {t('catalog.registration.ai.note', { note: outcome.proposal.note })}
                    </span>
                  ) : null}
                  {outcome.proposal.droppedBarcodes > 0 ? (
                    <span className="text-muted-foreground">
                      {t('catalog.registration.ai.droppedBarcodes', {
                        count: outcome.proposal.droppedBarcodes,
                      })}
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {outcome.proposal?.existing.map((entry) => (
              <Alert key={`${entry.code}-${entry.productId}`} variant="destructive">
                <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {t('catalog.registration.ai.existing', {
                    code: entry.code,
                    sku: entry.sku,
                    name: entry.name,
                  })}
                  <Link
                    to={`/catalog/products/${entry.productId}`}
                    className="font-medium text-link hover:underline"
                  >
                    {t('catalog.registration.view')}
                  </Link>
                </AlertDescription>
              </Alert>
            ))}
            {outcome.readProblem ? (
              <div className="flex flex-col gap-1">
                <ProblemAlert problem={outcome.readProblem} />
                <p className="text-sm text-muted-foreground">
                  {t('catalog.registration.ai.byHand')}
                </p>
              </div>
            ) : null}
            {outcome.unsupported > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>{t('catalog.images.unsupported')}</AlertDescription>
              </Alert>
            ) : null}
            {pictureFailure ? (
              <p className="text-sm text-destructive">
                {t(`catalog.registration.ai.pictureFailure.${pictureFailure}`)}
              </p>
            ) : null}
            {outcome.proposal || outcome.picture !== 'none' ? (
              <p className="text-sm text-muted-foreground">
                {t(`catalog.registration.ai.picture.${outcome.picture}`)}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
