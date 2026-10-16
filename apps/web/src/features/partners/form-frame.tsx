import type { ProblemDetails } from '@tugeel/api-client';
import type { ReactNode } from 'react';
import { FormFooter } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Card, CardContent } from '@/components/ui/card';

/**
 * How a partner form sits on its page (ADR-0066). In a record's card («Засах») the refusal leads,
 * the fields follow and the buttons close the card. On its own `/new` page (`page`) the fields sit
 * in a card, the server's refusal just above the buttons, and the buttons stick to the window's
 * foot after the card, so «Хадгалах» never waits below the fold.
 */
export function PartnerFormFrame(props: {
  page?: boolean;
  problem: ProblemDetails | null;
  fields: ReactNode;
  /** Null while the form is read-only. */
  buttons: ReactNode | null;
}) {
  if (props.page) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col gap-5">{props.fields}</CardContent>
        </Card>
        <ProblemAlert problem={props.problem} />
        {props.buttons ? <StickyActions>{props.buttons}</StickyActions> : null}
      </>
    );
  }
  return (
    <>
      <ProblemAlert problem={props.problem} />
      {props.fields}
      {props.buttons ? <FormFooter>{props.buttons}</FormFooter> : null}
    </>
  );
}
