import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SubscriptionGuard } from "@/components/SubscriptionGuard";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/auth/Login";
import MerchantLogin from "./pages/auth/MerchantLogin";
import AdminLogin from "./pages/auth/AdminLogin";
import MerchantSignup from "./pages/auth/MerchantSignup";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import Onboarding from "./pages/auth/Onboarding";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";

// Lazy load layouts and complex pages to prevent initial load crashes
const AppLayout = lazy(() => import("./pages/lojista/AppLayout"));
const Dashboard = lazy(() => import("./pages/lojista/Dashboard"));
const Categories = lazy(() => import("./pages/lojista/Categories"));
const Products = lazy(() => import("./pages/lojista/Products"));
const Coupons = lazy(() => import("./pages/lojista/Coupons"));
const Zones = lazy(() => import("./pages/lojista/Zones"));
const Settings = lazy(() => import("./pages/lojista/Settings"));
const Orders = lazy(() => import("./pages/lojista/Orders"));
const Customers = lazy(() => import("./pages/lojista/Customers"));
const Reports = lazy(() => import("./pages/lojista/Reports"));
const Subscription = lazy(() => import("./pages/lojista/Subscription"));
const Users = lazy(() => import("./pages/lojista/Users"));
const PublicStore = lazy(() => import("./pages/public/PublicStore"));
const PublicCheckout = lazy(() => import("./pages/public/PublicCheckout"));
const OrderTracking = lazy(() => import("./pages/public/OrderTracking"));
const PaymentSuccess = lazy(() => import("./pages/public/PaymentSuccess"));
const PaymentCancelled = lazy(() => import("./pages/public/PaymentCancelled"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminStores = lazy(() => import("./pages/admin/AdminStores"));
const AdminPlans = lazy(() => import("./pages/admin/AdminPlans"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const CustomerDashboard = lazy(() => import("./pages/cliente/Dashboard"));
const CustomerLayout = lazy(() => import("./pages/cliente/CustomerLayout"));
const StoresList = lazy(() => import("./pages/public/StoresList"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  if (typeof window === "undefined") return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <CartProvider>
              <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
                <Routes>
                {/* Public Routes */}
                <Route path="/" element={<StoresList />} />
                <Route path="/vendas" element={<Index />} />
                <Route path="/entrar" element={<Login />} />
                <Route path="/cadastrar" element={<Signup />} />
                <Route path="/recuperar-senha" element={<ForgotPassword />} />
                <Route path="/redefinir-senha" element={<ResetPassword />} />
                
                {/* Merchant Auth */}
                <Route path="/lojista/entrar" element={<MerchantLogin />} />
                <Route path="/cadastrar-loja" element={<MerchantSignup />} />
                
                {/* Admin Auth */}
                <Route path="/admin/entrar" element={<AdminLogin />} />

                <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

                <Route path="/vendas/lojas" element={<StoresList />} />
                <Route path="/loja/:slug" element={<PublicStore />} />
                <Route path="/loja/:slug/checkout" element={<ProtectedRoute requiredRole="customer"><PublicCheckout /></ProtectedRoute>} />
                <Route path="/pedido/:token" element={<OrderTracking />} />
                <Route path="/pedido/:token/sucesso" element={<PaymentSuccess />} />
                <Route path="/pedido/:token/cancelado" element={<PaymentCancelled />} />
                
                {/* Painel do Consumidor */}
                <Route path="/cliente" element={<ProtectedRoute requiredRole="customer"><CustomerLayout /></ProtectedRoute>}>
                  <Route index element={<CustomerDashboard />} />
                </Route>

                {/* Painel do Lojista */}
                <Route path="/lojista" element={<ProtectedRoute requiredRole="store_owner"><AppLayout /></ProtectedRoute>}>
                  <Route path="assinatura" element={<Subscription />} />
                  <Route element={<SubscriptionGuard />}>
                    <Route index element={<Dashboard />} />
                    <Route path="pedidos" element={<Orders />} />
                    <Route path="cardapio" element={<Products />} />
                    <Route path="categorias" element={<Categories />} />
                    <Route path="clientes" element={<Customers />} />
                    <Route path="cupons" element={<Coupons />} />
                    <Route path="entregas" element={<Zones />} />
                    <Route path="relatorios" element={<Reports />} />
                    <Route path="configuracoes" element={<Settings />} />
                    <Route path="usuarios" element={<Users />} />
                  </Route>
                </Route>

                {/* Painel do Proprietário (Admin Geral) */}
                <Route path="/admin" element={<ProtectedRoute requiredRole="super_admin"><AdminLayout /></ProtectedRoute>}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="lojas" element={<AdminStores />} />
                  <Route path="planos" element={<AdminPlans />} />
                  <Route path="configuracoes" element={<AdminSettings />} />
                </Route>

                <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </CartProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
