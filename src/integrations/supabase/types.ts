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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip: string | null
          route: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip?: string | null
          route?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip?: string | null
          route?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      announcement: {
        Row: {
          audience_type: Database["public"]["Enums"]["announcement_audience"]
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_pinned: boolean
          published_at: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          audience_type?: Database["public"]["Enums"]["announcement_audience"]
          body: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_pinned?: boolean
          published_at?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          audience_type?: Database["public"]["Enums"]["announcement_audience"]
          body?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_pinned?: boolean
          published_at?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "announcement_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "announcement_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_read: {
        Row: {
          announcement_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_read_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_read_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_read_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      announcement_target: {
        Row: {
          announcement_id: string
          department_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          announcement_id: string
          department_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          announcement_id?: string
          department_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcement_target_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_target_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_target_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "announcement_target_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_target_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      app_user: {
        Row: {
          created_at: string
          department_id: string | null
          deputy_id: string | null
          email: string | null
          employee_no: string | null
          extension: string | null
          hire_date: string | null
          id: string
          job_title: string | null
          line_user_id: string | null
          hide_from_pickers: boolean
          must_change_password: boolean
          name: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          deputy_id?: string | null
          email?: string | null
          employee_no?: string | null
          extension?: string | null
          hire_date?: string | null
          id: string
          job_title?: string | null
          line_user_id?: string | null
          hide_from_pickers?: boolean
          must_change_password?: boolean
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          deputy_id?: string | null
          email?: string | null
          employee_no?: string | null
          extension?: string | null
          hire_date?: string | null
          id?: string
          job_title?: string | null
          line_user_id?: string | null
          hide_from_pickers?: boolean
          must_change_password?: boolean
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_user_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "app_user_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "app_user_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["attachment_entity"]
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          storage_path: string | null
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["attachment_entity"]
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          storage_path?: string | null
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["attachment_entity"]
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          storage_path?: string | null
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: string
          target_id: string | null
          target_table: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      changelogs: {
        Row: {
          content: string | null
          created_at: string
          id: string
          released_at: string | null
          title: string
          type: string
          version: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          released_at?: string | null
          title: string
          type?: string
          version: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          released_at?: string | null
          title?: string
          type?: string
          version?: string
        }
        Relationships: []
      }
      comment: {
        Row: {
          body: string
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["comment_entity"]
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["comment_entity"]
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["comment_entity"]
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      department: {
        Row: {
          code: string | null
          created_at: string
          id: string
          manager_id: string | null
          name: string
          parent_id: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          manager_id?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          manager_id?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "department_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "department_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_todos: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          done_at: string | null
          id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          done_at?: string | null
          id?: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          done_at?: string | null
          id?: string
          status?: string
          title?: string
        }
        Relationships: []
      }
      doc_pages: {
        Row: {
          content: string | null
          id: string
          key: string
          title: string | null
          updated_at: string
        }
        Insert: {
          content?: string | null
          id?: string
          key: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          content?: string | null
          id?: string
          key?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      eip_anomaly: {
        Row: {
          action_taken: string | null
          amount: number | null
          cause: string | null
          close_note: string | null
          closed_at: string | null
          closed_by: string | null
          code: string | null
          confirm_note: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          detail: string | null
          fill_due_date: string | null
          filled_at: string | null
          filled_by: string | null
          id: string
          improve_due_date: string | null
          occurred_on: string | null
          prevention: string | null
          raised_at: string
          raised_by: string | null
          severity: string
          source: string
          status: string
          subject_id: string
          tenant_id: string
          title: string
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          action_taken?: string | null
          amount?: number | null
          cause?: string | null
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          code?: string | null
          confirm_note?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          detail?: string | null
          fill_due_date?: string | null
          filled_at?: string | null
          filled_by?: string | null
          id?: string
          improve_due_date?: string | null
          occurred_on?: string | null
          prevention?: string | null
          raised_at?: string
          raised_by?: string | null
          severity?: string
          source: string
          status?: string
          subject_id: string
          tenant_id: string
          title: string
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          action_taken?: string | null
          amount?: number | null
          cause?: string | null
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          code?: string | null
          confirm_note?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          detail?: string | null
          fill_due_date?: string | null
          filled_at?: string | null
          filled_by?: string | null
          id?: string
          improve_due_date?: string | null
          occurred_on?: string | null
          prevention?: string | null
          raised_at?: string
          raised_by?: string | null
          severity?: string
          source?: string
          status?: string
          subject_id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eip_anomaly_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_anomaly_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_anomaly_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_anomaly_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_anomaly_filled_by_fkey"
            columns: ["filled_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_filled_by_fkey"
            columns: ["filled_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_anomaly_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_anomaly_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_anomaly_attachment: {
        Row: {
          anomaly_id: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          anomaly_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          anomaly_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eip_anomaly_attachment_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "eip_anomaly"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_attachment_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_anomaly_attachment_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_assistant_conversation: {
        Row: {
          created_at: string
          id: string
          tenant_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_assistant_conversation_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_assistant_conversation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_assistant_conversation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_assistant_intent: {
        Row: {
          created_at: string
          example_questions: string[]
          feature: string
          id: string
          in_line_assistant: boolean
          intent: string | null
          keywords: string[]
          note: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
          web_route: string | null
        }
        Insert: {
          created_at?: string
          example_questions?: string[]
          feature: string
          id?: string
          in_line_assistant?: boolean
          intent?: string | null
          keywords?: string[]
          note?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
          web_route?: string | null
        }
        Update: {
          created_at?: string
          example_questions?: string[]
          feature?: string
          id?: string
          in_line_assistant?: boolean
          intent?: string | null
          keywords?: string[]
          note?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          web_route?: string | null
        }
        Relationships: []
      }
      eip_assistant_message: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_assistant_message_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "eip_assistant_conversation"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_deletion_policy: {
        Row: {
          created_at: string
          creator_col: string
          is_active: boolean
          label: string
          module_key: string
          purge_guard: string | null
          purge_role: string
          retention_days: number | null
          table_name: string
        }
        Insert: {
          created_at?: string
          creator_col: string
          is_active?: boolean
          label: string
          module_key: string
          purge_guard?: string | null
          purge_role?: string
          retention_days?: number | null
          table_name: string
        }
        Update: {
          created_at?: string
          creator_col?: string
          is_active?: boolean
          label?: string
          module_key?: string
          purge_guard?: string | null
          purge_role?: string
          retention_days?: number | null
          table_name?: string
        }
        Relationships: []
      }
      eip_dept_supervisor: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          note: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          note?: string | null
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          note?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_dept_supervisor_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_dept_supervisor_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_dept_supervisor_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_dept_supervisor_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_dept_supervisor_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_dept_supervisor_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_dept_view_grant: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          id: string
          include_subtree: boolean
          is_active: boolean
          note: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          include_subtree?: boolean
          is_active?: boolean
          note?: string | null
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          include_subtree?: boolean
          is_active?: boolean
          note?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_dept_view_grant_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_dept_view_grant_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_dept_view_grant_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_dept_view_grant_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_dept_view_grant_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_dept_view_grant_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_doc_folder: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_doc_folder_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_doc_folder_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_doc_folder_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_doc_folder_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_doc_folder_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "eip_doc_folder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_doc_folder_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_document: {
        Row: {
          created_at: string
          created_by: string | null
          current_version: number
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          doc_type: string
          folder_id: string | null
          id: string
          owner_id: string | null
          status: string
          summary: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          doc_type?: string
          folder_id?: string | null
          id?: string
          owner_id?: string | null
          status?: string
          summary?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          doc_type?: string
          folder_id?: string | null
          id?: string
          owner_id?: string | null
          status?: string
          summary?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_document_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_document_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_document_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_document_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "eip_doc_folder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_document_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_document_version: {
        Row: {
          content: string | null
          created_at: string
          created_by: string | null
          document_id: string
          file_name: string | null
          file_size: number | null
          file_url: string | null
          id: string
          mime_type: string | null
          note: string | null
          storage_path: string | null
          tenant_id: string
          version_no: number
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          document_id: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          mime_type?: string | null
          note?: string | null
          storage_path?: string | null
          tenant_id: string
          version_no: number
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          mime_type?: string | null
          note?: string | null
          storage_path?: string | null
          tenant_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "eip_document_version_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_version_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_document_version_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "eip_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_document_version_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_feature_analysis: {
        Row: {
          approach: string | null
          complexity: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          dev_brief: string | null
          estimated_points: number | null
          feasibility: string | null
          feature_request_id: string
          id: string
          model: string | null
          raw: Json | null
          reason: string | null
          recommendation: string | null
          relevance: number | null
          risks: string | null
          similar_notes: string | null
          tenant_id: string
        }
        Insert: {
          approach?: string | null
          complexity?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          dev_brief?: string | null
          estimated_points?: number | null
          feasibility?: string | null
          feature_request_id: string
          id?: string
          model?: string | null
          raw?: Json | null
          reason?: string | null
          recommendation?: string | null
          relevance?: number | null
          risks?: string | null
          similar_notes?: string | null
          tenant_id: string
        }
        Update: {
          approach?: string | null
          complexity?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          dev_brief?: string | null
          estimated_points?: number | null
          feasibility?: string | null
          feature_request_id?: string
          id?: string
          model?: string | null
          raw?: Json | null
          reason?: string | null
          recommendation?: string | null
          relevance?: number | null
          risks?: string | null
          similar_notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_feature_analysis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_feature_analysis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_feature_analysis_feature_request_id_fkey"
            columns: ["feature_request_id"]
            isOneToOne: false
            referencedRelation: "eip_feature_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_feature_analysis_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_feature_request: {
        Row: {
          area: string | null
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          points_cost: number
          request_type: string | null
          scope: string | null
          status: string
          submitter_id: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          points_cost?: number
          request_type?: string | null
          scope?: string | null
          status?: string
          submitter_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          points_cost?: number
          request_type?: string | null
          scope?: string | null
          status?: string
          submitter_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_feature_request_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_feature_request_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_feature_request_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_feature_request_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_feature_request_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_handover_item: {
        Row: {
          assignee_id: string | null
          assignee_reason: string | null
          created_at: string
          department_id: string | null
          entity_id: string
          entity_title: string | null
          entity_type: string
          escalated_level: number
          id: string
          last_notify_at: string | null
          leaver_id: string
          notify_attempts: number
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignee_reason?: string | null
          created_at?: string
          department_id?: string | null
          entity_id: string
          entity_title?: string | null
          entity_type: string
          escalated_level?: number
          id?: string
          last_notify_at?: string | null
          leaver_id: string
          notify_attempts?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignee_reason?: string | null
          created_at?: string
          department_id?: string | null
          entity_id?: string
          entity_title?: string | null
          entity_type?: string
          escalated_level?: number
          id?: string
          last_notify_at?: string | null
          leaver_id?: string
          notify_attempts?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_handover_item_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_handover_item_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_handover_item_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_handover_item_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_handover_item_leaver_id_fkey"
            columns: ["leaver_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_handover_item_leaver_id_fkey"
            columns: ["leaver_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_handover_item_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_handover_item_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_leave_handover_item: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          id: string
          quick_report_id: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          quick_report_id: string
          sort_order?: number
          tenant_id?: string
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          quick_report_id?: string
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eip_leave_handover_item_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_leave_handover_item_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_leave_handover_item_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_leave_handover_item_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_leave_handover_item_quick_report_id_fkey"
            columns: ["quick_report_id"]
            isOneToOne: false
            referencedRelation: "eip_quick_report"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_link: {
        Row: {
          created_at: string
          created_by: string | null
          from_id: string
          from_type: string
          id: string
          note: string | null
          relation: string
          tenant_id: string
          to_id: string
          to_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_id: string
          from_type: string
          id?: string
          note?: string | null
          relation?: string
          tenant_id: string
          to_id: string
          to_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_id?: string
          from_type?: string
          id?: string
          note?: string | null
          relation?: string
          tenant_id?: string
          to_id?: string
          to_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_link_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_link_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_notification_miss: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_code: string
          id: number
          reason: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_code: string
          id?: number
          reason: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_code?: string
          id?: number
          reason?: string
        }
        Relationships: []
      }
      eip_purge_policy: {
        Row: {
          days: number
          is_active: boolean
          key: string
          label: string
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          days: number
          is_active?: boolean
          key: string
          label: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          days?: number
          is_active?: boolean
          key?: string
          label?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      eip_purge_run_log: {
        Row: {
          detail: Json | null
          dry_run: boolean
          duration_ms: number | null
          error: string | null
          id: number
          ok: boolean
          ran_at: string
        }
        Insert: {
          detail?: Json | null
          dry_run?: boolean
          duration_ms?: number | null
          error?: string | null
          id?: number
          ok: boolean
          ran_at?: string
        }
        Update: {
          detail?: Json | null
          dry_run?: boolean
          duration_ms?: number | null
          error?: string | null
          id?: number
          ok?: boolean
          ran_at?: string
        }
        Relationships: []
      }
      eip_quick_report: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          deputy_id: string | null
          detail: string | null
          done_at: string | null
          done_by: string | null
          eta: string | null
          handover_note: string | null
          id: string
          leave_from: string | null
          leave_to: string | null
          leave_type: string | null
          report_date: string
          status: string
          submitted_at: string
          submitter_id: string
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          deputy_id?: string | null
          detail?: string | null
          done_at?: string | null
          done_by?: string | null
          eta?: string | null
          handover_note?: string | null
          id?: string
          leave_from?: string | null
          leave_to?: string | null
          leave_type?: string | null
          report_date?: string
          status?: string
          submitted_at?: string
          submitter_id: string
          tenant_id: string
          type?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          deputy_id?: string | null
          detail?: string | null
          done_at?: string | null
          done_by?: string | null
          eta?: string | null
          handover_note?: string | null
          id?: string
          leave_from?: string | null
          leave_to?: string | null
          leave_type?: string | null
          report_date?: string
          status?: string
          submitted_at?: string
          submitter_id?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "eip_quick_report_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_quick_report_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_quick_report_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_quick_report_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "eip_quick_report_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_quick_report_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_quick_report_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_quick_report_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_quick_report_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eip_quick_report_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eip_quick_report_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_url_link: {
        Row: {
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
          label: string | null
          tenant_id: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          label?: string | null
          tenant_id?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          label?: string | null
          tenant_id?: string
          url?: string
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          level: string
          message: string | null
          route: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          level?: string
          message?: string | null
          route?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          level?: string
          message?: string | null
          route?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          code: string
          created_at: string
          email: string | null
          expires_at: string | null
          id: string
          invited_by: string | null
          role_id: string | null
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          role_id?: string | null
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          role_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          reporter_id: string | null
          severity: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          reporter_id?: string | null
          severity?: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          reporter_id?: string | null
          severity?: string
          status?: string
          title?: string
        }
        Relationships: []
      }
      leave_type: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          tenant_id?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: []
      }
      line_bind_code: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          tenant_id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_bind_code_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_bind_code_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      line_pending_task: {
        Row: {
          created_at: string
          department_id: string | null
          description: string | null
          due_date: string | null
          owner_id: string | null
          priority: string
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          owner_id?: string | null
          priority?: string
          tenant_id?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          owner_id?: string | null
          priority?: string
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_pending_task_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_pending_task_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "line_pending_task_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_pending_task_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "line_pending_task_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_pending_task_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      lookups: {
        Row: {
          category: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      meeting: {
        Row: {
          agenda: string | null
          created_at: string
          created_by: string
          department_id: string | null
          id: string
          location: string | null
          meeting_date: string
          meeting_type: Database["public"]["Enums"]["meeting_type"]
          notes: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["meeting_status"]
          tenant_id: string
          title: string
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          agenda?: string | null
          created_at?: string
          created_by: string
          department_id?: string | null
          id?: string
          location?: string | null
          meeting_date: string
          meeting_type?: Database["public"]["Enums"]["meeting_type"]
          notes?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["meeting_status"]
          tenant_id: string
          title: string
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          agenda?: string | null
          created_at?: string
          created_by?: string
          department_id?: string | null
          id?: string
          location?: string | null
          meeting_date?: string
          meeting_type?: Database["public"]["Enums"]["meeting_type"]
          notes?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["meeting_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "fk_meeting_project"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "meeting_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_action_item: {
        Row: {
          content: string
          created_at: string
          due_date: string | null
          id: string
          linked_task_id: string | null
          meeting_id: string
          owner_id: string | null
          status: Database["public"]["Enums"]["action_item_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          due_date?: string | null
          id?: string
          linked_task_id?: string | null
          meeting_id: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["action_item_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          due_date?: string | null
          id?: string
          linked_task_id?: string | null
          meeting_id?: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["action_item_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_action_item_linked_task_id_fkey"
            columns: ["linked_task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "meeting_action_item_linked_task_id_fkey"
            columns: ["linked_task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_action_item_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_action_item_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_action_item_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_action_item_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_agenda_item: {
        Row: {
          created_at: string
          duration_min: number | null
          id: string
          meeting_id: string
          notes: string | null
          owner_id: string | null
          sort_order: number
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string
          duration_min?: number | null
          id?: string
          meeting_id: string
          notes?: string | null
          owner_id?: string | null
          sort_order?: number
          tenant_id: string
          title: string
        }
        Update: {
          created_at?: string
          duration_min?: number | null
          id?: string
          meeting_id?: string
          notes?: string | null
          owner_id?: string | null
          sort_order?: number
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_agenda_item_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_agenda_item_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_agenda_item_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_agenda_item_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_attendee: {
        Row: {
          attend_status: Database["public"]["Enums"]["attendee_status"]
          is_required: boolean
          meeting_id: string
          user_id: string
        }
        Insert: {
          attend_status?: Database["public"]["Enums"]["attendee_status"]
          is_required?: boolean
          meeting_id: string
          user_id: string
        }
        Update: {
          attend_status?: Database["public"]["Enums"]["attendee_status"]
          is_required?: boolean
          meeting_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendee_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendee_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendee_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      menus: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          menu_key: string
          module_key: string | null
          page_key: string | null
          parent_id: string | null
          route: string | null
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          menu_key: string
          module_key?: string | null
          page_key?: string | null
          parent_id?: string | null
          route?: string | null
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          menu_key?: string
          module_key?: string | null
          page_key?: string | null
          parent_id?: string | null
          route?: string | null
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone: {
        Row: {
          created_at: string
          due_date: string | null
          id: string
          name: string
          progress: number
          project_id: string
          status: Database["public"]["Enums"]["milestone_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          id?: string
          name: string
          progress?: number
          project_id: string
          status?: Database["public"]["Enums"]["milestone_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_date?: string | null
          id?: string
          name?: string
          progress?: number
          project_id?: string
          status?: Database["public"]["Enums"]["milestone_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["notification_entity"]
          id: string
          is_read: boolean
          line_attempts: number
          line_blocked_until: string | null
          line_error: string | null
          line_pending: boolean
          line_queued_at: string | null
          line_request_id: number | null
          line_sent_at: string | null
          message: string
          priority: string
          tenant_id: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type: Database["public"]["Enums"]["notification_entity"]
          id?: string
          is_read?: boolean
          line_attempts?: number
          line_blocked_until?: string | null
          line_error?: string | null
          line_pending?: boolean
          line_queued_at?: string | null
          line_request_id?: number | null
          line_sent_at?: string | null
          message: string
          priority?: string
          tenant_id: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["notification_entity"]
          id?: string
          is_read?: boolean
          line_attempts?: number
          line_blocked_until?: string | null
          line_error?: string | null
          line_pending?: boolean
          line_queued_at?: string | null
          line_request_id?: number | null
          line_sent_at?: string | null
          message?: string
          priority?: string
          tenant_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_setting: {
        Row: {
          created_at: string
          department_id: string | null
          event_code: string
          id: string
          in_app_enabled: boolean
          is_active: boolean
          line_enabled: boolean
          notif_type: string | null
          recipient_scopes: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          event_code: string
          id?: string
          in_app_enabled?: boolean
          is_active?: boolean
          line_enabled?: boolean
          notif_type?: string | null
          recipient_scopes?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          event_code?: string
          id?: string
          in_app_enabled?: boolean
          is_active?: boolean
          line_enabled?: boolean
          notif_type?: string | null
          recipient_scopes?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_setting_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_setting_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
        ]
      }
      personal_event: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          end_date: string | null
          end_time: string | null
          id: string
          note: string | null
          start_date: string
          start_time: string | null
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          note?: string | null
          start_date: string
          start_time?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          note?: string | null
          start_date?: string
          start_time?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_event_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_event_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "personal_event_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_event_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      personal_event_share: {
        Row: {
          created_at: string
          event_id: string
          id: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_event_share_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "personal_event"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_event_share_shared_with_user_id_fkey"
            columns: ["shared_with_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_event_share_shared_with_user_id_fkey"
            columns: ["shared_with_user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      personal_routine: {
        Row: {
          created_at: string
          days_of_month: number[] | null
          deleted_at: string | null
          deleted_by: string | null
          freq: string
          id: string
          is_active: boolean
          require_content: boolean
          sort_order: number
          tenant_id: string
          time_slot: string
          title: string
          updated_at: string
          use_month_end: boolean
          user_id: string
          weekdays: number[] | null
        }
        Insert: {
          created_at?: string
          days_of_month?: number[] | null
          deleted_at?: string | null
          deleted_by?: string | null
          freq?: string
          id?: string
          is_active?: boolean
          require_content?: boolean
          sort_order?: number
          tenant_id?: string
          time_slot?: string
          title: string
          updated_at?: string
          use_month_end?: boolean
          user_id: string
          weekdays?: number[] | null
        }
        Update: {
          created_at?: string
          days_of_month?: number[] | null
          deleted_at?: string | null
          deleted_by?: string | null
          freq?: string
          id?: string
          is_active?: boolean
          require_content?: boolean
          sort_order?: number
          tenant_id?: string
          time_slot?: string
          title?: string
          updated_at?: string
          use_month_end?: boolean
          user_id?: string
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "personal_routine_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_routine_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "personal_routine_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_routine_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      phone_order_daily: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          error_reason: string | null
          id: string
          log_date: string
          order_count: number
          remark: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          error_reason?: string | null
          id?: string
          log_date: string
          order_count?: number
          remark?: string | null
          tenant_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          error_reason?: string | null
          id?: string
          log_date?: string
          order_count?: number
          remark?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_order_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_order_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      phone_order_lock: {
        Row: {
          id: string
          locked: boolean
          locked_at: string
          locked_by: string | null
          tenant_id: string
          ym: string
        }
        Insert: {
          id?: string
          locked?: boolean
          locked_at?: string
          locked_by?: string | null
          tenant_id?: string
          ym: string
        }
        Update: {
          id?: string
          locked?: boolean
          locked_at?: string
          locked_by?: string | null
          tenant_id?: string
          ym?: string
        }
        Relationships: []
      }
      phone_order_month: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
          work_days: number | null
          ym: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id: string
          work_days?: number | null
          ym: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          work_days?: number | null
          ym?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_order_month_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_order_month_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
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
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      project: {
        Row: {
          created_at: string
          department_id: string | null
          description: string | null
          end_date: string | null
          goal: string | null
          health: Database["public"]["Enums"]["project_health"]
          id: string
          name: string
          owner_id: string
          scope: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          tenant_id: string
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          goal?: string | null
          health?: Database["public"]["Enums"]["project_health"]
          id?: string
          name: string
          owner_id: string
          scope?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          tenant_id: string
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          goal?: string | null
          health?: Database["public"]["Enums"]["project_health"]
          id?: string
          name?: string
          owner_id?: string
          scope?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          tenant_id?: string
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "project_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "project_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "project_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      project_kpi: {
        Row: {
          created_at: string
          current_value: string | null
          id: string
          name: string
          project_id: string
          sort_order: number | null
          target_value: string | null
          tenant_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          current_value?: string | null
          id?: string
          name: string
          project_id: string
          sort_order?: number | null
          target_value?: string | null
          tenant_id?: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          current_value?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number | null
          target_value?: string | null
          tenant_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_kpi_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
        ]
      }
      project_member: {
        Row: {
          project_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          project_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          project_id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_member_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_member_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_member_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      project_risk: {
        Row: {
          created_at: string
          id: string
          impact: string | null
          likelihood: string | null
          mitigation: string | null
          owner_id: string | null
          project_id: string
          status: string
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          impact?: string | null
          likelihood?: string | null
          mitigation?: string | null
          owner_id?: string | null
          project_id: string
          status?: string
          tenant_id?: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          impact?: string | null
          likelihood?: string | null
          mitigation?: string | null
          owner_id?: string | null
          project_id?: string
          status?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_risk_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_rule: {
        Row: {
          active_weekdays: number[] | null
          advance_days: number[]
          counterpart: string | null
          counterpart_user_id: string | null
          counterpart_user_ids: string[]
          created_at: string
          created_by: string | null
          days_of_month: number[] | null
          department_id: string | null
          description: string | null
          freq: string
          id: string
          is_active: boolean
          last_run_on: string | null
          months: number[] | null
          owner_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          remind_until_done: boolean
          repeat_every_days: number | null
          report_fields: Json | null
          tenant_id: string
          title: string
          updated_at: string
          use_month_end: boolean
          weekday: number | null
        }
        Insert: {
          active_weekdays?: number[] | null
          advance_days?: number[]
          counterpart?: string | null
          counterpart_user_id?: string | null
          counterpart_user_ids?: string[]
          created_at?: string
          created_by?: string | null
          days_of_month?: number[] | null
          department_id?: string | null
          description?: string | null
          freq?: string
          id?: string
          is_active?: boolean
          last_run_on?: string | null
          months?: number[] | null
          owner_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          remind_until_done?: boolean
          repeat_every_days?: number | null
          report_fields?: Json | null
          tenant_id: string
          title: string
          updated_at?: string
          use_month_end?: boolean
          weekday?: number | null
        }
        Update: {
          active_weekdays?: number[] | null
          advance_days?: number[]
          counterpart?: string | null
          counterpart_user_id?: string | null
          counterpart_user_ids?: string[]
          created_at?: string
          created_by?: string | null
          days_of_month?: number[] | null
          department_id?: string | null
          description?: string | null
          freq?: string
          id?: string
          is_active?: boolean
          last_run_on?: string | null
          months?: number[] | null
          owner_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          remind_until_done?: boolean
          repeat_every_days?: number | null
          report_fields?: Json | null
          tenant_id?: string
          title?: string
          updated_at?: string
          use_month_end?: boolean
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_rule_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rule_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recurring_rule_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rule_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recurring_rule_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rule_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "recurring_rule_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rule_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recurring_rule_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      role_module_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_view: boolean
          id: string
          module_key: string
          role_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          id?: string
          module_key: string
          role_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          id?: string
          module_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_module_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_page_permissions: {
        Row: {
          can_create: boolean | null
          can_delete: boolean | null
          can_edit: boolean | null
          can_export: boolean | null
          can_view: boolean | null
          id: string
          page_key: string
          role_id: string
        }
        Insert: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_export?: boolean | null
          can_view?: boolean | null
          id?: string
          page_key: string
          role_id: string
        }
        Update: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_export?: boolean | null
          can_view?: boolean | null
          id?: string
          page_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_page_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          id: string
          is_system: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
        }
        Relationships: []
      }
      system_configs: {
        Row: {
          created_at: string
          description: string | null
          group_name: string | null
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          group_name?: string | null
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          group_name?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      task: {
        Row: {
          board_position: number
          closing_summary: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          description: string | null
          due_date: string | null
          id: string
          occurrence_date: string | null
          owner_id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string | null
          recurring_rule_id: string | null
          report_data: Json | null
          start_date: string | null
          status_id: string
          tenant_id: string
          title: string
          type_id: string | null
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          board_position?: number
          closing_summary?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          occurrence_date?: string | null
          owner_id: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          project_id?: string | null
          recurring_rule_id?: string | null
          report_data?: Json | null
          start_date?: string | null
          status_id: string
          tenant_id: string
          title: string
          type_id?: string | null
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          board_position?: number
          closing_summary?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          occurrence_date?: string | null
          owner_id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          project_id?: string | null
          recurring_rule_id?: string | null
          report_data?: Json | null
          start_date?: string | null
          status_id?: string
          tenant_id?: string
          title?: string
          type_id?: string | null
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "fk_task_project"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "task_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "task_type"
            referencedColumns: ["id"]
          },
        ]
      }
      task_change_log: {
        Row: {
          changed_by: string | null
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          task_id: string
          tenant_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id: string
          tenant_id?: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_change_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_change_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_change_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_change_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          id: string
          is_done: boolean
          sort_order: number
          task_id: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          sort_order?: number
          task_id: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          sort_order?: number
          task_id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_checklist_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
      task_collaborator: {
        Row: {
          task_id: string
          user_id: string
        }
        Insert: {
          task_id: string
          user_id: string
        }
        Update: {
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_collaborator_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_collaborator_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborator_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborator_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      task_status: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          is_done_state: boolean
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          is_done_state?: boolean
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          is_done_state?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_status_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      task_type: {
        Row: {
          created_at: string
          default_steps: Json | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_steps?: Json | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_steps?: Json | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_type_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      task_update: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          progress: number | null
          status_changed_to_id: string | null
          task_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          progress?: number | null
          status_changed_to_id?: string | null
          task_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          progress?: number | null
          status_changed_to_id?: string | null
          task_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_update_status_changed_to_id_fkey"
            columns: ["status_changed_to_id"]
            isOneToOne: false
            referencedRelation: "task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_update_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      tenant: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      work_log: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          log_date: string
          manager_comment: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          routine_afternoon: Json
          routine_morning: Json
          special_items: Json
          status: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          log_date?: string
          manager_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          routine_afternoon?: Json
          routine_morning?: Json
          special_items?: Json
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          log_date?: string
          manager_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          routine_afternoon?: Json
          routine_morning?: Json
          special_items?: Json
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_log_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_log_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "work_log_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_log_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      work_log_attachment: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          tenant_id: string
          user_id: string
          work_log_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          tenant_id?: string
          user_id?: string
          work_log_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          tenant_id?: string
          user_id?: string
          work_log_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_log_attachment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_attachment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_log_attachment_work_log_id_fkey"
            columns: ["work_log_id"]
            isOneToOne: false
            referencedRelation: "work_log"
            referencedColumns: ["id"]
          },
        ]
      }
      work_log_item: {
        Row: {
          done: boolean
          id: string
          link: string | null
          note: string | null
          ref_id: string | null
          require_content: boolean
          section: string
          sort_order: number
          source: string | null
          text: string | null
          work_log_id: string
        }
        Insert: {
          done?: boolean
          id?: string
          link?: string | null
          note?: string | null
          ref_id?: string | null
          require_content?: boolean
          section: string
          sort_order?: number
          source?: string | null
          text?: string | null
          work_log_id: string
        }
        Update: {
          done?: boolean
          id?: string
          link?: string | null
          note?: string | null
          ref_id?: string | null
          require_content?: boolean
          section?: string
          sort_order?: number
          source?: string | null
          text?: string | null
          work_log_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_log_item_work_log_id_fkey"
            columns: ["work_log_id"]
            isOneToOne: false
            referencedRelation: "work_log"
            referencedColumns: ["id"]
          },
        ]
      }
      work_log_lock_archive: {
        Row: {
          archived_at: string
          locked_at: string | null
          locked_by: string | null
          work_log_id: string
        }
        Insert: {
          archived_at?: string
          locked_at?: string | null
          locked_by?: string | null
          work_log_id: string
        }
        Update: {
          archived_at?: string
          locked_at?: string | null
          locked_by?: string | null
          work_log_id?: string
        }
        Relationships: []
      }
      work_log_review: {
        Row: {
          comment: string
          created_at: string
          id: string
          reviewer_id: string
          reviewer_role: string
          tenant_id: string
          updated_at: string
          work_log_id: string
        }
        Insert: {
          comment: string
          created_at?: string
          id?: string
          reviewer_id?: string
          reviewer_role?: string
          tenant_id?: string
          updated_at?: string
          work_log_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          reviewer_id?: string
          reviewer_role?: string
          tenant_id?: string
          updated_at?: string
          work_log_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_log_review_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_review_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_log_review_work_log_id_fkey"
            columns: ["work_log_id"]
            isOneToOne: false
            referencedRelation: "work_log"
            referencedColumns: ["id"]
          },
        ]
      }
      work_log_review_archive: {
        Row: {
          archived_at: string
          archived_reason: string
          comment: string | null
          created_at: string | null
          id: string
          reviewer_id: string | null
          reviewer_role: string | null
          tenant_id: string | null
          updated_at: string | null
          work_log_id: string | null
        }
        Insert: {
          archived_at?: string
          archived_reason?: string
          comment?: string | null
          created_at?: string | null
          id: string
          reviewer_id?: string | null
          reviewer_role?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          work_log_id?: string | null
        }
        Update: {
          archived_at?: string
          archived_reason?: string
          comment?: string | null
          created_at?: string | null
          id?: string
          reviewer_id?: string | null
          reviewer_role?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          work_log_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      eip_calendar_events: {
        Row: {
          end_date: string | null
          end_time: string | null
          id: string | null
          kind: string | null
          leave_type: string | null
          note: string | null
          start_date: string | null
          start_time: string | null
          status: string | null
          tenant_id: string | null
          title: string | null
          user_id: string | null
        }
        Relationships: []
      }
      eip_my_notifications: {
        Row: {
          created_at: string | null
          entity_alive: boolean | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["notification_entity"] | null
          id: string | null
          is_read: boolean | null
          line_attempts: number | null
          line_blocked_until: string | null
          line_error: string | null
          line_pending: boolean | null
          line_queued_at: string | null
          line_request_id: number | null
          line_sent_at: string | null
          message: string | null
          priority: string | null
          tenant_id: string | null
          type: Database["public"]["Enums"]["notification_type"] | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          entity_alive?: never
          entity_id?: string | null
          entity_type?:
            | Database["public"]["Enums"]["notification_entity"]
            | null
          id?: string | null
          is_read?: boolean | null
          line_attempts?: number | null
          line_blocked_until?: string | null
          line_error?: string | null
          line_pending?: boolean | null
          line_queued_at?: string | null
          line_request_id?: number | null
          line_sent_at?: string | null
          message?: string | null
          priority?: string | null
          tenant_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"] | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          entity_alive?: never
          entity_id?: string | null
          entity_type?:
            | Database["public"]["Enums"]["notification_entity"]
            | null
          id?: string | null
          is_read?: boolean | null
          line_attempts?: number | null
          line_blocked_until?: string | null
          line_error?: string | null
          line_pending?: boolean | null
          line_queued_at?: string | null
          line_request_id?: number | null
          line_sent_at?: string | null
          message?: string | null
          priority?: string | null
          tenant_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
        ]
      }
      eip_org_chart: {
        Row: {
          department_code: string | null
          department_id: string | null
          department_name: string | null
          email: string | null
          employee_no: string | null
          extension: string | null
          hire_date: string | null
          job_title: string | null
          manager_id: string | null
          manager_name: string | null
          name: string | null
          parent_id: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          sort_order: number | null
          status: Database["public"]["Enums"]["user_status"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "department_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
        ]
      }
      eip_recurring_overview: {
        Row: {
          department_id: string | null
          department_name: string | null
          due_date: string | null
          is_done: boolean | null
          is_overdue: boolean | null
          is_reported: boolean | null
          occurrence_date: string | null
          owner_id: string | null
          owner_name: string | null
          recurring_rule_id: string | null
          rule_title: string | null
          status_name: string | null
          task_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "task_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "eip_org_chart"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rule"
            referencedColumns: ["id"]
          },
        ]
      }
      eip_task_timeline: {
        Row: {
          actor_id: string | null
          at: string | null
          comment: string | null
          field: string | null
          kind: string | null
          new_value: string | null
          old_value: string | null
          progress: number | null
          task_id: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      task_checklist_summary: {
        Row: {
          done: number | null
          open: number | null
          task_id: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "eip_recurring_overview"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_checklist_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_department_id: { Args: never; Returns: string }
      current_role_name: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_tenant_id: { Args: never; Returns: string }
      daily_maintenance: { Args: never; Returns: Json }
      eip_admin_create_user: {
        Args: {
          p_department_id?: string
          p_email: string
          p_full_name: string
          p_role_code?: string
        }
        Returns: Json
      }
      eip_admin_delete_user: { Args: { p_user_id: string }; Returns: Json }
      eip_admin_reset_password: { Args: { p_user_id: string }; Returns: Json }
      eip_announcement_targeted: {
        Args: { p_announcement_id: string }
        Returns: boolean
      }
      eip_anomaly_file_access: {
        Args: { p_path: string; p_write: boolean }
        Returns: boolean
      }
      eip_anomaly_weekly_kpi: {
        Args: { p_department_id?: string; p_from: string; p_to: string }
        Returns: {
          avg_close_days: number
          closed: number
          department_id: string
          department_name: string
          filled: number
          improving: number
          overdue_unfilled: number
          total: number
          total_amount: number
          unfilled: number
          voided: number
        }[]
      }
      eip_build_handover: { Args: { p_leaver: string }; Returns: number }
      eip_can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      eip_can_edit_task_checklist: {
        Args: { p_task_id: string }
        Returns: boolean
      }
      eip_can_manage_task: { Args: { p_task_id: string }; Returns: boolean }
      eip_can_run_recurring: { Args: never; Returns: boolean }
      eip_can_see_announcement: { Args: { p_id: string }; Returns: boolean }
      eip_can_see_leave: { Args: { p_report_id: string }; Returns: boolean }
      eip_can_see_meeting: { Args: { p_meeting_id: string }; Returns: boolean }
      eip_can_see_project: { Args: { p_project_id: string }; Returns: boolean }
      eip_can_see_task: { Args: { p_task_id: string }; Returns: boolean }
      eip_can_view_dept_record: { Args: { p_dept: string }; Returns: boolean }
      eip_can_view_dept_shared: { Args: { p_dept: string }; Returns: boolean }
      eip_close_leave_handover: { Args: { p_report_id: string }; Returns: Json }
      eip_complete_password_change: { Args: never; Returns: undefined }
      eip_confirm_line_delivery: { Args: never; Returns: number }
      eip_create_department: {
        Args: {
          p_code?: string
          p_name: string
          p_parent_id?: string
          p_sort_order?: number
        }
        Returns: {
          code: string | null
          created_at: string
          id: string
          manager_id: string | null
          name: string
          parent_id: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "department"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      eip_create_employee: {
        Args: {
          p_department_id: string
          p_domain?: string
          p_employee_no: string
          p_extension?: string
          p_job_title?: string
          p_name: string
          p_role?: string
          p_with_login?: boolean
        }
        Returns: Json
      }
      eip_cron_guarded: { Args: { p_job: string }; Returns: undefined }
      eip_deleted_items: {
        Args: { p_module?: string }
        Returns: {
          can_purge: boolean
          deleted_at: string
          deleted_by_name: string
          item_id: string
          label: string
          module_key: string
          purge_block: string
          title: string
        }[]
      }
      eip_dept_effective_manager: {
        Args: { p_dept: string; p_exclude?: string }
        Returns: string
      }
      eip_dept_in_subtree: {
        Args: { p_dept: string; p_root: string }
        Returns: boolean
      }
      eip_dept_routine_summary: {
        Args: { p_department_id?: string; p_from: string; p_to: string }
        Returns: {
          department_id: string
          department_name: string
          done: number
          expected: number
          log_date: string
          log_status: string
          user_id: string
          user_name: string
        }[]
      }
      eip_derive_app_role: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      eip_document_file_access: {
        Args: { p_path: string; p_write: boolean }
        Returns: boolean
      }
      eip_emit_notification: {
        Args: {
          p_actor_id: string
          p_department_id: string
          p_entity_id: string
          p_entity_type: Database["public"]["Enums"]["notification_entity"]
          p_event_code: string
          p_extra_user_ids?: string[]
          p_message: string
          p_notif_type: Database["public"]["Enums"]["notification_type"]
          p_owner_id: string
          p_priority?: string
        }
        Returns: number
      }
      eip_generate_line_bind_code: { Args: never; Returns: string }
      eip_handover_assignee: {
        Args: { p_creator: string; p_dept: string; p_leaver: string }
        Returns: Record<string, unknown>
      }
      eip_has_perm: {
        Args: { p_action: string; p_module: string }
        Returns: boolean
      }
      eip_is_any_dept_supervisor: { Args: never; Returns: boolean }
      eip_is_dept_supervisor: { Args: { p_dept: string }; Returns: boolean }
      eip_is_phone_order_hr: { Args: never; Returns: boolean }
      eip_is_task_collaborator: {
        Args: { p_task_id: string }
        Returns: boolean
      }
      eip_leave_roster: {
        Args: { p_from: string; p_to: string }
        Returns: {
          department_name: string
          end_date: string
          end_time: string
          handover_done: boolean
          id: string
          is_full_day: boolean
          start_date: string
          start_time: string
          user_id: string
          user_name: string
        }[]
      }
      eip_line_push_now: {
        Args: { p_message: string; p_user_id: string }
        Returns: number
      }
      eip_line_skip_reason: { Args: { t: string }; Returns: string }
      eip_line_status: { Args: { t: string }; Returns: number }
      eip_link_endpoint_visible: {
        Args: { p_id: string; p_type: string }
        Returns: boolean
      }
      eip_materialize_work_log_items: {
        Args: { p_log_id: string }
        Returns: number
      }
      eip_must_change_password: { Args: never; Returns: boolean }
      eip_my_routine_today: {
        Args: { p_date?: string }
        Returns: {
          done: boolean
          idx: number
          link: string
          note: string
          ref_id: string
          req: boolean
          section: string
          source: string
          text: string
        }[]
      }
      eip_my_supervised_departments: {
        Args: never
        Returns: {
          department_id: string
        }[]
      }
      eip_my_view_departments: { Args: never; Returns: string[] }
      eip_notification_entity_alive: {
        Args: {
          p_entity_id: string
          p_entity_type: Database["public"]["Enums"]["notification_entity"]
        }
        Returns: boolean
      }
      eip_notification_recipients: {
        Args: {
          p_actor_id?: string
          p_department_id?: string
          p_event_code: string
          p_extra_user_ids?: string[]
          p_owner_id?: string
        }
        Returns: {
          in_app: boolean
          line_enabled: boolean
          user_id: string
        }[]
      }
      eip_notify_user: {
        Args: {
          p_entity_id: string
          p_entity_type: Database["public"]["Enums"]["notification_entity"]
          p_message: string
          p_priority?: string
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user_id: string
        }
        Returns: number
      }
      eip_nudge_worklog: {
        Args: { p_date?: string; p_user_ids: string[] }
        Returns: number
      }
      eip_owns_personal_event: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      eip_pending_reassign: {
        Args: { p_user_id: string }
        Returns: {
          assignee_id: string
          assignee_name: string
          assignee_reason: string
          entity_id: string
          entity_title: string
          entity_type: string
        }[]
      }
      eip_performance_by_dept: {
        Args: { p_from: string; p_to: string }
        Returns: {
          anomalies_raised: number
          anomalies_unfilled: number
          department_id: string
          department_name: string
          handover_rate: number
          headcount: number
          routine_rate: number
          tasks_done: number
          tasks_overdue_now: number
          worklog_ontime_rate: number
          worklog_submit_rate: number
        }[]
      }
      eip_performance_summary: {
        Args: {
          p_department_id?: string
          p_from: string
          p_to: string
          p_user_id?: string
        }
        Returns: {
          anomalies_closed: number
          anomalies_raised: number
          anomalies_unfilled: number
          department_id: string
          department_name: string
          handover_done: number
          handover_items: number
          handover_rate: number
          meeting_actions_done: number
          meeting_actions_open_now: number
          routine_done: number
          routine_expected: number
          routine_rate: number
          tasks_done: number
          tasks_open_now: number
          tasks_overdue_now: number
          user_id: string
          user_name: string
          worklog_draft: number
          worklog_ontime: number
          worklog_ontime_rate: number
          worklog_submitted: number
        }[]
      }
      eip_personal_routine_due_on: {
        Args: {
          d: string
          r: Database["public"]["Tables"]["personal_routine"]["Row"]
        }
        Returns: boolean
      }
      eip_phone_order_error_detail: {
        Args: { p_department_id?: string; p_month: number; p_year: number }
        Returns: {
          department_name: string
          error_count: number
          error_reason: string
          log_date: string
          remark: string
          user_id: string
          user_name: string
        }[]
      }
      eip_phone_order_month_locked: {
        Args: { p_day: string }
        Returns: boolean
      }
      eip_phone_order_summary: {
        Args: { p_department_id?: string; p_month: number; p_year: number }
        Returns: {
          avg_score: number
          days_recorded: number
          department_id: string
          department_name: string
          locked: boolean
          total_errors: number
          total_orders: number
          user_id: string
          user_name: string
          work_days: number
        }[]
      }
      eip_priority_label: { Args: { p: string }; Returns: string }
      eip_purge_deleted: {
        Args: { p_id: string; p_module: string }
        Returns: undefined
      }
      eip_purge_maintenance: {
        Args: { p_dry_run?: boolean; p_max_per_table?: number }
        Returns: Json
      }
      eip_purge_old_logs: { Args: { p_days?: number }; Returns: string }
      eip_remove_routine_item: {
        Args: {
          p_date: string
          p_ref_id?: string
          p_section: string
          p_source?: string
          p_text?: string
        }
        Returns: Json
      }
      eip_reorder_leave_handover_items: {
        Args: { p_ids: string[] }
        Returns: number
      }
      eip_reorder_task_checklist: {
        Args: { p_ids: string[]; p_task_id: string }
        Returns: number
      }
      eip_restore_deleted: {
        Args: { p_id: string; p_module: string }
        Returns: undefined
      }
      eip_retry_urgent_line: { Args: never; Returns: number }
      eip_rule_due_on: {
        Args: {
          d: string
          r: Database["public"]["Tables"]["recurring_rule"]["Row"]
        }
        Returns: boolean
      }
      eip_run_recurring:
        | { Args: never; Returns: undefined }
        | { Args: { p_date: string }; Returns: undefined }
      eip_send_line_digests: { Args: never; Returns: number }
      eip_set_routine_item: {
        Args: {
          p_date: string
          p_done?: boolean
          p_link?: string
          p_note?: string
          p_ref_id?: string
          p_section: string
          p_source?: string
          p_text?: string
        }
        Returns: Json
      }
      eip_set_user_roles: {
        Args: { p_role_ids: string[]; p_user_id: string }
        Returns: undefined
      }
      eip_soft_delete: {
        Args: { p_id: string; p_module: string }
        Returns: Json
      }
      eip_supervised_departments_of: {
        Args: { p_user: string }
        Returns: string[]
      }
      eip_sweep_anomaly_overdue: { Args: never; Returns: number }
      eip_sweep_handover: { Args: never; Returns: number }
      eip_task_purge_guard: { Args: { p_id: string }; Returns: string }
      eip_toggle_routine_item: {
        Args: {
          p_date: string
          p_done: boolean
          p_ref_id?: string
          p_section: string
          p_source?: string
          p_text?: string
        }
        Returns: Json
      }
      eip_topup_routine_log: {
        Args: { p_date: string; p_user_id: string }
        Returns: number
      }
      eip_try_jsonb: { Args: { t: string }; Returns: Json }
      eip_url_link_visible: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: boolean
      }
      eip_user_can_scope_dept: { Args: { p_dept: string }; Returns: boolean }
      eip_work_log_purge_guard: { Args: { p_id: string }; Returns: string }
      eip_worklog_file_access: {
        Args: { p_path: string; p_write: boolean }
        Returns: boolean
      }
      eip_worklog_seed: {
        Args: { p_date?: string; p_user_id: string }
        Returns: Json
      }
      eip_worklog_supervised_members: {
        Args: never
        Returns: {
          department_id: string
          department_name: string
          name: string
          user_id: string
        }[]
      }
      is_admin: { Args: { _uid: string }; Returns: boolean }
      redeem_invitation: { Args: { p_code: string }; Returns: string }
    }
    Enums: {
      action_item_status: "open" | "converted" | "done"
      announcement_audience: "all" | "department" | "users"
      attachment_entity:
        | "task"
        | "meeting"
        | "project"
        | "announcement"
        | "anomaly"
      attendee_status: "invited" | "present" | "absent" | "leave"
      comment_entity: "task" | "meeting" | "project"
      meeting_status:
        | "draft"
        | "scheduled"
        | "in_progress"
        | "done"
        | "cancelled"
      meeting_type: "regular" | "project" | "adhoc"
      milestone_status: "pending" | "done"
      notification_entity:
        | "task"
        | "meeting"
        | "project"
        | "announcement"
        | "quick_report"
        | "work_log"
        | "handover"
        | "anomaly"
        | "leave_handover"
      notification_type:
        | "assigned"
        | "status_changed"
        | "mentioned"
        | "due_soon"
        | "overdue"
        | "review_needed"
        | "announcement"
        | "quick_report"
        | "reassign_needed"
        | "handover_created"
        | "handover_completed"
        | "anomaly_opened"
        | "anomaly_filled"
        | "anomaly_confirmed"
        | "anomaly_closed"
        | "anomaly_overdue"
        | "system_alert"
        | "worklog_reviewed"
      project_health: "on_track" | "at_risk" | "off_track"
      project_status: "planning" | "active" | "on_hold" | "done"
      task_priority: "low" | "normal" | "high" | "urgent"
      user_role: "company_admin" | "dept_manager" | "member" | "viewer"
      user_status: "active" | "inactive"
      visibility_scope: "company" | "department" | "members"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      action_item_status: ["open", "converted", "done"],
      announcement_audience: ["all", "department", "users"],
      attachment_entity: [
        "task",
        "meeting",
        "project",
        "announcement",
        "anomaly",
      ],
      attendee_status: ["invited", "present", "absent", "leave"],
      comment_entity: ["task", "meeting", "project"],
      meeting_status: [
        "draft",
        "scheduled",
        "in_progress",
        "done",
        "cancelled",
      ],
      meeting_type: ["regular", "project", "adhoc"],
      milestone_status: ["pending", "done"],
      notification_entity: [
        "task",
        "meeting",
        "project",
        "announcement",
        "quick_report",
        "work_log",
        "handover",
        "anomaly",
        "leave_handover",
      ],
      notification_type: [
        "assigned",
        "status_changed",
        "mentioned",
        "due_soon",
        "overdue",
        "review_needed",
        "announcement",
        "quick_report",
        "reassign_needed",
        "handover_created",
        "handover_completed",
        "anomaly_opened",
        "anomaly_filled",
        "anomaly_confirmed",
        "anomaly_closed",
        "anomaly_overdue",
        "system_alert",
        "worklog_reviewed",
      ],
      project_health: ["on_track", "at_risk", "off_track"],
      project_status: ["planning", "active", "on_hold", "done"],
      task_priority: ["low", "normal", "high", "urgent"],
      user_role: ["company_admin", "dept_manager", "member", "viewer"],
      user_status: ["active", "inactive"],
      visibility_scope: ["company", "department", "members"],
    },
  },
} as const
