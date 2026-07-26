import { Redis } from "ioredis";
import RedisMock from "ioredis-mock";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const USE_MOCK_REDIS = process.env.REDIS_MOCK === "true" || process.env.REDIS_MOCK === "1";

// In-memory Pub/Sub for mock Redis
const mockPubSubChannels = new Map();

function createMockPubSub() {
  const subscribers = new Map(); // channel -> Set of message callbacks
  const subscribeCallbacks = new Map(); // channel -> subscribe callback (called once)
  let messageHandler = null;
  
  return {
    subscribe(channel, callback) {
      if (!subscribers.has(channel)) {
        subscribers.set(channel, new Set());
      }
      // Store subscribe callback separately (called once with err, count)
      subscribeCallbacks.set(channel, callback);
      if (callback) callback(null, subscribers.get(channel).size);
      return Promise.resolve(subscribers.get(channel).size);
    },
    
    unsubscribe(channel, callback) {
      if (subscribers.has(channel)) {
        if (callback) {
          subscribers.get(channel).delete(callback);
        } else {
          subscribers.get(channel).clear();
        }
      }
      subscribeCallbacks.delete(channel);
      return Promise.resolve(1);
    },
    
    publish(channel, message) {
      let count = 0;
      if (subscribers.has(channel)) {
        for (const cb of subscribers.get(channel)) {
          try { cb(channel, message); } catch {}
          count++;
        }
      }
      // Also call global message handler
      if (messageHandler) {
        messageHandler(channel, message);
      }
      return Promise.resolve(count);
    },
    
    on(event, callback) {
      if (event === 'message') {
        messageHandler = callback;
      }
      return this;
    },
    
    // Internal method to trigger message event
    _emit(channel, message) {
      if (messageHandler) {
        messageHandler(channel, message);
      }
      if (subscribers.has(channel)) {
        for (const cb of subscribers.get(channel)) {
          try { cb(channel, message); } catch {}
        }
      }
    }
  };
}

const mockPubSub = createMockPubSub();

function createRedis() {
  if (USE_MOCK_REDIS) {
    const mock = new RedisMock({ lazyConnect: true });
    mock.connect = async () => {};
    mock.disconnect = () => {};
    
    // Override subscribe/unsubscribe/publish to use our in-memory Pub/Sub
    mock.subscribe = (channel, callback) => mockPubSub.subscribe(channel, callback);
    mock.unsubscribe = (channel, callback) => mockPubSub.unsubscribe(channel, callback);
    mock.publish = (channel, message) => mockPubSub.publish(channel, message);
    mock.on = (event, callback) => mockPubSub.on(event, callback);
    
    // Expose _emit for testing/triggering
    mock._emit = (channel, message) => mockPubSub._emit(channel, message);
    
    return mock;
  }

  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      const delay = Math.min(200 * 2 ** (times - 1), 5000);
      return delay;
    },
    lazyConnect: true,
  });
}

// Primary connection: regular commands (GET, SET, INCR, etc.)
export const redis = createRedis();

// Subscriber connection: dedicated for PUB/SUB only.
export const redisSubscriber = createRedis();

// Factory function for Bull queue connections.
// Bull calls createClient(type) internally with type='client', 'subscriber', or 'bclient'.
export function createBullRedis() {
  if (USE_MOCK_REDIS) {
    const mock = new RedisMock();
    // Add Pub/Sub support to Bull's mock Redis too
    mock.subscribe = (channel, callback) => mockPubSub.subscribe(channel, callback);
    mock.unsubscribe = (channel, callback) => mockPubSub.unsubscribe(channel, callback);
    mock.publish = (channel, message) => mockPubSub.publish(channel, message);
    mock.on = (event, callback) => mockPubSub.on(event, callback);
    return mock;
  }
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
