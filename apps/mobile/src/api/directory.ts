import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// «Байгууллага» → «Манайхан»: the company's employed people for every signed-in staff member, with
// what reaches them (GET /hr/directory). The server searches with the shared search keys.

export type Colleague = components['schemas']['HrDirectoryEntry'];

/** The colleagues matching `q` (all of them for an empty one); the last list stays while typing. */
export function useDirectory(q: string) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['directory', q],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/hr/directory', {
          params: { query: q === '' ? {} : { q } },
        }),
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
