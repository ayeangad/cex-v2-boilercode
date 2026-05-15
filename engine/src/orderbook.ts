import type { CreateOrderInput, OrderBook, OrderRecord, OrderStatus, RestingOrder, Fill } from "./store/exchange-store";
import { BALANCES, ORDERS, ORDERBOOKS } from "./store/exchange-store";


function getBalance(userId: string, symbol: string) {
  if (!BALANCES[userId]) BALANCES[userId] = {};
  if (!BALANCES[userId][symbol]) {
    BALANCES[userId][symbol] = { available: 0, locked: 0 };
  }
  return BALANCES[userId][symbol];
}

function getOrderbook(symbol: string) {
  if (!ORDERBOOKS[symbol]) {
    ORDERBOOKS[symbol] = { bids: [], asks: [] }
  }
  return ORDERBOOKS[symbol];
}

function settleTrade(buyerId: string, sellerId: string, qty: number, price: number, symbol: string): void {
  const totalCost = qty * price;
  getBalance(buyerId, "INR").locked -= totalCost
  getBalance(sellerId, "INR").available += totalCost

  getBalance(sellerId, symbol).locked -= qty;
  getBalance(buyerId, symbol).available += qty;
}

export function createOrder(input: CreateOrderInput) {
  const { userId, price, qty, side, type, symbol } = input;
  const totalCost = (price || 0) * qty


  if (side === "buy") {
    if (getBalance(userId, "INR").available < totalCost) {
      throw new Error("Low funds!")
    }
    getBalance(userId, "INR").available -= totalCost
    getBalance(userId, "INR").locked += totalCost

  } else if (side === "sell") {
    if (getBalance(userId, symbol).available < qty) {
      throw new Error("Not enough stock!")
    }
    getBalance(userId, symbol).available -= qty
    getBalance(userId, symbol).locked += qty
  }

  const orderId = crypto.randomUUID();
  const order: OrderRecord = {
    userId,
    orderId,
    symbol,
    side,
    type,
    price: price || null,
    fills: [],
    createdAt: Date.now(),
    qty,
    filledQty: 0,
    status: "open"
  }

  const books = getOrderbook(symbol)
  const oppositeSide = side === "buy" ? books.asks : books.bids;
  let remainingQty = qty

  for (let i = 0; i < oppositeSide.length; i++) {
    const existingOrder: RestingOrder = oppositeSide[i]!
    const isMatch = side === "buy" ? (existingOrder.price <= price!) : (existingOrder.price >= price!);

    if (isMatch) {
      const fillAmount = Math.min(remainingQty, existingOrder.qty);

      remainingQty -= fillAmount
      existingOrder.qty -= fillAmount
      existingOrder.filledQty += fillAmount

      const fillId = crypto.randomUUID();
      const fills: Fill = {
        fillId,
        symbol: existingOrder.symbol,
        price: existingOrder.price,
        qty: fillAmount,
        buyOrderId: side === "buy" ? order.orderId : existingOrder.orderId,
        sellOrderId: side === "sell" ? existingOrder.orderId : order.orderId,
        createdAt: Date.now()
      }
      order.fills.push(fills);

      const globalExisting = ORDERS.get(existingOrder.orderId)!;
      globalExisting.filledQty += fillAmount;
      globalExisting.status = existingOrder.qty === 0 ? "filled" : "partially_filled";
      globalExisting.fills.push(fills);

      if (side === "buy") {
        settleTrade(userId, existingOrder.userId, fillAmount, existingOrder.price, symbol)
      } else {
        settleTrade(existingOrder.userId, userId, fillAmount, existingOrder.price, symbol)
      };

      if (existingOrder.qty === 0) {
        oppositeSide.splice(i, 1)
        i--
      }
    }
  }

  order.filledQty = qty - remainingQty;
  order.status = remainingQty === 0 ? "filled" : (remainingQty === qty ? "open" : "partially_filled")
  ORDERS.set(order.orderId, order);

  if (remainingQty > 0) {
    const mySide = side === "buy" ? books.bids : books.asks

    mySide.push({
      orderId: order.orderId,
      userId,
      price: price!,
      side,
      type: "limit",
      symbol,
      createdAt: Date.now(),
      qty: remainingQty,
      filledQty: qty - remainingQty,
      status: order.status as OrderStatus
    });
  }

  return {
    message: "Order Processed!",
    orderId: order.orderId,
    filled: qty - remainingQty,
    remaining: remainingQty
  }
}
