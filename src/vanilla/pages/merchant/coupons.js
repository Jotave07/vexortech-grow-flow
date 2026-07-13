import { createCollectionPage } from "./collection-page.js";
import { date, money } from "./core.js";

export const render = createCollectionPage({
  title: "Cupons",
  singular: "cupom",
  description: "Crie incentivos claros sem perder controle da margem.",
  emptyDescription: "Adicione um cupom e defina valor minimo, validade e limite de uso.",
  table: "coupons",
  orderBy: "created_at",
  ascending: false,
  searchKeys: ["code", "discount_type"],
  toggleField: "is_active",
  columns: [
    { key: "code", label: "Codigo" },
    { key: "discount_value", label: "Desconto", render: (item, ctx) => item.discount_type === "percentual" ? `${Number(item.discount_value)}%` : money(ctx, item.discount_value) },
    { key: "min_order_value", label: "Pedido minimo", render: (item, ctx) => money(ctx, item.min_order_value) },
    { key: "expires_at", label: "Validade", render: (item, ctx) => item.expires_at ? date(ctx, item.expires_at, { dateStyle: "short" }) : "Sem validade" },
    { key: "is_active", label: "Status", render: (item) => item.is_active ? "Ativo" : "Inativo" },
  ],
  fields: [
    { name: "code", label: "Codigo", required: true },
    { name: "discount_type", label: "Tipo", options: [{ value: "percentual", label: "Percentual" }, { value: "fixo", label: "Valor fixo" }], defaultValue: "percentual" },
    { name: "discount_value", label: "Valor do desconto", type: "number", required: true, min: 0.01, step: 0.01 },
    { name: "min_order_value", label: "Pedido minimo", type: "number", defaultValue: 0, min: 0, step: 0.01 },
    { name: "usage_limit", label: "Limite de usos", type: "number", min: 1, step: 1, hint: "Deixe vazio para uso ilimitado." },
    { name: "expires_at", label: "Validade", type: "date" },
    { name: "is_active", label: "Cupom ativo", type: "checkbox", defaultValue: true },
  ],
  validate: (values) => {
    if (!values.code) return "Informe o codigo do cupom.";
    if (!(values.discount_value > 0)) return "O desconto precisa ser maior que zero.";
    if (values.discount_type === "percentual" && values.discount_value > 100) return "O desconto percentual nao pode superar 100%.";
    return null;
  },
  mapPayload: (values) => ({
    ...values,
    code: values.code.toLocaleUpperCase("pt-BR").replace(/\s+/g, ""),
    usage_limit: values.usage_limit || null,
    expires_at: values.expires_at || null,
  }),
  describe: (item) => `o cupom ${item.code}`,
});

export default render;
