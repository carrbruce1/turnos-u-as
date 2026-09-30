import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  public supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseKey
    );
  }
  escucharCambiosReservas(callback: () => void): RealtimeChannel {
    return this.supabase
      .channel('public:reservas')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservas' },
        () => {
          callback();
        }
      )
      .subscribe();
  }

  escucharCambiosLocal(localId: number | string, callback: () => void): RealtimeChannel {
    return this.supabase
      .channel(`public:locales:id=eq.${localId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'locales', filter: `id=eq.${localId}` },
        () => {
          callback();
        }
      )
      .subscribe();
  }

  removerCanal(channel: RealtimeChannel) {
    this.supabase.removeChannel(channel);
  }

  // --- GESTIÓN DE LOCALES ---

  async obtenerLocales() {
    return await this.supabase
      .from('locales')
      .select('*');
  }

  async obtenerLocalPorSlug(identifier: string | number) {
    const esNumero = !isNaN(Number(identifier));
    const columna = esNumero ? 'id' : 'slug';

    const { data, error } = await this.supabase
      .from('locales')
      .select('*')
      .eq(columna, identifier)
      .maybeSingle();

    if (error) {
      console.error('Error al obtener el local por slug/id:', error);
      return null;
    }

    return data;
  }

  async obtenerLocalPorId(localId: string | number) {
    const { data, error } = await this.supabase
      .from('locales')
      .select('*')
      .eq('id', localId)
      .maybeSingle();

    if (error) {
      console.error('Error al obtener el local:', error);
      return null;
    }

    return data;
  }

  async actualizarLocal(localId: string | number, datos: Partial<{
    banner_url: string;
    logo_url: string;
    hora_apertura: string;
    hora_cierre: string;
    descanso_inicio: string | null;
    descanso_fin: string | null;
    es_cerrado: number[];
    excepciones_horario: string;
    [key: string]: any;
  }>) {
    return await this.supabase
      .from('locales')
      .update(datos)
      .eq('id', localId)
      .select();
  }

  // --- GESTIÓN DE SERVICIOS (Con soporte para descripción) ---

  async obtenerServiciosPorLocal(localId: number) {
    return await this.supabase
      .from('servicios')
      .select('*')
      .eq('local_id', localId)
      .order('nombre', { ascending: true });
  }

  async guardarServicio(servicioData: { 
    local_id: number; 
    nombre: string; 
    descripcion?: string; 
    precio: number | null; 
    duracion: number 
  }) {
    return await this.supabase
      .from('servicios')
      .insert([servicioData])
      .select();
  }

  async actualizarServicio(id: number, datos: { 
    nombre?: string; 
    descripcion?: string; 
    precio?: number | null; 
    duracion?: number 
  }) {
    return await this.supabase
      .from('servicios')
      .update(datos)
      .eq('id', id)
      .select();
  }

  async eliminarServicio(id: number) {
    return await this.supabase
      .from('servicios')
      .delete()
      .eq('id', id);
  }

  async crearReserva(reservaData: any) {
    return await this.supabase
      .from('reservas')
      .insert([reservaData]);
  }

  async obtenerReservas() {
    return await this.supabase
      .from('reservas')
      .select('*')
      .order('fecha', { ascending: true });
  }

  async obtenerReservasPorLocal(localId: string | number) {
    return await this.supabase
      .from('reservas')
      .select('*')
      .eq('local_id', localId)
      .order('fecha', { ascending: true });
  }

  async obtenerReservaPorId(id: string | number) {
    return await this.supabase
      .from('reservas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
  }

  async actualizarEstadoReserva(id: string | number, nuevoEstado: string) {
    return await this.supabase
      .from('reservas')
      .update({ estado: nuevoEstado })
      .eq('id', id)
      .select();
  }

  async asignarEmpleadoATurno(idTurno: string | number, idEmpleado: string, nuevoEstado: string) {
    return await this.supabase
      .from('reservas')
      .update({ 
        empleados_id: String(idEmpleado), 
        estado: nuevoEstado 
      })
      .eq('id', idTurno)
      .select();
  }

  async cancelarReserva(id: string | number) {
    return await this.supabase
      .from('reservas')
      .update({ estado: 'cancelado' })
      .eq('id', id);
  }

  async login(email: string, password: string) {
    return await this.supabase.auth.signInWithPassword({
      email,
      password
    });
  }

  async obtenerSesion() {
    const { data } = await this.supabase.auth.getSession();
    return data.session;
  }

  async obtenerPerfilUsuario() {
    const { data: { user } } = await this.supabase.auth.getUser();
    
    if (!user) return null;

    const { data, error } = await this.supabase
      .from('perfiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error al obtener perfil:', error);
      return null;
    }

    return data; 
  }

  async logout() {
    return await this.supabase.auth.signOut();
  }

  async obtenerEmpleados() {
    return await this.supabase
      .from('perfiles')
      .select('id, nombre, rol, local_id')
      .eq('rol', 'empleado');
  }

  async crearNuevoEmpleado(datos: { nombre: string; email: string; password?: string; rol: string; local_id?: number }) {
    const tempSupabase = createClient(
      environment.supabaseUrl,
      environment.supabaseKey,
      { auth: { persistSession: false } }
    );

    const { data: authData, error: authError } = await tempSupabase.auth.signUp({
      email: datos.email.trim(),
      password: datos.password || '123456'
    });

    if (authError) return { error: authError };

    if (authData.user) {
      const { error: profileError } = await this.supabase
        .from('perfiles')
        .insert([
          {
            id: authData.user.id,
            nombre: datos.nombre,
            rol: datos.rol,
            local_id: datos.local_id
          }
        ]);

      return { error: profileError };
    }

    return { error: new Error('No se pudo crear el usuario') };
  }

  async subirImagen(file: File, folder: string = 'banners', bucket: string = 'barberia-media'): Promise<string | null> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;

      const { error } = await this.supabase.storage
        .from(bucket)
        .upload(fileName, file, { upsert: true });

      if (error) {
        console.error('Error al subir imagen:', error);
        return null;
      }

      const { data: publicUrlData } = this.supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      return publicUrlData.publicUrl;
    } catch (err) {
      console.error('Error en subirImagen:', err);
      return null;
    }
  }
}