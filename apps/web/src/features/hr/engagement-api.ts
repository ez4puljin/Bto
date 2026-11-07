import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { HR_KEYS } from './api';

/*
 * The staff's community as HR sees it (ADR-0146): notices and news, votes and surveys, moods,
 * feedback, thanks, sent locations and the month's calendar. Keys under ['hr', …]; a write refreshes
 * the HR reads, as the workforce hooks do.
 */

type Schemas = components['schemas'];
export type HrMessage = Schemas['HrMessage'];
export type HrMessageKind = HrMessage['kind'];
export type HrMessageRequest = Schemas['HrMessageRequest'];
export type HrPoll = Schemas['HrPoll'];
export type HrPollKind = HrPoll['kind'];
export type HrPollQuestion = Schemas['HrPollQuestion'];
export type HrPollQuestionKind = HrPollQuestion['kind'];
export type HrPollRequest = Schemas['HrPollRequest'];
export type HrFeedback = Schemas['HrFeedback'];
export type HrFeedbackStatus = HrFeedback['status'];
export type HrFeedbackCategory = HrFeedback['category'];
export type HrThanks = Schemas['HrThanks'];
export type HrLocationShare = Schemas['HrLocationShare'];
export type HrCalendarItem = Schemas['HrCalendarItem'];
export type HrEventRequest = Schemas['HrEventRequest'];
export type HrEventType = Schemas['HrEventType'];
export type HrEventTypeRequest = Schemas['HrEventTypeRequest'];
export type HrMoods = Schemas['HrMoods'];
export type HrStaffDetailsRequest = Schemas['HrStaffDetailsRequest'];

export const ENGAGEMENT_KEYS = {
  messages: ['hr', 'messages'] as const,
  polls: ['hr', 'polls'] as const,
  moods: ['hr', 'moods'] as const,
  feedback: ['hr', 'feedback'] as const,
  shares: ['hr', 'location-shares'] as const,
  calendar: ['hr', 'calendar'] as const,
  thanks: ['hr', 'thanks'] as const,
};

export function useHrMessages(kind: HrMessageKind) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.messages, kind],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/messages', { params: { query: { kind } }, signal })),
  });
}

export function useHrPolls(kind: HrPollKind) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.polls, kind],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/polls', { params: { query: { kind } }, signal })),
  });
}

export function useHrMoods(from: string, to: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.moods, from, to],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/moods', { params: { query: { from, to } }, signal })),
  });
}

export interface FeedbackFilter {
  from?: string;
  to?: string;
  status?: HrFeedbackStatus;
  category?: HrFeedbackCategory;
}

export function useHrFeedback(filter: FeedbackFilter) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.feedback, filter],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/feedback', { params: { query: filter }, signal })),
  });
}

export function useHrShares(from: string, to: string, userId?: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.shares, from, to, userId ?? null],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/location-shares', {
          params: { query: { from, to, userId } },
          signal,
        }),
      ),
  });
}

export function useHrCalendar(month: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.calendar, month],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/calendar', { params: { query: { month } }, signal })),
  });
}

/** The calendar's types (ADR-0171), in the order HR made them. */
export function useHrEventTypes(includeArchived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.calendar, 'types', includeArchived],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/event-types', {
          params: { query: { includeArchived: String(includeArchived) } },
          signal,
        }),
      ),
  });
}

export function useHrThanks(from: string, to: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ENGAGEMENT_KEYS.thanks, from, to],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/thanks', { params: { query: { from, to } }, signal })),
  });
}

export function useEngagementMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: HR_KEYS.all });
  const path = (id: number) => ({ params: { path: { id } } });
  return {
    createMessage: useMutation({
      mutationFn: async ({ key, ...body }: HrMessageRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/hr/messages', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: refresh,
    }),
    withdrawMessage: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/hr/messages/{id}/withdraw', path(id))),
      onSuccess: refresh,
    }),
    createPoll: useMutation({
      mutationFn: async ({ key, ...body }: HrPollRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/hr/polls', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: refresh,
    }),
    closePoll: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/hr/polls/{id}/close', path(id))),
      onSuccess: refresh,
    }),
    decideFeedback: useMutation({
      mutationFn: async ({
        id,
        ...body
      }: {
        id: number;
        status: HrFeedbackStatus;
        reply: string | null;
      }) => unwrap(await api.PUT('/api/v1/hr/feedback/{id}', { ...path(id), body })),
      onSuccess: refresh,
    }),
    saveEvent: useMutation({
      mutationFn: async ({ id, ...body }: HrEventRequest & { id: number | null }) =>
        id === null
          ? unwrap(await api.POST('/api/v1/hr/events', { body }))
          : unwrap(await api.PUT('/api/v1/hr/events/{id}', { ...path(id), body })),
      onSuccess: refresh,
    }),
    archiveEvent: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/hr/events/{id}', path(id))),
      onSuccess: refresh,
    }),
    setEventDone: useMutation({
      mutationFn: async ({ id, done }: { id: number; done: boolean }) =>
        unwrap(await api.PUT('/api/v1/hr/events/{id}/done', { ...path(id), body: { done } })),
      // Refused too: the event may have been archived by now, so the list must catch up.
      onSettled: refresh,
    }),
    saveEventType: useMutation({
      mutationFn: async ({ id, ...body }: HrEventTypeRequest & { id: number | null }) =>
        id === null
          ? unwrap(await api.POST('/api/v1/hr/event-types', { body }))
          : unwrap(await api.PUT('/api/v1/hr/event-types/{id}', { ...path(id), body })),
      onSuccess: refresh,
    }),
    archiveEventType: useMutation({
      mutationFn: async ({ id, archived }: { id: number; archived: boolean }) =>
        unwrap(
          await api.PUT('/api/v1/hr/event-types/{id}/archived', {
            ...path(id),
            body: { archived },
          }),
        ),
      onSuccess: refresh,
    }),
    saveDetails: useMutation({
      mutationFn: async ({ userId, ...body }: HrStaffDetailsRequest & { userId: number }) =>
        unwrap(
          await api.PUT('/api/v1/hr/staff/{userId}/details', {
            params: { path: { userId } },
            body,
          }),
        ),
      onSuccess: refresh,
    }),
  };
}
