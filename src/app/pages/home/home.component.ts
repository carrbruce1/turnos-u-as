import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';
import { RealtimeChannel } from '@supabase/supabase-js';

interface SlotHora {
  hora: string;
  ocupado: boolean;
}

interface DiaSemanaVista {
  nombreDia: string;
  numeroDia: number;
  fechaStr: string;
  horarios: SlotHora[];
  cerrado: boolean;
}

interface Servicio {
  id: number;
  local_id: number;
  nombre: string;
  descripcion?: string;
  precio: number;
  duracion: number;
}

interface ExcepcionHorario {
  es_cerrado: boolean;
  hora_apertura?: string | null;
  hora_cierre?: string | null;
}

@Component({
  selector: 'app-reserva',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit, OnDestroy {

  // 1: Servicio, 2: Detalles (observaciones), 3: Fecha/Hora, 4: Datos del cliente
  pasoActual: number = 1;
  private readonly totalPasos = 4;

  private fb = inject(FormBuilder);
  private supabaseService = inject(SupabaseService);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  localData: any = null;
  localId: number = 1;
  cargandoLocal = false;

  listaServicios: Servicio[] = [];
  diasCerradosLocal: number[] = [];

  excepcionesFecha: Map<string, ExcepcionHorario> = new Map();

  cargando = false;
  mostrarModal: boolean = false;
  tipoModal: 'cargando' | 'exito' | 'error' = 'cargando';

  resumenReservaModal: any = {
    nombre_cliente: '',
    servicio: '',
    fechaFormateada: '',
    hora: '',
    precio: 0
  };

  mensajeExito = false;

  horariosHabituales: string[] = ['09:00', '10:00', '11:00', '16:00', '17:00', '18:00', '19:00'];

  fechaActualNavegacion = new Date();
  fechaSeleccionadaStr = this.formatearFechaISO(new Date());
  horaSeleccionada: string | null = null;

  diasSemanaVista: DiaSemanaVista[] = [];
  nombreMesActual = '';

  reservasExistentes: any[] = [];

  private reservasSubscription: RealtimeChannel | null = null;
  private localSubscription: RealtimeChannel | null = null;

  reservaForm: FormGroup = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    apellido: ['', [Validators.required, Validators.minLength(2)]],
    telefono: ['', [Validators.required, Validators.pattern(/^[0-9\s\-+]+$/)]],
    servicio: ['', [Validators.required]],
    notas: ['', [Validators.maxLength(300)]], // opcional
    fecha: [this.fechaSeleccionadaStr, [Validators.required]],
    hora: ['', [Validators.required]]
  });

  ngOnInit() {
    this.route.paramMap.subscribe(async (params) => {
      const slugOrId = params.get('slug') || params.get('id') || '1';
      this.actualizarNombreMes();
      await this.cargarDatosDeSupabase(slugOrId);
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.reservasSubscription) {
      this.supabaseService.removerCanal(this.reservasSubscription);
    }
    if (this.localSubscription) {
      this.supabaseService.removerCanal(this.localSubscription);
    }
  }

  // ==========================================
  // NAVEGACIÓN DEL WIZARD
  // ==========================================
  siguientePaso(): void {
    if (this.pasoActual < this.totalPasos) {
      this.pasoActual++;
      this.cdr.detectChanges();
    }
  }

  pasoAnterior(): void {
    if (this.pasoActual > 1) {
      this.pasoActual--;
      this.cdr.detectChanges();
    }
  }

  esPasoDatosValido(): boolean {
    const nombre = this.f('nombre');
    const apellido = this.f('apellido');
    const telefono = this.f('telefono');
    return !!(nombre?.valid && apellido?.valid && telefono?.valid);
  }

  // Agrega una frase rápida al campo de observaciones (botones del paso 2)
  agregarNota(texto: string) {
    const ctrl = this.f('notas');
    if (!ctrl) return;
    const actual = String(ctrl.value || '').trim();
    const nuevo = actual ? `${actual}\n${texto}` : texto;
    ctrl.setValue(nuevo.slice(0, 300));
    ctrl.markAsDirty();
  }

  // ==========================================
  // LÓGICA CON SUPABASE Y DATOS
  // ==========================================
  async cargarDatosDeSupabase(identifier: string | number) {
    try {
      this.cargandoLocal = true;

      const data = await this.supabaseService.obtenerLocalPorSlug(identifier);

      if (!data) {
        console.warn('No se encontró el local con el identificador:', identifier);
        return;
      }

      this.aplicarDatosLocal(data);

      await Promise.all([
        this.cargarServiciosDelLocal(),
        this.cargarReservasDesdeSupabase()
      ]);

      this.construirVistaSemanal();
      this.suscribirACambiosRealtime();
      this.suscribirACambiosLocal();

    } catch (err) {
      console.error('Error al cargar datos desde Supabase:', err);
    } finally {
      this.cargandoLocal = false;
      this.cdr.detectChanges();
    }
  }

  private aplicarDatosLocal(data: any) {
    this.localData = data;
    this.localId = data.id;

    const rawDiasCerrados = data.es_cerrado || data.dias_cerrados;
    this.diasCerradosLocal = Array.isArray(rawDiasCerrados)
      ? rawDiasCerrados.map((n: any) => Number(n))
      : [];

    this.cargarExcepcionesDesde(data);
  }

  async cargarServiciosDelLocal() {
    try {
      const { data, error } = await this.supabaseService.obtenerServiciosPorLocal(this.localId);
      if (!error && data) {
        this.listaServicios = data;
      }
    } catch (err) {
      console.error('Error al obtener servicios:', err);
    }
  }

  suscribirACambiosLocal() {
    this.localSubscription = this.supabaseService.escucharCambiosLocal(this.localId, async () => {
      try {
        const data = await this.supabaseService.obtenerLocalPorId(this.localId);
        if (data) {
          this.aplicarDatosLocal(data);
          this.construirVistaSemanal();
          this.cdr.detectChanges();
        }
      } catch (err) {
        console.error('Error al refrescar datos del local en tiempo real:', err);
      }
    });
  }

  cargarExcepcionesDesde(localData: any) {
    try {
      this.excepcionesFecha.clear();

      if (!localData) return;

      const rawExcepcion = localData.excepcion_horario || localData.excepciones_horario;

      if (!rawExcepcion) return;

      let listaExcepciones: any[] = [];

      if (typeof rawExcepcion === 'string') {
        try {
          listaExcepciones = JSON.parse(rawExcepcion);
        } catch (e) {
          console.error('Error al parsear el JSON de excepcion_horario:', e);
        }
      } else if (Array.isArray(rawExcepcion)) {
        listaExcepciones = rawExcepcion;
      }

      for (const exc of listaExcepciones) {
        if (exc && exc.fecha) {
          this.excepcionesFecha.set(exc.fecha, {
            es_cerrado: exc.es_cerrado ?? exc.cerrado ?? false,
            hora_apertura: exc.hora_apertura || null,
            hora_cierre: exc.hora_cierre || null
          });
        }
      }
    } catch (err) {
      console.error('Error al procesar excepciones de horario:', err);
    }
  }

  obtenerNombreLocal(): string {
    return this.localData?.Nombre || this.localData?.nombre || 'CARGANDO LOCAL...';
  }

  obtenerUrlBanner(): string {
    const banner = this.localData?.banner_url || this.localData?.Banner_url;
    if (banner && banner.trim() !== '') {
      return banner.trim();
    }
    return 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=1600&auto=format&fit=crop';
  }

  seleccionarServicio(nombreServicio: string) {
    this.reservaForm.patchValue({ servicio: nombreServicio });
    this.reservaForm.get('servicio')?.markAsTouched();
    this.siguientePaso();
  }

  suscribirACambiosRealtime() {
    this.reservasSubscription = this.supabaseService.escucharCambiosReservas(async () => {
      await this.cargarReservasDesdeSupabase();
      this.construirVistaSemanal();
      this.cdr.detectChanges();
    });
  }

  f(campo: string) {
    return this.reservaForm.get(campo);
  }

  async cargarReservasDesdeSupabase() {
    try {
      const res = await this.supabaseService.obtenerReservasPorLocal(this.localId);
      const data = res.data;
      const error = res.error;

      if (!error && data) {
        this.reservasExistentes = data.filter((r: any) => {
          const est = r.estado ? String(r.estado).toLowerCase().trim() : '';
          return est !== 'cancelado' && est !== 'rechazado';
        });
      }
    } catch (err) {
      console.error('Error al cargar reservas:', err);
    }
  }

  formatearFechaISO(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  formatearFechaLarga(fechaStr: string): string {
    if (!fechaStr) return '';

    const fecha = new Date(fechaStr.includes('T') ? fechaStr : `${fechaStr}T00:00:00`);

    if (isNaN(fecha.getTime())) {
      return fechaStr;
    }

    const opciones: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    };

    const texto = fecha.toLocaleDateString('es-ES', opciones);

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  esSlotPasado(fechaStr: string, horaStr: string): boolean {
    const ahora = new Date();
    const hoyStr = this.formatearFechaISO(ahora);

    if (fechaStr < hoyStr) {
      return true;
    }

    if (fechaStr === hoyStr) {
      const [horaSlot, minSlot] = horaStr.split(':').map(Number);
      const horaActual = ahora.getHours();
      const minActual = ahora.getMinutes();

      if (horaSlot < horaActual) {
        return true;
      }

      if (horaSlot === horaActual && minSlot <= minActual) {
        return true;
      }
    }

    return false;
  }

  actualizarNombreMes() {
    const ano = this.fechaActualNavegacion.getFullYear();
    const mes = this.fechaActualNavegacion.getMonth();

    const nombresMeses = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    this.nombreMesActual = `${nombresMeses[mes]} ${ano}`;
  }

  generarHorariosDinamicos(dataLocal?: any): string[] {
    const local = dataLocal || this.localData;

    if (!local || !local.hora_apertura || !local.hora_cierre) {
      return this.horariosHabituales;
    }

    const aMinutos = (hStr: any): number => {
      if (!hStr || typeof hStr !== 'string') {
        return -1;
      }

      const partes = hStr.trim().substring(0, 5).split(':').map(Number);

      if (partes.length < 2 || isNaN(partes[0]) || isNaN(partes[1])) {
        return -1;
      }

      return partes[0] * 60 + partes[1];
    };

    const aFormatoHora = (minTotales: number): string => {
      const h = String(Math.floor(minTotales / 60)).padStart(2, '0');
      const m = String(minTotales % 60).padStart(2, '0');
      return `${h}:${m}`;
    };

    const minApertura = aMinutos(local.hora_apertura);
    const minCierre = aMinutos(local.hora_cierre);
    const minDescInicio = aMinutos(local.descanso_inicio);
    const minDescFin = aMinutos(local.descanso_fin);

    if (minApertura === -1 || minCierre === -1 || minApertura >= minCierre) {
      return this.horariosHabituales;
    }

    const slots: string[] = [];
    const duracionTurnoMinutos = 60;

    for (let minActual = minApertura; minActual < minCierre; minActual += duracionTurnoMinutos) {
      const estaEnDescanso =
        (minDescInicio !== -1 && minDescFin !== -1) &&
        (minActual >= minDescInicio && minActual < minDescFin);

      if (!estaEnDescanso) {
        slots.push(aFormatoHora(minActual));
      }
    }

    return slots.length > 0 ? slots : this.horariosHabituales;
  }

  construirVistaSemanal() {
    const nuevasColumnas = [];
    const baseDate = new Date(this.fechaActualNavegacion);
    const nombresDias = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

    const horariosHabitualesDelLocal = this.generarHorariosDinamicos(this.localData);

    for (let i = 0; i < 5; i++) {
      const current = new Date(baseDate);
      current.setDate(baseDate.getDate() + i);

      const diaIndice = current.getDay();
      const fStr = this.formatearFechaISO(current);

      const excepcion = this.excepcionesFecha.get(fStr);

      let esDiaCerrado = this.diasCerradosLocal.includes(diaIndice);
      let horariosDelDia = horariosHabitualesDelLocal;

      if (excepcion) {
        if (excepcion.es_cerrado) {
          esDiaCerrado = true;
        } else {
          esDiaCerrado = false;
          horariosDelDia = this.generarHorariosDinamicos({
            hora_apertura: excepcion.hora_apertura,
            hora_cierre: excepcion.hora_cierre,
            descanso_inicio: null,
            descanso_fin: null
          });
        }
      }

      const slots: SlotHora[] = horariosDelDia.map(h => {
        const estaOcupado = this.reservasExistentes.some(r => {
          const horaReserva = r.hora ? String(r.hora).substring(0, 5) : '';
          return r.fecha === fStr && horaReserva === h;
        });

        const esPasado = this.esSlotPasado(fStr, h);

        return { hora: h, ocupado: estaOcupado || esPasado || esDiaCerrado };
      });

      nuevasColumnas.push({
        nombreDia: nombresDias[diaIndice],
        numeroDia: current.getDate(),
        fechaStr: fStr,
        horarios: slots,
        cerrado: esDiaCerrado
      });
    }

    this.diasSemanaVista = [...nuevasColumnas];
  }

  cambiarSemana(delta: number) {
    this.fechaActualNavegacion.setDate(this.fechaActualNavegacion.getDate() + (delta * 5));
    this.actualizarNombreMes();
    this.construirVistaSemanal();
  }

  seleccionarSlot(fechaStr: string, hora: string) {
    if (this.esSlotPasado(fechaStr, hora)) {
      return;
    }

    this.fechaSeleccionadaStr = fechaStr;
    this.horaSeleccionada = hora;

    this.reservaForm.patchValue({
      fecha: fechaStr,
      hora: hora
    });
  }

  async onSubmit() {
    if (this.reservaForm.invalid) {
      this.reservaForm.markAllAsTouched();
      return;
    }

    this.cargando = true;
    this.mostrarModal = true;
    this.tipoModal = 'cargando';
    this.mensajeExito = false;

    const val = this.reservaForm.value;
    const nombreCompleto = `${val.nombre.trim()} ${val.apellido.trim()}`;

    // Precio del servicio seleccionado
    const servicioSeleccionado = this.listaServicios.find(srv => srv.nombre === val.servicio);
    const precioServicio = servicioSeleccionado?.precio ?? 0;

    const nuevaReserva = {
      local_id: this.localId,
      nombre_cliente: nombreCompleto,
      telefono_cliente: val.telefono,
      servicio: val.servicio,
      notas: (val.notas || '').trim() || null, // columna "notas" de reservas
      fecha: val.fecha,
      hora: val.hora,
      estado: 'pendiente'
    };

    try {
      const promesaCrear = this.supabaseService.crearReserva(nuevaReserva);

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout de red')), 8000)
      );

      const resultado: any = await Promise.race([promesaCrear, timeout]);
      const error = resultado?.error;

      if (error) {
        throw error;
      }

      this.mensajeExito = true;
      this.tipoModal = 'exito';

      this.resumenReservaModal = {
        nombre_cliente: nuevaReserva.nombre_cliente,
        servicio: nuevaReserva.servicio,
        fechaFormateada: this.formatearFechaLarga(nuevaReserva.fecha),
        hora: nuevaReserva.hora,
        precio: precioServicio
      };

      await this.cargarReservasDesdeSupabase();
      this.construirVistaSemanal();

      this.reservaForm.patchValue({
        nombre: '',
        apellido: '',
        telefono: '',
        servicio: '',
        notas: '',
        hora: ''
      });

      this.horaSeleccionada = null;

    } catch (err: any) {
      console.error('Error al guardar reservas:', err?.message || err);
      this.tipoModal = 'error';
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  cerrarModal() {
    this.mostrarModal = false;
    this.pasoActual = 1;
    this.cdr.detectChanges();
  }
}