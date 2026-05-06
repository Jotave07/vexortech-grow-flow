import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, MapPin, Star, ShoppingBag } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

export default function StoresList() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  const filteredStores = stores.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.city?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F0FDF4]">
      <Navbar />
      
      <main className="container mx-auto px-4 pt-24 pb-20">
        <div className="mb-10 text-center">
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
                        <Star className="h-4 w-4 fill-current" />
                        4.9
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

      <Footer />
    </div>
  );
}
