import { createCollectionPage } from "./collection-page.js";

export const render = createCollectionPage({
  title: "Categorias",
  singular: "categoria",
  description: "Organize o cardapio em secoes faceis de encontrar.",
  emptyDescription: "Crie a primeira categoria antes de cadastrar produtos.",
  table: "categories",
  orderBy: "sort_order",
  searchKeys: ["name", "description"],
  toggleField: "is_active",
  columns: [
    { key: "name", label: "Nome" },
    { key: "description", label: "Descricao" },
    { key: "sort_order", label: "Ordem" },
    { key: "is_active", label: "Status", render: (item) => item.is_active ? "Ativa" : "Inativa" },
  ],
  fields: [
    { name: "name", label: "Nome", required: true },
    { name: "description", label: "Descricao", type: "textarea" },
    { name: "sort_order", label: "Ordem de exibicao", type: "number", defaultValue: 0, min: 0, step: 1 },
  ],
  validate: (values) => !values.name ? "Informe o nome da categoria." : null,
  mapPayload: (values) => ({ ...values, name: values.name.toLocaleUpperCase("pt-BR"), description: values.description || null }),
  describe: (item) => `a categoria ${item.name}`,
});

export default render;
