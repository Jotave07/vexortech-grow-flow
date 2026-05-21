import { describe, expect, it, vi } from "vitest";
import { createOrderPaymentForOrder } from "./asaas.service";

const order = {
  id: "order-1",
  store_id: "store-1",
  total: 42.5,
  order_number: 77,
  customer_name: "MARIA",
  customer_email: "maria@example.com",
  customer_document: "12345678901",
  customer_phone: "11999999999",
  payment_method: "pix",
  asaas_api_key: "asaas-key",
  payment_gateway_provider: "asaas",
  payment_gateway_api_key: "asaas-key",
  payment_gateway_config: {},
};

const createDeps = (options: {
  existingPayment?: any;
  remotePayment?: any;
  customerResult?: any;
  paymentResult?: any;
} = {}) => {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM public.orders o")) return { rows: [order] };
      if (sql.includes("FROM public.payments") && sql.includes("FOR UPDATE")) {
        return { rows: options.existingPayment ? [options.existingPayment] : [] };
      }
      if (sql.includes("INSERT INTO public.payments")) return { rows: [{ id: "local-payment", status: "payment_creating" }] };
      if (sql.includes("UPDATE public.payments")) return { rows: [{ id: "local-payment" }] };
      return { rows: [] };
    }),
  };

  const gateway = {
    provider: "asaas",
    createCustomer: vi.fn(async () => options.customerResult ?? { id: "asaas-customer" }),
    createPixPayment: vi.fn(async () => options.paymentResult ?? { id: "asaas-payment", invoiceUrl: "https://invoice" }),
    findPaymentByExternalReference: vi.fn(async () => ({ data: options.remotePayment ? [options.remotePayment] : [] })),
    getPixQrCode: vi.fn(async () => ({ payload: "pix-code", encodedImage: "qr-image" })),
    getPayment: vi.fn(),
    refundPayment: vi.fn(),
    mapPaymentStatus: vi.fn(() => "pendente"),
  };

  const deps = {
    withTransaction: vi.fn(async (fn: any) => fn(client)),
    query: vi.fn(async () => ({ rows: [] })),
    gateways: { asaas: gateway },
    publishRealtime: vi.fn(),
    notifyStatus: vi.fn(async () => null),
  };

  return { deps, gateway, client };
};

describe("Asaas order payment service", () => {
  it("creates one Asaas charge and persists the local payment", async () => {
    const { deps, gateway } = createDeps();

    const result = await createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, deps as any);

    expect(result).toMatchObject({ paymentId: "asaas-payment", pixCode: "pix-code" });
    expect(gateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(gateway.createPixPayment).toHaveBeenCalledTimes(1);
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("SET external_id"),
      [order.id, "asaas-payment", "asaas"],
    );
  });

  it("reuses an existing pending local payment instead of creating a duplicate charge", async () => {
    const { deps, gateway } = createDeps({
      existingPayment: { id: "local-payment", status: "pendente", external_id: "asaas-existing", asaas_id: null },
    });

    const result = await createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, deps as any);

    expect(result).toMatchObject({ paymentId: "asaas-existing", pixCode: "pix-code" });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createPixPayment).not.toHaveBeenCalled();
  });

  it("keeps failed attempts recoverable and avoids a duplicate when Asaas already has the external reference", async () => {
    const first = createDeps({
      customerResult: { errors: [{ description: "CPF invalido" }] },
    });
    await expect(
      createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, first.deps as any),
    ).rejects.toThrow("CPF invalido");
    expect(first.gateway.createPixPayment).not.toHaveBeenCalled();
    expect(first.deps.query).toHaveBeenCalledWith(expect.stringContaining("status = 'falhou'"), expect.any(Array));

    const retry = createDeps({
      existingPayment: { id: "local-payment", status: "falhou", external_id: null, asaas_id: null },
      remotePayment: { id: "asaas-recovered", status: "PENDING" },
    });
    const result = await createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, retry.deps as any);

    expect(result).toMatchObject({ paymentId: "asaas-recovered" });
    expect(retry.gateway.createPixPayment).not.toHaveBeenCalled();
  });
});
