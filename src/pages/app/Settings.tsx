import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, MapPin, Palette, Plus, Save, Search, Settings2, Store, TimerReset, Trash2, Truck, Upload, Wallet } from "lucide-react";
import { fetchAddressByCep, ViaCepError, buildAddressLabel, normalizeCep } from "@/services/viacep";
import { formatBandLabel, formatDeliveryFeePreview, getMaxBandDistance, normalizeDistanceBands, type DeliveryDistanceBand, validateDeliverySettings } from "@/lib/delivery";
import { formatBRL } from "@/lib/format";
import { getPlanLimits, getStatusMeta, normalizePlan } from "@/lib/subscription";

type StoreRow = Tables<"stores">;
type StoreSettingsRow = Tables<"store_settings">;
type PlanRow = Tables<"plans">;
type SubscriptionRow = Tables<"subscriptions"> & { plans?: PlanRow | null };

type BusinessDay = {
  enabled: boolean;
  open: string;
  close: string;
};

type BusinessHours = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", BusinessDay>;

type StoreStatusValue = "open" | "closed" | "paused";

type CepLookupState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
};

const WEEKDAYS: Array<{ key: keyof BusinessHours; label: string }> = [
  { key: "mon", label: "Segunda" },
  { key: "tue", label: "Terca" },
  { key: "wed", label: "Quarta" },
  { key: "thu", label: "Quinta" },
  { key: "fri", label: "Sexta" },
  { key: "sat", label: "Sabado" },
  { key: "sun", label: "Domingo" },
];

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { enabled: true, open: "18:00", close: "23:00" },
  tue: { enabled: true, open: "18:00", close: "23:00" },
  wed: { enabled: true, open: "18:00", close: "23:00" },
  thu: { enabled: true, open: "18:00", close: "23:00" },
  fri: { enabled: true, open: "18:00", close: "23:30" },
  sat: { enabled: true, open: "18:00", close: "23:30" },
  sun: { enabled: true, open: "18:00", close: "23:00" },
};

const Settings = () => {
  const { store } = useOutletContext<{ store: { id: string } }>();
  const [storeForm, setStoreForm] = useState<StoreRow | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettingsRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);
  const [excludedNeighborhoodsText, setExcludedNeighborhoodsText] = useState("");
  const [distanceBands, setDistanceBands] = useState<DeliveryDistanceBand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [cepLookup, setCepLookup] = useState<CepLookupState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!store?.id) return;

    setLoading(true);
    setLoadingError(null);
    const [storeRes, settingsRes, subscriptionRes, plansRes] = await Promise.all([
      supabase.from("stores").select("*").eq("id", store.id).maybeSingle(),
      supabase.from("store_settings").select("*").eq("store_id", store.id).maybeSingle(),
      supabase.from("subscriptions").select("*, plans(*)").eq("store_id", store.id).maybeSingle(),
      supabase.from("plans").select("*").eq("is_active", true).order("sort_order"),
    ]);

    if (storeRes.error) {
      setLoading(false);
      setLoadingError(storeRes.error.message);
      return;
    }

    if (!storeRes.data) {
      setLoading(false);
      setLoadingError("Nao foi possivel localizar os dados da loja.");
      return;
    }

    let settingsRow = settingsRes.data as StoreSettingsRow | null;

    if (settingsRes.error) {
      setLoading(false);
      setLoadingError(settingsRes.error.message);
      return;
    }

    if (!settingsRow) {
      const created = await supabase.from("store_settings").insert({ store_id: store.id }).select("*").maybeSingle();
      if (created.error) {
        setLoading(false);
        setLoadingError(created.error.message);
        return;
      }
      settingsRow = created.data as StoreSettingsRow | null;
    }

    setStoreForm(buildStoreForm(storeRes.data as StoreRow));
    setStoreSettings(buildStoreSettings(settingsRow));
    setSubscription((subscriptionRes.data as SubscriptionRow | null) ?? null);
    setPlans((plansRes.data as PlanRow[]) ?? []);
    setBusinessHours(parseBusinessHours(settingsRow?.business_hours));
    setExcludedNeighborhoodsText(parseExcludedNeighborhoods(settingsRow?.excluded_neighborhoods).join("\n"));
    setDistanceBands(normalizeDistanceBands(settingsRow?.delivery_distance_rules));
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File, field: "logo_url" | "cover_url") => {
    if (!storeForm || !file.type.startsWith("image/")) {
      return toast.error("Selecione uma imagem valida.");
    }

    const ext = file.name.split(".").pop();
    const path = `${store.id}/${field}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("store-assets").upload(path, file);
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("store-assets").getPublicUrl(path);
    setStoreForm({ ...storeForm, [field]: data.publicUrl });
    toast.success("Imagem enviada com sucesso.");
  };

  const lookupCep = async () => {
    if (!storeForm) return;

    setCepLookup({ status: "loading", message: "Consultando CEP..." });
    try {
      const address = await fetchAddressByCep(storeForm.zip_code ?? "");
      setStoreForm({
        ...storeForm,
        zip_code: address.cep,
        address: address.street || storeForm.address,
        neighborhood: address.neighborhood || storeForm.neighborhood,
        city: address.city || storeForm.city,
        state: address.state || storeForm.state,
        address_complement: storeForm.address_complement || address.complement || null,
      });
      setCepLookup({ status: "success", message: "Endereco encontrado e preenchido. Revise os campos antes de salvar." });
      toast.success("Endereco localizado pelo CEP.");
    } catch (error) {
      const message = error instanceof ViaCepError ? error.message : "Nao foi possivel consultar o CEP.";
      setCepLookup({ status: "error", message });
      toast.error(message);
    }
  };

  const save = async () => {
    if (!storeForm || !storeSettings) return;

    const deliveryConfig = {
      allowDelivery: storeSettings.allow_delivery,
      allowPickup: storeSettings.allow_pickup,
      minimumOrderValue: Number(storeSettings.min_order_value) || 0,
      averagePrepTimeMinutes: Number(storeSettings.avg_prep_time_minutes) || 30,
      deliveryRadiusKm: toNullableNumber(storeSettings.delivery_radius_km),
      deliveryBaseFee: Number(storeSettings.delivery_base_fee) || 0,
      deliveryFeePerKm: Number(storeSettings.delivery_fee_per_km) || 0,
      distanceBands,
      deliveryMessage: storeSettings.delivery_message,
    };

    const validation = validateDeliverySettings(deliveryConfig);
    if (!validation.valid) {
      toast.error(validation.issues[0]?.message ?? "Revise as configuracoes de entrega.");
      return;
    }

    setSaving(true);
    const baseStorePayload = {
      name: storeForm.name,
      description: nullableText(storeForm.description),
      logo_url: nullableText(storeForm.logo_url),
      cover_url: nullableText(storeForm.cover_url),
      phone: nullableText(storeForm.phone),
      whatsapp: nullableText(storeForm.whatsapp),
      email: nullableText(storeForm.email),
      document: nullableText(storeForm.document),
      address: nullableText(storeForm.address),
      city: nullableText(storeForm.city),
      state: nullableText(storeForm.state)?.toUpperCase() ?? null,
      zip_code: nullableText(storeForm.zip_code ? normalizeCep(storeForm.zip_code) : null),
      primary_color: nullableText(storeForm.primary_color),
      secondary_color: nullableText(storeForm.secondary_color),
    };
    const extendedStorePayload = {
      public_name: nullableText(storeForm.public_name),
      address_number: nullableText(storeForm.address_number),
      address_complement: nullableText(storeForm.address_complement),
      neighborhood: nullableText(storeForm.neighborhood),
      latitude: toNullableNumber(storeForm.latitude),
      longitude: toNullableNumber(storeForm.longitude),
    };
    const baseSettingsPayload = {
      is_open: storeSettings.is_open,
      accept_orders_when_closed: storeSettings.accept_orders_when_closed,
      min_order_value: Number(storeSettings.min_order_value) || 0,
      avg_prep_time_minutes: Number(storeSettings.avg_prep_time_minutes) || 30,
      allow_delivery: storeSettings.allow_delivery,
      allow_pickup: storeSettings.allow_pickup,
      accept_cash: storeSettings.accept_cash,
      accept_pix: storeSettings.accept_pix,
      accept_card_on_delivery: storeSettings.accept_card_on_delivery,
      pix_key: nullableText(storeSettings.pix_key),
      pix_key_type: nullableText(storeSettings.pix_key_type),
      business_hours: businessHours as unknown as Json,
    };
    const extendedSettingsPayload = {
      delivery_radius_km: toNullableNumber(storeSettings.delivery_radius_km),
      delivery_base_fee: Number(storeSettings.delivery_base_fee) || 0,
      delivery_fee_per_km: Number(storeSettings.delivery_fee_per_km) || 0,
      delivery_distance_rules: distanceBands as unknown as Json,
      delivery_message: nullableText(storeSettings.delivery_message),
      excluded_neighborhoods: parseExcludedNeighborhoods(excludedNeighborhoodsText) as unknown as Json,
    };

    const storeUpdate = await supabase.from("stores").update({
      ...baseStorePayload,
      ...extendedStorePayload,
    }).eq("id", store.id);
    const safeStoreUpdate = shouldRetryWithLegacySchema(storeUpdate.error)
      ? await supabase.from("stores").update(baseStorePayload).eq("id", store.id)
      : storeUpdate;

    const settingsUpdate = await supabase.from("store_settings").update({
      ...baseSettingsPayload,
      ...extendedSettingsPayload,
    } as any).eq("store_id", store.id);
    const safeSettingsUpdate = shouldRetryWithLegacySchema(settingsUpdate.error)
      ? await supabase.from("store_settings").update(baseSettingsPayload as any).eq("store_id", store.id)
      : settingsUpdate;

    setSaving(false);

    if (safeStoreUpdate.error || safeSettingsUpdate.error) {
      return toast.error(safeStoreUpdate.error?.message ?? safeSettingsUpdate.error?.message ?? "Erro ao salvar configuracoes.");
    }

    toast.success("Configuracoes salvas com sucesso.");
    if (shouldRetryWithLegacySchema(storeUpdate.error) || shouldRetryWithLegacySchema(settingsUpdate.error)) {
      toast.message("As configuracoes basicas foram salvas. Campos avancados dependem de migrations ainda nao aplicadas no banco.");
    }
    setCepLookup((current) => current.status === "success" ? { ...current, message: "Endereco salvo com sucesso." } : current);
    void load();
  };

  const activePlan = useMemo(
    () => normalizePlan(subscription?.plans ?? plans.find((plan) => plan.id === storeForm?.plan_id) ?? null),
    [plans, storeForm?.plan_id, subscription?.plans],
  );
  const subscriptionStatus = getStatusMeta(subscription);
  const planLimits = getPlanLimits(activePlan);

  if (loading) {
    return <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>;
  }

  if (loadingError) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">Nao foi possivel carregar as configuracoes</h1>
          <p className="text-sm text-muted-foreground">{loadingError}</p>
          <Button variant="outline" onClick={() => void load()}>Tentar novamente</Button>
        </div>
      </Card>
    );
  }

  if (!storeForm || !storeSettings) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">Configuracoes indisponiveis</h1>
          <p className="text-sm text-muted-foreground">Os dados iniciais da loja nao puderam ser preparados.</p>
          <Button variant="outline" onClick={() => void load()}>Recarregar</Button>
        </div>
      </Card>
    );
  }

  const deliveryValidation = validateDeliverySettings({
    allowDelivery: storeSettings.allow_delivery,
    allowPickup: storeSettings.allow_pickup,
    minimumOrderValue: Number(storeSettings.min_order_value) || 0,
    averagePrepTimeMinutes: Number(storeSettings.avg_prep_time_minutes) || 30,
    deliveryRadiusKm: toNullableNumber(storeSettings.delivery_radius_km),
    deliveryBaseFee: Number(storeSettings.delivery_base_fee) || 0,
    deliveryFeePerKm: Number(storeSettings.delivery_fee_per_km) || 0,
    distanceBands,
    deliveryMessage: storeSettings.delivery_message,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Configuracoes</h1>
          <p className="text-muted-foreground">Estruture sua operacao, endereco, entrega, pagamentos e assinatura sem perder o acabamento premium da loja.</p>
        </div>
        <Button variant="hero" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar alteracoes
        </Button>
      </div>

      <Tabs defaultValue="general" className="space-y-5">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg bg-secondary/80 p-1">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="address">Endereco</TabsTrigger>
          <TabsTrigger value="delivery">Entrega</TabsTrigger>
          <TabsTrigger value="payments">Pagamentos</TabsTrigger>
          <TabsTrigger value="subscription">Assinatura</TabsTrigger>
          <TabsTrigger value="appearance">Aparencia</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={Store}
              title="Identidade comercial"
              description="Dados basicos da loja e o que aparece para clientes no canal online."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <Label htmlFor="store-name">Nome da loja</Label>
                <Input id="store-name" value={storeForm.name ?? ""} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-public-name">Nome publico</Label>
                <Input
                  id="store-public-name"
                  value={storeForm.public_name ?? ""}
                  onChange={(e) => setStoreForm({ ...storeForm, public_name: e.target.value })}
                  placeholder="Como a loja aparece para clientes"
                />
              </Field>
            </div>

            <Field>
              <Label htmlFor="store-description">Descricao curta</Label>
              <Textarea id="store-description" rows={3} value={storeForm.description ?? ""} onChange={(e) => setStoreForm({ ...storeForm, description: e.target.value })} />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <Label htmlFor="store-whatsapp">WhatsApp</Label>
                <Input id="store-whatsapp" value={storeForm.whatsapp ?? ""} onChange={(e) => setStoreForm({ ...storeForm, whatsapp: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-phone">Telefone</Label>
                <Input id="store-phone" value={storeForm.phone ?? ""} onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-email">E-mail</Label>
                <Input id="store-email" type="email" value={storeForm.email ?? ""} onChange={(e) => setStoreForm({ ...storeForm, email: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-document">CNPJ ou CPF</Label>
                <Input id="store-document" value={storeForm.document ?? ""} onChange={(e) => setStoreForm({ ...storeForm, document: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={Settings2}
              title="Operacao da loja"
              description="Status operacional e horario de funcionamento usando a estrutura atual do projeto."
            />

            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 items-start">
              <Field>
                <Label>Status da loja</Label>
                <Select value={getStoreStatusValue(storeSettings)} onValueChange={(value: StoreStatusValue) => setStoreSettings(applyStoreStatus(storeSettings, value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Aberta agora</SelectItem>
                    <SelectItem value="closed">Fechada</SelectItem>
                    <SelectItem value="paused">Pausa temporaria</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div className="rounded-lg border border-border bg-secondary/35 p-4 text-sm text-muted-foreground">
                {getStoreStatusValue(storeSettings) === "open" && "A loja fica visivel e aceita pedidos normalmente."}
                {getStoreStatusValue(storeSettings) === "closed" && "A loja continua publicada, mas o checkout nao deve aceitar novos pedidos."}
                {getStoreStatusValue(storeSettings) === "paused" && "A operacao fica em pausa, com a base pronta para comportamento diferenciado em fluxos futuros."}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {WEEKDAYS.map((day) => (
                <div key={day.key} className="rounded-lg border border-border bg-background/65 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{day.label}</span>
                    <Switch
                      checked={businessHours[day.key].enabled}
                      onCheckedChange={(enabled) => setBusinessHours({ ...businessHours, [day.key]: { ...businessHours[day.key], enabled } })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <Label>Abertura</Label>
                      <Input
                        type="time"
                        value={businessHours[day.key].open}
                        disabled={!businessHours[day.key].enabled}
                        onChange={(e) => setBusinessHours({ ...businessHours, [day.key]: { ...businessHours[day.key], open: e.target.value } })}
                      />
                    </Field>
                    <Field>
                      <Label>Fechamento</Label>
                      <Input
                        type="time"
                        value={businessHours[day.key].close}
                        disabled={!businessHours[day.key].enabled}
                        onChange={(e) => setBusinessHours({ ...businessHours, [day.key]: { ...businessHours[day.key], close: e.target.value } })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="address" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={MapPin}
              title="Endereco da loja"
              description="Use o ViaCEP para preencher rua, bairro, cidade e UF. Numero e complemento continuam editaveis manualmente."
            />

            <div className="grid grid-cols-1 md:grid-cols-[220px_auto] gap-3 items-end">
              <Field>
                <Label htmlFor="store-zip-code">CEP</Label>
                <Input id="store-zip-code" value={storeForm.zip_code ?? ""} onChange={(e) => setStoreForm({ ...storeForm, zip_code: e.target.value })} placeholder="00000-000" />
              </Field>
              <Button variant="outline" type="button" className="w-full md:w-auto" onClick={lookupCep} disabled={cepLookup.status === "loading"}>
                {cepLookup.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar CEP
              </Button>
            </div>

            {cepLookup.message && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                cepLookup.status === "error"
                  ? "border-destructive/25 bg-destructive/5 text-destructive"
                  : cepLookup.status === "success"
                    ? "border-primary/20 bg-primary/5 text-foreground"
                    : "border-border bg-secondary/45 text-muted-foreground"
              }`}>
                {cepLookup.message}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Label htmlFor="store-street">Rua</Label>
                <Input id="store-street" value={storeForm.address ?? ""} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} />
              </div>
              <Field>
                <Label htmlFor="store-address-number">Numero</Label>
                <Input id="store-address-number" value={storeForm.address_number ?? ""} onChange={(e) => setStoreForm({ ...storeForm, address_number: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-neighborhood">Bairro</Label>
                <Input id="store-neighborhood" value={storeForm.neighborhood ?? ""} onChange={(e) => setStoreForm({ ...storeForm, neighborhood: e.target.value })} />
              </Field>
              <div className="md:col-span-2">
                <Label htmlFor="store-address-complement">Complemento</Label>
                <Input id="store-address-complement" value={storeForm.address_complement ?? ""} onChange={(e) => setStoreForm({ ...storeForm, address_complement: e.target.value })} />
              </div>
              <Field>
                <Label htmlFor="store-city">Cidade</Label>
                <Input id="store-city" value={storeForm.city ?? ""} onChange={(e) => setStoreForm({ ...storeForm, city: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-state">UF</Label>
                <Input id="store-state" maxLength={2} value={storeForm.state ?? ""} onChange={(e) => setStoreForm({ ...storeForm, state: e.target.value.toUpperCase().slice(0, 2) })} />
              </Field>
            </div>

            <div className="rounded-lg border border-border bg-secondary/35 p-4 text-sm text-muted-foreground space-y-2">
              <div className="font-medium text-foreground">Endereco consolidado</div>
              <div>{buildAddressLabel({
                street: storeForm.address ?? "",
                number: storeForm.address_number ?? "",
                neighborhood: storeForm.neighborhood ?? "",
                city: storeForm.city ?? "",
                state: storeForm.state ?? "",
              }) || "Preencha os dados acima para ver o endereco formatado."}</div>
              <div>
                Coordenadas: {storeForm.latitude && storeForm.longitude
                  ? `${storeForm.latitude}, ${storeForm.longitude}`
                  : "ainda nao configuradas. A validacao por raio real depende de geocodificacao futura."}
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="delivery" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={Truck}
              title="Entrega e retirada"
              description="Base pronta para raio em KM, taxa por distancia e regras futuras sem fingir calculo real quando faltarem coordenadas."
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SwitchRow
                label="Ativar entrega"
                description="Quando desligado, o checkout publico nao deve oferecer entrega."
                checked={storeSettings.allow_delivery}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, allow_delivery: value })}
              />
              <SwitchRow
                label="Ativar retirada no local"
                description="Mantem a opcao de retirada sem exigir motoboy."
                checked={storeSettings.allow_pickup}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, allow_pickup: value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <Field>
                <Label>Raio maximo de entrega (KM)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={storeSettings.delivery_radius_km ?? ""}
                  onChange={(e) => setStoreSettings({ ...storeSettings, delivery_radius_km: e.target.value ? Number(e.target.value) : 0 })}
                  placeholder="Ex: 8"
                />
              </Field>
              <Field>
                <Label>Pedido minimo para entrega (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={storeSettings.min_order_value ?? 0}
                  onChange={(e) => setStoreSettings({ ...storeSettings, min_order_value: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field>
                <Label>Tempo medio de entrega/preparo (min)</Label>
                <Input
                  type="number"
                  value={storeSettings.avg_prep_time_minutes ?? 30}
                  onChange={(e) => setStoreSettings({ ...storeSettings, avg_prep_time_minutes: Number(e.target.value) || 30 })}
                />
              </Field>
              <Field>
                <Label>Maior distancia configurada</Label>
                <div className="flex h-10 items-center rounded-md border border-border bg-background px-3 text-sm text-muted-foreground">
                  {getMaxBandDistance(distanceBands) !== null
                    ? `${getMaxBandDistance(distanceBands)?.toFixed(1).replace(".", ",")} km`
                    : "Nenhuma faixa cadastrada"}
                </div>
              </Field>
            </div>

            <div className="space-y-4 rounded-lg border border-border bg-background/55 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Faixas de distancia e frete</div>
                  <div className="text-sm text-muted-foreground">
                    Configure o valor por intervalo de KM. Exemplo: 0 a 2 km por R$ 2,00; acima disso, a proxima faixa assume.
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={() => setDistanceBands((current) => [...current, createDistanceBand(current)])}>
                  <Plus className="h-4 w-4" />
                  Nova faixa
                </Button>
              </div>

              {distanceBands.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Nenhuma faixa cadastrada. Adicione pelo menos uma para definir a cobranca por distancia.
                </div>
              ) : (
                <div className="space-y-3">
                  {distanceBands.map((band, index) => (
                    <div key={band.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">Faixa {index + 1}</div>
                          <div className="text-xs text-muted-foreground">{formatBandLabel(band)}</div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDistanceBands((current) => current.filter((item) => item.id !== band.id))}
                          disabled={distanceBands.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Field>
                          <Label>Inicio (KM)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={band.startKm}
                            onChange={(e) => updateDistanceBand(setDistanceBands, band.id, "startKm", Number(e.target.value) || 0)}
                          />
                        </Field>
                        <Field>
                          <Label>Fim (KM)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={band.endKm}
                            onChange={(e) => updateDistanceBand(setDistanceBands, band.id, "endKm", Number(e.target.value) || 0)}
                          />
                        </Field>
                        <Field>
                          <Label>Taxa (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={band.fee}
                            onChange={(e) => updateDistanceBand(setDistanceBands, band.id, "fee", Number(e.target.value) || 0)}
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <Label>Bairros ou regioes excluidas</Label>
                <Textarea
                  rows={3}
                  value={excludedNeighborhoodsText}
                  onChange={(e) => setExcludedNeighborhoodsText(e.target.value)}
                  placeholder="Um bairro por linha"
                />
              </Field>
            </div>

            <Field>
              <Label>Mensagem personalizada sobre entrega</Label>
              <Textarea
                rows={3}
                value={storeSettings.delivery_message ?? ""}
                onChange={(e) => setStoreSettings({ ...storeSettings, delivery_message: e.target.value })}
                placeholder="Ex: atendemos entregas em raio limitado e confirmamos tudo pelo WhatsApp."
              />
            </Field>

            <div className="rounded-lg border border-border bg-secondary/35 p-4 text-sm text-muted-foreground space-y-2">
              <div className="font-medium text-foreground">Resumo atual</div>
              <div>{formatDeliveryFeePreview(distanceBands, toNullableNumber(storeSettings.delivery_radius_km))}</div>
              <div>
                Validacao por distancia automatica: {storeForm.latitude && storeForm.longitude
                  ? "loja pronta para cruzar coordenadas assim que o endereco do cliente tambem estiver geocodificado."
                  : "aguardando coordenadas confiaveis da loja. Sem isso, o sistema nao deve fingir bloqueio por KM real."}
              </div>
              <div>
                Zonas por bairro existentes continuam em <Link to="/app/entregas" className="text-primary underline-offset-4 hover:underline">Entregas</Link> para o fluxo atual do checkout.
              </div>
            </div>

            {!deliveryValidation.valid && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive space-y-1">
                {deliveryValidation.issues.map((issue) => (
                  <div key={`${issue.field}-${issue.message}`}>{issue.message}</div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={Wallet}
              title="Pagamentos aceitos"
              description="Pix, dinheiro e cartao presencial na maquininha, sem coleta de dados sensiveis no sistema."
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SwitchRow
                label="Aceitar Pix"
                description="Mostra a chave Pix no checkout para pagamento externo."
                checked={storeSettings.accept_pix}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, accept_pix: value })}
              />
              <SwitchRow
                label="Aceitar dinheiro"
                description="Permite troco e pagamento no ato da entrega ou retirada."
                checked={storeSettings.accept_cash}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, accept_cash: value })}
              />
              <SwitchRow
                label="Cartao presencial na maquininha"
                description="Sem gateway embutido e sem coleta de cartao no produto."
                checked={storeSettings.accept_card_on_delivery}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, accept_card_on_delivery: value })}
              />
            </div>

            {storeSettings.accept_pix && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <Label>Tipo de chave Pix</Label>
                  <Input
                    value={storeSettings.pix_key_type ?? ""}
                    onChange={(e) => setStoreSettings({ ...storeSettings, pix_key_type: e.target.value })}
                    placeholder="CPF, CNPJ, e-mail, telefone ou aleatoria"
                  />
                </Field>
                <Field>
                  <Label>Chave Pix</Label>
                  <Input value={storeSettings.pix_key ?? ""} onChange={(e) => setStoreSettings({ ...storeSettings, pix_key: e.target.value })} />
                </Field>
              </div>
            )}

            <div className="pt-4 border-t border-border/50">
              <SectionHeader
                icon={Settings2}
                title="Configuração Asaas (Automático)"
                description="Insira sua chave de API do Asaas para processar pagamentos PIX automaticamente."
              />
              <div className="mt-4 grid grid-cols-1 gap-4">
                <Field>
                  <Label htmlFor="asaas-api-key">API Key (Produção ou Sandbox)</Label>
                  <Input
                    id="asaas-api-key"
                    type="password"
                    value={(storeSettings as any).asaas_api_key ?? ""}
                    onChange={(e) => setStoreSettings({ ...storeSettings, asaas_api_key: e.target.value } as any)}
                    placeholder="Sua chave de acesso do Asaas"
                  />
                </Field>
                <div className="rounded-lg border border-border bg-secondary/35 p-4 text-sm text-muted-foreground flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  URL do Webhook: https://[SEU-SUPABASE-URL]/functions/v1/asaas-webhook
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="subscription" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={TimerReset}
              title="Assinatura da loja"
              description="Status atual, limites conhecidos e atalho rapido para a gestao completa do plano."
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm text-muted-foreground">Plano atual</div>
                      <div className="text-xl font-semibold">{activePlan?.name ?? "Sem plano definido"}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{subscriptionStatus.detail}</div>
                    </div>
                    <Badge variant={subscriptionStatus.tone}>{subscriptionStatus.label}</Badge>
                  </div>
                </div>

                {activePlan && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <MiniStat label="Produtos" value={planLimits.products ? String(planLimits.products) : "Ilimitado"} />
                    <MiniStat label="Pedidos por mes" value={planLimits.monthlyOrders ? String(planLimits.monthlyOrders) : "Ilimitado"} />
                    <MiniStat label="Lojas/unidades" value={planLimits.stores ? String(planLimits.stores) : "Ilimitado"} />
                    <MiniStat label="Usuarios internos" value={planLimits.internalUsers ? String(planLimits.internalUsers) : "Ilimitado"} />
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-secondary/35 p-4 flex flex-col justify-between gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Mensalidade</div>
                  <div className="text-2xl font-bold">{formatBRL(activePlan?.priceMonthly ?? 0)}</div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/app/assinatura">Abrir gestao completa da assinatura</Link>
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={Palette}
              title="Aparencia da loja online"
              description="Logo, capa e cores seguindo a identidade visual refinada do produto."
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UploadField
                label="Logo"
                imageUrl={storeForm.logo_url}
                emptyIcon={<Upload className="h-5 w-5 text-muted-foreground" />}
                onFileSelect={(file) => void upload(file, "logo_url")}
                previewClassName="h-16 w-16"
              />
              <UploadField
                label="Banner de capa"
                imageUrl={storeForm.cover_url}
                emptyIcon={<Upload className="h-5 w-5 text-muted-foreground" />}
                onFileSelect={(file) => void upload(file, "cover_url")}
                previewClassName="h-16 w-24"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <Label>Cor principal</Label>
                <Input type="color" value={storeForm.primary_color ?? "#0f766e"} onChange={(e) => setStoreForm({ ...storeForm, primary_color: e.target.value })} className="h-11 w-full" />
              </Field>
              <Field>
                <Label>Cor secundaria</Label>
                <Input type="color" value={storeForm.secondary_color ?? "#101828"} onChange={(e) => setStoreForm({ ...storeForm, secondary_color: e.target.value })} className="h-11 w-full" />
              </Field>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Field = ({ children }: { children: React.ReactNode }) => <div className="space-y-2">{children}</div>;

const SectionHeader = ({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) => (
  <div className="flex items-start gap-3">
    <div className="rounded-lg border border-border bg-secondary/45 p-2.5">
      <Icon className="h-4 w-4 text-primary" />
    </div>
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  </div>
);

const SwitchRow = ({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) => (
  <div className="rounded-lg border border-border bg-background/65 p-4">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  </div>
);

const UploadField = ({
  label,
  imageUrl,
  previewClassName,
  emptyIcon,
  onFileSelect,
}: {
  label: string;
  imageUrl: string | null;
  previewClassName: string;
  emptyIcon: React.ReactNode;
  onFileSelect: (file: File) => void;
}) => (
  <div className="rounded-lg border border-border bg-background/65 p-4 space-y-3">
    <Label>{label}</Label>
    <div className="flex items-center gap-3">
      <div className={`${previewClassName} rounded bg-muted overflow-hidden flex items-center justify-center shrink-0`}>
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : emptyIcon}
      </div>
      <label className="cursor-pointer">
        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
        <Button type="button" variant="outline" asChild><span>Escolher arquivo</span></Button>
      </label>
    </div>
  </div>
);

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border bg-background/70 p-4">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className="mt-1 text-lg font-semibold">{value}</div>
  </div>
);

const parseBusinessHours = (value: Json | undefined): BusinessHours => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_BUSINESS_HOURS;

  const source = value as Record<string, unknown>;
  const result = { ...DEFAULT_BUSINESS_HOURS };

  for (const day of WEEKDAYS) {
    const current = source[day.key];
    if (!current || typeof current !== "object" || Array.isArray(current)) continue;
    const item = current as Record<string, unknown>;
    result[day.key] = {
      enabled: typeof item.enabled === "boolean" ? item.enabled : DEFAULT_BUSINESS_HOURS[day.key].enabled,
      open: typeof item.open === "string" ? item.open : DEFAULT_BUSINESS_HOURS[day.key].open,
      close: typeof item.close === "string" ? item.close : DEFAULT_BUSINESS_HOURS[day.key].close,
    };
  }

  return result;
};

const parseExcludedNeighborhoods = (value: Json | undefined) => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const buildStoreForm = (store: StoreRow): StoreRow => ({
  ...store,
  public_name: store.public_name ?? null,
  neighborhood: store.neighborhood ?? null,
  address_number: store.address_number ?? null,
  address_complement: store.address_complement ?? null,
  latitude: store.latitude ?? null,
  longitude: store.longitude ?? null,
  secondary_color: store.secondary_color ?? "#101828",
});

const buildStoreSettings = (settings: StoreSettingsRow | null): StoreSettingsRow => ({
  id: settings?.id ?? crypto.randomUUID(),
  store_id: settings?.store_id ?? "",
  created_at: settings?.created_at ?? new Date().toISOString(),
  updated_at: settings?.updated_at ?? new Date().toISOString(),
  is_open: settings?.is_open ?? true,
  accept_orders_when_closed: settings?.accept_orders_when_closed ?? false,
  min_order_value: settings?.min_order_value ?? 0,
  avg_prep_time_minutes: settings?.avg_prep_time_minutes ?? 30,
  allow_delivery: settings?.allow_delivery ?? true,
  allow_pickup: settings?.allow_pickup ?? true,
  accept_cash: settings?.accept_cash ?? true,
  accept_pix: settings?.accept_pix ?? true,
  accept_card_on_delivery: settings?.accept_card_on_delivery ?? true,
  accept_card_online: settings?.accept_card_online ?? true,
  pix_key: settings?.pix_key ?? null,
  pix_key_type: settings?.pix_key_type ?? null,
  business_hours: settings?.business_hours ?? DEFAULT_BUSINESS_HOURS,
  delivery_radius_km: settings?.delivery_radius_km ?? 0,
  delivery_base_fee: settings?.delivery_base_fee ?? 0,
  delivery_distance_rules: settings?.delivery_distance_rules ?? [],
  delivery_fee_per_km: settings?.delivery_fee_per_km ?? 0,
  delivery_message: settings?.delivery_message ?? null,
  excluded_neighborhoods: settings?.excluded_neighborhoods ?? [],
});

const getStoreStatusValue = (settings: StoreSettingsRow): StoreStatusValue => {
  if (settings.is_open) return "open";
  if (settings.accept_orders_when_closed) return "paused";
  return "closed";
};

const applyStoreStatus = (settings: StoreSettingsRow, status: StoreStatusValue): StoreSettingsRow => {
  if (status === "open") {
    return { ...settings, is_open: true, accept_orders_when_closed: false };
  }
  if (status === "paused") {
    return { ...settings, is_open: false, accept_orders_when_closed: true };
  }
  return { ...settings, is_open: false, accept_orders_when_closed: false };
};

const nullableText = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const toNullableNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const createDistanceBand = (bands: DeliveryDistanceBand[]): DeliveryDistanceBand => {
  const previous = bands[bands.length - 1];
  const startKm = previous ? previous.endKm : 0;
  const endKm = previous ? Number((previous.endKm + 1).toFixed(1)) : 2;

  return {
    id: crypto.randomUUID(),
    startKm,
    endKm,
    fee: 0,
  };
};

const updateDistanceBand = (
  setBands: Dispatch<SetStateAction<DeliveryDistanceBand[]>>,
  id: string,
  field: keyof Omit<DeliveryDistanceBand, "id">,
  value: number,
) => {
  setBands((current) => current.map((band) => (
    band.id === id ? { ...band, [field]: value } : band
  )));
};

const shouldRetryWithLegacySchema = (error: { message?: string } | null) =>
  Boolean(error?.message && (
    error.message.includes("schema cache") ||
    error.message.includes("column") ||
    error.message.includes("public_name") ||
    error.message.includes("delivery_radius_km") ||
    error.message.includes("delivery_base_fee") ||
    error.message.includes("delivery_fee_per_km") ||
    error.message.includes("delivery_distance_rules")
  ));

export default Settings;
