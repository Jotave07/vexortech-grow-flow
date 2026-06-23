import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, User, Phone, Bike, Car } from "lucide-react";
import { toast } from "sonner";

const VEHICLE_LABELS: Record<string, string> = {
  moto: "Moto",
  carro: "Carro",
  bicicleta: "Bicicleta",
};

const Drivers = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", phone: "", vehicle_type: "moto" });

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const { data, error } = await backend
      .from("delivery_drivers")
      .select("*")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });

    if (error) toast.error(error.message);
    setDrivers(data ?? []);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", phone: "", vehicle_type: "moto" });
    setDialogOpen(true);
  };

  const openEdit = (driver: any) => {
    setEditing(driver);
    setForm({ name: driver.name, phone: driver.phone || "", vehicle_type: driver.vehicle_type || "moto" });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Nome do entregador é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await backend
          .from("delivery_drivers")
          .update({ name: form.name.trim(), phone: form.phone.trim() || null, vehicle_type: form.vehicle_type })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Entregador atualizado");
      } else {
        const { error } = await backend
          .from("delivery_drivers")
          .insert({ store_id: store.id, name: form.name.trim(), phone: form.phone.trim() || null, vehicle_type: form.vehicle_type });
        if (error) throw error;
        toast.success("Entregador cadastrado");
      }
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (driver: any) => {
    const { error } = await backend
      .from("delivery_drivers")
      .update({ is_active: !driver.is_active })
      .eq("id", driver.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDrivers((prev) => prev.map((d) => d.id === driver.id ? { ...d, is_active: !d.is_active } : d));
  };

  const remove = async (driver: any) => {
    if (!confirm(`Remover ${driver.name}?`)) return;
    const { error } = await backend.from("delivery_drivers").delete().eq("id", driver.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Entregador removido");
    await load();
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="inline h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Entregadores</h1>
          <p className="text-sm text-muted-foreground">Gerencie sua equipe de entrega.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1.5" /> Novo entregador
        </Button>
      </div>

      {drivers.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Nenhum entregador cadastrado. Clique em "Novo entregador" para começar.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {drivers.map((driver) => (
            <Card key={driver.id} className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{driver.name}</div>
                {driver.phone && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" /> {driver.phone}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={driver.is_active ? "default" : "secondary"} className="text-[10px]">
                    {driver.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {VEHICLE_LABELS[driver.vehicle_type] || driver.vehicle_type}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => openEdit(driver)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-destructive" onClick={() => remove(driver)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* New/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar entregador" : "Novo entregador"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="driver-name">Nome</Label>
              <Input
                id="driver-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nome do entregador"
              />
            </div>
            <div>
              <Label htmlFor="driver-phone">Telefone</Label>
              <Input
                id="driver-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="(XX) XXXXX-XXXX"
              />
            </div>
            <div>
              <Label>Veículo</Label>
              <Select value={form.vehicle_type} onValueChange={(v) => setForm((f) => ({ ...f, vehicle_type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="moto">Moto</SelectItem>
                  <SelectItem value="carro">Carro</SelectItem>
                  <SelectItem value="bicicleta">Bicicleta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Drivers;
