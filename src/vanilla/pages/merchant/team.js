import { button, confirmAction, createPage, dataOf, getStoreId, h, requireMerchant, toast, withBusy } from "./core.js";

export function render(ctx) {
  const page = createPage(ctx, { title: "Equipe", description: "Revise quem possui acesso a loja e remova acessos que nao sao mais necessarios." });
  const state = { members: [] };
  const load = async () => {
    page.loading("Carregando equipe...");
    try {
      await requireMerchant(ctx);
      const storeId = getStoreId(ctx);
      const profiles = await dataOf(ctx.api.from("profiles").select("*").eq("store_id", storeId), []);
      const userIds = profiles.map((profile) => profile.user_id).filter(Boolean);
      const roles = userIds.length ? await dataOf(ctx.api.from("user_roles").select("*").eq("store_id", storeId).in("user_id", userIds), []) : [];
      state.members = profiles.map((profile) => ({ ...profile, roles: roles.filter((role) => role.user_id === profile.user_id) }));
      renderMembers();
    } catch (error) { page.fail(error, load); }
  };
  const renderMembers = () => {
    if (!state.members.length) return page.empty("Nenhum usuario vinculado", "O proprietario da loja continua com acesso pela conta principal.");
    const table = h(ctx, "table", { className: "merchant-table" },
      h(ctx, "caption", {}, "Usuarios vinculados a loja e seus papeis."),
      h(ctx, "thead", {}, h(ctx, "tr", {}, ["Usuario", "Contato", "Papel", "Acao"].map((label) => h(ctx, "th", { scope: "col" }, label)))),
      h(ctx, "tbody", {}, state.members.map((member) => h(ctx, "tr", {},
        h(ctx, "td", {}, member.full_name ?? "Usuario"), h(ctx, "td", {}, member.email ?? member.phone ?? "Nao informado"),
        h(ctx, "td", {}, member.roles.map((role) => role.role).join(", ") || member.role || "Colaborador"),
        h(ctx, "td", {}, member.user_id === ctx.auth.session?.user?.id
          ? "Voce"
          : member.roles.some((role) => role.role === "store_owner") || member.role === "store_owner"
            ? "Proprietario"
            : button(ctx, "Remover acesso", { danger: true, onClick: (event) => remove(member, event.currentTarget) }))))));
    page.root.dataset.pageState = "ready";
    page.setContent(h(ctx, "div", { className: "merchant-table-wrap" }, table));
  };
  const remove = async (member, control) => {
    if (!await confirmAction(ctx, `Remover o acesso de ${member.full_name ?? "este usuario"}?`)) return;
    await withBusy(control, async () => {
      try {
        const [profileResult, roleResult] = await Promise.all([
          ctx.api.from("profiles").update({ store_id: null }).eq("id", member.id),
          ctx.api.from("user_roles").delete().eq("user_id", member.user_id).eq("store_id", getStoreId(ctx)),
        ]);
        if (profileResult?.error) throw new Error(profileResult.error.message);
        if (roleResult?.error) throw new Error(roleResult.error.message);
        toast(ctx, "Acesso removido.", "success");
        await load();
      } catch (error) { toast(ctx, error.message, "error"); }
    });
  };
  page.root.ready = load();
  return page.root;
}

export default render;
