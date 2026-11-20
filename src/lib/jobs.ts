import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type Queue } from "pg-boss";
import type { Queryable } from "./database.js";

export interface JobPayloads {
  "send-message": { messageId: string };
  "apply-retention": object;
}

export type QueueName = keyof JobPayloads;

export const sendMessageRetryLimit = 3;

const queueSettings: Record<QueueName, Omit<Queue, "name">> = {
  "send-message": {
    retryLimit: sendMessageRetryLimit,
    retryDelay: 30,
    retryBackoff: true,
  },
  "apply-retention": { retryLimit: 2, retryDelay: 300 },
};

export const queueNames = Object.keys(queueSettings).filter(
  (name): name is QueueName => name in queueSettings,
);

export interface JobQueue {
  enqueue<Name extends QueueName>(
    transaction: Queryable,
    name: Name,
    data: JobPayloads[Name],
  ): Promise<string>;
}

export class JobNotEnqueuedError extends Error {
  override name = "JobNotEnqueuedError";
}

export const createJobBoss = (databaseUrl: string): PgBoss =>
  new PgBoss({ connectionString: databaseUrl });

export const createJobQueues = async (boss: PgBoss): Promise<void> => {
  for (const name of queueNames) {
    const existing = await boss.getQueue(name);
    if (existing === null) {
      await boss.createQueue(name, queueSettings[name]);
    } else {
      await boss.updateQueue(name, queueSettings[name]);
    }
  }
};

export const buildJobQueue = (boss: PgBoss): JobQueue => ({
  enqueue: async (transaction, name, data) => {
    const jobId = await boss.send(name, data, {
      db: fromDrizzle(transaction, sql),
    });
    if (jobId === null) {
      throw new JobNotEnqueuedError(`The ${name} job was not enqueued`);
    }
    return jobId;
  },
});
