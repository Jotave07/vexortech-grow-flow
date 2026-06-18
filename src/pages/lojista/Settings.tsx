import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import type { Json, Tables } from "@/integrations/backend/types";
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
import { Loader2, MapPin, Palette, Save, Search, Settings2, Store, TimerReset, Truck, Upload, Wallet, Copy, ShieldCheck, Activity } from "lucide-react";
import { fetchAddressByCep } from "@/services/cep/viacepService";
import { ViaCepError } from "@/services/viacep";
import { buildAddressLabel, fetchAddressFromCurrentLocation, geocodeAddressCoordinates, normalizeCep } from "@/services/viacep";
import { validateDeliverySettings } from "@/lib/delivery";
import { STORE_SEGMENT_OPTIONS, normalizeStoreSegment } from "@/lib/store-segments";
import { formatBRL, formatPhone, formatDoc, formatCEP } from "@/lib/format";
import { getPlanLimits, getStatusMeta, normalizePlan } from "@/lib/subscription";
import { getStoreProfileVerification } from "@/lib/profile-verification";
import { getStoreThemeStyle } from "@/lib/store-theme";

type StoreRow = Tables<"stores">;
type StoreFormRow = StoreRow & { store_type?: string | null };
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

const STORE_TYPE_LABELS: Record<string, string> = {
  Restaurantes: "Restaurante",
  Lanches: "Lanchonete / Lanches",
  Pizza: "Pizzaria / Pizza",
  Açaí: "Açaí / Sorvetes",
  Mercados: "Mercado / Conveniência",
  Bebidas: "Distribuidora / Bebidas",
  Farmácia: "Farmácia / Drogaria",
  Pet: "Pet shop",
  Outros: "Outros",
};

const Settings = () => {
  const { store } = useOutletContext<{ store: { id: string } }>();
  const [storeForm, setStoreForm] = useState<StoreFormRow | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettingsRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [cepLookup, setCepLookup] = useState<CepLookupState>({ status: "idle" });
  const [geocodingStore, setGeocodingStore] = useState(false);
  const load = useCallback(async () => {
    if (!store?.id) return;

    setLoading(true);
    setLoadingError(null);
    const [storeRes, settingsRes, subscriptionRes, plansRes] = await Promise.all([
      backend.from("stores").select("*").eq("id", store.id).maybeSingle(),
      backend.from("store_settings").select("*").eq("store_id", store.id).maybeSingle(),
      backend.from("subscriptions").select("*, plans(*)").eq("store_id", store.id).maybeSingle(),
      backend.from("plans").select("*").eq("is_active", true).order("sort_order"),
    ]);

    if (storeRes.error) {
      setLoading(false);
      setLoadingError(storeRes.error.message);
      return;
    }

    if (!storeRes.data) {
      setLoading(false);
      setLoadingError("Não foi possível localizar os dados da loja.");
      return;
    }

    let settingsRow = settingsRes.data as StoreSettingsRow | null;

    if (settingsRes.error) {
      setLoading(false);
      setLoadingError(settingsRes.error.message);
      return;
    }

    if (!settingsRow) {
      const created = await backend.from("store_settings").insert({ store_id: store.id }).select("*").maybeSingle();
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
    const { error } = await backend.storage.from("store-assets").upload(path, file);
    if (error) return toast.error(error.message);
    const { data } = backend.storage.from("store-assets").getPublicUrl(path);
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
        zip_code: address.cep || storeForm.zip_code,
        address: address.logradouro || storeForm.address,
        neighborhood: address.bairro || storeForm.neighborhood,
        city: address.localidade || storeForm.city,
        state: address.uf || storeForm.state,
        address_complement: storeForm.address_complement || address.complemento || null,
      });
      setCepLookup({ status: "success", message: "Endereço encontrado e preenchido. Revise os campos antes de salvar." });
      toast.success("Endereço localizado pelo CEP.");
    } catch (error) {
      const message = error instanceof ViaCepError ? error.message : "Não foi possível consultar o CEP.";
      setCepLookup({ status: "error", message });
      toast.error(message);
    }
  };

  const geocodeStoreAddress = async () => {
    if (!storeForm) return;
    setGeocodingStore(true);
    try {
      const coordinates = await geocodeAddressCoordinates({
        street: storeForm.address ?? "",
        number: storeForm.address_number ?? "",
        neighborhood: storeForm.neighborhood ?? "",
        city: storeForm.city ?? "",
        state: storeForm.state ?? "",
        zipCode: storeForm.zip_code ?? "",
      });

      if (!coordinates) {
        toast.error("Não foi possível gerar coordenadas. Confira rua, número, cidade e UF.");
        return;
      }

      setStoreForm({ ...storeForm, latitude: coordinates.lat, longitude: coordinates.lng });
      toast.success("Coordenadas da loja atualizadas.");
    } finally {
      setGeocodingStore(false);
    }
  };

  const useCurrentStoreLocation = async () => {
    if (!storeForm) return;
    setGeocodingStore(true);
    try {
      const address = await fetchAddressFromCurrentLocation();
      setStoreForm({
        ...storeForm,
        zip_code: address.cep || storeForm.zip_code,
        address: address.street || storeForm.address,
        neighborhood: address.neighborhood || storeForm.neighborhood,
        city: address.city || storeForm.city,
        state: address.state || storeForm.state,
        latitude: address.lat ?? storeForm.latitude,
        longitude: address.lng ?? storeForm.longitude,
      });
      toast.success("Localização atual aplicada à loja. Revise número e complemento.");
    } catch (error: any) {
      toast.error(error.message || "Não foi possível usar a localização atual.");
    } finally {
      setGeocodingStore(false);
    }
  };

  const save = async () => {
    if (!storeForm || !storeSettings) return;

    const deliveryConfig = {
      allowDelivery: storeSettings.allow_delivery,
      allowPickup: storeSettings.allow_pickup,
      deliveryRadiusKm: toNullableNumber(storeSettings.delivery_radius_km),
      hasStoreAddress: Boolean(storeForm.address && storeForm.address_number && storeForm.neighborhood && storeForm.city && storeForm.state),
      hasStoreCoordinates: Boolean(storeForm.latitude && storeForm.longitude),
    };

    const validation = validateDeliverySettings(deliveryConfig);
    if (!validation.valid) {
      toast.error(validation.issues[0]?.message ?? "Revise as configurações de entrega.");
      return;
    }

    if (storeSettings.accept_pix && !nullableText(storeSettings.pix_key)) {
      toast.error("Informe a chave Pix da loja para aceitar Pix no checkout.");
      return;
    }

    setSaving(true);
    try {
    const baseStorePayload = {
      name: storeForm.name?.toUpperCase(),
      description: nullableText(storeForm.description),
      logo_url: nullableText(storeForm.logo_url),
      cover_url: nullableText(storeForm.cover_url),
      phone: nullableText(storeForm.phone?.replace(/\D/g, "")),
      whatsapp: nullableText(storeForm.whatsapp?.replace(/\D/g, "")),
      email: nullableText(storeForm.email),
      document: nullableText(storeForm.document?.replace(/\D/g, "")),
      address: nullableText(storeForm.address?.toUpperCase()),
      city: nullableText(storeForm.city?.toUpperCase()),
      state: nullableText(storeForm.state)?.toUpperCase() ?? null,
      zip_code: nullableText(storeForm.zip_code ? normalizeCep(storeForm.zip_code) : null),
      primary_color: nullableText(storeForm.primary_color),
      secondary_color: nullableText(storeForm.secondary_color),
    };
    const extendedStorePayload = {
      public_name: nullableText(storeForm.public_name?.toUpperCase()),
      store_type: normalizeStoreSegment(storeForm.store_type) ?? "Restaurantes",
      address_number: nullableText(storeForm.address_number),
      address_complement: nullableText(storeForm.address_complement?.toUpperCase()),
      neighborhood: nullableText(storeForm.neighborhood?.toUpperCase()),
      latitude: toNullableNumber(storeForm.latitude),
      longitude: toNullableNumber(storeForm.longitude),
    };
    const baseSettingsPayload = {
      is_open: storeSettings.is_open,
      accept_orders_when_closed: storeSettings.accept_orders_when_closed,
      avg_prep_time_minutes: Number(storeSettings.avg_prep_time_minutes) || 30,
      allow_delivery: storeSettings.allow_delivery,
      allow_pickup: storeSettings.allow_pickup,
      accept_cash: storeSettings.accept_cash,
      accept_pix: storeSettings.accept_pix,
      accept_card_on_delivery: storeSettings.accept_card_on_delivery,
      pix_key: nullableText(storeSettings.pix_key),
      pix_key_type: nullableText(storeSettings.pix_key_type),
      payment_instructions: nullableText((storeSettings as any).payment_instructions),
      asaas_api_key: null,
      asaas_wallet_id: null,
      business_hours: businessHours as unknown as Json,
    };
    const extendedSettingsPayload = {
      payment_gateway_provider: null,
      payment_gateway_api_key: null,
      payment_gateway_config: {} as unknown as Json,
      delivery_radius_km: toNullableNumber(storeSettings.delivery_radius_km),
    };

    const storeUpdate = await backend.from("stores").update({
      ...baseStorePayload,
      ...extendedStorePayload,
    }).eq("id", store.id);
    const safeStoreUpdate = shouldRetryWithLegacySchema(storeUpdate.error)
      ? await backend.from("stores").update(baseStorePayload).eq("id", store.id)
      : storeUpdate;

    const settingsUpdate = await backend.from("store_settings").update({
      ...baseSettingsPayload,
      ...extendedSettingsPayload,
    } as any).eq("store_id", store.id);
    const safeSettingsUpdate = shouldRetryWithLegacySchema(settingsUpdate.error)
      ? await backend.from("store_settings").update(baseSettingsPayload as any).eq("store_id", store.id)
      : settingsUpdate;

    if (safeStoreUpdate.error || safeSettingsUpdate.error) {
      toast.error(safeStoreUpdate.error?.message ?? safeSettingsUpdate.error?.message ?? "Erro ao salvar configurações.");
      return;
    }

    toast.success("Configurações salvas com sucesso.");
    if (shouldRetryWithLegacySchema(storeUpdate.error) || shouldRetryWithLegacySchema(settingsUpdate.error)) {
      toast.message("As configurações básicas foram salvas. Campos avançados dependem de migrations ainda não aplicadas no banco.");
    }
    setCepLookup((current) => current.status === "success" ? { ...current, message: "Endereço salvo com sucesso." } : current);
    void load();
    } catch (error: any) {
      toast.error(error?.message || "Erro inesperado ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  const activePlan = useMemo(
    () => normalizePlan(subscription?.plans ?? plans.find((plan) => plan.id === storeForm?.plan_id) ?? null),
    [plans, storeForm?.plan_id, subscription?.plans],
  );
  const subscriptionStatus = getStatusMeta(subscription);
  const planLimits = getPlanLimits(activePlan);
  const storeVerification = getStoreProfileVerification(storeForm ?? {}, storeSettings);

  if (loading) {
    return <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>;
  }

  if (loadingError) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">Não foi possível carregar as configurações</h1>
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
          <h1 className="text-xl font-semibold">Configurações indisponíveis</h1>
          <p className="text-sm text-muted-foreground">Os dados iniciais da loja não puderam ser preparados.</p>
          <Button variant="outline" onClick={() => void load()}>Recarregar</Button>
        </div>
      </Card>
    );
  }

  const deliveryValidation = validateDeliverySettings({
    allowDelivery: storeSettings.allow_delivery,
    allowPickup: storeSettings.allow_pickup,
    deliveryRadiusKm: toNullableNumber(storeSettings.delivery_radius_km),
    hasStoreAddress: Boolean(storeForm.address && storeForm.address_number && storeForm.neighborhood && storeForm.city && storeForm.state),
    hasStoreCoordinates: Boolean(storeForm.latitude && storeForm.longitude),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Configurações</h1>
          <p className="text-muted-foreground">Estruture sua operacao, endereco, entrega, pagamentos e assinatura sem perder o acabamento premium da loja.</p>
        </div>
        <Button variant="hero" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar alteracoes
        </Button>
      </div>

      <Tabs defaultValue="general" className="space-y-5">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none bg-secondary/80 p-1">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="address">Endereço</TabsTrigger>
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
                <Input id="store-name" value={storeForm.name ?? ""} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value.toUpperCase() })} />
              </Field>
              <Field>
                <Label htmlFor="store-public-name">Nome público</Label>
                <Input
                  id="store-public-name"
                  value={storeForm.public_name ?? ""}
                  onChange={(e) => setStoreForm({ ...storeForm, public_name: e.target.value.toUpperCase() })}
                  placeholder="Como a loja aparece para clientes"
                />
              </Field>
              <Field>
                <Label>Tipo de loja</Label>
                <Select
                  value={normalizeStoreSegment(storeForm.store_type) ?? "Restaurantes"}
                  onValueChange={(value) => setStoreForm({ ...storeForm, store_type: value })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STORE_SEGMENT_OPTIONS.map((segment) => (
                      <SelectItem key={segment} value={segment}>{STORE_TYPE_LABELS[segment] ?? segment}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <Label htmlFor="store-description">Descricao curta</Label>
              <Textarea id="store-description" rows={3} value={storeForm.description ?? ""} onChange={(e) => setStoreForm({ ...storeForm, description: e.target.value })} />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <Label htmlFor="store-whatsapp">WhatsApp</Label>
                <Input id="store-whatsapp" value={formatPhone(storeForm.whatsapp) ?? ""} onChange={(e) => setStoreForm({ ...storeForm, whatsapp: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-phone">Telefone</Label>
                <Input id="store-phone" value={formatPhone(storeForm.phone) ?? ""} onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-email">E-mail</Label>
                <Input id="store-email" type="email" value={storeForm.email ?? ""} onChange={(e) => setStoreForm({ ...storeForm, email: e.target.value.toLowerCase() })} />
              </Field>
              <Field>
                <Label htmlFor="store-document">CNPJ ou CPF</Label>
                <Input id="store-document" value={formatDoc(storeForm.document) ?? ""} onChange={(e) => setStoreForm({ ...storeForm, document: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={ShieldCheck}
              title="Confianca do perfil"
              description="Selo calculado com dados fiscais, contato, endereco, visual e formas de pagamento."
            />

            <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
              <div className="rounded-none border border-border bg-background/70 p-4">
                <div className="text-sm text-muted-foreground">Pontuacao do perfil</div>
                <div className="mt-2 text-3xl font-bold text-foreground">{storeVerification.score}%</div>
                <Badge className="mt-3 rounded-none bg-primary/15 text-foreground hover:bg-primary/15">
                  <ShieldCheck className="mr-1 h-3.5 w-3.5 text-primary" />
                  {storeVerification.label}
                </Badge>
                <p className="mt-3 text-sm text-muted-foreground">{storeVerification.detail}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {storeVerification.checks.map((check) => (
                  <div key={check.key} className="flex items-center justify-between gap-3 rounded-none border border-border bg-background/70 px-3 py-2 text-sm">
                    <span>{check.label}</span>
                    <Badge variant={check.ok ? "default" : "secondary"}>{check.ok ? "OK" : "Pendente"}</Badge>
                  </div>
                ))}
              </div>
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
                    <SelectItem value="paused">Pausa temporária</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div className="rounded-none border border-border bg-secondary/35 p-4 text-sm text-muted-foreground">
                {getStoreStatusValue(storeSettings) === "open" && "A loja fica visivel e aceita pedidos normalmente."}
                {getStoreStatusValue(storeSettings) === "closed" && "A loja continua publicada, mas o checkout não deve aceitar novos pedidos."}
                {getStoreStatusValue(storeSettings) === "paused" && "A operação fica em pausa, com a base pronta para comportamento diferenciado em fluxos futuros."}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {WEEKDAYS.map((day) => (
                <div key={day.key} className="rounded-none border border-border bg-background/65 p-4 space-y-3">
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
              title="Endereço da loja"
              description="Use o ViaCEP para preencher rua, bairro, cidade e UF. Numero e complemento continuam editaveis manualmente."
            />

            <div className="grid grid-cols-1 md:grid-cols-[220px_auto_auto_auto] gap-3 items-end">
              <Field>
                <Label htmlFor="store-zip-code">CEP</Label>
                <Input id="store-zip-code" value={formatCEP(storeForm.zip_code) ?? ""} onChange={(e) => setStoreForm({ ...storeForm, zip_code: e.target.value })} placeholder="00000-000" />
              </Field>
              <Button variant="outline" type="button" className="w-full md:w-auto" onClick={lookupCep} disabled={cepLookup.status === "loading"}>
                {cepLookup.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar CEP
              </Button>
              <Button variant="outline" type="button" className="w-full md:w-auto" onClick={geocodeStoreAddress} disabled={geocodingStore}>
                {geocodingStore ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                Gerar coordenadas
              </Button>
              <Button variant="outline" type="button" className="w-full md:w-auto" onClick={useCurrentStoreLocation} disabled={geocodingStore}>
                Usar local atual
              </Button>
            </div>

            {cepLookup.message && (
              <div className={`rounded-none border px-4 py-3 text-sm ${
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
                <Input id="store-street" value={storeForm.address?.toUpperCase() ?? ""} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value.toUpperCase() })} />
              </div>
              <Field>
                <Label htmlFor="store-address-number">Numero</Label>
                <Input id="store-address-number" value={storeForm.address_number ?? ""} onChange={(e) => setStoreForm({ ...storeForm, address_number: e.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="store-neighborhood">Bairro</Label>
                <Input id="store-neighborhood" value={storeForm.neighborhood?.toUpperCase() ?? ""} onChange={(e) => setStoreForm({ ...storeForm, neighborhood: e.target.value.toUpperCase() })} />
              </Field>
              <div className="md:col-span-2">
                <Label htmlFor="store-address-complement">Complemento</Label>
                <Input id="store-address-complement" value={storeForm.address_complement?.toUpperCase() ?? ""} onChange={(e) => setStoreForm({ ...storeForm, address_complement: e.target.value.toUpperCase() })} />
              </div>
              <Field>
                <Label htmlFor="store-city">Cidade</Label>
                <Input id="store-city" value={storeForm.city?.toUpperCase() ?? ""} onChange={(e) => setStoreForm({ ...storeForm, city: e.target.value.toUpperCase() })} />
              </Field>
              <Field>
                <Label htmlFor="store-state">UF</Label>
                <Input id="store-state" maxLength={2} value={storeForm.state ?? ""} onChange={(e) => setStoreForm({ ...storeForm, state: e.target.value.toUpperCase().slice(0, 2) })} />
              </Field>
            </div>

            <div className="rounded-none border border-border bg-secondary/35 p-4 text-sm text-muted-foreground space-y-2">
              <div className="font-medium text-foreground">Endereço consolidado</div>
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
                  : "ainda não configuradas. Gere coordenadas para ativar o raio automático com mais precisão."}
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="delivery" className="space-y-4">
          <Card className="p-6 space-y-5">
            <SectionHeader
              icon={Truck}
              title="Entrega e retirada"
              description="Controle disponibilidade, localizacao da loja e raio maximo. Os valores de frete sao configurados na aba Entregas."
            />

            <div className="rounded-none border border-primary/20 bg-primary/5 p-4 text-sm font-medium text-foreground">
              Os valores de frete sao configurados na aba Entregas.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SwitchRow
                label="Ativar entrega"
                description="Quando desligado, o checkout público não deve oferecer entrega."
                checked={storeSettings.allow_delivery}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, allow_delivery: value })}
              />
              <SwitchRow
                label="Ativar retirada no local"
                description="Mantém a opção de retirada sem exigir motoboy."
                checked={storeSettings.allow_pickup}
                onCheckedChange={(value) => setStoreSettings({ ...storeSettings, allow_pickup: value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>

            <div className="rounded-none border border-border bg-secondary/35 p-4 text-sm text-muted-foreground space-y-2">
              <div className="font-medium text-foreground">Resumo atual</div>
              <div>
                Raio maximo configurado: {toNullableNumber(storeSettings.delivery_radius_km)
                  ? `${Number(storeSettings.delivery_radius_km).toFixed(1).replace(".", ",")} km`
                  : "nao definido"}.
              </div>
              <div>
                Validação por distância automática: {storeForm.latitude && storeForm.longitude
                  ? "ativa. O checkout cruza coordenadas, consulta rota pública quando possível e bloqueia pedidos fora do raio."
                  : "aguardando coordenadas confiáveis da loja. Use Gerar coordenadas na aba Endereço."}
              </div>
            </div>

            {!deliveryValidation.valid && (
              <div className="rounded-none border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive space-y-1">
                {deliveryValidation.issues.map((issue) => (
                  <div key={`${issue.field}-${issue.message}`}>{issue.message}</div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card className="p-6 space-y-6">
            <SectionHeader
              icon={Wallet}
              title="Pagamentos"
              description="Configure como sua loja recebe pagamentos dos pedidos."
            />

            <div className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Pix da loja
              </h3>
              
              <div className="grid gap-4 rounded-none border border-primary/20 bg-primary/5 p-4">
                <div className="space-y-2">
                  <Label htmlFor="store-pix-key" className="text-xs font-black uppercase tracking-widest">
                    Chave Pix ou Pix copia e cola
                  </Label>
                  <Textarea
                    id="store-pix-key"
                    placeholder="Informe a chave Pix recebedora da loja ou um Pix copia e cola"
                    value={storeSettings.pix_key ?? ""}
                    onChange={(event) => setStoreSettings({
                      ...storeSettings,
                      pix_key: event.target.value,
                      pix_key_type: event.target.value.trim().startsWith("000201") ? "copy_paste" : "key",
                    } as any)}
                    className="min-h-[96px] rounded-none border border-border bg-white font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payment-instructions" className="text-xs font-black uppercase tracking-widest">
                    Instrucoes para o cliente
                  </Label>
                  <Textarea
                    id="payment-instructions"
                    placeholder="Ex.: Depois de pagar, envie o comprovante pelo WhatsApp e aguarde a confirmacao."
                    value={String((storeSettings as any).payment_instructions ?? "")}
                    onChange={(event) => setStoreSettings({
                      ...storeSettings,
                      payment_instructions: event.target.value,
                    } as any)}
                    className="min-h-[76px] rounded-none border border-border bg-white text-sm"
                  />
                </div>

                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest leading-relaxed">
                  Essa chave e usada apenas para mostrar o Pix ao cliente. A confirmacao do pagamento e manual no painel de pedidos.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <SwitchRow
                  label="Aceitar PIX"
                  description="Mostra a chave Pix da loja no checkout e aguarda aprovacao manual."
                  checked={!!storeSettings.accept_pix}
                  onCheckedChange={(val) => setStoreSettings({ ...storeSettings, accept_pix: val })}
                />
                <SwitchRow
                  label="Aceitar Dinheiro"
                  description="Pagamento em espécie na entrega."
                  checked={!!storeSettings.accept_cash}
                  onCheckedChange={(val) => setStoreSettings({ ...storeSettings, accept_cash: val })}
                />
                <SwitchRow
                  label="Cartão na Entrega"
                  description="Crédito ou Débito na maquininha."
                  checked={!!storeSettings.accept_card_on_delivery}
                  onCheckedChange={(val) => setStoreSettings({ ...storeSettings, accept_card_on_delivery: val })}
                />
              </div>

              <div className="hidden">
                <h4 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Confirmacao manual do Pix
                </h4>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input 
                      value="Confirmacao manual pelo painel de pedidos"
                      readOnly 
                      className="rounded-none border border-border bg-white font-mono text-[10px]" 
                    />
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="shrink-0 rounded-none border border-border"
                      onClick={() => {
                        navigator.clipboard.writeText("Confirmacao manual pelo painel de pedidos");
                        toast.success("Link copiado!");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                    Confira o recebimento do Pix e aprove manualmente no pedido.
                  </p>
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
              description="Consulta privada do plano atual. Alteracoes de assinatura ficam isoladas na gestao segura."
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
              <div className="space-y-4">
                <div className="rounded-none border border-border bg-background/70 p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm text-muted-foreground">Assinatura atual</div>
                      <div className="text-xl font-semibold">{activePlan?.name ?? "Sem plano definido"}</div>
                      {activePlan?.description && (
                        <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{activePlan.description}</div>
                      )}
                      <div className="mt-1 text-sm text-muted-foreground">{subscriptionStatus.detail}</div>
                    </div>
                    <Badge variant={subscriptionStatus.tone}>{subscriptionStatus.label}</Badge>
                  </div>
                </div>

                {activePlan && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <MiniStat label="Produtos" value={formatLimitValue(planLimits.products)} />
                      <MiniStat label="Pedidos por mes" value={formatLimitValue(planLimits.monthlyOrders)} />
                      <MiniStat label="Lojas/unidades" value={formatLimitValue(planLimits.stores)} />
                      <MiniStat label="Usuarios internos" value={formatLimitValue(planLimits.internalUsers)} />
                    </div>

                    {activePlan.marketingFeatures.length > 0 && (
                      <div className="rounded-none border border-border bg-secondary/30 p-4">
                        <div className="text-sm font-medium">Recursos cadastrados no plano</div>
                        <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                          {activePlan.marketingFeatures.slice(0, 6).map((feature) => (
                            <div key={feature} className="rounded-none bg-background/70 px-3 py-2">{feature}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-none border border-border bg-secondary/35 p-4 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Mensalidade</div>
                    <div className="text-2xl font-bold">{formatBRL(activePlan?.priceMonthly ?? 0)}</div>
                  </div>
                  <div className="rounded-none border border-border bg-background/70 p-3 text-xs text-muted-foreground">
                    Dados de cartao nao aparecem aqui. Para evitar alteracoes acidentais, troca de plano e pagamento ficam na tela segura de assinatura.
                  </div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/lojista/assinatura">Abrir gestao segura</Link>
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

            <div className="rounded-none border border-border bg-secondary/35 p-4">
              <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Previa da loja</div>
              <div style={getStoreThemeStyle(storeForm)} className="overflow-hidden rounded-none border border-border bg-white">
                <div className="h-20 bg-[linear-gradient(135deg,var(--primary),var(--accent))]" />
                <div className="grid gap-3 p-4 sm:grid-cols-[4.5rem_1fr_auto] sm:items-center">
                  <div className="-mt-10 h-20 w-20 overflow-hidden rounded-none border-4 border-white bg-white shadow-sm">
                    {storeForm.logo_url ? (
                      <img src={storeForm.logo_url} alt={storeForm.public_name || storeForm.name || 'Logo da loja'} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-secondary text-primary">
                        <Store className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="font-bold">{storeForm.public_name || storeForm.name || "Nome da loja"}</div>
                    <div className="text-sm text-muted-foreground">{storeForm.description || "Descricao curta da loja para clientes."}</div>
                  </div>
                  <Button type="button" className="w-full sm:w-auto">Ver cardapio</Button>
                </div>
              </div>
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
    <div className="rounded-none border border-border bg-secondary/45 p-2.5">
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
  <div className="rounded-none border border-border bg-background/65 p-4">
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
  <div className="rounded-none border border-border bg-background/65 p-4 space-y-3">
    <Label>{label}</Label>
    <div className="flex items-center gap-3">
      <div className={`${previewClassName} rounded-none border border-border bg-white overflow-hidden flex items-center justify-center shrink-0`}>
        {imageUrl ? <img src={imageUrl} alt={label} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-contain" /> : emptyIcon}
      </div>
      <label className="cursor-pointer">
        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
        <Button type="button" variant="outline" asChild><span>Escolher arquivo</span></Button>
      </label>
    </div>
  </div>
);

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-none border border-border bg-background/70 p-4">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className="mt-1 text-lg font-semibold">{value}</div>
  </div>
);

const formatLimitValue = (value: number | null | undefined) =>
  value === null || value === undefined ? "Ilimitado" : String(value);

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

const buildStoreForm = (store: StoreFormRow): StoreFormRow => ({
  ...store,
  public_name: store.public_name ?? null,
  store_type: normalizeStoreSegment(store.store_type) ?? "Restaurantes",
  neighborhood: store.neighborhood ?? null,
  address_number: store.address_number ?? null,
  address_complement: store.address_complement ?? null,
  latitude: store.latitude ?? null,
  longitude: store.longitude ?? null,
  secondary_color: store.secondary_color ?? "#101828",
});

const buildStoreSettings = (settings: any): any => ({
  id: settings?.id ?? crypto.randomUUID(),
  store_id: settings?.store_id ?? "",
  created_at: settings?.created_at ?? new Date().toISOString(),
  updated_at: settings?.updated_at ?? new Date().toISOString(),
  is_open: settings?.is_open ?? true,
  accept_orders_when_closed: settings?.accept_orders_when_closed ?? false,
  min_order_value: Number(settings?.min_order_value ?? 0),
  avg_prep_time_minutes: Number(settings?.avg_prep_time_minutes ?? 30),
  allow_delivery: settings?.allow_delivery ?? true,
  allow_pickup: settings?.allow_pickup ?? true,
  accept_cash: settings?.accept_cash ?? true,
  accept_pix: settings?.accept_pix ?? true,
  accept_card_on_delivery: settings?.accept_card_on_delivery ?? true,
  accept_card_online: settings?.accept_card_online ?? true,
  pix_key: settings?.pix_key ?? null,
  pix_key_type: settings?.pix_key_type ?? null,
  payment_instructions: settings?.payment_instructions ?? null,
  business_hours: settings?.business_hours ?? DEFAULT_BUSINESS_HOURS,
  delivery_radius_km: settings?.delivery_radius_km ?? 0,
  delivery_base_fee: settings?.delivery_base_fee ?? 0,
  delivery_distance_rules: settings?.delivery_distance_rules ?? [],
  delivery_fee_per_km: settings?.delivery_fee_per_km ?? 0,
  delivery_message: settings?.delivery_message ?? null,
  excluded_neighborhoods: settings?.excluded_neighborhoods ?? [],
  asaas_api_key: settings?.asaas_api_key ?? null,
  asaas_wallet_id: settings?.asaas_wallet_id ?? null,
  payment_gateway_provider: settings?.payment_gateway_provider ?? null,
  payment_gateway_api_key: settings?.payment_gateway_api_key ?? null,
  payment_gateway_config: settings?.payment_gateway_config ?? {},
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

const shouldRetryWithLegacySchema = (error: { message?: string } | null) =>
  Boolean(error?.message && (
    error.message.includes("schema cache") ||
    error.message.includes("column") ||
    error.message.includes("public_name") ||
    error.message.includes("store_type") ||
    error.message.includes("delivery_radius_km") ||
    error.message.includes("delivery_base_fee") ||
    error.message.includes("delivery_fee_per_km") ||
    error.message.includes("delivery_distance_rules")
  ));

export default Settings;
