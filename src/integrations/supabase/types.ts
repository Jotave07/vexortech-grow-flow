export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          store_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          store_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string | null
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean | null
          max_discount_amount: number | null
          min_order_value: number | null
          store_id: string
          usage_count: number | null
          usage_limit: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          discount_type: string
          discount_value: number
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_discount_amount?: number | null
          min_order_value?: number | null
          store_id: string
          usage_count?: number | null
          usage_limit?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_discount_amount?: number | null
          min_order_value?: number | null
          store_id?: string
          usage_count?: number | null
          usage_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          asaas_id: string | null
          city: string | null
          complement: string | null
          created_at: string | null
          full_name: string | null
          id: string
          last_order_at: string | null
          name: string | null
          neighborhood: string | null
          number: string | null
          phone: string
          registration_completed: boolean | null
          state: string | null
          store_id: string
          street: string | null
          total_orders: number | null
          total_spent: number | null
          user_id: string | null
          zip_code: string | null
        }
        Insert: {
          asaas_id?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          last_order_at?: string | null
          name?: string | null
          neighborhood?: string | null
          number?: string | null
          phone: string
          registration_completed?: boolean | null
          state?: string | null
          store_id: string
          street?: string | null
          total_orders?: number | null
          total_spent?: number | null
          user_id?: string | null
          zip_code?: string | null
        }
        Update: {
          asaas_id?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          last_order_at?: string | null
          name?: string | null
          neighborhood?: string | null
          number?: string | null
          phone?: string
          registration_completed?: boolean | null
          state?: string | null
          store_id?: string
          street?: string | null
          total_orders?: number | null
          total_spent?: number | null
          user_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          city: string | null
          created_at: string | null
          estimated_minutes: number | null
          fee: number | null
          id: string
          is_active: boolean | null
          min_order: number | null
          neighborhood: string
          store_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          estimated_minutes?: number | null
          fee?: number | null
          id?: string
          is_active?: boolean | null
          min_order?: number | null
          neighborhood: string
          store_id: string
        }
        Update: {
          city?: string | null
          created_at?: string | null
          estimated_minutes?: number | null
          fee?: number | null
          id?: string
          is_active?: boolean | null
          min_order?: number | null
          neighborhood?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_options: {
        Row: {
          created_at: string | null
          extra_price: number | null
          id: string
          item_name: string | null
          name: string
          option_item_id: string
          option_name: string | null
          order_item_id: string
          price: number | null
        }
        Insert: {
          created_at?: string | null
          extra_price?: number | null
          id?: string
          item_name?: string | null
          name: string
          option_item_id: string
          option_name?: string | null
          order_item_id: string
          price?: number | null
        }
        Update: {
          created_at?: string | null
          extra_price?: number | null
          id?: string
          item_name?: string | null
          name?: string
          option_item_id?: string
          option_name?: string | null
          order_item_id?: string
          price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_item_options_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          order_id: string
          product_id: string | null
          product_name: string | null
          quantity: number
          store_id: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          product_name?: string | null
          quantity: number
          store_id?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          store_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          order_id: string
          status: string
          store_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          order_id: string
          status: string
          store_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          coupon_code: string | null
          coupon_id: string | null
          created_at: string | null
          customer_document: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_fee: number | null
          delivery_neighborhood: string | null
          delivery_state: string | null
          delivery_type: string | null
          delivery_zip_code: string | null
          discount_amount: number | null
          id: string
          is_seen: boolean | null
          notes: string | null
          order_number: number
          payment_method: string | null
          payment_status: string | null
          public_token: string | null
          status: string | null
          store_id: string
          subtotal: number | null
          total: number
          updated_at: string | null
        }
        Insert: {
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string | null
          customer_document?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_fee?: number | null
          delivery_neighborhood?: string | null
          delivery_state?: string | null
          delivery_type?: string | null
          delivery_zip_code?: string | null
          discount_amount?: number | null
          id?: string
          is_seen?: boolean | null
          notes?: string | null
          order_number?: number
          payment_method?: string | null
          payment_status?: string | null
          public_token?: string | null
          status?: string | null
          store_id: string
          subtotal?: number | null
          total: number
          updated_at?: string | null
        }
        Update: {
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string | null
          customer_document?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_fee?: number | null
          delivery_neighborhood?: string | null
          delivery_state?: string | null
          delivery_type?: string | null
          delivery_zip_code?: string | null
          discount_amount?: number | null
          id?: string
          is_seen?: boolean | null
          notes?: string | null
          order_number?: number
          payment_method?: string | null
          payment_status?: string | null
          public_token?: string | null
          status?: string | null
          store_id?: string
          subtotal?: number | null
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          asaas_id: string | null
          created_at: string | null
          external_id: string | null
          id: string
          order_id: string | null
          paid_at: string | null
          status: string
          store_id: string
        }
        Insert: {
          amount: number
          asaas_id?: string | null
          created_at?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          status: string
          store_id: string
        }
        Update: {
          amount?: number
          asaas_id?: string | null
          created_at?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          allows_advanced_reports: boolean | null
          allows_coupons: boolean | null
          allows_custom_branding: boolean | null
          allows_custom_domain: boolean | null
          created_at: string | null
          description: string | null
          features: Json | null
          id: string
          is_active: boolean | null
          max_products: number | null
          name: string
          price_monthly: number
          slug: string | null
          sort_order: number | null
        }
        Insert: {
          allows_advanced_reports?: boolean | null
          allows_coupons?: boolean | null
          allows_custom_branding?: boolean | null
          allows_custom_domain?: boolean | null
          created_at?: string | null
          description?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_products?: number | null
          name: string
          price_monthly: number
          slug?: string | null
          sort_order?: number | null
        }
        Update: {
          allows_advanced_reports?: boolean | null
          allows_coupons?: boolean | null
          allows_custom_branding?: boolean | null
          allows_custom_domain?: boolean | null
          created_at?: string | null
          description?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_products?: number | null
          name?: string
          price_monthly?: number
          slug?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      product_option_items: {
        Row: {
          created_at: string | null
          extra_price: number | null
          id: string
          is_active: boolean | null
          name: string
          option_id: string
        }
        Insert: {
          created_at?: string | null
          extra_price?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          option_id: string
        }
        Update: {
          created_at?: string | null
          extra_price?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_option_items_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
        ]
      }
      product_options: {
        Row: {
          created_at: string | null
          id: string
          is_required: boolean | null
          max_choices: number | null
          min_choices: number | null
          name: string
          product_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          max_choices?: number | null
          min_choices?: number | null
          name: string
          product_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          max_choices?: number | null
          min_choices?: number | null
          name?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_options_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_available: boolean | null
          is_featured: boolean | null
          name: string
          prep_time_minutes: number | null
          price: number
          promo_price: number | null
          sort_order: number | null
          store_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_available?: boolean | null
          is_featured?: boolean | null
          name: string
          prep_time_minutes?: number | null
          price: number
          promo_price?: number | null
          sort_order?: number | null
          store_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_available?: boolean | null
          is_featured?: boolean | null
          name?: string
          prep_time_minutes?: number | null
          price?: number
          promo_price?: number | null
          sort_order?: number | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          complement: string | null
          created_at: string | null
          document: string | null
          email: string | null
          full_name: string | null
          id: string
          is_exempt: boolean | null
          last_login: string | null
          neighborhood: string | null
          number: string | null
          phone: string | null
          role: string | null
          state: string | null
          store_id: string | null
          street: string | null
          updated_at: string | null
          user_id: string
          zip_code: string | null
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string | null
          document?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_exempt?: boolean | null
          last_login?: string | null
          neighborhood?: string | null
          number?: string | null
          phone?: string | null
          role?: string | null
          state?: string | null
          store_id?: string | null
          street?: string | null
          updated_at?: string | null
          user_id: string
          zip_code?: string | null
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string | null
          document?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_exempt?: boolean | null
          last_login?: string | null
          neighborhood?: string | null
          number?: string | null
          phone?: string | null
          role?: string | null
          state?: string | null
          store_id?: string | null
          street?: string | null
          updated_at?: string | null
          user_id?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          accept_card_on_delivery: boolean | null
          accept_card_online: boolean | null
          accept_cash: boolean | null
          accept_orders_when_closed: boolean | null
          accept_pix: boolean | null
          address: string | null
          allow_delivery: boolean
          allow_pickup: boolean
          asaas_api_key: string | null
          asaas_wallet_id: string | null
          avg_prep_time_minutes: number | null
          business_hours: Json | null
          created_at: string | null
          delivery_base_fee: number | null
          delivery_distance_rules: Json | null
          delivery_fee: number | null
          delivery_fee_per_km: number | null
          delivery_message: string | null
          delivery_radius_km: number | null
          excluded_neighborhoods: Json | null
          free_delivery_above: number | null
          id: string
          is_open: boolean | null
          min_order_amount: number | null
          min_order_value: number | null
          next_opening_time: string | null
          payment_methods: Json | null
          pix_key: string | null
          pix_key_type: string | null
          store_id: string
          updated_at: string | null
          whatsapp_number: string | null
        }
        Insert: {
          accept_card_on_delivery?: boolean | null
          accept_card_online?: boolean | null
          accept_cash?: boolean | null
          accept_orders_when_closed?: boolean | null
          accept_pix?: boolean | null
          address?: string | null
          allow_delivery?: boolean
          allow_pickup?: boolean
          asaas_api_key?: string | null
          asaas_wallet_id?: string | null
          avg_prep_time_minutes?: number | null
          business_hours?: Json | null
          created_at?: string | null
          delivery_base_fee?: number | null
          delivery_distance_rules?: Json | null
          delivery_fee?: number | null
          delivery_fee_per_km?: number | null
          delivery_message?: string | null
          delivery_radius_km?: number | null
          excluded_neighborhoods?: Json | null
          free_delivery_above?: number | null
          id?: string
          is_open?: boolean | null
          min_order_amount?: number | null
          min_order_value?: number | null
          next_opening_time?: string | null
          payment_methods?: Json | null
          pix_key?: string | null
          pix_key_type?: string | null
          store_id: string
          updated_at?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          accept_card_on_delivery?: boolean | null
          accept_card_online?: boolean | null
          accept_cash?: boolean | null
          accept_orders_when_closed?: boolean | null
          accept_pix?: boolean | null
          address?: string | null
          allow_delivery?: boolean
          allow_pickup?: boolean
          asaas_api_key?: string | null
          asaas_wallet_id?: string | null
          avg_prep_time_minutes?: number | null
          business_hours?: Json | null
          created_at?: string | null
          delivery_base_fee?: number | null
          delivery_distance_rules?: Json | null
          delivery_fee?: number | null
          delivery_fee_per_km?: number | null
          delivery_message?: string | null
          delivery_radius_km?: number | null
          excluded_neighborhoods?: Json | null
          free_delivery_above?: number | null
          id?: string
          is_open?: boolean | null
          min_order_amount?: number | null
          min_order_value?: number | null
          next_opening_time?: string | null
          payment_methods?: Json | null
          pix_key?: string | null
          pix_key_type?: string | null
          store_id?: string
          updated_at?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          address_complement: string | null
          address_number: string | null
          city: string | null
          cover_url: string | null
          created_at: string | null
          delivery_fee: number | null
          description: string | null
          document: string | null
          email: string | null
          font_family: string | null
          id: string
          is_active: boolean | null
          is_suspended: boolean | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          min_order_amount: number | null
          name: string
          neighborhood: string | null
          owner_user_id: string
          payment_methods: Json | null
          phone: string | null
          plan_id: string | null
          primary_color: string | null
          public_name: string | null
          secondary_color: string | null
          slug: string
          state: string | null
          status: string | null
          updated_at: string | null
          whatsapp: string | null
          whatsapp_number: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string | null
          delivery_fee?: number | null
          description?: string | null
          document?: string | null
          email?: string | null
          font_family?: string | null
          id?: string
          is_active?: boolean | null
          is_suspended?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order_amount?: number | null
          name: string
          neighborhood?: string | null
          owner_user_id: string
          payment_methods?: Json | null
          phone?: string | null
          plan_id?: string | null
          primary_color?: string | null
          public_name?: string | null
          secondary_color?: string | null
          slug: string
          state?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp?: string | null
          whatsapp_number?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string | null
          delivery_fee?: number | null
          description?: string | null
          document?: string | null
          email?: string | null
          font_family?: string | null
          id?: string
          is_active?: boolean | null
          is_suspended?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order_amount?: number | null
          name?: string
          neighborhood?: string | null
          owner_user_id?: string
          payment_methods?: Json | null
          phone?: string | null
          plan_id?: string | null
          primary_color?: string | null
          public_name?: string | null
          secondary_color?: string | null
          slug?: string
          state?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp?: string | null
          whatsapp_number?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stores_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          asaas_subscription_id: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          last_payment_status: string | null
          plan_id: string | null
          provider: string | null
          status: string | null
          store_id: string
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          asaas_subscription_id?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          last_payment_status?: string | null
          plan_id?: string | null
          provider?: string | null
          status?: string | null
          store_id: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          asaas_subscription_id?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          last_payment_status?: string | null
          plan_id?: string | null
          provider?: string | null
          status?: string | null
          store_id?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          store_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          store_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          store_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_order:
        | {
            Args: { _order_id: string }
            Returns: {
              created_at: string
              delivery_type: string
              id: string
              notes: string
              payment_method: string
              status: string
              store_name: string
              total: number
            }[]
          }
        | {
            Args: { _order_id: string; _token?: string }
            Returns: {
              created_at: string
              delivery_type: string
              id: string
              notes: string
              payment_method: string
              payment_status: string
              status: string
              store_id: string
              store_name: string
              total: number
            }[]
          }
        | {
            Args: { _order_id?: string; _token: string }
            Returns: {
              created_at: string
              delivery_type: string
              id: string
              notes: string
              payment_method: string
              payment_status: string
              public_token: string
              status: string
              store_id: string
              store_name: string
              total: number
            }[]
          }
      get_public_order_items:
        | {
            Args: { _order_id: string }
            Returns: {
              id: string
              product_name: string
              quantity: number
              unit_price: number
            }[]
          }
        | {
            Args: { _order_id: string; _token?: string }
            Returns: {
              id: string
              product_name: string
              quantity: number
              unit_price: number
            }[]
          }
        | {
            Args: { _order_id?: string; _token: string }
            Returns: {
              id: string
              product_name: string
              quantity: number
              unit_price: number
            }[]
          }
      get_public_order_status_history:
        | {
            Args: { _order_id: string }
            Returns: {
              created_at: string
              id: string
              notes: string
              status: string
            }[]
          }
        | {
            Args: { _order_id: string; _token?: string }
            Returns: {
              created_at: string
              id: string
              notes: string
              status: string
            }[]
          }
        | {
            Args: { _order_id?: string; _token: string }
            Returns: {
              created_at: string
              id: string
              notes: string
              status: string
            }[]
          }
      is_vexor_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
