-- Force type refresh
COMMENT ON TABLE public.orders IS 'Tabela de pedidos do sistema';
COMMENT ON TABLE public.stores IS 'Tabela de lojas do sistema';
COMMENT ON TABLE public.profiles IS 'Tabela de perfis de usuário';
COMMENT ON TABLE public.store_settings IS 'Configurações detalhadas das lojas';
COMMENT ON TABLE public.customers IS 'Clientes das lojas';
COMMENT ON TABLE public.products IS 'Catálogo de produtos';
COMMENT ON TABLE public.categories IS 'Categorias de produtos';
COMMENT ON TABLE public.order_items IS 'Itens inclusos nos pedidos';
COMMENT ON TABLE public.order_item_options IS 'Opções selecionadas para itens de pedidos';
COMMENT ON TABLE public.payments IS 'Registro de transações e pagamentos';
COMMENT ON TABLE public.plans IS 'Planos de assinatura disponíveis';
COMMENT ON TABLE public.subscriptions IS 'Histórico de assinaturas das lojas';
COMMENT ON TABLE public.user_roles IS 'Papéis e permissões de usuários';
COMMENT ON TABLE public.coupons IS 'Cupons de desconto das lojas';
COMMENT ON TABLE public.delivery_zones IS 'Zonas e taxas de entrega por bairro';
