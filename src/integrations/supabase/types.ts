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
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
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
          created_at: string
          discount_type: Database["public"]["Enums"]["coupon_type"]
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean
          min_order_value: number
          starts_at: string | null
          store_id: string
          updated_at: string
          usage_count: number
          usage_limit: number | null
        }
        Insert: {
          code: string
          created_at?: string
          discount_type?: Database["public"]["Enums"]["coupon_type"]
          discount_value: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          min_order_value?: number
          starts_at?: string | null
          store_id: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          discount_type?: Database["public"]["Enums"]["coupon_type"]
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          min_order_value?: number
          starts_at?: string | null
          store_id?: string
          updated_at?: string
          usage_count?: number
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
      customer_addresses: {
        Row: {
          city: string | null
          complement: string | null
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          neighborhood: string
          number: string | null
          reference: string | null
          store_id: string
          street: string
          zip_code: string | null
        }
        Insert: {
          city?: string | null
          complement?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          neighborhood: string
          number?: string | null
          reference?: string | null
          store_id: string
          street: string
          zip_code?: string | null
        }
        Update: {
          city?: string | null
          complement?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          neighborhood?: string
          number?: string | null
          reference?: string | null
          store_id?: string
          street?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          last_order_at: string | null
          name: string
          phone: string
          store_id: string
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          last_order_at?: string | null
          name: string
          phone: string
          store_id: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          last_order_at?: string | null
          name?: string
          phone?: string
          store_id?: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
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
          created_at: string
          estimated_minutes: number
          fee: number
          id: string
          is_active: boolean
          min_order: number
          neighborhood: string
          store_id: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          estimated_minutes?: number
          fee?: number
          id?: string
          is_active?: boolean
          min_order?: number
          neighborhood: string
          store_id: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          estimated_minutes?: number
          fee?: number
          id?: string
          is_active?: boolean
          min_order?: number
          neighborhood?: string
          store_id?: string
          updated_at?: string
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
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string | null
          metadata: Json | null
          store_id: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          metadata?: Json | null
          store_id: string
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          metadata?: Json | null
          store_id?: string
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_options: {
        Row: {
          created_at: string
          extra_price: number
          id: string
          item_name: string
          option_name: string
          order_item_id: string
          store_id: string
        }
        Insert: {
          created_at?: string
          extra_price?: number
          id?: string
          item_name: string
          option_name: string
          order_item_id: string
          store_id: string
        }
        Update: {
          created_at?: string
          extra_price?: number
          id?: string
          item_name?: string
          option_name?: string
          order_item_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_options_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_options_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          options_total: number
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          store_id: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          options_total?: number
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          store_id: string
          subtotal: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          options_total?: number
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          store_id?: string
          subtotal?: number
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
          changed_by: string | null
          created_at: string
          id: string
          notes: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
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
          change_for: number | null
          coupon_code: string | null
          coupon_id: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string
          delivery_address: string | null
          delivery_fee: number
          delivery_neighborhood: string | null
          delivery_reference: string | null
          delivery_zone_id: string | null
          discount: number
          estimated_minutes: number | null
          id: string
          is_seen: boolean
          notes: string | null
          order_number: number
          order_type: Database["public"]["Enums"]["order_type"]
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status_extended"]
          public_token: string
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          change_for?: number | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          delivery_address?: string | null
          delivery_fee?: number
          delivery_neighborhood?: string | null
          delivery_reference?: string | null
          delivery_zone_id?: string | null
          discount?: number
          estimated_minutes?: number | null
          id?: string
          is_seen?: boolean
          notes?: string | null
          order_number?: number
          order_type?: Database["public"]["Enums"]["order_type"]
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status_extended"]
          public_token?: string
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          change_for?: number | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          delivery_address?: string | null
          delivery_fee?: number
          delivery_neighborhood?: string | null
          delivery_reference?: string | null
          delivery_zone_id?: string | null
          discount?: number
          estimated_minutes?: number | null
          id?: string
          is_seen?: boolean
          notes?: string | null
          order_number?: number
          order_type?: Database["public"]["Enums"]["order_type"]
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status_extended"]
          public_token?: string
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
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
            foreignKeyName: "orders_delivery_zone_id_fkey"
            columns: ["delivery_zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
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
          created_at: string
          currency: string
          external_id: string | null
          failure_reason: string | null
          id: string
          last_event_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          paid_at: string | null
          provider: string
          provider_payment_intent_id: string | null
          provider_session_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          last_event_at?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          paid_at?: string | null
          provider?: string
          provider_payment_intent_id?: string | null
          provider_session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          last_event_at?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          paid_at?: string | null
          provider?: string
          provider_payment_intent_id?: string | null
          provider_session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          store_id?: string
          updated_at?: string
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
          allows_advanced_reports: boolean
          allows_coupons: boolean
          allows_custom_branding: boolean
          allows_custom_domain: boolean
          created_at: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          max_products: number | null
          name: string
          price_monthly: number
          provider_price_id: string | null
          slug: string
          sort_order: number
          subscription_provider: string
          updated_at: string
        }
        Insert: {
          allows_advanced_reports?: boolean
          allows_coupons?: boolean
          allows_custom_branding?: boolean
          allows_custom_domain?: boolean
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          max_products?: number | null
          name: string
          price_monthly?: number
          provider_price_id?: string | null
          slug: string
          sort_order?: number
          subscription_provider?: string
          updated_at?: string
        }
        Update: {
          allows_advanced_reports?: boolean
          allows_coupons?: boolean
          allows_custom_branding?: boolean
          allows_custom_domain?: boolean
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          max_products?: number | null
          name?: string
          price_monthly?: number
          provider_price_id?: string | null
          slug?: string
          sort_order?: number
          subscription_provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_option_items: {
        Row: {
          created_at: string
          extra_price: number
          id: string
          is_active: boolean
          name: string
          option_id: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          extra_price?: number
          id?: string
          is_active?: boolean
          name: string
          option_id: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          extra_price?: number
          id?: string
          is_active?: boolean
          name?: string
          option_id?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_option_items_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_option_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_options: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          max_choices: number
          min_choices: number
          name: string
          product_id: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          max_choices?: number
          min_choices?: number
          name: string
          product_id: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          max_choices?: number
          min_choices?: number
          name?: string
          product_id?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_options_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_options_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_available: boolean
          is_featured: boolean
          name: string
          prep_time_minutes: number | null
          price: number
          promo_price: number | null
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_available?: boolean
          is_featured?: boolean
          name: string
          prep_time_minutes?: number | null
          price: number
          promo_price?: number | null
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_available?: boolean
          is_featured?: boolean
          name?: string
          prep_time_minutes?: number | null
          price?: number
          promo_price?: number | null
          sort_order?: number
          store_id?: string
          updated_at?: string
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
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          store_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          store_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          store_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          accept_card_on_delivery: boolean
          accept_card_online: boolean
          accept_cash: boolean
          accept_orders_when_closed: boolean
          accept_pix: boolean
          allow_delivery: boolean
          allow_pickup: boolean
          avg_prep_time_minutes: number
          business_hours: Json
          created_at: string
          delivery_base_fee: number
          delivery_distance_rules: Json
          delivery_fee_per_km: number
          delivery_message: string | null
          delivery_radius_km: number
          excluded_neighborhoods: Json
          id: string
          is_open: boolean
          min_order_value: number
          pix_key: string | null
          pix_key_type: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          accept_card_on_delivery?: boolean
          accept_card_online?: boolean
          accept_cash?: boolean
          accept_orders_when_closed?: boolean
          accept_pix?: boolean
          allow_delivery?: boolean
          allow_pickup?: boolean
          avg_prep_time_minutes?: number
          business_hours?: Json
          created_at?: string
          delivery_base_fee?: number
          delivery_distance_rules?: Json
          delivery_fee_per_km?: number
          delivery_message?: string | null
          delivery_radius_km?: number
          excluded_neighborhoods?: Json
          id?: string
          is_open?: boolean
          min_order_value?: number
          pix_key?: string | null
          pix_key_type?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          accept_card_on_delivery?: boolean
          accept_card_online?: boolean
          accept_cash?: boolean
          accept_orders_when_closed?: boolean
          accept_pix?: boolean
          allow_delivery?: boolean
          allow_pickup?: boolean
          avg_prep_time_minutes?: number
          business_hours?: Json
          created_at?: string
          delivery_base_fee?: number
          delivery_distance_rules?: Json
          delivery_fee_per_km?: number
          delivery_message?: string | null
          delivery_radius_km?: number
          excluded_neighborhoods?: Json
          id?: string
          is_open?: boolean
          min_order_value?: number
          pix_key?: string | null
          pix_key_type?: string | null
          store_id?: string
          updated_at?: string
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
          created_at: string
          description: string | null
          document: string | null
          email: string | null
          id: string
          is_active: boolean
          is_suspended: boolean
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          neighborhood: string | null
          owner_user_id: string
          phone: string | null
          plan_id: string | null
          primary_color: string | null
          public_name: string | null
          secondary_color: string | null
          slug: string
          state: string | null
          updated_at: string
          whatsapp: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          document?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          is_suspended?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name: string
          neighborhood?: string | null
          owner_user_id: string
          phone?: string | null
          plan_id?: string | null
          primary_color?: string | null
          public_name?: string | null
          secondary_color?: string | null
          slug: string
          state?: string | null
          updated_at?: string
          whatsapp?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          document?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          is_suspended?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name?: string
          neighborhood?: string | null
          owner_user_id?: string
          phone?: string | null
          plan_id?: string | null
          primary_color?: string | null
          public_name?: string | null
          secondary_color?: string | null
          slug?: string
          state?: string | null
          updated_at?: string
          whatsapp?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          created_at: string
          id: string
          payload: Json | null
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          payload?: Json | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json | null
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string
          external_subscription_id: string | null
          id: string
          last_payment_status: string | null
          plan_id: string
          provider: string
          provider_checkout_id: string | null
          provider_customer_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          store_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          external_subscription_id?: string | null
          id?: string
          last_payment_status?: string | null
          plan_id: string
          provider?: string
          provider_checkout_id?: string | null
          provider_customer_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          store_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          external_subscription_id?: string | null
          id?: string
          last_payment_status?: string | null
          plan_id?: string
          provider?: string
          provider_checkout_id?: string | null
          provider_customer_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          store_id?: string
          trial_ends_at?: string | null
          updated_at?: string
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
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          store_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          store_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_order: {
        Args: { _token: string }
        Returns: {
          created_at: string
          customer_name: string
          delivery_address: string
          delivery_fee: number
          delivery_neighborhood: string
          discount: number
          estimated_minutes: number
          id: string
          order_number: number
          order_type: Database["public"]["Enums"]["order_type"]
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status_extended"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          store_logo_url: string
          store_name: string
          store_whatsapp: string
          subtotal: number
          total: number
        }[]
      }
      get_public_order_items: {
        Args: { _token: string }
        Returns: {
          item_id: string
          notes: string
          options_total: number
          product_name: string
          quantity: number
          subtotal: number
          unit_price: number
        }[]
      }
      get_public_order_status_history: {
        Args: { _token: string }
        Returns: {
          created_at: string
          notes: string
          status: Database["public"]["Enums"]["order_status"]
        }[]
      }
      get_user_store_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_vexor_admin: { Args: { _user_id: string }; Returns: boolean }
      mark_stripe_event_processed: {
        Args: { _event_id: string; _event_type: string; _payload: Json }
        Returns: boolean
      }
      user_belongs_to_store: {
        Args: { _store_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin_vexor"
        | "store_owner"
        | "store_staff"
        | "delivery_staff"
        | "store_manager"
        | "store_attendant"
      coupon_type: "percentual" | "fixo"
      order_status:
        | "novo"
        | "confirmado"
        | "em_preparo"
        | "saiu_para_entrega"
        | "pronto_para_retirada"
        | "entregue"
        | "cancelado"
      order_type: "entrega" | "retirada"
      payment_method: "dinheiro" | "pix" | "cartao_entrega" | "cartao_online"
      payment_status: "pendente" | "pago" | "cancelado"
      payment_status_extended:
        | "pendente"
        | "processando"
        | "pago"
        | "falhou"
        | "cancelado"
        | "expirado"
        | "reembolsado"
      subscription_status:
        | "trial"
        | "ativa"
        | "suspensa"
        | "cancelada"
        | "pendente_pagamento"
        | "inadimplente"
        | "bloqueada"
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
    Enums: {
      app_role: [
        "admin_vexor",
        "store_owner",
        "store_staff",
        "delivery_staff",
        "store_manager",
        "store_attendant",
      ],
      coupon_type: ["percentual", "fixo"],
      order_status: [
        "novo",
        "confirmado",
        "em_preparo",
        "saiu_para_entrega",
        "pronto_para_retirada",
        "entregue",
        "cancelado",
      ],
      order_type: ["entrega", "retirada"],
      payment_method: ["dinheiro", "pix", "cartao_entrega", "cartao_online"],
      payment_status: ["pendente", "pago", "cancelado"],
      payment_status_extended: [
        "pendente",
        "processando",
        "pago",
        "falhou",
        "cancelado",
        "expirado",
        "reembolsado",
      ],
      subscription_status: [
        "trial",
        "ativa",
        "suspensa",
        "cancelada",
        "pendente_pagamento",
        "inadimplente",
        "bloqueada",
      ],
    },
  },
} as const
