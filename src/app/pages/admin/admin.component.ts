import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectorRef
} from '@angular/core';
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

export interface ExcepcionHorario {
  fecha: string;
  es_cerrado: boolean;
  hora_apertura: string | null;
  hora_cierre: string | null;
  motivo: string | null;
}

export type TipoImagen = 'banner' | 'logo' | 'servicio' | 'servicioEdit';

interface ServicioEstadistica {
  nombre: string;
  cantidad: number;
  porcentaje: number;
}

interface EstadoEstadistica {
  nombre: string;
  cantidad: number;
  color: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit, OnDestroy {
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  nombreUsuario: string = localStorage.getItem('usuario_nombre') || 'Admin';
  cerrandoSesion = false;
  nombreBarberia = '';
  localIdUsuario: number | null = null;

  vistaActual: 'turnos' | 'historial' | 'calendario' | 'informes' = 'turnos';

  turnosTotales: Reserva[] = [];
  turnosFiltrados: Reserva[] = [];
  historialFiltrado: Reserva[] = [];

  estadoFiltro = 'en_proceso';
  cantidadEnProceso = 0;
  cantidadRechazados = 0;
  searchTerm = '';

  // Modal de notificaciones
  mostrarModal = false;
  tipoModal: 'cargando' | 'exito' | 'error' = 'cargando';
  mensajeModal = '';
  subtituloModal = '';

  // Modal de ajustes
  mostrarModalAjustes = false;
  pestanaAjustes: 'servicios' | 'branding' | 'horarios' | 'feriados' = 'servicios';

  // Formulario de servicios
  nuevoServicio = {
    nombre: '',
    descripcion: '',
    precio: null as number | null,
    duracion: 30,
    foto_url: ''
  };

  listaServicios: any[] = [];

  // Edición de servicios
  servicioEditandoId: number | string | null = null;
  precioEditando: number | null = null;
  descripcionEditando = '';
  fotoUrlEditando = '';
  nombreEditando = '';
  duracionEditando: number | null = null;

  // Control de operaciones para evitar dobles clics y estados trabados
  guardandoServicio = false;
  eliminandoServicioId: number | string | null = null;
  archivoServicioEditando: File | null = null;

  // Datos del local
  datosLocal = {
    banner_url: '',
    logo_url: '',
    hora_apertura: '09:00',
    hora_cierre: '20:00',
    descanso_inicio: '13:00',
    descanso_fin: '14:00'
  };

  // Archivos y previsualizaciones
  archivoBanner: File | null = null;
  archivoLogo: File | null = null;
  previewBanner: string | null = null;
  previewLogo: string | null = null;
  isDraggingBanner = false;
  isDraggingLogo = false;
  isDraggingServicio = false;

  // Días de cierre semanales
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

  // Excepciones por fecha
  excepciones: ExcepcionHorario[] = [];
  fechaBloqueo = '';
  motivoBloqueo = '';
  cerradoTotalExcepcion = true;
  horaAperturaExcepcion = '';
  horaCierreExcepcion = '';

  private reservasSubscription: RealtimeChannel | null = null;

  // ---------------------------------------------------------
  // INFORMES Y ESTADÍSTICAS
  // ---------------------------------------------------------

  get totalFinalizados(): number {
    return this.turnosTotales.filter(t => t.estado === 'finalizado').length;
  }

  get totalPendientes(): number {
    return this.turnosTotales.filter(t => t.estado === 'pendiente').length;
  }

  get totalConfirmados(): number {
    return this.turnosTotales.filter(t => t.estado === 'confirmado').length;
  }

  get totalEnProceso(): number {
    return this.turnosTotales.filter(t => t.estado === 'en_proceso').length;
  }

  get tasaFinalizacion(): number {
    if (this.turnosTotales.length === 0) return 0;

    return Math.round(
      (this.totalFinalizados / this.turnosTotales.length) * 100
    );
  }

  get facturacionEstimada(): number {
    const finalizados = this.turnosTotales.filter(
      t => t.estado === 'finalizado'
    );

    return finalizados.reduce((total, turno) => {
      return total + this.precioServicio(turno.servicio);
    }, 0);
  }

  get topServicios(): ServicioEstadistica[] {
    const conteo = new Map<string, number>();

    this.turnosTotales
      .filter(t => t.estado !== 'rechazado')
      .forEach(turno => {
        const nombre = (turno.servicio || 'Servicio sin especificar').trim();
        conteo.set(nombre, (conteo.get(nombre) || 0) + 1);
      });

    const lista = Array.from(conteo.entries())
      .map(([nombre, cantidad]) => ({
        nombre,
        cantidad,
        porcentaje: 0
      }))
      .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre))
      .slice(0, 3);

    const maximo = lista.length > 0 ? lista[0].cantidad : 0;

    return lista.map(servicio => ({
      ...servicio,
      porcentaje: maximo > 0
        ? Math.round((servicio.cantidad / maximo) * 100)
        : 0
    }));
  }

  get distribucionEstados(): EstadoEstadistica[] {
    return [
      {
        nombre: 'Finalizados',
        cantidad: this.totalFinalizados,
        color: '#8bba9b'
      },
      {
        nombre: 'Pendientes',
        cantidad: this.totalPendientes,
        color: '#e8bd78'
      },
      {
        nombre: 'Confirmados',
        cantidad: this.totalConfirmados,
        color: '#c18aa7'
      },
      {
        nombre: 'En proceso',
        cantidad: this.totalEnProceso,
        color: '#a8a0d2'
      },
      {
        nombre: 'Rechazados',
        cantidad: this.cantidadRechazados,
        color: '#d98989'
      }
    ];
  }

  get graficoCircular(): string {
    const total = this.turnosTotales.length;

    if (total === 0) {
      return 'conic-gradient(#eee7e9 0% 100%)';
    }

    let acumulado = 0;

    const segmentos = this.distribucionEstados
      .filter(estado => estado.cantidad > 0)
      .map(estado => {
        const inicio = acumulado;
        acumulado += (estado.cantidad / total) * 100;

        return `${estado.color} ${inicio}% ${acumulado}%`;
      });

    if (segmentos.length === 0) {
      return 'conic-gradient(#eee7e9 0% 100%)';
    }

    return `conic-gradient(${segmentos.join(', ')})`;
  }

  porcentajeEstado(cantidad: number): number {
    if (this.turnosTotales.length === 0) return 0;

    return Math.round((cantidad / this.turnosTotales.length) * 100);
  }

  precioServicio(nombre?: string | null): number {
    if (!nombre) return 0;

    const nombreBuscado = nombre.trim().toLocaleLowerCase();

    const servicio = this.listaServicios.find(s =>
      String(s.nombre || '').trim().toLocaleLowerCase() === nombreBuscado
    );

    const precio = Number(servicio?.precio);

    return Number.isFinite(precio) && precio > 0 ? precio : 0;
  }

  textoEstado(estado: Reserva['estado']): string {
    const etiquetas: Record<Reserva['estado'], string> = {
      pendiente: 'Pendiente',
      confirmado: 'Confirmado',
      en_proceso: 'En proceso',
      finalizado: 'Finalizado',
      rechazado: 'Rechazado'
    };

    return etiquetas[estado] || estado;
  }

  // ---------------------------------------------------------
  // INICIO Y ACTUALIZACIÓN EN TIEMPO REAL
  // ---------------------------------------------------------

  async ngOnInit(): Promise<void> {
    await this.cargarPerfilUsuario();
    await this.cargarTurnos();

    if (this.localIdUsuario !== null) {
      await this.cargarServiciosDelLocal();
    }

    this.suscribirACambiosRealtime();
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    if (this.reservasSubscription) {
      this.supabaseService.removerCanal(this.reservasSubscription);
      this.reservasSubscription = null;
    }
  }

  suscribirACambiosRealtime(): void {
    this.reservasSubscription =
      this.supabaseService.escucharCambiosReservas(async () => {
        await this.cargarTurnos();
      });
  }

  private parsearExcepciones(raw: any): ExcepcionHorario[] {
    if (!raw) return [];

    try {
      const lista = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (!Array.isArray(lista)) return [];

      return lista.filter(
        (e: any) => e && typeof e.fecha === 'string'
      );
    } catch (err) {
      console.error('Error al leer excepciones_horario:', err);
      return [];
    }
  }

  private aplicarDatosLocal(local: any): void {
    this.datosLocal.banner_url = local.banner_url || local.banner || '';
    this.datosLocal.logo_url = local.logo_url || local.logo || '';
    this.datosLocal.hora_apertura =
      (local.hora_apertura || '09:00').substring(0, 5);
    this.datosLocal.hora_cierre =
      (local.hora_cierre || '20:00').substring(0, 5);
    this.datosLocal.descanso_inicio =
      (local.descanso_inicio || '').substring(0, 5);
    this.datosLocal.descanso_fin =
      (local.descanso_fin || '').substring(0, 5);

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

  async cargarPerfilUsuario(): Promise<void> {
    const perfil = await this.supabaseService.obtenerPerfilUsuario();

    if (!perfil) return;

    if (perfil.nombre) {
      this.nombreUsuario = perfil.nombre;
      localStorage.setItem('usuario_nombre', perfil.nombre);
    }

    if (perfil.local_id !== undefined && perfil.local_id !== null) {
      this.localIdUsuario = Number(perfil.local_id);

      try {
        const local = await this.supabaseService.obtenerLocalPorId(
          this.localIdUsuario
        );

        if (local) {
          this.nombreBarberia = local.Nombre || local.nombre || '';
          this.aplicarDatosLocal(local);
        }
      } catch (err) {
        console.error('Error al obtener los datos del local:', err);
      }
    }

    this.cdr.detectChanges();
  }

  async cargarTurnos(): Promise<void> {
    let dataRes: any[] | null = null;
    let errorRes: any = null;

    if (this.localIdUsuario !== null) {
      const res = await this.supabaseService.obtenerReservasPorLocal(
        this.localIdUsuario
      );

      dataRes = res.data;
      errorRes = res.error;
    } else {
      const res = await this.supabaseService.obtenerReservas();

      dataRes = res.data;
      errorRes = res.error;
    }

    if (errorRes) {
      console.error('Error al cargar los turnos:', errorRes);
      return;
    }

    if (dataRes) {
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

  actualizarContadores(): void {
    this.cantidadEnProceso = this.turnosTotales.filter(
      t =>
        t.estado === 'en_proceso' ||
        t.estado === 'pendiente' ||
        t.estado === 'confirmado'
    ).length;

    this.cantidadRechazados = this.turnosTotales.filter(
      t => t.estado === 'rechazado'
    ).length;
  }

  // ---------------------------------------------------------
  // VISTAS, FILTROS E HISTORIAL
  // ---------------------------------------------------------

  verVista(vista: 'turnos' | 'historial' | 'calendario' | 'informes'): void {
    this.vistaActual = vista;
    this.aplicarFiltros();

    if (
      vista === 'informes' &&
      this.localIdUsuario !== null &&
      this.listaServicios.length === 0
    ) {
      void this.cargarServiciosDelLocal();
    }
  }

  filtrarPorEstado(estado: string): void {
    this.estadoFiltro = estado;
    this.aplicarFiltros();
  }

  aplicarFiltros(): void {
    const query = this.searchTerm.toLowerCase().trim();
    let baseTurnos: Reserva[] = [];

    if (this.estadoFiltro === 'en_proceso') {
      baseTurnos = this.turnosTotales.filter(
        t =>
          t.estado === 'en_proceso' ||
          t.estado === 'pendiente' ||
          t.estado === 'confirmado'
      );
    } else {
      baseTurnos = this.turnosTotales.filter(
        t => t.estado === this.estadoFiltro
      );
    }

    if (query) {
      this.turnosFiltrados = baseTurnos.filter(t =>
        (t.nombre_cliente || '').toLowerCase().includes(query) ||
        (t.servicio || '').toLowerCase().includes(query) ||
        (t.telefono_cliente || '').includes(query)
      );
    } else {
      this.turnosFiltrados = baseTurnos;
    }

    const baseHistorial = this.turnosTotales.filter(
      t => t.estado === 'finalizado'
    );

    if (query) {
      this.historialFiltrado = baseHistorial.filter(t =>
        (t.nombre_cliente || '').toLowerCase().includes(query) ||
        (t.servicio || '').toLowerCase().includes(query) ||
        (t.telefono_cliente || '').includes(query)
      );
    } else {
      this.historialFiltrado = baseHistorial;
    }
  }

  // ---------------------------------------------------------
  // CAMBIAR ESTADO DE UN TURNO
  // ---------------------------------------------------------

  async cambiarEstadoTurno(
    idTurno: string | number,
    nuevoEstado: 'confirmado' | 'finalizado' | 'rechazado'
  ): Promise<void> {
    this.mostrarModal = true;
    this.tipoModal = 'cargando';

    if (nuevoEstado === 'confirmado') {
      this.mensajeModal = 'Confirmando turno...';
      this.subtituloModal = 'Actualizando el registro en la base de datos.';
    } else if (nuevoEstado === 'finalizado') {
      this.mensajeModal = 'Finalizando turno...';
      this.subtituloModal = 'Actualizando el registro en la base de datos.';
    } else {
      this.mensajeModal = 'Rechazando turno...';
      this.subtituloModal = 'Actualizando el registro en la base de datos.';
    }

    this.cdr.detectChanges();

    try {
      const { error } =
        await this.supabaseService.actualizarEstadoReserva(
          idTurno,
          nuevoEstado
        );

      if (error) throw error;

      await this.cargarTurnos();

      this.tipoModal = 'exito';

      if (nuevoEstado === 'confirmado') {
        this.mensajeModal = '¡Turno confirmado!';
        this.subtituloModal = 'El estado del turno fue actualizado.';
      } else if (nuevoEstado === 'finalizado') {
        this.mensajeModal = '¡Turno finalizado!';
        this.subtituloModal = 'La cita se registró como finalizada.';
      } else {
        this.mensajeModal = 'Turno rechazado';
        this.subtituloModal = 'La reserva se marcó como rechazada.';
      }

      this.cdr.detectChanges();

      setTimeout(() => this.cerrarModal(), 1200);
    } catch (err) {
      console.error('Error al cambiar el estado:', err);

      this.tipoModal = 'error';
      this.mensajeModal = 'Ocurrió un error';
      this.subtituloModal =
        'No se pudo actualizar el estado del turno. Reintentá nuevamente.';

      this.cdr.detectChanges();
    }
  }

  cancelarTurno(idTurno: string | number): void {
    this.cambiarEstadoTurno(idTurno, 'rechazado');
  }

  async confirmarYEnviarWhatsApp(turno: Reserva): Promise<void> {
    if (!turno.telefono_cliente) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Sin teléfono registrado';
      this.subtituloModal =
        'Este cliente no tiene un número cargado para enviar WhatsApp.';

      this.cdr.detectChanges();
      return;
    }

    await this.cambiarEstadoTurno(turno.id, 'confirmado');

    const nombreLocal = this.nombreBarberia || 'Nuestro local';

    let telefono = turno.telefono_cliente.replace(/\D/g, '');

    if (!telefono.startsWith('54')) {
      telefono = `54${telefono}`;
    }

    const fechaFormateada = this.formatearFechaLarga(turno.fecha);

    const mensaje =
      `¡Hola *${turno.nombre_cliente || 'Cliente'}*! 👋\n\n` +
      `Tu turno en *${nombreLocal}* ha sido *CONFIRMADO*.\n\n` +
      `Servicio: ${turno.servicio || 'General'}\n` +
      `Fecha: ${fechaFormateada}\n` +
      `Hora: ${turno.hora} hs\n\n` +
      '¡Muchas gracias!';

    window.open(
      `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`,
      '_blank'
    );
  }

  // ---------------------------------------------------------
  // AJUSTES DEL LOCAL
  // ---------------------------------------------------------

  async abrirAjustes(): Promise<void> {
    this.mostrarModalAjustes = true;
    this.pestanaAjustes = 'servicios';

    this.cdr.detectChanges();

    if (this.localIdUsuario !== null) {
      await this.cargarServiciosDelLocal();

      try {
        const local = await this.supabaseService.obtenerLocalPorId(
          this.localIdUsuario
        );

        if (local) this.aplicarDatosLocal(local);
      } catch (err) {
        console.error('Error al cargar datos del local:', err);
      }
    }

    this.cdr.detectChanges();
  }

  async cargarServiciosDelLocal(): Promise<void> {
    if (this.localIdUsuario === null) return;

    try {
      const { data, error } =
        await this.supabaseService.obtenerServiciosPorLocal(
          this.localIdUsuario
        );

      if (error) throw error;

      if (data) {
        this.listaServicios = [...data];
      }

      this.cdr.detectChanges();
    } catch (err) {
      console.error('Error al cargar servicios:', err);
      this.cdr.detectChanges();
    }
  }

  cerrarAjustes(): void {
    this.mostrarModalAjustes = false;

    this.archivoBanner = null;
    this.archivoLogo = null;
    this.previewBanner = null;
    this.previewLogo = null;

    this.cancelarEdicionServicio();
    this.cdr.detectChanges();
  }

  cambiarPestanaAjustes(
    pestana: 'servicios' | 'branding' | 'horarios' | 'feriados'
  ): void {
    this.pestanaAjustes = pestana;
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------
  // IMÁGENES: ARRASTRAR, SOLTAR Y SELECCIONAR
  // ---------------------------------------------------------

  onDragOver(event: DragEvent, tipo: TipoImagen): void {
    event.preventDefault();
    event.stopPropagation();

    if (tipo === 'banner') this.isDraggingBanner = true;
    else if (tipo === 'logo') this.isDraggingLogo = true;
    else this.isDraggingServicio = true;
  }

  onDragLeave(event: DragEvent, tipo: TipoImagen): void {
    event.preventDefault();
    event.stopPropagation();

    if (tipo === 'banner') this.isDraggingBanner = false;
    else if (tipo === 'logo') this.isDraggingLogo = false;
    else this.isDraggingServicio = false;
  }

  onDrop(event: DragEvent, tipo: TipoImagen): void {
    event.preventDefault();
    event.stopPropagation();

    if (tipo === 'banner') this.isDraggingBanner = false;
    else if (tipo === 'logo') this.isDraggingLogo = false;
    else this.isDraggingServicio = false;

    if (event.dataTransfer?.files.length) {
      this.procesarArchivo(event.dataTransfer.files[0], tipo);
    }
  }

  onFileSeleccionado(event: Event, tipo: TipoImagen): void {
    const input = event.target as HTMLInputElement;

    if (input.files?.length) {
      this.procesarArchivo(input.files[0], tipo);
    }

    input.value = '';
  }

  onDragOverBanner(event: DragEvent): void {
    this.onDragOver(event, 'banner');
  }

  onDragLeaveBanner(event: DragEvent): void {
    this.onDragLeave(event, 'banner');
  }

  onDropBanner(event: DragEvent): void {
    this.onDrop(event, 'banner');
  }

  onFileSelectedBanner(event: Event): void {
    this.onFileSeleccionado(event, 'banner');
  }

  onDragOverLogo(event: DragEvent): void {
    this.onDragOver(event, 'logo');
  }

  onDragLeaveLogo(event: DragEvent): void {
    this.onDragLeave(event, 'logo');
  }

  onDropLogo(event: DragEvent): void {
    this.onDrop(event, 'logo');
  }

  onFileSelectedLogo(event: Event): void {
    this.onFileSeleccionado(event, 'logo');
  }

  procesarArchivo(file: File, tipo: TipoImagen): void {
    if (!file.type.startsWith('image/')) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Archivo inválido';
      this.subtituloModal =
        'Por favor, seleccioná un archivo de imagen válido.';

      this.cdr.detectChanges();
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'Imagen demasiado grande';
      this.subtituloModal =
        'Elegí una imagen de hasta 5 MB.';

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
        this.archivoServicioEditando = file;
        this.fotoUrlEditando = result;
      }

      this.cdr.detectChanges();
    };

    reader.onerror = () => {
      this.mostrarModal = true;
      this.tipoModal = 'error';
      this.mensajeModal = 'No se pudo leer la imagen';
      this.subtituloModal =
        'Intentá nuevamente con otra imagen.';

      this.cdr.detectChanges();
    };

    reader.readAsDataURL(file);
  }

  // ---------------------------------------------------------
  // CREAR, EDITAR Y ELIMINAR SERVICIOS
  // ---------------------------------------------------------

  async guardarNuevoServicio(): Promise<void> {
    if (this.guardandoServicio) return;

    if (this.localIdUsuario === null) {
      this.mostrarError('No se encontró el local', 'Volvé a iniciar sesión e intentá nuevamente.');
      return;
    }

    const nombre = this.nuevoServicio.nombre.trim();

    if (!nombre) {
      this.mostrarError('Campo incompleto', 'Debés ingresar un nombre para el servicio.');
      return;
    }

    if (
      this.nuevoServicio.precio !== null &&
      (!Number.isFinite(Number(this.nuevoServicio.precio)) ||
        Number(this.nuevoServicio.precio) < 0)
    ) {
      this.mostrarError('Precio inválido', 'Ingresá un precio válido.');
      return;
    }

    this.guardandoServicio = true;
    this.cdr.detectChanges();

    try {
      let fotoFinal = this.nuevoServicio.foto_url.trim();

      const { error } = await this.supabaseService.guardarServicio({
        local_id: this.localIdUsuario,
        nombre,
        descripcion: this.nuevoServicio.descripcion.trim() || undefined,
        precio: this.nuevoServicio.precio,
        duracion: Number(this.nuevoServicio.duracion) || 30,
        foto_url: fotoFinal || undefined
      });

      if (error) throw error;

      this.nuevoServicio = {
        nombre: '',
        descripcion: '',
        precio: null,
        duracion: 30,
        foto_url: ''
      };

      await this.cargarServiciosDelLocal();
      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('Error al agregar el servicio:', err);

      this.mostrarError(
        'Error al agregar servicio',
        err?.message || 'No se pudo registrar el nuevo servicio.'
      );
    } finally {
      this.guardandoServicio = false;
      this.cdr.detectChanges();
    }
  }

  iniciarEdicionServicio(servicio: any): void {
    if (!servicio) return;

    if (this.guardandoServicio || this.eliminandoServicioId !== null) return;

    this.servicioEditandoId = servicio.id;

    this.nombreEditando = String(servicio.nombre ?? '');
    this.precioEditando =
      servicio.precio === null || servicio.precio === undefined
        ? null
        : Number(servicio.precio);
    this.descripcionEditando = String(servicio.descripcion ?? '');
    this.duracionEditando =
      servicio.duracion === null || servicio.duracion === undefined
        ? 30
        : Number(servicio.duracion);

    this.fotoUrlEditando = String(servicio.foto_url ?? '');
    this.archivoServicioEditando = null;

    this.cdr.detectChanges();
  }

  cancelarEdicionServicio(): void {
    this.servicioEditandoId = null;
    this.precioEditando = null;
    this.descripcionEditando = '';
    this.fotoUrlEditando = '';
    this.nombreEditando = '';
    this.duracionEditando = null;
    this.archivoServicioEditando = null;

    this.cdr.detectChanges();
  }

  async editarPrecioServicio(servicio: any): Promise<void> {
    if (!servicio?.id || this.guardandoServicio) return;

    if (this.servicioEditandoId !== servicio.id) {
      this.iniciarEdicionServicio(servicio);
      return;
    }

    if (this.localIdUsuario === null) {
      this.mostrarError('No se encontró el local', 'Volvé a iniciar sesión e intentá nuevamente.');
      return;
    }

    const precioAGuardar =
      this.precioEditando === null || this.precioEditando === undefined
        ? servicio.precio
        : Number(this.precioEditando);

    if (
      precioAGuardar !== null &&
      precioAGuardar !== undefined &&
      (!Number.isFinite(Number(precioAGuardar)) || Number(precioAGuardar) < 0)
    ) {
      this.mostrarError('Precio inválido', 'Ingresá un precio válido.');
      return;
    }

    const duracionAGuardar =
      this.duracionEditando === null || this.duracionEditando === undefined
        ? Number(servicio.duracion) || 30
        : Number(this.duracionEditando);

    if (!Number.isFinite(duracionAGuardar) || duracionAGuardar <= 0) {
      this.mostrarError('Duración inválida', 'Ingresá una duración mayor a cero.');
      return;
    }

    this.guardandoServicio = true;
    this.cdr.detectChanges();

    try {
      let fotoFinal = this.fotoUrlEditando.trim();

      if (this.archivoServicioEditando) {
        const urlSubida = await this.supabaseService.subirImagen(
          this.archivoServicioEditando,
          'barberia-media'
        );

        if (!urlSubida) {
          throw new Error('No se pudo subir la nueva foto del servicio.');
        }

        fotoFinal = urlSubida;
      } else if (!fotoFinal) {
        fotoFinal = String(servicio.foto_url ?? '');
      }

      const cambios: any = {
        nombre: this.nombreEditando.trim() || servicio.nombre,
        descripcion: this.descripcionEditando.trim(),
        precio: precioAGuardar,
        duracion: duracionAGuardar,
        foto_url: fotoFinal
      };

      const { error } = await this.supabaseService.actualizarServicio(
        servicio.id,
        cambios
      );

      if (error) throw error;

      this.listaServicios = this.listaServicios.map(s =>
        s.id === servicio.id
          ? {
              ...s,
              ...cambios
            }
          : s
      );

      this.cancelarEdicionServicio();
      await this.cargarServiciosDelLocal();

      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('Error al actualizar el servicio:', err);

      this.mostrarError(
        'Error al actualizar',
        err?.message || 'No se pudo actualizar el servicio. Revisá los datos e intentá nuevamente.'
      );
    } finally {
      this.guardandoServicio = false;
      this.cdr.detectChanges();
    }
  }

  async eliminarServicio(idServicio: number | string): Promise<void> {
    if (this.guardandoServicio || this.eliminandoServicioId !== null) return;

    if (this.localIdUsuario === null) {
      this.mostrarError('No se encontró el local', 'Volvé a iniciar sesión e intentá nuevamente.');
      return;
    }

    const idNumerico = Number(idServicio);

    if (!Number.isFinite(idNumerico)) {
      this.mostrarError('ID no válido', 'El ID del servicio no es válido.');
      return;
    }

    this.eliminandoServicioId = idServicio;
    this.cdr.detectChanges();

    try {
      const { error } =
        await this.supabaseService.eliminarServicio(idNumerico);

      if (error) throw error;

      this.listaServicios = this.listaServicios.filter(
        s => String(s.id) !== String(idServicio)
      );

      if (String(this.servicioEditandoId) === String(idServicio)) {
        this.cancelarEdicionServicio();
      }

      this.cdr.detectChanges();
      await this.cargarServiciosDelLocal();
    } catch (err: any) {
      console.error('Error al eliminar servicio:', err);

      this.mostrarError(
        'Error al eliminar',
        err?.message || 'No se pudo eliminar el servicio.'
      );
    } finally {
      this.eliminandoServicioId = null;
      this.cdr.detectChanges();
    }
  }

  // ---------------------------------------------------------
  // MENSAJES DE ERROR
  // ---------------------------------------------------------

  private mostrarError(titulo: string, detalle: string): void {
    this.mostrarModal = true;
    this.tipoModal = 'error';
    this.mensajeModal = titulo;
    this.subtituloModal = detalle;
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------
  // DÍAS CERRADOS Y EXCEPCIONES DE HORARIO
  // ---------------------------------------------------------

  toggleDiaCerrado(num: number): void {
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

  async guardarExcepcionFecha(): Promise<void> {
    if (this.localIdUsuario === null) return;

    if (!this.fechaBloqueo) {
      this.mostrarError(
        'Falta la fecha',
        'Seleccioná la fecha que querés bloquear o modificar.'
      );
      return;
    }

    if (!this.cerradoTotalExcepcion) {
      if (this.horaAperturaExcepcion >= this.horaCierreExcepcion) {
        this.mostrarError(
          'Horario inválido',
          'La hora de apertura debe ser anterior a la de cierre.'
        );
        return;
      }
    }

    // Activamos el modal de carga para evitar que parezca congelado
    this.mostrarModal = true;
    this.tipoModal = 'cargando';
    this.mensajeModal = 'Guardando excepción...';
    this.subtituloModal = 'Actualizando la información en Supabase.';
    this.cdr.detectChanges();

    const nuevaExcepcion: ExcepcionHorario = {
      fecha: this.fechaBloqueo,
      es_cerrado: this.cerradoTotalExcepcion,
      hora_apertura: this.cerradoTotalExcepcion
        ? null
        : this.horaAperturaExcepcion,
      hora_cierre: this.cerradoTotalExcepcion
        ? null
        : this.horaCierreExcepcion,
      motivo: this.motivoBloqueo?.trim() || null
    };

    const listaActualizada = [
      ...this.excepciones.filter(e => e.fecha !== this.fechaBloqueo),
      nuevaExcepcion
    ].sort((a, b) => a.fecha.localeCompare(b.fecha));

    try {
      const { data, error } = await this.supabaseService.actualizarLocal(
        this.localIdUsuario,
        { excepciones_horario: JSON.stringify(listaActualizada) }
      );

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error(
          'No se actualizó ninguna fila. Revisá los permisos sobre locales.'
        );
      }

      this.excepciones = listaActualizada;
      this.fechaBloqueo = '';
      this.motivoBloqueo = '';
      this.cerradoTotalExcepcion = true;
      this.horaAperturaExcepcion = '';
      this.horaCierreExcepcion = '';

      // Cambiamos a estado de éxito y cerramos automáticamente
      this.tipoModal = 'exito';
      this.mensajeModal = '¡Excepción guardada!';
      this.subtituloModal = 'Los cambios se registraron correctamente.';
      this.cdr.detectChanges();

      setTimeout(() => this.cerrarModal(), 1500);
    } catch (err: any) {
      console.error('Error al guardar excepción:', err);

      this.tipoModal = 'error';
      this.mensajeModal = 'Error al guardar';
      this.subtituloModal =
        err?.message || 'No se pudo guardar la excepción de horario.';
      this.cdr.detectChanges();
    }
  }

  async eliminarExcepcionFecha(fecha: string): Promise<void> {
    if (this.localIdUsuario === null) return;

    this.mostrarModal = true;
    this.tipoModal = 'cargando';
    this.mensajeModal = 'Eliminando excepción...';
    this.subtituloModal = 'Actualizando registros.';
    this.cdr.detectChanges();

    try {
      const listaActualizada = this.excepciones.filter(
        e => e.fecha !== fecha
      );

      const { data, error } = await this.supabaseService.actualizarLocal(
        this.localIdUsuario,
        { excepciones_horario: JSON.stringify(listaActualizada) }
      );

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error(
          'No se actualizó ninguna fila. Revisá los permisos sobre locales.'
        );
      }

      this.excepciones = listaActualizada;
      
      this.tipoModal = 'exito';
      this.mensajeModal = '¡Excepción eliminada!';
      this.subtituloModal = 'La excepción fue removida.';
      this.cdr.detectChanges();

      setTimeout(() => this.cerrarModal(), 1200);
    } catch (err: any) {
      console.error('Error al eliminar la excepción:', err);

      this.tipoModal = 'error';
      this.mensajeModal = 'Error al eliminar';
      this.subtituloModal =
        err?.message || 'No se pudo eliminar la excepción de horario.';
      this.cdr.detectChanges();
    }
  }

  // ---------------------------------------------------------
  // GUARDAR AJUSTES
  // ---------------------------------------------------------

  async guardarAjustes(): Promise<void> {
    if (this.localIdUsuario === null) {
      this.cerrarAjustes();
      return;
    }

    if (this.pestanaAjustes === 'horarios') {
      const {
        hora_apertura,
        hora_cierre,
        descanso_inicio,
        descanso_fin
      } = this.datosLocal;

      if (
        !hora_apertura ||
        !hora_cierre ||
        hora_apertura >= hora_cierre
      ) {
        this.mostrarError(
          'Horario inválido',
          'La hora de apertura debe ser anterior a la de cierre.'
        );
        return;
      }

      const descansoIncompleto =
        (!!descanso_inicio && !descanso_fin) ||
        (!descanso_inicio && !!descanso_fin);

      const descansoInvertido =
        !!descanso_inicio &&
        !!descanso_fin &&
        descanso_inicio >= descanso_fin;

      if (descansoIncompleto || descansoInvertido) {
        this.mostrarError(
          'Descanso inválido',
          'Completá inicio y fin del descanso con horarios válidos, o dejá ambos vacíos.'
        );
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
          const urlSubida = await this.supabaseService.subirImagen(
            this.archivoBanner,
            'barberia-media'
          );

          if (!urlSubida) {
            throw new Error('No se pudo subir la imagen del banner.');
          }

          bannerFinal = urlSubida;
        }

        if (this.archivoLogo) {
          const urlSubida = await this.supabaseService.subirImagen(
            this.archivoLogo,
            'barberia-media'
          );

          if (!urlSubida) {
            throw new Error('No se pudo subir la imagen del logo.');
          }

          logoFinal = urlSubida;
        }

        const { data, error } = await this.supabaseService.actualizarLocal(
          this.localIdUsuario,
          {
            banner_url: bannerFinal,
            logo_url: logoFinal
          }
        );

        if (error) throw error;

        if (!data || data.length === 0) {
          throw new Error(
            'No se actualizó ninguna fila. Revisá los permisos sobre locales.'
          );
        }

        this.datosLocal.banner_url = bannerFinal;
        this.datosLocal.logo_url = logoFinal;
        this.archivoBanner = null;
        this.archivoLogo = null;
        this.previewBanner = null;
        this.previewLogo = null;
      } else if (this.pestanaAjustes === 'horarios') {
        const { data, error } = await this.supabaseService.actualizarLocal(
          this.localIdUsuario,
          {
            hora_apertura: this.datosLocal.hora_apertura,
            hora_cierre: this.datosLocal.hora_cierre,
            descanso_inicio: this.datosLocal.descanso_inicio || null,
            descanso_fin: this.datosLocal.descanso_fin || null
          }
        );

        if (error) throw error;

        if (!data || data.length === 0) {
          throw new Error(
            'No se actualizó ninguna fila. Revisá los permisos sobre locales.'
          );
        }
      } else if (this.pestanaAjustes === 'feriados') {
        const { data, error } = await this.supabaseService.actualizarLocal(
          this.localIdUsuario,
          { es_cerrado: this.diasCerrados }
        );

        if (error) throw error;

        if (!data || data.length === 0) {
          throw new Error(
            'No se actualizó ninguna fila. Revisá los permisos sobre locales.'
          );
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
      this.subtituloModal =
        err?.message || 'No se pudieron actualizar los datos.';

      this.cdr.detectChanges();
    }
  }

  // ---------------------------------------------------------
  // FECHAS Y MODALES
  // ---------------------------------------------------------

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

    const fecha = new Date(
      fechaStr.includes('T') ? fechaStr : `${fechaStr}T00:00:00`
    );

    if (Number.isNaN(fecha.getTime())) return fechaStr;

    const opciones: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    };

    const texto = fecha.toLocaleDateString('es-ES', opciones);

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  cerrarModal(): void {
    this.mostrarModal = false;
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------
  // CIERRE DE SESIÓN Y NAVEGACIÓN
  // ---------------------------------------------------------

  async cerrarSesion(): Promise<void> {
    if (this.cerrandoSesion) return;

    this.cerrandoSesion = true;
    this.cdr.detectChanges();

    try {
      localStorage.removeItem('usuario_nombre');

      const cierre = (async () => {
        await this.supabaseService.removerTodosLosCanales();
        await this.supabaseService.logout();
      })();

      const tiempoMaximo = new Promise<void>(resolve =>
        setTimeout(resolve, 4000)
      );

      const tiempoMinimo = new Promise<void>(resolve =>
        setTimeout(resolve, 700)
      );

      await Promise.all([
        Promise.race([cierre, tiempoMaximo]),
        tiempoMinimo
      ]);
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    } finally {
      await this.router.navigate(['/login']);
      this.cerrandoSesion = false;
    }
  }

  navegarA(ruta: string): void {
    this.router.navigate([`/${ruta}`]);
  }

  async verPaginaPublica(): Promise<void> {
    if (this.localIdUsuario) {
      try {
        const local = await this.supabaseService.obtenerLocalPorId(
          this.localIdUsuario
        );

        const slugLocal =
          local?.slug ||
          (local?.nombre || local?.Nombre || '')
            .toLowerCase()
            .replace(/\s+/g, '-');

        window.open(`/${slugLocal}`, '_blank');
      } catch (err) {
        console.error('Error al abrir la página pública:', err);
        window.open(`/home/${this.localIdUsuario}`, '_blank');
      }
    } else {
      window.open('/home/1', '_blank');
    }
  }
}