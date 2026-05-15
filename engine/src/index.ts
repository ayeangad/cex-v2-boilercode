import "dotenv/config";
import { createClient } from "redis";
import { env } from "./utils/env.js";
import type { CancelOrder, CreateOrderInput } from "./store/exchange-store";
import { createOrder, getDepth, getUserBalance, getOrder, cancelOrder } from "./orderbook";

export type EngineCommandType =
  | "create_order"
  | "get_depth"
  | "get_user_balance"
  | "get_order"
  | "cancel_order";

export interface EngineRequest {
  correlationId: string;
  responseQueue: string;
  type: EngineCommandType;
  payload: Record<string, unknown>;
}

export interface EngineResponse {
  correlationId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const brokerClient = createClient({ url: env.redisUrl }).on("error", (error) => {
  console.error("Redis broker client error", error);
});

const responseClient = createClient({ url: env.redisUrl }).on("error", (error) => {
  console.error("Redis response client error", error);
});

await Promise.all([brokerClient.connect(), responseClient.connect()]);

async function sendResponse(responseQueue: string, response: EngineResponse): Promise<void> {
  await responseClient.lPush(responseQueue, JSON.stringify(response));
}

function handleEngineRequest(message: EngineRequest): unknown {
  if (message.type === "create_order") {
    const payload = message.payload as unknown as CreateOrderInput
    return createOrder(payload)
  }

  if (message.type === "get_depth") {
    const { symbol } = message.payload as { symbol: string }
    return getDepth(symbol)
  }

  if (message.type === "get_user_balance") {
    const { userId } = message.payload as { userId: string }
    return getUserBalance(userId)
  }
  if (message.type === "get_order") {
    const { orderId } = message.payload as { orderId: string }
    return getOrder(orderId)
  }
  if (message.type === "cancel_order") {
    const payload = message.payload as unknown as CancelOrder
    return cancelOrder(payload)
  }

  throw new Error("TODO(student): implement this engine request type");
}

console.log(`Engine listening on Redis queue: ${env.incomingQueue}`);

for (; ;) {
  const item = await brokerClient.brPop(env.incomingQueue, 0);
  if (!item) continue;

  let message: EngineRequest;

  try {
    message = JSON.parse(item.element) as EngineRequest;
  } catch {
    console.error("Skipping invalid broker message");
    continue;
  }

  try {
    const data = handleEngineRequest(message);
    await sendResponse(message.responseQueue, {
      correlationId: message.correlationId,
      ok: true,
      data,
    });
  } catch (error) {
    await sendResponse(message.responseQueue, {
      correlationId: message.correlationId,
      ok: false,
      error: error instanceof Error ? error.message : "engine_error",
    });
  }
}
