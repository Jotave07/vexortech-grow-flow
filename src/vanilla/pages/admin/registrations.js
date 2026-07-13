import { digitsOnly, isValidDocument, normalizeDocument, slugify } from "../auth/validation.js";
import {
  badge,
  button,
  createAdminPage,
  dataOf,
  date,
  field,
  h,
  normalizeSearch,
  openDialog,
  serializeForm,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

export function filterRegistrations(profiles, search = "") {
  const term = normalizeSearch(search);
  if (!term) return profiles;
  return profiles.filter((profile) =>
    normalizeSearch(
      `${profile.full_name || profile.name || ""} ${profile.email || ""} ${profile.document || ""} ${profile.role || ""} ${profile.store?.name || ""}`,
    ).includes(term),
  );
}

export function renderAdminRegistrations(ctx) {
  const page = createAdminPage(ctx, {
    title: "Cadastros e parceiros",
    description:
      "Consulte perfis da plataforma e provisione novos lojistas por uma operacao administrativa protegida no servidor.",
  });
  let profiles = [];
  let searchValue = "";
  const results = h(ctx, "section");
  const search = h(ctx, "input", {
    type: "search",
    className: "admin-input",
    placeholder: "Nome, e-mail, documento, loja ou papel",
    "aria-label": "Pesquisar cadastros",
  });

  const load = async () => {
    results.replaceChildren(
      ctx.ui.loading?.("Carregando cadastros...") ??
        h(ctx, "div", { className: "admin-state" }, "Carregando cadastros..."),
    );
    try {
      const [profileRows, storeRows] = await Promise.all([
        dataOf(
          ctx.api
            .from("profiles")
            .select(
              "id,user_id,store_id,role,full_name,name,email,document,phone,is_exempt,created_at",
            )
            .order("created_at", { ascending: false })
            .limit(10_000),
          [],
        ),
        dataOf(
          ctx.api
            .from("stores")
            .select("id,owner_user_id,name,slug,is_active,is_suspended")
            .limit(10_000),
          [],
        ),
      ]);
      const storeById = new Map(storeRows.map((store) => [store.id, store]));
      const storeByOwner = new Map(storeRows.map((store) => [store.owner_user_id, store]));
      profiles = profileRows.map((profile) => ({
        ...profile,
        store: storeById.get(profile.store_id) ?? storeByOwner.get(profile.user_id) ?? null,
      }));
      if (page.active()) renderResults();
    } catch (error) {
      results.replaceChildren(
        h(ctx, "div", { className: "admin-alert", role: "alert" }, error.message),
      );
    }
  };

  function renderResults() {
    const visible = filterRegistrations(profiles, searchValue);
    const rows = visible.map((profile) =>
      h(
        ctx,
        "tr",
        {},
        h(
          ctx,
          "td",
          {},
          h(ctx, "strong", {}, profile.full_name || profile.name || "Sem nome"),
          h(ctx, "div", { className: "admin-field__hint" }, profile.email || "Sem e-mail"),
        ),
        h(
          ctx,
          "td",
          {},
          badge(
            ctx,
            profile.role || "customer",
            statusTone(profile.role === "super_admin" ? "ativo" : profile.role),
          ),
        ),
        h(
          ctx,
          "td",
          {},
          profile.store
            ? h(
                ctx,
                "a",
                {
                  href: `/loja/${profile.store.slug}`,
                  onClick: (event) => {
                    event.preventDefault();
                    ctx.navigate(`/loja/${profile.store.slug}`);
                  },
                },
                profile.store.name,
              )
            : "—",
        ),
        h(ctx, "td", {}, profile.document || "—"),
        h(ctx, "td", {}, profile.is_exempt ? badge(ctx, "Cortesia", "success") : "Padrao"),
        h(ctx, "td", {}, date(ctx, profile.created_at)),
      ),
    );
    results.replaceChildren(
      visible.length
        ? h(
            ctx,
            "div",
            { className: "admin-table-wrap" },
            h(
              ctx,
              "table",
              { className: "admin-table" },
              h(ctx, "caption", {}, `${visible.length} de ${profiles.length} perfis`),
              h(
                ctx,
                "thead",
                {},
                h(
                  ctx,
                  "tr",
                  {},
                  ["Pessoa", "Papel", "Loja", "Documento", "Cobranca", "Criado em"].map((label) =>
                    h(ctx, "th", { scope: "col" }, label),
                  ),
                ),
              ),
              h(ctx, "tbody", {}, rows),
            ),
          )
        : (ctx.ui.empty?.("Nenhum cadastro", "Nao ha perfis para esta pesquisa.") ??
            h(ctx, "div", { className: "admin-state" }, "Nenhum cadastro encontrado.")),
    );
    page.announce(`${visible.length} cadastros exibidos.`);
  }

  const createPartner = () => {
    const form = h(
      ctx,
      "form",
      { className: "admin-form" },
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "full_name",
          label: "Nome do responsavel",
          required: true,
          autocomplete: "name",
        }),
        field(ctx, {
          name: "email",
          label: "E-mail de acesso",
          type: "email",
          required: true,
          autocomplete: "email",
        }),
      ),
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "password",
          label: "Senha temporaria",
          type: "password",
          required: true,
          autocomplete: "new-password",
          hint: "Minimo de 8 caracteres. Envie por canal seguro.",
        }),
        field(ctx, { name: "document", label: "CPF ou CNPJ", required: true }),
      ),
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "name",
          label: "Nome da loja",
          required: true,
          autocomplete: "organization",
        }),
        field(ctx, {
          name: "slug",
          label: "Slug publico",
          required: true,
          hint: "Letras minusculas, numeros e hifens.",
        }),
      ),
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "whatsapp",
          label: "WhatsApp",
          type: "tel",
          required: true,
          autocomplete: "tel",
        }),
        field(ctx, { name: "city", label: "Cidade", required: true }),
        field(ctx, { name: "state", label: "UF", required: true }),
      ),
      h(
        ctx,
        "div",
        { className: "admin-alert" },
        "Esta operacao cria usuario, perfil, papel de lojista, loja e configuracoes. Revise o e-mail: ele sera usado para acesso.",
      ),
    );
    const nameControl = form.querySelector('[name="name"]');
    const slugControl = form.querySelector('[name="slug"]');
    const passwordControl = form.querySelector('[name="password"]');
    passwordControl.minLength = 8;
    let slugEdited = false;
    nameControl.addEventListener("input", () => {
      if (!slugEdited) slugControl.value = slugify(nameControl.value);
    });
    slugControl.addEventListener("input", () => {
      slugEdited = true;
      slugControl.value = slugify(slugControl.value);
    });
    const submit = button(ctx, "Criar parceiro", { primary: true, type: "submit" });
    const modal = openDialog(ctx, { title: "Novo parceiro", content: form, actions: [submit] });
    page.onCleanup(modal.close);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = serializeForm(form);
      if (!isValidDocument(values.document))
        return toast(ctx, "Informe um CPF ou CNPJ valido.", "error");
      if (!/^[a-z0-9-]{3,50}$/.test(values.slug))
        return toast(ctx, "Informe um slug valido.", "error");
      await withBusy(submit, async () => {
        const result = await ctx.api.fn("admin-create-store", {
          full_name: String(values.full_name).trim(),
          email: String(values.email).trim().toLowerCase(),
          password: String(values.password),
          document: normalizeDocument(values.document),
          name: String(values.name).trim(),
          slug: values.slug,
          whatsapp: digitsOnly(values.whatsapp),
          city: String(values.city).trim(),
          state: String(values.state).trim().toUpperCase().slice(0, 2),
        });
        if (result.error || result.data?.error)
          return toast(
            ctx,
            result.error?.message || result.data?.error || "Falha ao criar parceiro.",
            "error",
          );
        modal.close();
        toast(ctx, "Parceiro e loja criados.", "success");
        await load();
      });
    });
    submit.addEventListener("click", () => form.requestSubmit());
  };

  search.addEventListener("input", () => {
    searchValue = search.value;
    renderResults();
  });
  page.actions.append(
    button(ctx, "Novo parceiro", { primary: true, onClick: createPartner }),
    button(ctx, "Atualizar", { onClick: load }),
  );
  page.setContent(h(ctx, "section", { className: "admin-panel" }, search), results);
  void load();
  return page.root;
}
