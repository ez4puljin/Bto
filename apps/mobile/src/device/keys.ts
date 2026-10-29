// The storage keys' shapes, without the storage itself: pure modules (and their tests) name
// a key without loading AsyncStorage.

/** Keys of one user on one server: two reps sharing a phone never see each other's cart. */
export const userKey = (name: string, server: string, userId: number) =>
  `bto.${name}.v1:${server}:${userId}`;
