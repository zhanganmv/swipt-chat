/**
 * Turns a state transition into the smallest set of row changes.
 *
 * Persistence used to be "write this whole file again", so every streamed token
 * rewrote every conversation. Here the previous persisted state is the diff
 * base: only rows whose values actually changed become ops, and the caller
 * batches them into one transaction.
 */
import type { ChatState } from "../domain/conversation.ts";
import type { ModelProvider, ProviderModel } from "../domain/provider.ts";
import { sameProvider, sameModel } from "../domain/provider.ts";
import type { Message } from "../domain/types.ts";
import type { StoreOp } from "./store.ts";

const sameMessage = (left: Message, right: Message): boolean =>
  left.id === right.id &&
  left.content === right.content &&
  left.status === right.status &&
  left.error === right.error;

/**
 * `base` must be the state that was last handed to the store, not the previous
 * React render: a failed flush resets the base to `null`, and the next flush
 * then rewrites everything (upserts are idempotent).
 */
export function diffState(
  base: ChatState,
  next: ChatState,
): StoreOp[] {
  const ops: StoreOp[] = [];

  const before = new Map(base.conversations.map((item) => [item.id, item]));
  for (const conversation of next.conversations) {
    const previous = before.get(conversation.id);
    before.delete(conversation.id);
    if (
      previous === undefined ||
      previous.title !== conversation.title ||
      previous.updatedAt !== conversation.updatedAt
    ) {
      ops.push({
        kind: "session",
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      });
    }
    const old = previous?.messages ?? [];
    for (let seq = 0; seq < conversation.messages.length; seq += 1) {
      const message = conversation.messages[seq];
      const current = old[seq];
      if (current !== undefined && sameMessage(current, message)) {
        continue;
      }
      ops.push({
        kind: "message",
        sessionId: conversation.id,
        seq,
        message,
      });
    }
  }
  for (const id of before.keys()) {
    ops.push({ kind: "session.delete", id });
  }

  const oldProviders = new Map(base.providers.map((item) => [item.id, item]));
  for (const provider of next.providers) {
    const previous = oldProviders.get(provider.id);
    oldProviders.delete(provider.id);
    if (previous === undefined || !sameProvider(previous, provider)) {
      ops.push({ kind: "provider", provider });
    }
  }
  for (const id of oldProviders.keys()) {
    ops.push({ kind: "provider.delete", id });
  }

  for (const providerId of Object.keys(next.models)) {
    const models = next.models[providerId];
    const previous = base.models[providerId] ?? [];
    for (let position = 0; position < models.length; position += 1) {
      const model = models[position];
      const existing = previous.find((item) => item.id === model.id);
      if (existing === undefined || !sameModel(existing, model)) {
        ops.push({ kind: "model", providerId, model, position });
      }
    }
    for (const model of previous) {
      if (!models.some((item) => item.id === model.id)) {
        ops.push({ kind: "model.delete", providerId, modelId: model.id });
      }
    }
  }
  for (const providerId of Object.keys(base.models)) {
    if (next.models[providerId] === undefined) {
      // The provider is gone (or its models were cleared); `provider.delete`
      // already cascades, so only an emptied list needs explicit deletes.
      if (next.providers.some((item) => item.id === providerId)) {
        for (const model of base.models[providerId]) {
          ops.push({ kind: "model.delete", providerId, modelId: model.id });
        }
      }
    }
  }

  const oldAgents = new Map(base.agents.map((item) => [item.id, item]));
  for (const agent of next.agents) {
    const previous = oldAgents.get(agent.id);
    oldAgents.delete(agent.id);
    if (previous === undefined || previous.title !== agent.title) {
      ops.push({ kind: "agent", agent });
    }
  }
  for (const id of oldAgents.keys()) {
    ops.push({ kind: "agent.delete", id });
  }

  if (base.currentId !== next.currentId) {
    ops.push({ kind: "state", key: "current_session", value: next.currentId });
  }
  if (base.providerId !== next.providerId) {
    ops.push({ kind: "state", key: "active_provider", value: next.providerId });
  }
  if (base.modelId !== next.modelId) {
    ops.push({ kind: "state", key: "active_model", value: next.modelId });
  }
  if (base.agentId !== next.agentId) {
    ops.push({ kind: "state", key: "active_agent", value: next.agentId });
  }
  if (base.draft !== next.draft) {
    ops.push({ kind: "state", key: "draft", value: next.draft });
  }

  return ops;
}