/**
 * Identifiers for conversations and messages.
 *
 * Persisted records must survive a process restart, so ids cannot depend on an
 * in-memory counter alone: two restarts inside the same millisecond used to
 * collide. The random suffix makes collisions negligible without pulling in
 * `crypto.randomUUID` (not in the swiplet runtime's guaranteed surface).
 */
let counter = 0;

export function newId(prefix: string): string {
  counter = (counter + 1) % 0xffffff;
  const random = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${random}`;
}