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
const AppLayout = lazy(() => import("./pages/app/AppLayout"));
import Dashboard from "./pages/app/Dashboard";
import Categories from "./pages/app/Categories";
import Products from "./pages/app/Products";
import Coupons from "./pages/app/Coupons";
import Zones from "./pages/app/Zones";
import Settings from "./pages/app/Settings";
import Orders from "./pages/app/Orders";
import Customers from "./pages/app/Customers";
import Reports from "./pages/app/Reports";
import Subscription from "./pages/app/Subscription";
import Users from "./pages/app/Users";
import PublicStore from "./pages/public/PublicStore";
import PublicCheckout from "./pages/public/PublicCheckout";
import OrderTracking from "./pages/public/OrderTracking";
import PaymentSuccess from "./pages/public/PaymentSuccess";
import PaymentCancelled from "./pages/public/PaymentCancelled";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminStores from "./pages/admin/AdminStores";
import AdminPlans from "./pages/admin/AdminPlans";
import AdminSettings from "./pages/admin/AdminSettings";
import CustomerDashboard from "./pages/public/CustomerDashboard";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
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
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
