import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const redisPub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const redisSub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const PRESENCE_KEY = "syncro:presence:online_users";

export async function markUserOnline(userId: string): Promise<string[]> {
  await redis.sadd(PRESENCE_KEY, userId);
  return redis.smembers(PRESENCE_KEY);
}

export async function markUserOffline(userId: string): Promise<string[]> {
  await redis.srem(PRESENCE_KEY, userId);
  return redis.smembers(PRESENCE_KEY);
}

export async function getOnlineUsers(): Promise<string[]> {
  return redis.smembers(PRESENCE_KEY);
}
