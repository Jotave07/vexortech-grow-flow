export interface KitchenOrder {
  id: string;
  order_number: number;
  customer_name: string;
  status: string;
  items: KitchenItem[];
  created_at: string;
  estimated_min?: number;
  estimated_max?: number;
  age_minutes: number;
  urgency: "low" | "medium" | "high" | "critical";
}

interface KitchenItem {
  product_name: string;
  quantity: number;
  notes?: string;
  order_item_options?: Array<{ id: string; option_name?: string; item_name: string; extra_price?: number }>;
}

export interface BatchGroup {
  product_name: string;
  total_quantity: number;
  orderNumbers: number[];
}

export interface KitchenQueue {
  queue: KitchenOrder[];
  batches: BatchGroup[];
}

/**
 * Calculate urgency based on age and estimated time
 */
const calculateUrgency = (order: { age_minutes: number; estimated_min?: number; estimated_max?: number }): KitchenOrder["urgency"] => {
  if (order.age_minutes >= 25) return "critical";
  if (order.age_minutes >= 15) return "high";
  if (order.estimated_min && order.age_minutes >= order.estimated_min * 0.7) return "medium";
  return "low";
};

/**
 * Sort orders by kitchen priority:
 * 1. Status: em_preparo > confirmado > novo
 * 2. Within same status: urgency (critical > high > medium > low)
 * 3. FIFO tiebreaker: oldest first
 */
const sortByKitchenPriority = (orders: KitchenOrder[]): KitchenOrder[] => {
  const statusPriority: Record<string, number> = {
    em_preparo: 0,
    confirmado: 1,
    novo: 2,
  };

  const urgencyPriority: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return [...orders].sort((a, b) => {
    const statusA = statusPriority[a.status] ?? 99;
    const statusB = statusPriority[b.status] ?? 99;
    if (statusA !== statusB) return statusA - statusB;

    const urgencyA = urgencyPriority[a.urgency];
    const urgencyB = urgencyPriority[b.urgency];
    if (urgencyA !== urgencyB) return urgencyA - urgencyB;

    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
};

/**
 * Find items that appear in multiple orders for batch preparation.
 */
export const findBatchingOpportunities = (orders: KitchenOrder[]): BatchGroup[] => {
  const itemMap = new Map<string, { total_quantity: number; orderNumbers: number[] }>();

  for (const order of orders) {
    for (const item of order.items) {
      const key = item.product_name.toLowerCase().trim();
      const existing = itemMap.get(key);
      if (existing) {
        existing.total_quantity += item.quantity;
        if (!existing.orderNumbers.includes(order.order_number)) {
          existing.orderNumbers.push(order.order_number);
        }
      } else {
        itemMap.set(key, {
          total_quantity: item.quantity,
          orderNumbers: [order.order_number],
        });
      }
    }
  }

  // Only return items that appear in 2+ orders
  return Array.from(itemMap.entries())
    .filter(([, data]) => data.orderNumbers.length >= 2)
    .map(([product_name, data]) => ({
      product_name,
      total_quantity: data.total_quantity,
      orderNumbers: data.orderNumbers.sort(),
    }))
    .sort((a, b) => b.total_quantity - a.total_quantity);
};

/**
 * Build kitchen queue from raw orders with items.
 * Orders must already have status in ["em_preparo", "confirmado", "novo"].
 */
export const calculateKitchenQueue = (
  rawOrders: any[],
  itemsMap: Map<string, KitchenItem[]>,
): KitchenQueue => {
  const kitchenOrders: KitchenOrder[] = rawOrders.map((order) => {
    const age_minutes = Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
    const items = itemsMap.get(order.id) || [];

    const orderData: KitchenOrder = {
      id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      status: order.status,
      items,
      created_at: order.created_at,
      estimated_min: order.estimated_min,
      estimated_max: order.estimated_max,
      age_minutes,
      urgency: "low",
    };

    orderData.urgency = calculateUrgency(orderData);
    return orderData;
  });

  const queue = sortByKitchenPriority(kitchenOrders);
  const batches = findBatchingOpportunities(kitchenOrders);

  return { queue, batches };
};
