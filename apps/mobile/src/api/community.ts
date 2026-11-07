import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { ubDate } from '../dates/dates';
import { useSignedIn } from '../state/session';
import { useMyAttendance } from './attendance';
import { unwrap } from './problem';

// «Хамт олон» (ADR-0146): what every signed-in staff member reads and answers — notices and news,
// votes and surveys, the day's mood, the calendar, thanks, feedback, a sent location and their own
// details. Every write refreshes `['community']`.

export type Feed = components['schemas']['HrFeed'];
export type MyMessage = components['schemas']['HrMyMessage'];
export type MessageKind = MyMessage['kind'];
export type Poll = components['schemas']['HrPoll'];
export type PollQuestion = components['schemas']['HrPollQuestion'];
export type PollAnswer = components['schemas']['HrPollAnswerRequest'];
export type Feedback = components['schemas']['HrFeedback'];
export type FeedbackRequest = components['schemas']['HrFeedbackRequest'];
export type ThanksEntry = components['schemas']['HrThanksEntry'];
export type ThanksRank = components['schemas']['HrThanksRank'];
export type ThanksRequest = components['schemas']['HrThanksRequest'];
export type LocationShare = components['schemas']['HrLocationShare'];
export type LocationShareRequest = components['schemas']['HrLocationShareRequest'];
export type CalendarItem = components['schemas']['HrCalendarItem'];
export type Profile = components['schemas']['HrProfile'];
export type ProfileRequest = components['schemas']['HrProfileRequest'];
export type Child = components['schemas']['HrChild'];
export type Colleague = components['schemas']['UserLookup'];

const KEY = ['community'] as const;
export const FEED_KEY = [...KEY, 'feed'] as const;

/** Today in Ulaanbaatar: the server's when it has answered, else the phone's clock at UTC+8. */
export function useToday(): string {
  const attendance = useMyAttendance();
  return attendance.data?.today ?? ubDate(new Date().toISOString());
}

/** The badges, the popups and today's mood; read at start and every minute for the badges. */
export function useFeed() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: FEED_KEY,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/me/feed')),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** The unread notices and news and the unanswered polls: the entry row's badge. */
export function feedCount(feed: Feed | undefined): number {
  return feed ? feed.unreadNotices + feed.unreadNews + feed.openPolls : 0;
}

/** Saves today's face; the feed follows at once, so the chosen face does not flicker back. */
export function useSetMood() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (score: number) =>
      unwrap(await session.client.PUT('/api/v1/hr/me/mood', { body: { score } })),
    onSuccess: (mood) =>
      queryClient.setQueryData<Feed>(FEED_KEY, (feed) =>
        feed ? { ...feed, moodToday: mood.score } : feed,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** Everything that has reached this person, both kinds, newest first. */
export function useMyMessages() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'messages'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/me/messages')),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

/** Marks messages read; the answer is empty (204), so only a failure is unwrapped. */
export function useReadMessages() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const result = await session.client.POST('/api/v1/hr/me/messages/read', { body: { ids } });
      if (!result.response.ok) unwrap(result);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMyPolls() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'polls'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/me/polls')),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

export function useAnswerPoll() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, answers }: { id: number; answers: PollAnswer[] }) =>
      unwrap(
        await session.client.POST('/api/v1/hr/me/polls/{id}/answers', {
          params: { path: { id } },
          body: { answers },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** `YYYY-MM`'s events, birthdays and work anniversaries. */
export function useCalendar(month: string) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'calendar', month],
    queryFn: async () =>
      unwrap(await session.client.GET('/api/v1/hr/calendar', { params: { query: { month } } })),
    staleTime: 60_000,
  });
}

/** Marks an event's work done, or not (ADR-0171 #8). */
export function useSetEventDone() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, done }: { id: number; done: boolean }) =>
      unwrap(
        await session.client.PUT('/api/v1/hr/events/{id}/done', {
          params: { path: { id } },
          body: { done },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useThanks(from: string, to: string) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'thanks', from, to],
    queryFn: async () =>
      unwrap(await session.client.GET('/api/v1/hr/thanks', { params: { query: { from, to } } })),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

/** Sends thanks; the key is kept by the form so a retried send is answered once. */
export function useSendThanks() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: ThanksRequest }) =>
      unwrap(
        await session.client.POST('/api/v1/hr/thanks', {
          body,
          params: { header: { 'Idempotency-Key': key } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** Active staff by name for the colleague picker; `q` is already debounced by the screen. */
export function useColleagues(q: string, enabled: boolean) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'colleagues', q],
    queryFn: async () =>
      unwrap(await session.client.GET('/api/v1/users/lookup', { params: { query: { q } } })),
    enabled,
    staleTime: 60_000,
  });
}

export function useMyFeedback() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'feedback'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/me/feedback')),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

export function useSendFeedback() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: FeedbackRequest }) =>
      unwrap(
        await session.client.POST('/api/v1/hr/me/feedback', {
          body,
          params: { header: { 'Idempotency-Key': key } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMyLocations() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'locations'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/me/locations')),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

export function useShareLocation() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: LocationShareRequest }) =>
      unwrap(
        await session.client.POST('/api/v1/hr/me/locations', {
          body,
          params: { header: { 'Idempotency-Key': key } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMyProfile() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...KEY, 'profile'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/me/profile')),
    staleTime: 15_000,
  });
}

export function useSaveProfile() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ProfileRequest) =>
      unwrap(await session.client.PUT('/api/v1/hr/me/profile', { body })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
