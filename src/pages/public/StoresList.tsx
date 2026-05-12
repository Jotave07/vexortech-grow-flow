import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, MapPin, ShoppingBag, User, ChevronDown, Filter } from "lucide-react";
import { Footer } from "@/components/landing/Footer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAddressByCep } from "@/services/viacep";
import { toast } from "sonner";
import { onlyDigits, formatCEP, formatBRL } from "@/lib/format";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { onlyDigits, formatCEP } from "@/lib/format";

export default function StoresList() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [address, setAddress] = useState<any>(null);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [tempCep, setTempCep] = useState("");
  const [loadingCep, setLoadingCep] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("delivery_address");
    if (saved) {
      setAddress(JSON.parse(saved));
    } else {
      setShowAddressModal(true);
    }
  }, []);

  const handleCepLookup = async () => {
    const cleanCep = onlyDigits(tempCep);
    if (cleanCep.length !== 8) return toast.error("CEP inválido");
    setLoadingCep(true);
    try {
      const addr = await fetchAddressByCep(cleanCep);
      const fullAddr = { ...addr, zipCode: cleanCep };
      setAddress(fullAddr);
      localStorage.setItem("delivery_address", JSON.stringify(fullAddr));
      setShowAddressModal(false);
      toast.success("Endereço definido!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  };

  useEffect(() => {
    async function loadStores() {
      const { data } = await supabase
        .from("stores")
        .select(`
          *,
          store_settings(is_open, business_hours)
        `)
        .eq("is_suspended", false);
      
      setStores(data || []);
      setLoading(false);
    }
    loadStores();
  }, []);

  const filteredStores = stores.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.city?.toLowerCase().includes(search.toLowerCase());
    
    // In a real scenario, we would filter by delivery zones here
    // For now, we'll just show all stores but could implement radius/zone logic
    return matchesSearch;
  }).sort((a, b) => {
    // Show open stores first
    if (a.store_settings?.is_open && !b.store_settings?.is_open) return -1;
    if (!a.store_settings?.is_open && b.store_settings?.is_open) return 1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#F0FDF4]">
      <Navbar />
      
      <main className="container mx-auto px-4 pt-24 pb-20">
        <div className="mb-10 text-center">
          <div 
            className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full border-2 border-emerald-100 shadow-sm mb-6 cursor-pointer hover:bg-emerald-50 transition-colors"
            onClick={() => setShowAddressModal(true)}
          >
            <MapPin className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-black uppercase tracking-tight italic text-emerald-900">
              {address ? `${address.neighborhood}, ${address.city}` : "Onde você quer receber?"}
            </span>
          </div>

          <h1 className="text-4xl font-black uppercase tracking-tighter italic text-emerald-900 mb-4">
            Lojas Disponíveis
          </h1>
          <p className="text-emerald-700 font-medium">Encontre os melhores estabelecimentos da sua região.</p>
        </div>

        <div className="max-w-2xl mx-auto mb-12">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-400 group-focus-within:text-emerald-600 transition-colors" />
            <Input 
              placeholder="Buscar por nome ou cidade..." 
              className="h-14 pl-12 border-2 border-emerald-100 rounded-2xl bg-white shadow-xl shadow-emerald-900/5 focus:border-emerald-500 transition-all font-bold"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
          </div>
        ) : filteredStores.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border-2 border-emerald-100">
            <ShoppingBag className="h-16 w-16 mx-auto text-emerald-100 mb-4" />
            <h3 className="text-xl font-black uppercase text-emerald-900">Nenhuma loja encontrada</h3>
            <p className="text-emerald-600">Tente buscar por outro termo.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredStores.map(store => (
              <Link key={store.id} to={`/loja/${store.slug}`} className="group">
                <Card className="overflow-hidden border-2 border-emerald-50 shadow-lg group-hover:shadow-2xl group-hover:border-emerald-200 transition-all duration-300 rounded-3xl bg-white h-full flex flex-col">
                  <div className="h-40 bg-emerald-900 relative">
                    {store.logo_url ? (
                      <img src={store.logo_url} alt={store.name} className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBag className="h-12 w-12 text-emerald-700/50" />
                      </div>
                    )}
                    <div className="absolute top-4 right-4">
                      <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${store.store_settings?.is_open ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                        {store.store_settings?.is_open ? 'Aberto' : 'Fechado'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-6 flex-1 flex flex-col">
                    <h2 className="text-xl font-black uppercase tracking-tight italic text-emerald-900 mb-2 group-hover:text-emerald-600 transition-colors">
                      {store.name}
                    </h2>
                    
                    <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold mb-4">
                      <MapPin className="h-4 w-4" />
                      {store.city || 'Cidade não informada'} - {store.state}
                    </div>

                    <div className="mt-auto pt-4 border-t border-emerald-50 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-amber-500 font-black">
                        {/* Rating real logic can be added later with store_reviews */}
                      </div>
                      <Button variant="ghost" className="text-emerald-600 font-black uppercase text-xs tracking-widest group-hover:translate-x-1 transition-transform">
                        Ver Cardápio
                      </Button>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showAddressModal} onOpenChange={setShowAddressModal}>
        <DialogContent className="max-w-md rounded-3xl border-2 border-emerald-100 p-0 overflow-hidden">
          <div className="bg-emerald-900 p-6 text-white text-center">
            <MapPin className="h-10 w-10 mx-auto mb-3 text-emerald-400" />
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter italic text-white">Onde você está?</DialogTitle>
            <p className="text-emerald-200 text-sm mt-2">Informe seu CEP para vermos quem entrega aí.</p>
          </div>
          <div className="p-8 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Seu CEP</label>
              <div className="flex gap-2">
                <Input 
                  value={formatCEP(tempCep)} 
                  onChange={(e) => setTempCep(e.target.value)} 
                  placeholder="00000-000"
                  className="h-14 border-2 border-emerald-50 rounded-2xl font-bold focus:border-emerald-500"
                />
                <Button 
                  onClick={handleCepLookup} 
                  disabled={loadingCep}
                  className="h-14 w-14 bg-emerald-600 hover:bg-emerald-700 rounded-2xl shadow-lg shadow-emerald-200"
                >
                  {loadingCep ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                </Button>
              </div>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Ou use sua localização</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
