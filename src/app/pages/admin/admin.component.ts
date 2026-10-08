import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../services/supabase.service';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface Reserva {
  id: string | number;
  local_id?: number;
  nombre_cliente?: string;
  telefono_cliente?: string;
  email_cliente?: string;
  servicio?: string;
  notas?: string | null;
  fecha: string;
  hora: string;
  estado: 'pendiente' | 'confirmado' | 'en_proceso' | 'finalizado' | 'rechazado';
}

// Forma de cada excepción guardada dentro del texto JSON de "excepciones_horario"
export interface ExcepcionHorario {
  fecha: string;                 // "YYYY-MM-DD"
  es_cerrado: boolean;
  hora_apertura: string | null;  // "HH:mm" (solo si es_cerrado = false)
  hora_cierre: string | null;    // "HH:mm" (solo si es_cerrado = false)
  motivo: string | null;
}

export type TipoImagen = 'banner' | 'logo' | 'servicio' | 'servicioEdit';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css'],
})
export class AdminComponent implements OnInit, OnDestroy {
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  nombreUsuario: string = localStorage.getItem('usuario_nombre') || 'Admin';
  nombreBarberia: string = '';
  localIdUsuario: number | null = null;

  vistaActual: 'turnos' | 'historial' | 'calendario' = 'turnos';
  turnosTotales: Reserva[] = [];
  turnosFiltrados: Reserva[] = [];
  historialFiltrado: Reserva[] = [];
  estadoFiltro: string = 'en_proceso';
  cantidadEnProceso = 0;
  cantidadRechazados = 0;
  searchTerm: string = '';

  // ESTADOS DEL MODAL DE NOTIFICACIONES
  mostrarModal = false;
  tipoModal: 'cargando' | 'exito' | 'error' = 'cargando';
  mensajeModal = '';
  subtituloModal = '';

  // ESTADOS DEL MODAL DE AJUSTES
  mostrarModalAjustes = false;
  pestanaAjustes: 'servicios' | 'branding' | 'horarios' | 'feriados' = 'servicios';

  // DATOS FORMULARIO AJUSTES
  nuevoServicio = { nombre: '', descripcion: '', precio: null as number | null, duracion: 30, foto_url: '' };
  listaServicios: any[] = [];

  // ESTADO DE EDICIÓN DE SERVICIO
  servicioEditandoId: number | string | null = null;
  precioEditando: number | null = null;
  descripcionEditando: string = " ";
  fotoUrlEditando: string = '';

  datosLocal = {
    banner_url: '',
    logo_url: '',
    hora_apertura: '09:00',
    hora_cierre: '20:00',
    descanso_inicio: '13:00',
    descanso_fin: '14:00'
  };

  // ARCHIVOS DE IMAGEN Y PREVISUALIZACIONES
  archivoBanner: File | null = null;
  archivoLogo: File | null = null;
  previewBanner: string | null = null;
  previewLogo: string | null = null;
  isDraggingBanner = false;
  isDraggingLogo = false;
  isDraggingServicio = false;

  // --- BLOQUEO DE DÍAS DE LA SEMANA (RECURRENTE, columna "es_cerrado") ---
  diasSemanaOpciones = [
    { num: 1, nombre: 'Lunes' },
    { num: 2, nombre: 'Martes' },
    { num: 3, nombre: 'Miércoles' },
    { num: 4, nombre: 'Jueves' },
    { num: 5, nombre: 'Viernes' },
    { num: 6, nombre: 'Sábado' },
    { num: 0, nombre: 'Domingo' }
  ];
  diasCerrados: number[] = [];

  // --- EXCEPCIONES POR FECHA PUNTUAL (columna de texto "excepciones_horario", guardada como JSON) ---
  excepciones: ExcepcionHorario[] = [];
  fechaBloqueo: string = '';
  motivoBloqueo: string = '';
  cerradoTotalExcepcion: boolean = true;
  horaAperturaExcepcion: string = '';
  horaCierreExcepcion: string = '';

  private reservasSubscription: RealtimeChannel | null = null;

  async ngOnInit() {
    await this.cargarPerfilUsuario();
    await this.cargarTurnos();
    this.suscribirACambiosRealtime();
  }

  ngOnDestroy() {
    if (this.reservasSubscription) {
      this.supabaseService.removerCanal(this.reservasSubscription);
    }
  }

  suscribirACambiosRealtime() {
    this.reservasSubscription = this.supabaseService.escucharCambiosReservas(async () => {
      await this.cargarTurnos();
    });
  }

  private parsearExcepciones(raw: any): ExcepcionHorario[] {
    if (!raw) return [];
    try {
      const lista = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(lista)) return [];
      return lista.filter((e: any) => e && typeof e.fecha === 'string');
    } catch (err) {
      console.error('Error al leer excepciones_horario:', err);
      return [];
    }
  }

  private aplicarDatosLocal(local: any) {
    this.datosLocal.banner_url = local.banner_url || local.banner || '';
    this.datosLocal.logo_url = local.logo_url || local.logo || '';
    this.datosLocal.hora_apertura = (local.hora_apertura || '09:00').substring(0, 5);
    this.datosLocal.hora_cierre = (local.hora_cierre || '20:00').substring(0, 5);
    this.datosLocal.descanso_inicio = (local.descanso_inicio || '').substring(0, 5);
    this.datosLocal.descanso_fin = (local.descanso_fin || '').substring(0, 5);

    this.diasCerrados = Array.isArray(local.es_cerrado)
      ? local.es_cerrado.map((n: any) => Number(n))
      : [];

    const hoyStr = this.formatearFechaISO(new Date());
    this.excepciones = this.parsearExcepciones(local.excepciones_horario)
      .filter(e => e.fecha >= hoyStr)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  formatearFechaISO(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  async cargarPerfilUsuario() {
    const perfil = await this.supabaseService.obtenerPerfilUsuario();
    if (perfil) {
      if (perfil.nombre) {
        this.nombreUsuario = perfil.nombre;
        localStorage.setItem('usuario_nombre', perfil.nombre);
      }
      if (perfil.local_id !== undefined && perfil.local_id !== null) {
        this.localIdUsuario = Number(perfil.local_id);

        try {
          const local = await this.supabaseService.obtenerLocalPorId(this.localIdUsuario);
          if (local) {
            this.nombreBarberia = local.Nombre || local.nombre || '';
            this.aplicarDatosLocal(local);
          }
        } catch (err) {
          console.error('Error al obtener el nombre del local:', err);
        }
      }
      this.cdr.detectChanges();
    }
  }

  async cargarTurnos() {
    let dataRes: any[] | null = null;
    let errorRes: any = null;

    if (this.localIdUsuario !== null) {
      const res = await this.supabaseService.obtenerReservasPorLocal(this.localIdUsuario);
      dataRes = res.data;
      errorRes = res.error;
    } else {
      const res = await this.supabaseService.obtenerReservas();
      dataRes = res.data;
      errorRes = res.error;
    }

    if (!errorRes && dataRes) {
      this.turnosTotales = (dataRes as Reserva[]).sort((a, b) => {
        const fechaA = new Date(`${a.fecha}T${a.hora || '00:00'}`);
        const fechaB = new Date(`${b.fecha}T${b.hora || '00:00'}`);
        return fechaB.getTime() - fechaA.getTime();
      });

      this.actualizarContadores();
      this.aplicarFiltros();
      this.cdr.detectChanges();
    }
  }

  actualizarContadores() {
    this.cantidadEnProceso = this.turnosTotales.filter(
      t => t.estado === 'en_proceso' || t.estado === 'pendiente' || t.estado === 'confirmado'
    ).length;

    this.cantidadRechazados = this.turnosTotales.filter(t => t.estado === 'rechazado').length;
  }

  verVista(vista: 'turnos' | 'historial' | 'calendario') {
    this.vistaActual = vista;
    this.aplicarFiltros();
  }

  filtrarPorEstado(estado: string) {
    this.estadoFiltro = estado;
    this.aplicarFiltros();
  }

  aplicarFiltros() {
    const query = this.searchTerm.toLowerCase().trim();
    let baseTurnos: Reserva[] = [];

    if (this.estadoFiltro === 'en_proceso') {
      baseTurnos = this.turnosTotales.filter(
        t => t.estado === 'en_proceso' || t.estado === 'pendiente' || t.estado === 'confirmado'
      );
    } else {
      baseTurnos = this.turnosTotales.filter(t => t.estado === this.estadoFiltro);
    }

    if (query) {
      this.turnosFiltrados = baseTurnos.filter(t =>
        (t.nombre_cliente && t.nombre_cliente.toLowerCase().includes(query)) ||
        (t.servicio && t.servicio.toLowerCase().includes(query)) ||
        (t.telefono_cliente && t.telefono_cliente.includes(query))
      );
    } else {
      this.turnosFiltrados = baseTurnos;
    }

    const baseHistorial = this.turnosTotales.filter(t => t.estado === 'finalizado');
    if (query) {
      this.historialFiltrado = baseHistorial.filter(t =>
        (t.nombre_cliente && t.nombre_cliente.toLowerCase().includes(query)) ||
        (t.servicio && t.servicio.toLowerCase().includes(query)) ||
        (t.telefono_cliente && t.telefono_cliente.includes(query))
      );
    } else {
      this.historialFiltrado = baseHistorial;
    }
  }

  async cambiarEstadoTurno(idTurno: string | number, nuevoEstado: 'confirmado' | 'finalizado' | 'rechazado') {
    this.mostrarModal = true;
    this.tipoModal = 'cargando';

    if (nuevoEstado === 'confirmado') {
      this.mensajeModal = 'Confirmando turno...';
      this.subtituloModal = 'Actualizando el registro en la base de datos.';
    } else if (nuevoEstado === 'finalizado') {
      this.mensajeModal = 'Finalizando turno...';
      this.subtituloModal = 'Actualizando el registro en la base de datos.';
    } else {
      this.mensajeModal = 'Cancelando turno...';
      this.subtituloModal = 'Procesando el cambio de estado.';
    }
    this.cdr.detectChanges();

    try {
      const { error } = await this.supabaseService.actualizarEstadoReserva(idTurno, nuevoEstado);

      if (!error) {
        await this.cargarTurnos();

        this.tipoModal = 'exito';
        if (nuevoEstado === 'confirmado') {
          this.mensajeModal = '¡Turno confirmado!';
        } else if (nuevoEstado === 'finalizado') {
          this.mensajeModal = '¡Turno finalizado!';
        } else {
          this.mensajeModal = 'El turno fue cancelado/rechazado.';
        }

        this.cdr.detectChanges();

        setTimeout(() => {
          this.cerrarModal();
        }, 1200);

      } else {
        throw error;
      }
    } catch (err) {
      console.error('Error al cambiar el estado:', err);
      this.tipoModal = 'error';
      this.mensajeModal = 'Ocurrió un error';
      this.subtituloModal = 'No se pudo actualizar el estado del turno. Reintentá nuevamente.';
      this.cdr.detectChanges();
    }
  }

  cancelarTurno(idTurno: string | number) {
    this.cambiarEstadoTurno(idTurno, 'rechazado');
  }

  async confirmarYEnviarWhatsApp(turno: Reserva) {
    if (!turno.telefono_cliente) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Sin teléfono registrado';
      this.subtituloModal = 'Este cliente no tiene un número cargado para enviar WhatsApp.';
      this.cdr.detectChanges();
      return;
    }

    await this.cambiarEstadoTurno(turno.id, 'confirmado');

    let nombreLocal = this.nombreBarberia || 'Nuestra Barbería';
    if (turno.local_id && turno.local_id !== this.localIdUsuario) {
      try {
        const local = await this.supabaseService.obtenerLocalPorId(turno.local_id);
        if (local) {
          nombreLocal = local.Nombre || local.nombre || nombreLocal;
        }
      } catch (err) {
        console.error('Error al obtener nombre del local:', err);
      }
    }

    let telefono = turno.telefono_cliente.replace(/\D/g, '');
    if (!telefono.startsWith('54')) {
      telefono = `54${telefono}`;
    }

    const fechaFormateada = this.formatearFechaLarga(turno.fecha);

    const mensaje = `¡Hola *${turno.nombre_cliente || 'Cliente'}*! 👋\n\n` +
                    `Tu turno en *${nombreLocal}* ha sido *CONFIRMADO* 💈✂️\n\n` +
                    `📌 *Detalles de tu cita:*\n` +
                    `🔹 *Servicio:* ${turno.servicio || 'Corte'}\n` +
                    `📅 *Fecha:* ${fechaFormateada}\n` +
                    `⏰ *Hora:* ${turno.hora} hs\n\n` +
                    `📍 Te esperamos en nuestro local. Si necesitás reprogramar o cancelar, por favor avisanos con 24 horas de anticipación. ¡Muchas gracias!`;

    const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
  }

  // --- CONTROL DEL MODAL DE AJUSTES ---
  async abrirAjustes() {
    this.mostrarModalAjustes = true;
    this.pestanaAjustes = 'servicios';

    if (this.localIdUsuario) {
      await this.cargarServiciosDelLocal();
      try {
        const local = await this.supabaseService.obtenerLocalPorId(this.localIdUsuario);
        if (local) {
          this.aplicarDatosLocal(local);
        }
      } catch (err) {
        console.error('Error al cargar datos del local:', err);
      }
    }
    this.cdr.detectChanges();
  }

  async cargarServiciosDelLocal() {
    if (!this.localIdUsuario) return;
    const { data, error } = await this.supabaseService.obtenerServiciosPorLocal(this.localIdUsuario);
    if (!error && data) {
      this.listaServicios = data;
    }
  }

  cerrarAjustes() {
    this.mostrarModalAjustes = false;
    this.archivoBanner = null;
    this.archivoLogo = null;
    this.previewBanner = null;
    this.previewLogo = null;
    this.cancelarEdicionServicio();
    this.cdr.detectChanges();
  }

  cambiarPestanaAjustes(pestana: 'servicios' | 'branding' | 'horarios' | 'feriados') {
    this.pestanaAjustes = pestana;
  }

  // --- MÉTODOS DE MANEJO DE IMÁGENES (DRAG & DROP Y SELECCIÓN) ---
  onDragOver(event: DragEvent, tipo: TipoImagen) {
    event.preventDefault();
    event.stopPropagation();
    if (tipo === 'banner') this.isDraggingBanner = true;
    else if (tipo === 'logo') this.isDraggingLogo = true;
    else if (tipo === 'servicio' || tipo === 'servicioEdit') this.isDraggingServicio = true;
  }

  onDragLeave(event: DragEvent, tipo: TipoImagen) {
    event.preventDefault();
    event.stopPropagation();
    if (tipo === 'banner') this.isDraggingBanner = false;
    else if (tipo === 'logo') this.isDraggingLogo = false;
    else if (tipo === 'servicio' || tipo === 'servicioEdit') this.isDraggingServicio = false;
  }

  onDrop(event: DragEvent, tipo: TipoImagen) {
    event.preventDefault();
    event.stopPropagation();
    if (tipo === 'banner') this.isDraggingBanner = false;
    else if (tipo === 'logo') this.isDraggingLogo = false;
    else if (tipo === 'servicio' || tipo === 'servicioEdit') this.isDraggingServicio = false;

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      this.procesarArchivo(event.dataTransfer.files[0], tipo);
    }
  }

  onFileSeleccionado(event: Event, tipo: TipoImagen) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.procesarArchivo(input.files[0], tipo);
    }
  }

  onDragOverBanner(event: DragEvent) {
    this.onDragOver(event, 'banner');
  }

  onDragLeaveBanner(event: DragEvent) {
    this.onDragLeave(event, 'banner');
  }

  onDropBanner(event: DragEvent) {
    this.onDrop(event, 'banner');
  }

  onFileSelectedBanner(event: Event) {
    this.onFileSeleccionado(event, 'banner');
  }

  onDragOverLogo(event: DragEvent) {
    this.onDragOver(event, 'logo');
  }

  onDragLeaveLogo(event: DragEvent) {
    this.onDragLeave(event, 'logo');
  }

  onDropLogo(event: DragEvent) {
    this.onDrop(event, 'logo');
  }

  onFileSelectedLogo(event: Event) {
    this.onFileSeleccionado(event, 'logo');
  }

  procesarArchivo(file: File, tipo: TipoImagen) {
    if (!file.type.startsWith('image/')) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Archivo inválido';
      this.subtituloModal = 'Por favor, seleccioná un archivo de imagen válido.';
      this.cdr.detectChanges();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (tipo === 'banner') {
        this.archivoBanner = file;
        this.previewBanner = result;
        this.datosLocal.banner_url = result;
      } else if (tipo === 'logo') {
        this.archivoLogo = file;
        this.previewLogo = result;
        this.datosLocal.logo_url = result;
      } else if (tipo === 'servicio') {
        this.nuevoServicio.foto_url = result;
      } else if (tipo === 'servicioEdit') {
        this.fotoUrlEditando = result;
      }
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  async guardarNuevoServicio() {
    if (!this.localIdUsuario) return;

    if (!this.nuevoServicio.nombre.trim()) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Campo incompleto';
      this.subtituloModal = 'Debes ingresar un nombre para el servicio.';
      this.cdr.detectChanges();
      return;
    }

    try {
      const { error } = await this.supabaseService.guardarServicio({
        local_id: this.localIdUsuario,
        nombre: this.nuevoServicio.nombre.trim(),
        descripcion: this.nuevoServicio.descripcion.trim() || undefined,
        precio: this.nuevoServicio.precio,
        duracion: this.nuevoServicio.duracion || 30,
        foto_url: this.nuevoServicio.foto_url.trim() || undefined
      });

      if (error) throw error;

      this.nuevoServicio = { nombre: '', descripcion: '', precio: null, duracion: 30, foto_url: '' };
      await this.cargarServiciosDelLocal();
      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('Error al agregar el servicio:', err);
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Error al agregar servicio';
      this.subtituloModal = err.message || 'No se pudo registrar el nuevo servicio.';
      this.cdr.detectChanges();
    }
  }

  iniciarEdicionServicio(servicio: any) {
    this.servicioEditandoId = servicio.id;
    this.precioEditando = servicio.precio;
    this.descripcionEditando = servicio.descripcion || '';
    this.fotoUrlEditando = servicio.foto_url || '';
    this.cdr.detectChanges();
  }

  cancelarEdicionServicio() {
    this.servicioEditandoId = null;
    this.precioEditando = null;
    this.descripcionEditando = '';
    this.fotoUrlEditando = '';
    this.cdr.detectChanges();
  }

  async editarPrecioServicio(servicio: any) {
    if (!servicio || !servicio.id) return;
    if (this.servicioEditandoId !== servicio.id) {
      this.iniciarEdicionServicio(servicio);
      return;
    }
    const precioAGuardar = this.precioEditando !== null ? this.precioEditando : servicio.precio;

    try {
      const { error } = await this.supabaseService.actualizarServicio(servicio.id, {
        precio: precioAGuardar,
        descripcion: this.descripcionEditando.trim() || undefined,
        foto_url: this.fotoUrlEditando.trim() || undefined
      });
      if (error) throw error;

      this.cancelarEdicionServicio();
      await this.cargarServiciosDelLocal();
      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('Error al actualizar el servicio:', err);
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Error al actualizar';
      this.subtituloModal = 'No se pudo actualizar el servicio.';
      this.cdr.detectChanges();
    }
  }

  async eliminarServicio(idServicio: number | string) {
    try {
      const idNumerico = Number(idServicio);

      if (isNaN(idNumerico)) {
        this.mostrarModal = true;
        this.tipoModal = 'error';
        this.mensajeModal = 'ID no válido';
        this.subtituloModal = 'El ID del servicio no es válido.';
        this.cdr.detectChanges();
        return;
      }

      const { error } = await this.supabaseService.eliminarServicio(idNumerico);
      if (error) throw error;

      await this.cargarServiciosDelLocal();
      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('Error al eliminar servicio:', err);
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Error al eliminar';
      this.subtituloModal = 'No se pudo eliminar el servicio.';
      this.cdr.detectChanges();
    }
  }

  // --- DÍAS CERRADOS DE LA SEMANA (RECURRENTE, columna "es_cerrado") ---
  toggleDiaCerrado(num: number) {
    const idx = this.diasCerrados.indexOf(num);
    if (idx === -1) {
      this.diasCerrados.push(num);
    } else {
      this.diasCerrados.splice(idx, 1);
    }
  }

  estaDiaCerrado(num: number): boolean {
    return this.diasCerrados.includes(num);
  }

  async guardarExcepcionFecha() {
    if (!this.localIdUsuario) return;

    if (!this.fechaBloqueo) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Falta la fecha';
      this.subtituloModal = 'Seleccioná la fecha que querés bloquear o modificar.';
      this.cdr.detectChanges();
      return;
    }

    if (!this.cerradoTotalExcepcion) {
      if (!this.horaAperturaExcepcion || !this.horaCierreExcepcion || this.horaAperturaExcepcion >= this.horaCierreExcepcion) {
        this.mostrarModal = true;
        this.tipoModal = 'error';
        this.mensajeModal = 'Horario inválido';
        this.subtituloModal = 'La hora de apertura debe ser anterior a la de cierre.';
        this.cdr.detectChanges();
        return;
      }
    }

    const nuevaExcepcion: ExcepcionHorario = {
      fecha: this.fechaBloqueo,
      es_cerrado: this.cerradoTotalExcepcion,
      hora_apertura: this.cerradoTotalExcepcion ? null : this.horaAperturaExcepcion,
      hora_cierre: this.cerradoTotalExcepcion ? null : this.horaCierreExcepcion,
      motivo: this.motivoBloqueo?.trim() || null
    };

    const listaActualizada = [
      ...this.excepciones.filter(e => e.fecha !== this.fechaBloqueo),
      nuevaExcepcion
    ].sort((a, b) => a.fecha.localeCompare(b.fecha));

    try {
      const { data, error } = await this.supabaseService.actualizarLocal(this.localIdUsuario, {
        excepciones_horario: JSON.stringify(listaActualizada)
      });

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se actualizó ninguna fila (revisá permisos sobre "locales").');
      }

      this.excepciones = listaActualizada;
      this.fechaBloqueo = '';
      this.motivoBloqueo = '';
      this.cerradoTotalExcepcion = true;
      this.horaAperturaExcepcion = '';
      this.horaCierreExcepcion = '';
      this.cdr.detectChanges();

    } catch (err: any) {
      console.error('Error al guardar excepción:', err);
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Error al guardar';
      this.subtituloModal = err.message || 'No se pudo guardar la excepción de horario.';
      this.cdr.detectChanges();
    }
  }

  async eliminarExcepcionFecha(fecha: string) {
    if (!this.localIdUsuario) return;

    try {
      const listaActualizada = this.excepciones.filter(e => e.fecha !== fecha);

      const { data, error } = await this.supabaseService.actualizarLocal(this.localIdUsuario, {
        excepciones_horario: JSON.stringify(listaActualizada)
      });

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se actualizó ninguna fila (revisá permisos sobre "locales").');
      }

      this.excepciones = listaActualizada;
      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('Error al eliminar la excepción:', err);
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Error al eliminar';
      this.subtituloModal = 'No se pudo eliminar la excepción de horario.';
      this.cdr.detectChanges();
    }
  }

  async guardarAjustes() {
    if (!this.localIdUsuario) {
      this.cerrarAjustes();
      return;
    }

    if (this.pestanaAjustes === 'horarios') {
      const { hora_apertura, hora_cierre, descanso_inicio, descanso_fin } = this.datosLocal;

      if (!hora_apertura || !hora_cierre || hora_apertura >= hora_cierre) {
        this.mostrarModal = true;
        this.tipoModal = 'error';
        this.mensajeModal = 'Horario inválido';
        this.subtituloModal = 'La hora de apertura debe ser anterior a la de cierre.';
        this.cdr.detectChanges();
        return;
      }

      const descansoIncompleto =
        (descanso_inicio && !descanso_fin) || (!descanso_inicio && descanso_fin);
      const descansoInvertido =
        descanso_inicio && descanso_fin && descanso_inicio >= descanso_fin;

      if (descansoIncompleto || descansoInvertido) {
        this.mostrarModal = true;
        this.tipoModal = 'error';
        this.mensajeModal = 'Descanso inválido';
        this.subtituloModal = 'Completá inicio y fin del descanso (inicio menor que fin), o dejá ambos vacíos.';
        this.cdr.detectChanges();
        return;
      }
    }

    this.mostrarModalAjustes = false;
    this.mostrarModal = true;
    this.tipoModal = 'cargando';
    this.mensajeModal = 'Guardando cambios...';
    this.subtituloModal = 'Actualizando la información en Supabase.';
    this.cdr.detectChanges();

    try {
      if (this.pestanaAjustes === 'branding') {
        let bannerFinal = this.datosLocal.banner_url;
        let logoFinal = this.datosLocal.logo_url;

        if (this.archivoBanner) {
          const urlSubida = await this.supabaseService.subirImagen(this.archivoBanner, 'barberia-media');
          if (urlSubida) bannerFinal = urlSubida;
        }

        if (this.archivoLogo) {
          const urlSubida = await this.supabaseService.subirImagen(this.archivoLogo, 'barberia-media');
          if (urlSubida) logoFinal = urlSubida;
        }

        const { data, error } = await this.supabaseService.actualizarLocal(this.localIdUsuario, {
          banner_url: bannerFinal,
          logo_url: logoFinal
        });

        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('No se actualizó ninguna fila (revisá permisos/políticas sobre "locales").');
        }

        this.datosLocal.banner_url = bannerFinal;
        this.datosLocal.logo_url = logoFinal;
        this.archivoBanner = null;
        this.archivoLogo = null;
      } else if (this.pestanaAjustes === 'horarios') {
        const { data, error } = await this.supabaseService.actualizarLocal(this.localIdUsuario, {
          hora_apertura: this.datosLocal.hora_apertura,
          hora_cierre: this.datosLocal.hora_cierre,
          descanso_inicio: this.datosLocal.descanso_inicio || null,
          descanso_fin: this.datosLocal.descanso_fin || null
        });
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('No se actualizó ninguna fila (revisá permisos/políticas sobre "locales").');
        }
      } else if (this.pestanaAjustes === 'feriados') {
        const { data, error } = await this.supabaseService.actualizarLocal(this.localIdUsuario, {
          es_cerrado: this.diasCerrados
        });

        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('No se actualizó ninguna fila (revisá permisos/políticas sobre "locales").');
        }
        const filaActualizada = data[0];
        this.diasCerrados = Array.isArray(filaActualizada.es_cerrado)
          ? filaActualizada.es_cerrado.map((n: any) => Number(n))
          : this.diasCerrados;
      }

      this.tipoModal = 'exito';
      this.mensajeModal = '¡Ajustes guardados!';
      this.subtituloModal = 'Los cambios se registraron correctamente.';
      this.cdr.detectChanges();

      setTimeout(() => this.cerrarModal(), 1500);

    } catch (err: any) {
      console.error('Error al guardar ajustes:', err);
      this.tipoModal = 'error';
      this.mensajeModal = 'Error al guardar';
      this.subtituloModal = err.message || 'No se pudieron actualizar los datos.';
      this.cdr.detectChanges();
    }
  }

  formatearFechaLatina(fechaStr: string): string {
    if (!fechaStr) return '';
    const partes = fechaStr.split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return fechaStr;
  }

  formatearFechaLarga(fechaStr: string): string {
    if (!fechaStr) return '';
    const fecha = new Date(fechaStr.includes('T') ? fechaStr : `${fechaStr}T00:00:00`);
    if (isNaN(fecha.getTime())) return fechaStr;

    const opciones: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    };

    const texto = fecha.toLocaleDateString('es-ES', opciones);
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  cerrarModal() {
    this.mostrarModal = false;
    this.cdr.detectChanges();
  }

  cerrarSesion() {
    localStorage.removeItem('usuario_nombre');
    this.supabaseService.logout();
    this.router.navigate(['/login']);
  }

  navegarA(ruta: string) {
    this.router.navigate([`/${ruta}`]);
  }
}