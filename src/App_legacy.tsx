import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SubscriptionGuard } from "@/components/SubscriptionGuard";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import Onboarding from "./pages/auth/Onboarding";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";

// Lazy load layouts and complex pages to prevent initial load crashes
const AppLayout = lazy(() => import("./pages/app/AppLayout"));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const Categories = lazy(() => import("./pages/app/Categories"));
const Products = lazy(() => import("./pages/app/Products"));
const Coupons = lazy(() => import("./pages/app/Coupons"));
const Zones = lazy(() => import("./pages/app/Zones"));
const Settings = lazy(() => import("./pages/app/Settings"));
const Orders = lazy(() => import("./pages/app/Orders"));
const Customers = lazy(() => import("./pages/app/Customers"));
const Reports = lazy(() => import("./pages/app/Reports"));
const Subscription = lazy(() => import("./pages/app/Subscription"));
const Users = lazy(() => import("./pages/app/Users"));
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
const CustomerDashboard = lazy(() => import("./pages/public/CustomerDashboard"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/entrar" element={<Login />} />
                <Route path="/cadastrar" element={<Signup />} />
                <Route path="/recuperar-senha" element={<ForgotPassword />} />
                <Route path="/redefinir-senha" element={<ResetPassword />} />
                <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

                <Route path="/loja/:slug" element={<PublicStore />} />
                <Route path="/loja/:slug/checkout" element={<PublicCheckout />} />
                <Route path="/pedido/:token" element={<OrderTracking />} />
                <Route path="/pedido/:token/sucesso" element={<PaymentSuccess />} />
                <Route path="/pedido/:token/cancelado" element={<PaymentCancelled />} />
                <Route path="/meu-painel" element={<ProtectedRoute><CustomerDashboard /></ProtectedRoute>} />

                <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
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

                <Route path="/admin" element={<ProtectedRoute superAdminOnly><AdminLayout /></ProtectedRoute>}>
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

export default App;