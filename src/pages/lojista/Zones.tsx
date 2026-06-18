import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Search, MapPin, Truck, Clock, AlertTriangle } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { DeliveryRegion } from "@/types/delivery";
import { isValidCep, normalizeCep, formatCep } from "@/utils/zipCode";
import { fetchAddressByCep } from "@/services/cep/viacepService";
import { calculateDeliveryQuote } from "@/services/delivery/deliveryQuoteService";
import type { AddressCoordinates } from "@/services/viacep";

type TestAddress = {
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  customerCoordinates?: AddressCoordinates | null;
};

const TEST_SUBTOTAL = 100;

const readQuoteDistanceKm = (quote: any) => {
  const value = quote?.distanceKm ?? quote?.distance_km;
  const distance = Number(value);
  return Number.isFinite(distance) ? distance : null;
};

const formatQuoteDistance = (distanceKm: number | null) =>
  distanceKm === null ? "calculando pelo CEP" : `${distanceKm.toFixed(1).replace(".", ",")} km`;

const Zones = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<DeliveryRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryRegion | null>(null);
  
  const initialForm = {
    name: "",
    neighborhood: "",
    city: store?.city || "",
    state: store?.state || "",
    zip_start: "",
    zip_end: "",
    max_radius_km: "",
    fee: "0",
    fee_per_km: "0",
    min_fee: "",
    max_fee: "",
    min_order: "0",
    base_prep_time: "30",
    minutes_per_km: "5",
    additional_region_time: "0",
    priority: "0",
    is_active: true
  };

  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [resolvingRegionCep, setResolvingRegionCep] = useState(false);
  
  const [testAddress, setTestAddress] = useState<TestAddress>({
    cep: "",
    street: "",
    number: "",
    neighborhood: "",
    city: "",
    state: "",
    customerCoordinates: null,
  });
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [lastAutoTestKey, setLastAutoTestKey] = useState("");

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const { data } = await backend
      .from("delivery_zones")
      .select("*")
      .eq("store_id", store.id)
      .order("priority", { ascending: false });
    setItems((data as DeliveryRegion[]) || []);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => { 
    setEditing(null); 
    setForm({ ...initialForm, city: store?.city || "", state: store?.state || "" }); 
    setOpen(true); 
  };

  const openEdit = (z: DeliveryRegion) => { 
    setEditing(z); 
    setForm({ 
      name: z.name || "",
      neighborhood: z.neighborhood || "", 
      city: z.city || "", 
      state: z.state || "",
      zip_start: z.zip_start || "",
      zip_end: z.zip_end || "",
      max_radius_km: z.max_radius_km ? String(z.max_radius_km) : "",
      fee: String(z.fee || 0), 
      fee_per_km: String(z.fee_per_km || 0),
      min_fee: z.min_fee ? String(z.min_fee) : "",
      max_fee: z.max_fee ? String(z.max_fee) : "",
      min_order: String(z.min_order || 0), 
      base_prep_time: String(z.base_prep_time || 30),
      minutes_per_km: String(z.minutes_per_km || 5),
      additional_region_time: String(z.additional_region_time || 0),
      priority: String(z.priority || 0),
      is_active: !!z.is_active
    }); 
    setOpen(true); 
  };

  const save = async () => {
    if (!form.name.trim() && !form.neighborhood.trim()) {
      return toast.error("Nome ou bairro é obrigatório");
    }
    
    setSaving(true);
    const payload = { 
      store_id: store.id, 
      name: form.name.trim(),
      neighborhood: form.neighborhood.trim(), 
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      zip_start: normalizeCep(form.zip_start) || null,
      zip_end: normalizeCep(form.zip_end) || null,
      max_radius_km: form.max_radius_km ? Number(form.max_radius_km) : null,
      fee: Number(form.fee) || 0,
      fee_per_km: Number(form.fee_per_km) || 0,
      min_fee: form.min_fee ? Number(form.min_fee) : null,
      max_fee: form.max_fee ? Number(form.max_fee) : null,
      min_order: Number(form.min_order) || 0, 
      base_prep_time: Number(form.base_prep_time) || 30,
      minutes_per_km: Number(form.minutes_per_km) || 5,
      additional_region_time: Number(form.additional_region_time) || 0,
      priority: Number(form.priority) || 0,
      is_active: form.is_active
    };

    const { error } = editing
      ? await backend.from("delivery_zones").update(payload).eq("id", editing.id)
      : await backend.from("delivery_zones").insert(payload);
    
    setSaving(false);
    if (error) return toast.error(error.message);
    
    toast.success("Região de entrega salva com sucesso!"); 
    setOpen(false); 
    load();
  };

  const toggle = async (z: DeliveryRegion) => { 
    const { error } = await backend.from("delivery_zones").update({ is_active: !z.is_active }).eq("id", z.id); 
    if (error) toast.error(error.message);
    load(); 
  };

  const remove = async (z: DeliveryRegion) => { 
    if (!confirm(`Excluir região "${z.name || z.neighborhood}"?`)) return; 
    const { error } = await backend.from("delivery_zones").delete().eq("id", z.id); 
    if (error) toast.error(error.message);
    load(); 
  };

  const quoteTestAddress = useCallback(async (address: TestAddress) => {
    const quote = await calculateDeliveryQuote({
      storeId: store.id,
      subtotal: TEST_SUBTOTAL,
      cep: normalizeCep(address.cep),
      street: address.street,
      number: address.number,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      customerCoordinates: address.customerCoordinates || null,
    });
    setTestResult(quote);
  }, [store.id]);

  const resolveCepForTest = useCallback(async (address: TestAddress) => {
    const cep = normalizeCep(address.cep);
    if (!cep || !isValidCep(cep)) return address;
    const resolved = await fetchAddressByCep(cep);
    const lat = Number(resolved.lat);
    const lng = Number(resolved.lng);
    return {
      ...address,
      cep: normalizeCep(resolved.cep || cep),
      street: (resolved.logradouro || address.street).toUpperCase(),
      neighborhood: (resolved.bairro || address.neighborhood).toUpperCase(),
      city: (resolved.localidade || address.city).toUpperCase(),
      state: (resolved.uf || address.state).toUpperCase(),
      customerCoordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    };
  }, []);

  const runTest = async () => {
    if (!isValidCep(testAddress.cep)) return toast.error("Informe um CEP valido");
    setTesting(true);
    try {
      const resolvedAddress = await resolveCepForTest(testAddress);
      setTestAddress(resolvedAddress);
      await quoteTestAddress(resolvedAddress);
    } catch (err: any) {
      toast.error(err.message || "Erro ao testar frete");
    } finally {
      setTesting(false);
    }
  };

  const fillRegionFromCep = async () => {
    const cep = normalizeCep(form.zip_start);
    if (!isValidCep(cep)) return toast.error("Informe um CEP inicial valido.");

    setResolvingRegionCep(true);
    try {
      const address = await fetchAddressByCep(cep);
      const neighborhood = (address.bairro || form.neighborhood || "").toUpperCase();
      const city = (address.localidade || form.city || "").toUpperCase();
      const state = (address.uf || form.state || "").toUpperCase().slice(0, 2);

      setForm((current) => ({
        ...current,
        name: current.name || neighborhood || city || `CEP ${formatCep(cep)}`,
        neighborhood,
        city,
        state,
        zip_start: cep,
        zip_end: normalizeCep(current.zip_end) || cep,
      }));
      toast.success("Regiao preenchida pelo CEP.");
    } catch (error: any) {
      toast.error(error?.message || "Nao foi possivel consultar o CEP.");
    } finally {
      setResolvingRegionCep(false);
    }
  };

  useEffect(() => {
    const cep = normalizeCep(testAddress.cep);
    const autoTestKey = cep;
    if (!store?.id || cep.length !== 8 || !isValidCep(cep) || autoTestKey === lastAutoTestKey) return;

    const timer = window.setTimeout(async () => {
      setTesting(true);
      try {
        const resolvedAddress = await resolveCepForTest(testAddress);
        setTestAddress(resolvedAddress);
        setLastAutoTestKey(autoTestKey);
        await quoteTestAddress(resolvedAddress);
      } catch (err: any) {
        setLastAutoTestKey(autoTestKey);
        setTestResult({ available: false, reason: err.message || "CEP invalido" });
      } finally {
        setTesting(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [lastAutoTestKey, quoteTestAddress, resolveCepForTest, store?.id, testAddress]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Configurações de Entrega</h1>
          <p className="text-muted-foreground">Gerencie regiões, bairros e faixas de CEP atendidos.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTestResult(null)} className="hidden md:flex">
             Limpar teste
          </Button>
          <Button variant="hero" onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Nova Região
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>
          ) : items.length === 0 ? (
            <Card className="p-10 text-center text-muted-foreground">Nenhuma região de entrega configurada.</Card>
          ) : (
            <div className="space-y-3">
              {items.map((z) => (
                <Card key={z.id} className={`p-4 transition-all ${!z.is_active ? 'opacity-60 bg-muted/50' : 'hover:border-primary/50'}`}>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg">{z.name || z.neighborhood}</span>
                        {!z.is_active && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded uppercase font-bold">Inativo</span>}
                        {(z.priority || 0) > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase font-bold">Prio {z.priority}</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {z.neighborhood || "Todos bairros"}, {z.city}</div>
                        {z.zip_start && <div className="flex items-center gap-1"><Search className="h-3 w-3" /> CEP {formatCep(z.zip_start)} a {formatCep(z.zip_end || "")}</div>}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2">
                        <div className="bg-primary/10 text-primary-foreground text-xs px-2 py-1 rounded-none font-medium flex items-center gap-1">
                          <Truck className="h-3 w-3" /> Taxa: {formatBRL(z.fee || 0)} {z.fee_per_km ? `+ ${formatBRL(z.fee_per_km)}/km` : ""}
                        </div>
                        <div className="bg-primary/15 text-foreground text-xs px-2 py-1 rounded-none font-medium flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {(z.base_prep_time || 30) + (z.additional_region_time || 0)} min base
                        </div>
                        <div className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-none font-medium">
                          Mín: {formatBRL(z.min_order || 0)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch checked={!!z.is_active} onCheckedChange={() => toggle(z)} />
                      <Button variant="ghost" size="icon" onClick={() => openEdit(z)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2"><Search className="h-4 w-4" /> Testar Cálculo</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label>CEP</Label>
                  <Input
                    placeholder="00000-000"
                    inputMode="numeric"
                    value={testAddress.cep}
                    onChange={e => {
                      setTestAddress({
                        cep: e.target.value,
                        street: "",
                        number: "",
                        neighborhood: "",
                        city: "",
                        state: "",
                        customerCoordinates: null,
                      });
                      setTestResult(null);
                      setLastAutoTestKey("");
                    }}
                  />
                </div>
                {(testAddress.street || testAddress.neighborhood || testAddress.city || testAddress.state) && (
                  <div className="rounded-none border border-border bg-muted/30 p-3 text-xs font-medium leading-relaxed text-muted-foreground">
                    {testAddress.street && <div>{testAddress.street}</div>}
                    {testAddress.neighborhood && <div>Bairro: {testAddress.neighborhood}</div>}
                    {(testAddress.city || testAddress.state) && <div>{[testAddress.city, testAddress.state].filter(Boolean).join("/")}</div>}
                  </div>
                )}
                <Button size="sm" onClick={runTest} disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Testar frete"}
                </Button>
              </div>

              {testResult && (
                <div className={`p-4 rounded-none border ${testResult.available ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                  {testResult.available ? (
                    <div className="space-y-2">
                      <div className="text-green-800 font-bold flex items-center gap-2">
                        Disponível!
                      </div>
                      <div className="text-sm text-green-700">
                        Região: <strong>{testResult.regionName || testResult.region?.name || testResult.region?.neighborhood}</strong><br/>
                        Distância: <strong>{formatQuoteDistance(readQuoteDistanceKm(testResult))}</strong><br/>
                        Taxa: <strong>{formatBRL(testResult.fee)}</strong><br/>
                        Previsão: <strong>{testResult.estimatedMin || testResult.estimated_min}-{testResult.estimatedMax || testResult.estimated_max} min</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-red-800 font-bold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Indisponível
                      </div>
                      <p className="text-sm text-red-700">{testResult.reason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar" : "Nova"} Região de Entrega</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Geral</TabsTrigger>
              <TabsTrigger value="pricing">Taxas</TabsTrigger>
              <TabsTrigger value="time">Tempo</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Nome da Região *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Centro" />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <Label>Cidade *</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <Label>UF *</Label>
                  <Input value={form.state} maxLength={2} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <Label>Prioridade</Label>
                  <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
                </div>
                <div>
                  <Label>Raio maximo da regiao (KM)</Label>
                  <Input type="number" step="0.1" value={form.max_radius_km} onChange={(e) => setForm({ ...form, max_radius_km: e.target.value })} />
                </div>
              </div>
              <div className="p-4 border rounded-none bg-muted/30">
                <Label className="mb-2 block font-bold">Faixa de CEP (Opcional)</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">CEP Inicial</Label>
                    <Input value={form.zip_start} onChange={(e) => setForm({ ...form, zip_start: e.target.value })} placeholder="00000-000" />
                  </div>
                  <div>
                    <Label className="text-xs">CEP Final</Label>
                    <Input value={form.zip_end} onChange={(e) => setForm({ ...form, zip_end: e.target.value })} placeholder="00000-000" />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={fillRegionFromCep}
                  disabled={resolvingRegionCep}
                >
                  {resolvingRegionCep ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Preencher bairro, cidade e UF pelo CEP
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="pricing" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Taxa Fixa (R$)</Label>
                  <Input type="number" step="0.01" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
                </div>
                <div>
                  <Label>Pedido Mínimo (R$)</Label>
                  <Input type="number" step="0.01" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} />
                </div>
                <div className="col-span-2 p-4 border rounded-none space-y-4">
                  <Label className="font-bold">Cálculo Avançado</Label>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Taxa p/ KM</Label>
                      <Input type="number" step="0.01" value={form.fee_per_km} onChange={(e) => setForm({ ...form, fee_per_km: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Mínimo</Label>
                      <Input type="number" step="0.01" value={form.min_fee} onChange={(e) => setForm({ ...form, min_fee: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Máximo</Label>
                      <Input type="number" step="0.01" value={form.max_fee} onChange={(e) => setForm({ ...form, max_fee: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="time" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Preparo (min)</Label>
                  <Input type="number" value={form.base_prep_time} onChange={(e) => setForm({ ...form, base_prep_time: e.target.value })} />
                </div>
                <div>
                  <Label>Extra Região (min)</Label>
                  <Input type="number" value={form.additional_region_time} onChange={(e) => setForm({ ...form, additional_region_time: e.target.value })} />
                </div>
                <div>
                  <Label>Minutos/KM</Label>
                  <Input type="number" value={form.minutes_per_km} onChange={(e) => setForm({ ...form, minutes_per_km: e.target.value })} />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="hero" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} 
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Zones;
