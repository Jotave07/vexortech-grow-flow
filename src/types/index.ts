export type OrderStatus =
  | "pendente"
  | "novo"
  | "em_preparo"
  | "saiu_para_entrega"
  | "pronto_para_retirada"
  | "entregue"
  | "cancelado";

export type DeliveryType = "entrega" | "retirada";

// ─── Plan / Subscription ──────────────────────────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  slug?: string;
  price_monthly: number;
  sort_order?: number;
}

export interface SubscriptionWithPlan {
  status: string;
  plan_id?: string | null;
  asaas_subscription_id?: string | null;
  billing_type?: string | null;
  plans?: Plan;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export interface Store {
  id: string;
  name: string;
  public_name?: string | null;
  slug: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  whatsapp_number?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  logo_url?: string | null;
  is_active: boolean;
  is_suspended: boolean;
  owner_user_id?: string | null;
  plan_id?: string | null;
  created_at: string;
  updated_at?: string;
  document_file_path?: string | null;
  selfie_file_path?: string | null;
  document_number?: string | null;
  // populated via JOIN
  subscriptions?: SubscriptionWithPlan[];
  is_exempt?: boolean;
  owner_profile_id?: string;
}

export interface StoreSettings {
  store_id: string;
  whatsapp_number?: string | null;
}

// ─── Product ──────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  store_id: string;
  name: string;
  description?: string | null;
  price: number;
  is_active: boolean;
  category_id?: string | null;
  image_url?: string | null;
  sort_order?: number;
  created_at: string;
  updated_at?: string;
}

// ─── Order ────────────────────────────────────────────────────────────────────

export interface OrderItemOption {
  id: string;
  order_item_id: string;
  item_name: string;
  extra_price: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  notes?: string | null;
  order_item_options?: OrderItemOption[];
}

export interface Order {
  id: string;
  order_number?: string | null;
  store_id: string;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  delivery_type: DeliveryType;
  delivery_address?: string | null;
  delivery_reference?: string | null;
  delivery_fee: number;
  subtotal: number;
  discount_amount?: number | null;
  total: number;
  payment_method: string;
  notes?: string | null;
  distance_km?: number | null;
  estimated_min?: number | null;
  estimated_max?: number | null;
  public_token?: string | null;
  created_at: string;
  updated_at?: string;
  // populated via JOIN
  order_items?: OrderItem[];
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CursorParams {
  cursor?: string | null;
  limit?: number;
}
