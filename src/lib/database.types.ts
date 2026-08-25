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
      adjustments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          evidence_id: string | null
          id: string
          reason: string | null
          type: Database["public"]["Enums"]["adjustment_type"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          evidence_id?: string | null
          id?: string
          reason?: string | null
          type: Database["public"]["Enums"]["adjustment_type"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          evidence_id?: string | null
          id?: string
          reason?: string | null
          type?: Database["public"]["Enums"]["adjustment_type"]
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustments_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          entity: string
          entity_id: string | null
          id: string
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      car_categories: {
        Row: {
          created_at: string
          crew_size: number
          id: string
          name: string
          sort_order: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          crew_size?: number
          id?: string
          name: string
          sort_order?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          crew_size?: number
          id?: string
          name?: string
          sort_order?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      car_inspection_photos: {
        Row: {
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          inspection_id: string
          storage_path: string
          taken_at: string
          view: Database["public"]["Enums"]["inspection_view"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          inspection_id: string
          storage_path: string
          taken_at?: string
          view: Database["public"]["Enums"]["inspection_view"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          inspection_id?: string
          storage_path?: string
          taken_at?: string
          view?: Database["public"]["Enums"]["inspection_view"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "car_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_inspection_photos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      car_inspections: {
        Row: {
          car_id: string
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          reason: Database["public"]["Enums"]["inspection_reason"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          reason: Database["public"]["Enums"]["inspection_reason"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          reason?: Database["public"]["Enums"]["inspection_reason"]
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_inspections_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_inspections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_inspections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      car_issues: {
        Row: {
          car_id: string
          created_at: string
          id: string
          note: string
          photo_path: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["car_issue_status"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          id?: string
          note: string
          photo_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["car_issue_status"]
          user_id: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          id?: string
          note?: string
          photo_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["car_issue_status"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_issues_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_issues_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          id: string
          label: string | null
          plate: string
          qr_token: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          plate: string
          qr_token?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          plate?: string
          qr_token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cars_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "car_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          car_id: string
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          crew_key: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          out_gps_lat: number | null
          out_gps_lng: number | null
          out_outside_geofence: boolean
          outside_geofence: boolean
          prev_car_id: string | null
          switch_reason: string | null
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          crew_key?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          out_gps_lat?: number | null
          out_gps_lng?: number | null
          out_outside_geofence?: boolean
          outside_geofence?: boolean
          prev_car_id?: string | null
          switch_reason?: string | null
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          crew_key?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          out_gps_lat?: number | null
          out_gps_lng?: number | null
          out_outside_geofence?: boolean
          outside_geofence?: boolean
          prev_car_id?: string | null
          switch_reason?: string | null
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_prev_car_id_fkey"
            columns: ["prev_car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cleanings: {
        Row: {
          car_id: string
          created_at: string
          done: boolean
          gps_lat: number | null
          gps_lng: number | null
          id: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          done?: boolean
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          done?: boolean
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleanings_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleanings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleanings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_photos: {
        Row: {
          car_id: string | null
          category: Database["public"]["Enums"]["evidence_category"]
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          photo_path: string | null
          taken_at: string
          workspace_id: string
        }
        Insert: {
          car_id?: string | null
          category: Database["public"]["Enums"]["evidence_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          workspace_id: string
        }
        Update: {
          car_id?: string | null
          category?: Database["public"]["Enums"]["evidence_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_photos_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_photos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_logs: {
        Row: {
          amount: number | null
          car_id: string
          consumption: number | null
          created_at: string
          fuel_date: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          km_warning: boolean
          liters: number | null
          location: string | null
          ocr_amount: number | null
          ocr_date: string | null
          ocr_liters: number | null
          ocr_location: string | null
          odometer_km: number
          photo_path: string | null
          taken_at: string
          user_id: string
          verified: boolean
          work_date: string
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          car_id: string
          consumption?: number | null
          created_at?: string
          fuel_date?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          km_warning?: boolean
          liters?: number | null
          location?: string | null
          ocr_amount?: number | null
          ocr_date?: string | null
          ocr_liters?: number | null
          ocr_location?: string | null
          odometer_km: number
          photo_path?: string | null
          taken_at?: string
          user_id: string
          verified?: boolean
          work_date: string
          workspace_id: string
        }
        Update: {
          amount?: number | null
          car_id?: string
          consumption?: number | null
          created_at?: string
          fuel_date?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          km_warning?: boolean
          liters?: number | null
          location?: string | null
          ocr_amount?: number | null
          ocr_date?: string | null
          ocr_liters?: number | null
          ocr_location?: string | null
          odometer_km?: number
          photo_path?: string | null
          taken_at?: string
          user_id?: string
          verified?: boolean
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_logs_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          car_id: string | null
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          note: string | null
          photo_path: string | null
          taken_at: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id?: string | null
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string | null
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_reminders: {
        Row: {
          car_id: string
          created_at: string
          id: string
          last_notified_at: string | null
          left_zone_at: string
          left_zone_by: string | null
          notify_count: number
          resolved_at: string | null
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          id?: string
          last_notified_at?: string | null
          left_zone_at?: string
          left_zone_by?: string | null
          notify_count?: number
          resolved_at?: string | null
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          id?: string
          last_notified_at?: string | null
          left_zone_at?: string
          left_zone_by?: string | null
          notify_count?: number
          resolved_at?: string | null
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_reminders_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_reminders_left_zone_by_fkey"
            columns: ["left_zone_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_reminders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          created_at: string
          created_by: string
          email: string
          expires_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          used_at: string | null
          used_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          used_at?: string | null
          used_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          used_at?: string | null
          used_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_workspaces: {
        Row: {
          created_at: string
          manager_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          manager_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          manager_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_workspaces_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_locks: {
        Row: {
          locked_at: string
          locked_by: string | null
          workspace_id: string
          ym: string
        }
        Insert: {
          locked_at?: string
          locked_by?: string | null
          workspace_id: string
          ym: string
        }
        Update: {
          locked_at?: string
          locked_by?: string | null
          workspace_id?: string
          ym?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_locks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_proofs: {
        Row: {
          id: string
          sha256: string
          storage_path: string
          taken_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          id?: string
          sha256: string
          storage_path: string
          taken_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          id?: string
          sha256?: string
          storage_path?: string
          taken_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_proofs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_proofs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          pay_amount: number | null
          pay_type: Database["public"]["Enums"]["pay_type"] | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          status: Database["public"]["Enums"]["user_status"]
          workspace_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          pay_amount?: number | null
          pay_type?: Database["public"]["Enums"]["pay_type"] | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          status?: Database["public"]["Enums"]["user_status"]
          workspace_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          pay_amount?: number | null
          pay_type?: Database["public"]["Enums"]["pay_type"] | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          status?: Database["public"]["Enums"]["user_status"]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_stops: {
        Row: {
          address_override: string | null
          city: string | null
          cod_amount: number | null
          created_at: string
          display_order: number | null
          event_note: string | null
          expected_amount: number | null
          geocoded: boolean
          id: string
          is_cash: boolean
          lat: number | null
          lng: number | null
          note: string | null
          payment_method: string | null
          phone: string | null
          planned_time: string | null
          postal_code: string | null
          received_amount: number | null
          recorded_at: string | null
          recorded_by: string | null
          seq: number | null
          sheet_name: string | null
          skip_reason: string | null
          status: Database["public"]["Enums"]["stop_status"]
          street: string | null
          time_window: string | null
          tip: number | null
          upload_id: string
          weight: number | null
          workspace_id: string
        }
        Insert: {
          address_override?: string | null
          city?: string | null
          cod_amount?: number | null
          created_at?: string
          display_order?: number | null
          event_note?: string | null
          expected_amount?: number | null
          geocoded?: boolean
          id?: string
          is_cash?: boolean
          lat?: number | null
          lng?: number | null
          note?: string | null
          payment_method?: string | null
          phone?: string | null
          planned_time?: string | null
          postal_code?: string | null
          received_amount?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          seq?: number | null
          sheet_name?: string | null
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["stop_status"]
          street?: string | null
          time_window?: string | null
          tip?: number | null
          upload_id: string
          weight?: number | null
          workspace_id: string
        }
        Update: {
          address_override?: string | null
          city?: string | null
          cod_amount?: number | null
          created_at?: string
          display_order?: number | null
          event_note?: string | null
          expected_amount?: number | null
          geocoded?: boolean
          id?: string
          is_cash?: boolean
          lat?: number | null
          lng?: number | null
          note?: string | null
          payment_method?: string | null
          phone?: string | null
          planned_time?: string | null
          postal_code?: string | null
          received_amount?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          seq?: number | null
          sheet_name?: string | null
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["stop_status"]
          street?: string | null
          time_window?: string | null
          tip?: number | null
          upload_id?: string
          weight?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "route_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      route_uploads: {
        Row: {
          car_id: string | null
          created_at: string
          end_poi: string | null
          file_name: string | null
          id: string
          start_poi: string | null
          uploaded_by: string | null
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id?: string | null
          created_at?: string
          end_poi?: string | null
          file_name?: string | null
          id?: string
          start_poi?: string | null
          uploaded_by?: string | null
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string | null
          created_at?: string
          end_poi?: string | null
          file_name?: string | null
          id?: string
          start_poi?: string | null
          uploaded_by?: string | null
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_uploads_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          car_id: string
          created_at: string
          created_by: string | null
          driver_id: string | null
          id: string
          loader_id: string | null
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          loader_id?: string | null
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          loader_id?: string | null
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_loader_id_fkey"
            columns: ["loader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          partner_decided_at: string | null
          partner_decision: Database["public"]["Enums"]["swap_status"]
          partner_id: string | null
          requested_by: string
          shift_id: string
          status: Database["public"]["Enums"]["swap_status"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          partner_decided_at?: string | null
          partner_decision?: Database["public"]["Enums"]["swap_status"]
          partner_id?: string | null
          requested_by: string
          shift_id: string
          status?: Database["public"]["Enums"]["swap_status"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          partner_decided_at?: string | null
          partner_decision?: Database["public"]["Enums"]["swap_status"]
          partner_id?: string | null
          requested_by?: string
          shift_id?: string
          status?: Database["public"]["Enums"]["swap_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          driver_day_rate: number
          geo_lat: number | null
          geo_lng: number | null
          geo_radius_m: number | null
          id: string
          loader_day_rate: number
          name: string
          photo_retention_days: number
        }
        Insert: {
          created_at?: string
          driver_day_rate?: number
          geo_lat?: number | null
          geo_lng?: number | null
          geo_radius_m?: number | null
          id?: string
          loader_day_rate?: number
          name: string
          photo_retention_days?: number
        }
        Update: {
          created_at?: string
          driver_day_rate?: number
          geo_lat?: number | null
          geo_lng?: number | null
          geo_radius_m?: number | null
          id?: string
          loader_day_rate?: number
          name?: string
          photo_retention_days?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_user: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_workspace_id: string
          target_id: string
        }
        Returns: undefined
      }
      can_access_workspace: { Args: { wid: string }; Returns: boolean }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_status: {
        Args: never
        Returns: Database["public"]["Enums"]["user_status"]
      }
      decide_swap: {
        Args: { p_approve: boolean; p_request_id: string }
        Returns: undefined
      }
      is_active: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_manager_or_admin: { Args: never; Returns: boolean }
      partner_decide_swap: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: undefined
      }
      push_inspection_reminder: { Args: { p_id: string }; Returns: undefined }
      resolve_member_names: {
        Args: { ids: string[] }
        Returns: {
          full_name: string
          id: string
        }[]
      }
      set_user_pay: {
        Args: {
          p_pay_amount: number
          p_pay_type: Database["public"]["Enums"]["pay_type"]
          target_id: string
        }
        Returns: undefined
      }
      set_user_status: {
        Args: {
          p_status: Database["public"]["Enums"]["user_status"]
          target_id: string
        }
        Returns: undefined
      }
      set_workspace_geofence: {
        Args: {
          p_lat: number
          p_lng: number
          p_radius_m: number
          p_workspace_id: string
        }
        Returns: undefined
      }
      set_workspace_rates: {
        Args: {
          p_driver_rate: number
          p_loader_rate: number
          p_workspace_id: string
        }
        Returns: undefined
      }
      storage_workspace_ok: { Args: { objname: string }; Returns: boolean }
      tick_inspection_reminders: { Args: never; Returns: undefined }
      user_workspace_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      adjustment_type: "advance" | "deduction"
      car_issue_status: "open" | "in_progress" | "resolved"
      evidence_category: "dirt" | "damage" | "cigarette_burn" | "other"
      inspection_reason: "day9" | "driver_change" | "manual"
      inspection_view: "front" | "rear" | "left" | "right" | "interior"
      pay_type: "daily" | "monthly"
      stop_status: "pending" | "done" | "skipped"
      swap_status: "pending" | "approved" | "rejected"
      user_role: "driver" | "loader" | "manager" | "admin" | "crew"
      user_status: "pending" | "active" | "disabled"
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
      adjustment_type: ["advance", "deduction"],
      car_issue_status: ["open", "in_progress", "resolved"],
      evidence_category: ["dirt", "damage", "cigarette_burn", "other"],
      inspection_reason: ["day9", "driver_change", "manual"],
      inspection_view: ["front", "rear", "left", "right", "interior"],
      pay_type: ["daily", "monthly"],
      stop_status: ["pending", "done", "skipped"],
      swap_status: ["pending", "approved", "rejected"],
      user_role: ["driver", "loader", "manager", "admin", "crew"],
      user_status: ["pending", "active", "disabled"],
    },
  },
} as const
